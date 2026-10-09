/**
 * The report's numbers as the pane shows them on every surface: the header,
 * the headline tiles and their change, the progress lines and the features by
 * level. Plus what art.ts draws from them where the surface draws Svg. Pure,
 * like select.ts.
 */
import type { HabitId, Report, WeekRow, WeekSummary } from '../types'
import type { Hero, HeroDay, ToolkitLevel, Tone, Trend } from './art'
import * as C from './copy'
import * as Sel from './select'

const DAY = 24 * 60 * 60 * 1000

export type Better = 'up' | 'down' | null
export type Series = { label: string; values: (number | null)[]; better: Better; format: (n: number) => string }
export type Tile = { label: string; value: string; now: number; avg: number | null; better: Better }
export type Header = { title: string; range: string; weekNo: number | null; notes: string[]; early: boolean }

export const FEATURE_LEVEL: Record<string, number> = {
  'claude-md': 1,
  'at-mention': 1,
  image: 1,
  interrupt: 1,
  'fresh-start': 1,
  'ask-checks': 1,
  'plan-mode': 2,
  rewind: 2,
  'model-choice': 2,
  subagents: 2,
  'commands-skills': 2,
  mcp: 2,
  'allow-rules': 2,
  compact: 2,
  hooks: 3,
  parallel: 3,
  worktrees: 3,
  headless: 3,
  automation: 3,
  plugins: 3,
  workflows: 3,
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function weeksBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / (7 * DAY))
}

export function header(row: WeekRow, firstReportWeek: string | null, isCurrent: boolean): Header {
  const early = Sel.isEarlyRead(row)
  return {
    title: early ? 'Your last 7 days with Claude' : isCurrent ? 'Your week so far' : 'Your week with Claude',
    range: early ? `${C.shortDate(row.start)} to ${C.shortDate(row.end - 1)}` : C.weekRange(row.week),
    weekNo: firstReportWeek && !early && row.week >= firstReportWeek ? weeksBetween(firstReportWeek, row.week) + 1 : null,
    notes: [early ? 'early read' : null, row.coverage.partial ? 'partial week: your logs start partway through it' : null].filter(
      (x): x is string => !!x,
    ),
    early,
  }
}

/** The four headline numbers, each with the average of the 4 full weeks before. */
export function tiles(report: Report, row: WeekRow): Tile[] {
  const before = report.history.filter(w => w.start < row.start && !w.partial).slice(-4)
  const avg = (pick: (w: WeekSummary) => number) => mean(before.map(pick))
  return [
    { label: 'Sessions', value: String(row.volume.sessions), now: row.volume.sessions, avg: avg(w => w.sessions), better: null },
    { label: 'Prompts', value: String(row.volume.prompts), now: row.volume.prompts, avg: avg(w => w.prompts), better: null },
    { label: 'Spent', value: C.money(row.cost.usd), now: row.cost.usd, avg: avg(w => w.usd), better: 'down' },
    {
      label: 'Typical cost per prompt',
      value: C.money(row.cost.perPrompt.median),
      now: row.cost.perPrompt.median,
      avg: avg(w => w.costPerPrompt),
      better: 'down',
    },
  ]
}

/** A tile's change against its average: under 10%, or with no better way, it's no news. */
export function change(t: Tile): { pct: number; tone: Tone } | null {
  if (t.avg === null || t.avg <= 0) return null
  const pct = (t.now - t.avg) / t.avg
  if (Math.abs(pct) < 0.1 || t.better === null) return { pct, tone: 'flat' }
  const good = (t.better === 'down' && pct < 0) || (t.better === 'up' && pct > 0)
  return { pct, tone: good ? 'good' : 'bad' }
}

/** Weeks whose definitions changed, or that were partial, break the line. */
export function seriesOf(history: WeekSummary[], pick: (w: WeekSummary) => number | null): (number | null)[] {
  const out: (number | null)[] = []
  let version: number | null = null
  for (const week of history) {
    if (version !== null && week.metricsVersion !== version) out.push(null)
    version = week.metricsVersion
    out.push(week.partial ? null : pick(week))
  }
  return out
}

/** The weeks the progress lines cover: up to 12, ending with the week shown. */
export function progressWeeks(report: Report, row: WeekRow): WeekSummary[] {
  return report.history.filter(w => w.start <= row.start).slice(-12)
}

export function progressSeries(history: WeekSummary[], habit: HabitId | null): Series[] {
  const all: Series[] = [
    ...(habit
      ? [{ label: C.HABIT[habit].title, values: seriesOf(history, w => w.habits[habit] ?? null), better: 'up' as Better, format: C.percent }]
      : []),
    { label: 'Typical cost per prompt', values: seriesOf(history, w => w.costPerPrompt), better: 'down', format: C.money },
    { label: 'Corrections per 10 prompts', values: seriesOf(history, w => w.correctionsPer10), better: 'down', format: n => n.toFixed(1) },
    { label: 'Oversized sessions', values: seriesOf(history, w => w.oversized), better: 'down', format: n => String(n) },
    {
      label: 'Steps spent rediscovering projects',
      values: seriesOf(history, w => w.discoverySteps),
      better: 'down',
      format: n => String(n),
    },
  ]
  return all.filter(s => s.values.some(v => v !== null))
}

function known(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null)
}

/** The line's direction, first known week to last, and what it means. */
export function direction(s: Series): { d: number | null; tone: Tone } {
  const k = known(s.values)
  if (k.length < 2) return { d: null, tone: 'flat' }
  const d = (k[k.length - 1] ?? 0) - (k[0] ?? 0)
  if (d === 0) return { d, tone: 'flat' }
  const good = (s.better === 'down' && d < 0) || (s.better === 'up' && d > 0)
  return { d, tone: good ? 'good' : 'bad' }
}

/** The features shown: the person's level and the next one up. */
export function shownFeatures(report: Report): string[] {
  const reach = Math.max(1, Math.min(3, report.level + 1))
  return Object.keys(C.FEATURE_NAME).filter(name => (FEATURE_LEVEL[name] ?? 3) <= reach)
}

// -- for art.ts

function dayKey(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

/** The row's seven days with what each cost: dates as scan.py's local ones. */
export function weekDays(row: WeekRow): HeroDay[] {
  let first: Date
  if (/^\d{4}-\d{2}-\d{2}$/.test(row.week)) {
    const [y, m, d] = row.week.split('-').map(Number)
    first = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  } else {
    const local = new Date(row.start + DAY / 2)
    first = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()))
  }
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(first.getTime() + i * DAY)
    const usd = row.cost.byDay[dayKey(day)] ?? 0
    return { letter: C.ART.dayLetter(day.getUTCDay()), usd, label: C.money(usd) }
  })
}

export function heroOf(report: Report, row: WeekRow, head: Header): Hero {
  const ts = tiles(report, row)
  const changes = ts.map(change)
  const days = weekDays(row)
  return {
    kicker: C.ART.kicker(head.weekNo, head.early).toUpperCase(),
    title: head.title,
    subline: C.ART.subline(
      head.range,
      row.volume.activeDays,
      head.notes.filter(n => !head.early || n !== 'early read').map(n => n.split(':')[0] ?? n),
    ),
    stats: ts.map((t, i) => {
      const c = changes[i]
      return { label: t.label, value: t.value, delta: c ? C.ART.change(c.pct) : null, tone: c?.tone ?? 'flat' }
    }),
    days: days.some(d => d.usd > 0) ? days : null,
    daysTitle: C.ART.days.toUpperCase(),
    caption: changes.some(Boolean) ? C.ART.caption : null,
  }
}

export function trendsOf(series: Series[], history: WeekSummary[]): Trend[] {
  const first = history[0] ? C.weekStartDay(history[0].week) : ''
  const last = history[history.length - 1] ? C.weekStartDay((history[history.length - 1] as WeekSummary).week) : ''
  return series.map(s => {
    const k = known(s.values)
    const { tone } = direction(s)
    const a = k[0]
    const b = k[k.length - 1]
    let delta: string | null = null
    if (a !== undefined && b !== undefined && k.length >= 2) {
      if (a === b) delta = C.ART.steady
      else if (a === 0) delta = C.ART.fromZero
      else delta = C.ART.change((b - a) / Math.abs(a))
    }
    return { label: s.label, values: s.values, value: b === undefined ? '' : s.format(b), delta, tone, first, last }
  })
}

export function toolkitOf(report: Report): ToolkitLevel[] {
  const names = shownFeatures(report)
  const levels = [...new Set(names.map(name => FEATURE_LEVEL[name] ?? 3))].sort()
  return levels.map(level => {
    const mine = names.filter(name => (FEATURE_LEVEL[name] ?? 3) === level)
    const used = mine.filter(name => report.features[name]).length
    return {
      name: C.LEVEL_NAME[level] ?? `Level ${level}`,
      count: C.levelCount(used, mine.length),
      used,
      total: mine.length,
      chips: mine.map(name => ({
        text: C.FEATURE_NAME[name] ?? name,
        state: report.features[name] ? ('used' as const) : report.upNext?.feature === name ? ('next' as const) : ('open' as const),
      })),
    }
  })
}
