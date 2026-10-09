/**
 * The report as words, for /coach where no pane can be placed, and as data,
 * for the mcp__coach__report tool (SPEC.md §11.1, §11.5).
 */
import type { Choices, Report, WeekRow } from '../types'
import * as C from './copy'
import * as Sel from './select'

const TOOL_LIMIT = 20_000

export function summaryText(report: Report | null, choices: Choices, now: number): string {
  if (!report) return 'coach is still reading your sessions. Try /coach again in a minute.'
  const row = Sel.shownRow(report, null)
  if (!row) return 'Come back in a few days. coach needs a little history first.'
  const habit = Sel.chooseHabit(report, row, choices, now).habit
  const tips = Sel.chooseTips(report, row, choices, habit, now)
  const lines = [
    `Your week with Claude (${C.weekRange(row.week)}): ${row.volume.sessions} sessions, ${row.volume.prompts} prompts, about ${C.money(row.cost.usd)} at API list prices; a typical prompt cost ${C.money(row.cost.perPrompt.median)}.`,
  ]
  if (habit) lines.push(`Habit of the week: ${C.HABIT[habit].title}. ${C.HABIT[habit].tryThis}`)
  for (const t of tips) {
    const words = C.tipText(t)
    lines.push(`Tip: ${words.title}. ${words.body}`)
  }
  return lines.join('\n')
}

const DEFINITIONS =
  'Costs are estimated at API list prices. A prompt is what the person typed plus everything Claude did until the next one. Habits: fresh-start = share of topic changes that started a new session or /clear; point-to-place = share of first prompts naming a file; say-done = share of first prompts saying what done looks like; check-work = share of changes followed by a test or build; plan-big = share of big changes planned first.'

/** mcp__coach__report's answer: compact JSON, at most 20 KB. */
export function toolResult(report: Report | null, week: string, part: string): unknown {
  if (!report) return { error: 'No coach report yet: the first scan is still running.' }
  const row: WeekRow | null =
    week === 'current'
      ? report.current
      : week === 'previous'
        ? (report.previous ?? report.recent)
        : (Sel.rows(report).find(r => r.week === week) ?? null)
  const strip = (ev: WeekRow['evidence']) =>
    report.excerpts ? ev : Object.fromEntries(Object.entries(ev).map(([k, v]) => [k, { ...v, excerpt: null }]))
  const parts: Record<string, () => unknown> = {
    summary: () =>
      row && {
        week: row.week,
        volume: row.volume,
        cost: { usd: row.cost.usd, perPrompt: row.cost.perPrompt, byModel: row.cost.byModel, byDay: row.cost.byDay },
        habits: row.habits,
        tips: row.tips.map(t => ({ id: t.id, numbers: t.numbers, impactUsd: t.impactUsd })),
        notices: row.notices,
      },
    habits: () => row && { week: row.week, habits: row.habits, evidence: strip(row.evidence) },
    tips: () => row && { week: row.week, tips: row.tips },
    'claude-md': () => report.suggestions.claudeMd,
    skills: () => report.suggestions.skills.map(({ signature: _s, ...rest }) => rest),
    cost: () => row && { week: row.week, cost: row.cost, usage: row.usage },
    all: () => row && { ...row, evidence: strip(row.evidence) },
  }
  const body = (parts[part] ?? parts.summary)?.() ?? { error: `No week ${week} in the report.` }
  const out = { definitions: DEFINITIONS, weeks: report.history.map(h => h.week), data: body }
  return JSON.stringify(out).length <= TOOL_LIMIT
    ? out
    : { ...out, data: null, note: 'Too large: ask for one part at a time.' }
}
