import { expect, test } from 'claude-code/testing'

import * as Sel from '../hooks/select'
import type { Choices, HabitWeek, Report, Tip, WeekRow } from '../types'
import { REPORT } from './fixtures/report'
import { NOW } from './helpers'

const DAY = 24 * 60 * 60 * 1000
const prev = REPORT.previous as WeekRow
const choices = (patch: Partial<Choices> = {}): Choices => ({ ...Sel.EMPTY_CHOICES, ...patch })

function habit(patch: Partial<HabitWeek>): HabitWeek {
  return { value: 0.2, sample: 10, target: 0.5, min: 5, eligible: true, impactUsd: 1, evidence: [], done: 2, total: 10, ...patch }
}

function tip(id: string, patch: Partial<Tip> = {}): Tip {
  return { id, family: 'tip', level: 1, category: id, score: 0.5, impactUsd: null, count: 1, evidence: [], numbers: {}, conflicts: [], ...patch }
}

function withRow(row: Partial<WeekRow>): [Report, WeekRow] {
  const merged = { ...prev, ...row }
  return [{ ...REPORT, previous: merged, weeks: [...REPORT.weeks.slice(0, -1), merged] }, merged]
}

test('the report shows the last full week, and an early read when there is none', () => {
  expect(Sel.shownRow(REPORT, null)?.week).toBe('2026-09-28')
  const early = { ...prev, week: 'recent' }
  expect(Sel.shownRow({ ...REPORT, recent: early }, null)?.week).toBe('recent')
  expect(Sel.shownRow(REPORT, '2026-09-21')?.week).toBe('2026-09-21')
})

test('a new habit is the eligible one with the most at stake', () => {
  const [report, row] = withRow({
    habits: { 'say-done': habit({ impactUsd: 1 }), 'check-work': habit({ impactUsd: 3 }), 'plan-big': habit({ eligible: false, impactUsd: 9 }) },
  })
  expect(Sel.chooseHabit(report, row, choices(), NOW)).toEqual({ habit: 'check-work', learned: null, reason: 'new' })
})

test('a habit stays for two weeks while it still has room to grow', () => {
  const [report, row] = withRow({
    habits: { 'say-done': habit({ impactUsd: 1 }), 'check-work': habit({ impactUsd: 3 }) },
  })
  const log = [{ week: '2026-09-21', habit: 'say-done' as const, status: 'active' as const }]
  expect(Sel.chooseHabit(report, row, choices({ habitLog: log }), NOW).habit).toBe('say-done')
})

test('met two weeks running, a habit is learned and the next one starts', () => {
  const [base, row] = withRow({
    habits: { 'say-done': habit({ value: 0.6, target: 0.4, eligible: false }), 'check-work': habit({ impactUsd: 3 }) },
  })
  const report = { ...base, history: base.history.map(w => (w.week === '2026-09-21' ? { ...w, habits: { ...w.habits, 'say-done': 0.5 } } : w)) }
  const log = [{ week: '2026-09-21', habit: 'say-done' as const, status: 'active' as const }]
  expect(Sel.chooseHabit(report, row, choices({ habitLog: log }), NOW)).toEqual({ habit: 'check-work', learned: 'say-done', reason: 'new' })
})

test('a habit picked away from this week is not offered again this week', () => {
  const [report, row] = withRow({ habits: { 'say-done': habit({ impactUsd: 1 }), 'check-work': habit({ impactUsd: 3 }) } })
  const log = [{ week: row.week, habit: 'check-work' as const, status: 'skipped' as const }]
  expect(Sel.chooseHabit(report, row, choices({ habitLog: log }), NOW).habit).toBe('say-done')
  expect(Sel.nextHabit(row, 'check-work', choices())).toBe('say-done')
})

test('nothing eligible, no habit', () => {
  const [report, row] = withRow({ habits: { 'say-done': habit({ eligible: false }) } })
  expect(Sel.chooseHabit(report, row, choices(), NOW)).toEqual({ habit: null, learned: null, reason: 'none' })
})

test('tips: the top two of different kinds, and none the person turned away', () => {
  const [report, row] = withRow({
    notices: [],
    tips: [
      tip('a', { category: 'cost', score: 0.9 }),
      tip('b', { category: 'cost', score: 0.8 }),
      tip('c', { category: 'flow', score: 0.7 }),
      tip('d', { category: 'context', score: 0.6 }),
      tip('low', { category: 'setup', score: 0.1 }),
    ],
  })
  expect(Sel.chooseTips(report, row, choices(), null, NOW).map(t => t.id)).toEqual(['a', 'c'])
  const away = choices({ tips: { a: { dismissedAt: NOW, shownWeeks: [] }, c: { snoozedUntil: NOW + DAY, shownWeeks: [] } } })
  expect(Sel.chooseTips(report, row, away, null, NOW).map(t => t.id)).toEqual(['b', 'd'])
})

test('tips past the next level wait, except safety', () => {
  const [report, row] = withRow({
    notices: [],
    tips: [tip('power', { level: 3, category: 'flow' }), tip('safe', { level: 3, category: 'safety' })],
  })
  expect(Sel.chooseTips({ ...report, level: 0 }, row, choices(), null, NOW).map(t => t.id)).toEqual(['safe'])
  expect(Sel.chooseTips({ ...report, level: 2 }, row, choices(), null, NOW).map(t => t.id)).toEqual(['power', 'safe'])
})

test('a tip that repeats the habit of the week waits', () => {
  const [report, row] = withRow({ notices: [], tips: [tip('compaction-pressure', { conflicts: ['fresh-start'] })] })
  expect(Sel.chooseTips(report, row, choices(), 'fresh-start', NOW)).toEqual([])
})

test('a tip shown two weeks running with nothing done rests for four weeks', () => {
  const shown = choices({ tips: { a: { shownWeeks: ['2026-09-14', '2026-09-21'] } } })
  const next = Sel.recordShown(shown, [tip('a')], '2026-09-28', ['2026-09-14', '2026-09-21'], NOW)
  expect(next.tips.a?.snoozedUntil).toBe(NOW + 28 * DAY)
})

test('a detector flagged wrong three times in four weeks goes quiet', () => {
  const flags = [1, 2, 3].map(i => ({ detector: 'fresh-start', evidenceId: `x${i}`, at: NOW - i * DAY }))
  expect(Sel.detectorOff(choices({ notRight: flags }), 'fresh-start', NOW)).toBe(true)
  expect(Sel.detectorOff(choices({ notRight: flags.slice(1) }), 'fresh-start', NOW)).toBe(false)
})

test('CLAUDE.md cards drop dismissed lines, and empty cards', () => {
  const card = REPORT.suggestions.claudeMd.find(c => c.project === 'my-app')
  if (!card) throw new Error('fixture has no my-app card')
  const first = card.lines[0]?.id ?? ''
  const fewer = Sel.claudeMdCards(REPORT, choices({ tips: { [first]: { dismissedAt: NOW, shownWeeks: [] } } }), NOW)
  expect(fewer.find(c => c.id === card.id)?.lines.map(l => l.id)).not.toContain(first)
  const gone = Sel.claudeMdCards(REPORT, choices({ tips: { [card.id]: { dismissedAt: NOW, shownWeeks: [] } } }), NOW)
  expect(gone.find(c => c.id === card.id)).toBeUndefined()
  expect(Sel.claudeMdText(card)).toBe('- Test: `pnpm test` (one file: `pnpm test <path>`)\n- Use `pnpm`, not `npm`.')
})

test('a line taken up is noticed, then judged a week later, once', () => {
  const covered = { id: 'claude-md:my-app:S1:test', project: 'my-app', source: 'S1', text: '- Test: `pnpm test`', sessions: 5, events: 0 }
  const report = { ...REPORT, suggestions: { ...REPORT.suggestions, claudeMdCovered: [covered] } }
  const [adopted, none] = Sel.wins(report, choices(), new Set([covered.id]), NOW)
  expect(none).toEqual([])
  expect(adopted.adoptions[covered.id]?.at).toBe(NOW)
  const [told, said] = Sel.wins(report, adopted, new Set(), NOW + 8 * DAY)
  expect(said.map(w => w.text)).toEqual(['Since you added Test: `pnpm test` to CLAUDE.md, Claude went straight to it in 5 of 5 sessions.'])
  expect(Sel.wins(report, told, new Set(), NOW + 9 * DAY)[1]).toEqual([])
})

test('the bar: hidden, ready, the habit, or a nudge', () => {
  expect(Sel.barState(null, choices(), null, NOW).kind).toBe('hidden')
  expect(Sel.barState(REPORT, choices({ barHidden: true }), null, NOW).kind).toBe('hidden')
  expect(Sel.barState(REPORT, choices(), null, NOW)).toEqual({ kind: 'ready', first: true, days: 23 })
  const seen = choices({ lastSeenWeek: '2026-09-28', firstReportWeek: '2026-09-28', habitLog: [{ week: '2026-09-28', habit: 'fresh-start', status: 'active' }] })
  expect(Sel.barState(REPORT, seen, null, NOW).kind).toBe('habit')
  expect(Sel.barState(REPORT, seen, { text: 'hi', at: NOW - 60_000 }, NOW)).toEqual({ kind: 'nudge', text: 'hi' })
  expect(Sel.barState(REPORT, seen, { text: 'hi', at: NOW - 3 * 60_000 }, NOW).kind).toBe('habit')
})
