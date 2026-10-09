import { expect, test } from 'claude-code/testing'

import * as A from '../hooks/art'
import * as F from '../hooks/figures'
import type { WeekRow } from '../types'
import { REPORT } from './fixtures/report'

const prev = REPORT.previous as WeekRow

const HERO: A.Hero = {
  kicker: 'COACH · WEEK 1',
  title: 'Your week with Claude',
  subline: '28 Sep to 4 Oct · 5 active days',
  stats: [
    { label: 'Sessions', value: '10', delta: '▲ 25%', tone: 'flat' },
    { label: 'Prompts', value: '18', delta: null, tone: 'flat' },
    { label: 'Spent', value: '$6.14', delta: '▲ 40%', tone: 'bad' },
    { label: 'Typical cost per prompt', value: '$0.31', delta: '▼ 20%', tone: 'good' },
  ],
  days: F.weekDays(prev),
  daysTitle: 'SPEND BY DAY',
  caption: 'Arrows compare with your average for the 4 weeks before.',
}

test('the hero sets its words as text, escaped', () => {
  const { source } = A.heroSvg({ ...HERO, title: 'Fish & <chips>' }, 720)
  expect(source).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="720" height="\d+"/)
  expect(source).toContain('>Fish &amp; &lt;chips&gt;</text>')
  expect(source).not.toContain('<chips>')
  for (const word of ['COACH · WEEK 1', '$6.14', 'Typical cost per prompt', '▲ 40%', 'SPEND BY DAY']) expect(source).toContain(word)
})

test('a narrow hero stacks its numbers two by two, and its day chart under the title', () => {
  const wide = A.heroSvg(HERO, 720)
  const narrow = A.heroSvg(HERO, 380)
  expect(narrow.height).toBeGreaterThan(wide.height + 100)
  expect(narrow.source).toContain('width="380"')
})

test('the costliest day is the one labelled, on its own day of the week', () => {
  const days = F.weekDays(prev)
  expect(days.map(d => d.letter).join('')).toBe('MTWTFSS')
  expect(days.map(d => d.usd)).toEqual([0.2618, 0.5051, 2.3319, 1.1974, 1.8445, 0, 0])
  const { source } = A.heroSvg(HERO, 720)
  expect(source).toContain('>$2.33</text>')
  expect(source).not.toContain('>$1.84</text>')
})

test('a tile is good, bad or no news against the 4 weeks before', () => {
  const tile = (now: number, avg: number | null, better: F.Better): F.Tile => ({ label: 'x', value: '', now, avg, better })
  expect(F.change(tile(5, null, 'down'))).toBeNull()
  expect(F.change(tile(105, 100, 'down'))?.tone).toBe('flat')
  expect(F.change(tile(150, 100, null))?.tone).toBe('flat')
  expect(F.change(tile(150, 100, 'down'))?.tone).toBe('bad')
  expect(F.change(tile(50, 100, 'down'))?.tone).toBe('good')
})

test('the ring draws the share against its goal, and none before there is one', () => {
  const partway = A.ringSvg(0.3, 0.7, '30%', 'goal 70%', false)
  expect(partway).toContain(`stroke="${A.TONE.claude}"`)
  expect(partway).toContain('>30%</text>')
  const met = A.ringSvg(0.8, 0.7, '80%', 'goal 70%', true)
  expect(met).toContain(`stroke="${A.TONE.good}"`)
  const none = A.ringSvg(null, 0.7, '—', 'goal 70%', false)
  expect(none).not.toContain('stroke-dasharray')
})

test('a progress line breaks where a week is missing, and says which way it went', () => {
  const history = F.progressWeeks(REPORT, prev)
  const trends = F.trendsOf(
    [
      { label: 'Down is good', values: [4, null, 3, 2], better: 'down', format: String },
      { label: 'From nothing', values: [0, 1, 2], better: 'down', format: String },
      { label: 'Flat', values: [1, 1], better: 'up', format: String },
    ],
    history,
  )
  expect(trends.map(t => [t.delta, t.tone])).toEqual([
    ['▼ 50%', 'good'],
    ['▲ from 0', 'bad'],
    ['steady', 'flat'],
  ])
  // [4, null, 3, 2]: the first week stands alone, so the one line is the last two
  const lines = A.trendsSvg(trends.slice(0, 1), 640).source.match(/<path d="(M[^"]*)" fill="none"/g) ?? []
  expect(lines.length).toBe(1)
  expect(lines[0]?.match(/[ML]/g)?.join('')).toBe('ML')
})

test('the toolkit shows the next level up, and marks the feature to try next', () => {
  const levels = F.toolkitOf(REPORT)
  expect(levels.map(l => [l.name, l.count])).toEqual([['The basics', '2 of 6']])
  const chips = levels[0]?.chips ?? []
  expect(chips.find(c => c.text === 'CLAUDE.md')?.state).toBe('next')
  expect(chips.find(c => c.text === 'Asking for checks')?.state).toBe('used')
  expect(chips.find(c => c.text === 'Screenshots')?.state).toBe('open')
  const { source, height } = A.toolkitSvg(levels, 300)
  expect(source).toContain('→ CLAUDE.md')
  expect(height).toBeGreaterThan(60)
})

test('a label too long for its room is cut with an ellipsis', () => {
  expect(A.fit('Short', 12, 200)).toBe('Short')
  const cut = A.fit('Steps spent rediscovering projects', 12, 80)
  expect(cut.endsWith('…')).toBe(true)
  expect(A.textWidth(cut, 12)).toBeLessThanOrEqual(80)
})
