/**
 * What to show, from the report and the person's own choices (SPEC.md §9):
 * the week, the habit of the week, the tips, the cards, and the wins. Pure
 * functions, so every rule is a plain test.
 */
import type {
  Choices,
  ClaudeMdCard,
  HabitId,
  Report,
  SkillCard,
  Tip,
  WeekRow,
} from '../types'

const DAY = 24 * 60 * 60 * 1000
const WEEK = 7 * DAY
const HABITS: HabitId[] = ['fresh-start', 'point-to-place', 'say-done', 'check-work', 'plan-big']
const LEARNED_REST_WEEKS = 8
const TIP_MIN_SCORE = 0.3
const DETECTOR_OFF_FLAGS = 3

export const EMPTY_CHOICES: Choices = {
  firstReportWeek: null,
  lastSeenWeek: null,
  habitLog: [],
  tips: {},
  notRight: [],
  hints: { lastShownAt: {}, day: '', count: 0, off: [] },
  grading: {},
  adoptions: {},
  barHidden: false,
}

/** The full weeks the pane can show, oldest first, plus this week so far. */
export function rows(report: Report): WeekRow[] {
  const out: WeekRow[] = []
  const seen = new Set<string>()
  for (const row of [...(report.weeks ?? []), report.previous, report.current]) {
    if (row && !seen.has(row.week)) {
      seen.add(row.week)
      out.push(row)
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/**
 * The week the report shows unless the person picked another: the last full
 * week, or the last 7 days as an early read when no full week has enough days.
 */
export function shownRow(report: Report, week: string | null): WeekRow | null {
  if (week) {
    if (week === 'recent' && report.recent) return report.recent
    const hit = rows(report).find(r => r.week === week)
    if (hit) return hit
  }
  return report.recent ?? report.previous ?? report.current
}

export function isEarlyRead(row: WeekRow): boolean {
  return row.week === 'recent'
}

// -- "Not right?"

export function isNotRight(choices: Choices, evidenceId: string): boolean {
  return choices.notRight.some(n => n.evidenceId === evidenceId)
}

/** A detector flagged wrong 3 times within 4 weeks is turned off for this person. */
export function detectorOff(choices: Choices, detector: string, now: number): boolean {
  return (
    choices.notRight.filter(n => n.detector === detector && now - n.at <= 4 * WEEK).length >=
    DETECTOR_OFF_FLAGS
  )
}

export function offDetectors(choices: Choices, now: number): string[] {
  const names = new Set(choices.notRight.map(n => n.detector))
  return [...names].filter(name => detectorOff(choices, name, now))
}

// -- the habit of the week (SPEC.md §9.1)

export type HabitChoice = {
  habit: HabitId | null
  /** A habit met two weeks running, said once. */
  learned: HabitId | null
  /** Why this one: kept from earlier weeks, picked fresh, or none needed. */
  reason: 'kept' | 'new' | 'none'
}

function metTarget(row: WeekRow | undefined, habit: HabitId): boolean {
  const h = row?.habits[habit]
  return !!h && h.value !== null && h.sample >= h.min && h.value >= h.target
}

function summaryMet(report: Report, week: string, habit: HabitId): boolean {
  const summary = report.history.find(h => h.week === week)
  const value = summary?.habits[habit]
  const target = report.previous?.habits[habit]?.target ?? 1
  return value !== undefined && value !== null && value >= target
}

/** The week before `row`'s, by id. */
function weekBefore(report: Report, row: WeekRow): string | null {
  const before = report.history.filter(h => h.start < row.start)
  return before.length ? (before[before.length - 1]?.week ?? null) : null
}

export function chooseHabit(report: Report, row: WeekRow, choices: Choices, now: number): HabitChoice {
  const log = [...choices.habitLog].sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0))
  const skipped = new Set(log.filter(l => l.week === row.week && l.status === 'skipped').map(l => l.habit))
  const recentlyLearned = new Set(
    log
      .filter(l => l.status === 'learned' && row.start - Date.parse(`${l.week}T00:00:00`) < LEARNED_REST_WEEKS * WEEK)
      .map(l => l.habit),
  )
  const offs = new Set(offDetectors(choices, now))
  const eligible = HABITS.filter(h => {
    const status = row.habits[h]
    return status?.eligible && !skipped.has(h) && !recentlyLearned.has(h) && !offs.has(h)
  })
  const earlier = log.filter(l => l.week < row.week)
  const active = [...earlier].reverse().find(l => l.status === 'active')
  let learned: HabitId | null = null
  if (active && !skipped.has(active.habit)) {
    const before = weekBefore(report, row)
    if (metTarget(row, active.habit) && before && summaryMet(report, before, active.habit)) {
      learned = active.habit
    } else {
      const weeksOn = earlier.filter(l => l.habit === active.habit && l.status === 'active').length
      const status = row.habits[active.habit]
      const noSample = !status || status.sample < status.min
      const stillWanted = status?.eligible || (noSample && weeksOn < 2)
      if (stillWanted && (weeksOn < 2 || status?.eligible)) {
        return { habit: active.habit, learned: null, reason: 'kept' }
      }
    }
  }
  const sameWeek = log.find(l => l.week === row.week && l.status === 'active')
  if (sameWeek && eligible.includes(sameWeek.habit)) {
    return { habit: sameWeek.habit, learned, reason: 'kept' }
  }
  const pool = eligible.filter(h => h !== learned)
  if (!pool.length) return { habit: null, learned, reason: 'none' }
  const best = [...pool].sort((a, b) => {
    const ha = row.habits[a]
    const hb = row.habits[b]
    const diff = (hb?.impactUsd ?? 0) - (ha?.impactUsd ?? 0)
    if (diff !== 0) return diff
    const gap = (h: typeof ha) => (h && h.value !== null ? (h.target - h.value) / h.target : 0)
    return gap(hb) - gap(ha)
  })[0]
  return { habit: best ?? null, learned, reason: 'new' }
}

/** The next habit when the person presses "Pick another habit". */
export function nextHabit(row: WeekRow, current: HabitId, choices: Choices): HabitId | null {
  const skipped = new Set(choices.habitLog.filter(l => l.week === row.week && l.status === 'skipped').map(l => l.habit))
  const pool = HABITS.filter(h => h !== current && !skipped.has(h) && row.habits[h]?.eligible)
  return pool.sort((a, b) => (row.habits[b]?.impactUsd ?? 0) - (row.habits[a]?.impactUsd ?? 0))[0] ?? null
}

/** This week's progress on a habit, for the bar: "2 of 3 switches". */
export function progress(report: Report, habit: HabitId): { done: number; total: number } | null {
  const h = report.current?.habits[habit]
  return h && h.total > 0 ? { done: h.done, total: h.total } : null
}

/** The habit the bar keeps in view: the one logged for the latest week. */
export function activeHabit(choices: Choices): HabitId | null {
  const log = [...choices.habitLog]
    .filter(l => l.status === 'active')
    .sort((a, b) => (a.week < b.week ? -1 : 1))
  return log[log.length - 1]?.habit ?? null
}

// -- tips (SPEC.md §9.3)

export function tipVisible(tip: Tip, report: Report, row: WeekRow, choices: Choices, habit: HabitId | null, now: number): boolean {
  const mine = choices.tips[tip.id]
  if (mine?.dismissedAt) return false
  if (mine?.snoozedUntil && mine.snoozedUntil > now) return false
  if (tip.category !== 'safety' && tip.level > report.level + 1) return false
  if (habit && tip.conflicts.includes(habit)) return false
  if (tip.score < TIP_MIN_SCORE) return false
  if (detectorOff(choices, tip.id, now)) return false
  if (tip.evidence.length && tip.evidence.every(id => isNotRight(choices, id))) return false
  // The bypass notice already says it, in "Also noticed".
  if (tip.id === 'bypass-to-auto' && row.notices.some(n => n.id === 'bypass')) return false
  return true
}

export function chooseTips(
  report: Report,
  row: WeekRow,
  choices: Choices,
  habit: HabitId | null,
  now: number,
  limit = 2,
): Tip[] {
  const out: Tip[] = []
  const categories = new Set<string>()
  for (const tip of [...row.tips].sort((a, b) => b.score - a.score)) {
    if (!tipVisible(tip, report, row, choices, habit, now) || categories.has(tip.category)) continue
    out.push(tip)
    categories.add(tip.category)
    if (out.length >= limit) break
  }
  return out
}

/** Every tip still worth showing, for /coach tips. */
export function allTips(report: Report, row: WeekRow, choices: Choices, habit: HabitId | null, now: number): Tip[] {
  return [...row.tips]
    .filter(t => tipVisible({ ...t, score: Math.max(t.score, TIP_MIN_SCORE) }, report, row, choices, habit, now))
    .sort((a, b) => b.score - a.score)
}

/**
 * A tip shown in the two weeks before this one with nothing done about it
 * rests for 4 weeks: -> the choices with this week's showing recorded.
 */
export function recordShown(choices: Choices, tips: Tip[], week: string, previousWeeks: string[], now: number): Choices {
  const next: Choices = { ...choices, tips: { ...choices.tips } }
  for (const tip of tips) {
    const mine = next.tips[tip.id] ?? { shownWeeks: [] }
    const shown = mine.shownWeeks.includes(week) ? mine.shownWeeks : [...mine.shownWeeks, week].slice(-8)
    const ranBefore = previousWeeks.slice(-2).every(w => shown.includes(w)) && previousWeeks.length >= 2
    next.tips[tip.id] = ranBefore ? { ...mine, shownWeeks: [], snoozedUntil: now + 4 * WEEK } : { ...mine, shownWeeks: shown }
  }
  return next
}

// -- CLAUDE.md and skill cards (SPEC.md §9.6, §9.7)

export function claudeMdCards(report: Report, choices: Choices, now: number): ClaudeMdCard[] {
  const out: ClaudeMdCard[] = []
  const offs = new Set(offDetectors(choices, now))
  for (const card of report.suggestions.claudeMd) {
    if (choices.tips[card.id]?.dismissedAt) continue
    const lines = card.lines.filter(
      l =>
        !choices.tips[l.id]?.dismissedAt &&
        !offs.has(`claude-md-${l.source}`) &&
        !(l.evidence.length && l.evidence.every(id => isNotRight(choices, id))),
    )
    const files = card.pointers.files.filter(f => !choices.tips[`${card.id}:file:${f}`]?.dismissedAt)
    const tasks = card.pointers.tasks.filter(t => !choices.tips[`${card.id}:task:${t}`]?.dismissedAt)
    // A card left with only "too long" says nothing the claude-md-too-long tip doesn't.
    if (!lines.length && !files.length && !tasks.length && !card.notes.some(n => n.id !== 'too-long')) continue
    out.push({ ...card, lines, pointers: { files, tasks } })
  }
  return out
}

export function skillCards(report: Report, choices: Choices, now: number): SkillCard[] {
  return report.suggestions.skills.filter(
    c =>
      !choices.tips[c.id]?.dismissedAt &&
      !detectorOff(choices, 'skill', now) &&
      !(c.evidence.length && c.evidence.every(id => isNotRight(choices, id))),
  )
}

/** The text "Copy" puts on the clipboard for a CLAUDE.md card. */
export function claudeMdText(card: ClaudeMdCard): string {
  return card.lines.map(l => l.text).filter(Boolean).join('\n')
}

// -- did it help (SPEC.md §9.6, §9.7)

export type Win = { id: string; text: string }

/**
 * -> (the choices with new adoptions recorded, the wins to say this time).
 * A line counts as adopted when a CLAUDE.md now holds a line coach suggested
 * before; it is judged once it has had a week of sessions to show it.
 */
export function wins(report: Report, choices: Choices, suggestedBefore: Set<string>, now: number): [Choices, Win[]] {
  const adoptions = { ...choices.adoptions }
  const out: Win[] = []
  for (const line of report.suggestions.claudeMdCovered) {
    const known = adoptions[line.id]
    if (!known) {
      if (suggestedBefore.has(line.id)) {
        adoptions[line.id] = { at: now, baseline: { sessions: line.sessions, events: line.events }, text: line.text }
      }
      continue
    }
    if (known.told || now - known.at < WEEK || line.sessions < 2) continue
    const straight = Math.max(0, line.sessions - line.events)
    const text =
      line.source === 'S1'
        ? `Since you added ${line.text.replace(/^- /, '')} to CLAUDE.md, Claude went straight to it in ${straight} of ${line.sessions} sessions.`
        : line.source === 'S2'
          ? line.events === 0
            ? `Since you added "${line.text.replace(/^- /, '')}" to CLAUDE.md, Claude hasn't tried the other command first.`
            : `Claude still tried the other command first ${line.events} times, even with "${line.text.replace(/^- /, '')}" in CLAUDE.md.`
          : line.events === 0
            ? `Since you added "${line.text.replace(/^- /, '')}" to CLAUDE.md, you haven't had to say it again.`
            : `You still corrected Claude about "${line.text.replace(/^- /, '')}" ${line.events} times since adding it.`
    out.push({ id: line.id, text })
    adoptions[line.id] = { ...known, told: true }
  }
  for (const skill of report.suggestions.skillsAdopted) {
    const id = `skill-adopted:${skill.name}`
    if (adoptions[id]?.told || skill.uses < 1) continue
    const before = skill.correctionsBefore
    const after = skill.correctionsAfter
    const change = before || after ? ` Corrections afterwards went from ${before} to ${after}.` : ''
    out.push({ id, text: `You've used /${skill.name} ${skill.uses} time${skill.uses === 1 ? '' : 's'} since you made it.${change}` })
    adoptions[id] = { at: now, baseline: {}, told: true }
  }
  return [{ ...choices, adoptions }, out]
}

// -- the bar (SPEC.md §11.3)

export type BarState =
  | { kind: 'hidden' }
  | { kind: 'nudge'; text: string }
  | { kind: 'ready'; first: boolean; days: number }
  | { kind: 'habit'; habit: HabitId; done: number | null; total: number | null }

export function barState(
  report: Report | null,
  choices: Choices,
  nudge: { text: string; at: number } | null,
  now: number,
): BarState {
  if (!report || choices.barHidden) return { kind: 'hidden' }
  if (nudge && now - nudge.at < 2 * 60 * 1000) return { kind: 'nudge', text: nudge.text }
  const shown = report.recent ?? report.previous
  if (shown && choices.lastSeenWeek !== shown.week && (shown.week === 'recent' || now - shown.end < WEEK)) {
    const since = report.coverage.logsSince ?? now
    return { kind: 'ready', first: choices.firstReportWeek === null, days: Math.max(1, Math.round((now - since) / DAY)) }
  }
  const habit = activeHabit(choices)
  if (!habit) return { kind: 'hidden' }
  const p = progress(report, habit)
  return { kind: 'habit', habit, done: p?.done ?? null, total: p?.total ?? null }
}
