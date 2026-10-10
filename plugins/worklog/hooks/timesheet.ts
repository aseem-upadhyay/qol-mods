/**
 * The week as a timesheet (SPEC.md §4.2, §6.5, §8.2, §8.3): a row per repo
 * and PR or branch, a column per day, each cell rounded so a day's cells
 * still add up to its rounded total; and the same as a Markdown table, as
 * plain text, and as CSV with a row per day and branch.
 */
import type { Day, Pr, Week } from '../types'
import { addDays, dayLabel, weekday } from './days'
import { groupLabel, headline } from './labels'

/** The first day of the week `date` is in. */
export function weekStartOf(date: string, startsOn: 'monday' | 'sunday'): string {
  const first = startsOn === 'monday' ? 1 : 0
  return addDays(date, -((weekday(date) - first + 7) % 7))
}

export function weekDates(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** "Mon 5": a column's heading. */
export function columnLabel(date: string): string {
  return dayLabel(date).split(' ').slice(0, 2).join(' ')
}

/** "2:15", and "" for nothing. */
export function clockHours(minutes: number): string {
  if (minutes <= 0) return ''
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

export type Row = {
  repo: string
  /** "owner/repo" from its remote, null without one: what its color comes from. */
  slug: string | null
  root: string
  branch: string
  /** "#12 fix-login", or the branch. */
  label: string
  pr: Pr | null
  /** What the branch's work was: its headline on the latest day it has one. */
  title: string | null
  /** Rounded minutes per day, and the week's. */
  cells: number[]
  total: number
  /** The minutes before rounding. */
  raw: number[]
}

export type Sheet = { start: string; dates: string[]; rows: Row[]; dayTotals: number[]; total: number; roundTo: number }

/**
 * A day's minutes rounded to `step`: the day's total to the nearest step,
 * then each cell down to a step and the steps left over given to the cells
 * nearest the next one, so the cells add up to the rounded total. A cell of
 * more than half a step is never rounded away: it takes one from the biggest.
 */
export function roundDay(minutes: number[], step: number): number[] {
  if (step <= 0) return minutes.map(m => Math.round(m))
  const total = minutes.reduce((a, b) => a + b, 0)
  const exact = minutes.map(m => m / step)
  const units = exact.map(Math.floor)
  let left = Math.round(total / step) - units.reduce((a, b) => a + b, 0)
  const order = exact
    .map((e, i) => ({ i, rest: e - Math.floor(e) }))
    .sort((a, b) => b.rest - a.rest || (minutes[b.i] ?? 0) - (minutes[a.i] ?? 0))
  for (const { i } of order) {
    if (left <= 0) break
    units[i] = (units[i] ?? 0) + 1
    left -= 1
  }
  minutes.forEach((m, i) => {
    if ((units[i] ?? 0) > 0 || m <= step / 2) return
    let biggest = -1
    units.forEach((u, j) => {
      if (u > 1 && (biggest < 0 || u > (units[biggest] ?? 0))) biggest = j
    })
    if (biggest < 0) return
    units[biggest] = (units[biggest] ?? 0) - 1
    units[i] = 1
  })
  return units.map(u => u * step)
}

export function sheetOf(week: Week): Sheet {
  const dates = weekDates(week.start)
  const byDate = new Map(week.days.map(d => [d.date, d]))
  const rows = new Map<string, Row>()
  dates.forEach((date, i) => {
    for (const repo of byDate.get(date)?.repos ?? []) {
      for (const g of repo.groups) {
        if (g.minutes <= 0) continue
        const key = `${repo.root}|${g.branch}`
        const row = rows.get(key) ?? {
          repo: repo.name,
          slug: repo.slug,
          root: repo.root,
          branch: g.branch,
          label: groupLabel(g),
          pr: null,
          title: null,
          cells: Array<number>(7).fill(0),
          total: 0,
          raw: Array<number>(7).fill(0),
        }
        row.raw[i] = (row.raw[i] ?? 0) + g.minutes
        if (g.pr) {
          row.pr = g.pr
          row.label = groupLabel(g)
        }
        row.title = headline(g) ?? row.title
        rows.set(key, row)
      }
    }
  })
  const list = [...rows.values()]
  dates.forEach((_, i) => {
    const rounded = roundDay(
      list.map(r => r.raw[i] ?? 0),
      week.roundTo,
    )
    list.forEach((r, k) => {
      r.cells[i] = rounded[k] ?? 0
    })
  })
  for (const r of list) r.total = r.cells.reduce((a, b) => a + b, 0)
  const repoTotal = new Map<string, number>()
  for (const r of list) repoTotal.set(r.root, (repoTotal.get(r.root) ?? 0) + r.total)
  const shown = list
    .filter(r => r.total > 0)
    .sort(
      (a, b) =>
        (repoTotal.get(b.root) ?? 0) - (repoTotal.get(a.root) ?? 0) ||
        a.repo.localeCompare(b.repo) ||
        b.total - a.total ||
        a.label.localeCompare(b.label),
    )
  const dayTotals = dates.map((_, i) => shown.reduce((s, r) => s + (r.cells[i] ?? 0), 0))
  return { start: week.start, dates, rows: shown, dayTotals, total: dayTotals.reduce((a, b) => a + b, 0), roundTo: week.roundTo }
}

export function weekTitle(sheet: Sheet): string {
  return `Week of ${dayLabel(sheet.start)}`
}

/** What the rounding was, for under a table. */
export function roundingNote(roundTo: number): string {
  return roundTo > 0 ? `Rounded to ${roundTo} minutes; each day still adds up.` : 'Not rounded.'
}

function mdCell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

/** The timesheet as a Markdown table: a row per branch, the repo named on its first. */
export function sheetMarkdown(sheet: Sheet): string {
  const head = ['Repo', 'Branch', ...sheet.dates.map(columnLabel), 'Total']
  const lines = [`| ${head.join(' | ')} |`, `| --- | --- | ${sheet.dates.map(() => '---:').join(' | ')} | ---: |`]
  let last = ''
  for (const r of sheet.rows) {
    const repo = r.root === last ? '' : r.repo
    last = r.root
    lines.push(`| ${mdCell(repo)} | ${mdCell(r.label)} | ${r.cells.map(clockHours).join(' | ')} | ${clockHours(r.total)} |`)
  }
  lines.push(`| **Total** | | ${sheet.dayTotals.map(t => (t ? `**${clockHours(t)}**` : '')).join(' | ')} | **${clockHours(sheet.total)}** |`)
  return lines.join('\n')
}

/** The timesheet as plain text in columns: repos, their branches indented, a total row. */
export function sheetText(sheet: Sheet): string {
  const labels = sheet.rows.flatMap(r => [r.repo, `  ${r.label}`])
  const width = Math.min(34, Math.max(12, ...labels.map(l => l.length)) + 2)
  const cell = (s: string, w = 7) => s.padStart(w)
  const cut = (s: string) => (s.length > width - 1 ? `${s.slice(0, width - 2)}…` : s).padEnd(width)
  const lines = [`${''.padEnd(width)}${sheet.dates.map(d => cell(columnLabel(d))).join('')}${cell('Total', 8)}`]
  let last = ''
  for (const r of sheet.rows) {
    if (r.root !== last) lines.push(cut(r.repo))
    last = r.root
    lines.push(`${cut(`  ${r.label}`)}${r.cells.map(c => cell(clockHours(c) || '·')).join('')}${cell(clockHours(r.total), 8)}`)
  }
  lines.push(`${cut('Total')}${sheet.dayTotals.map(t => cell(clockHours(t) || '·')).join('')}${cell(clockHours(sheet.total), 8)}`)
  return lines.map(l => l.trimEnd()).join('\n')
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * A row per day and branch, for a spreadsheet: the date, repo, PR, branch,
 * what it was, hours as rounded and as worked, and when it started and ended.
 */
export function sheetCsv(sheet: Sheet, days: Day[]): string {
  const byDate = new Map(days.map(d => [d.date, d]))
  const rows = new Map(sheet.rows.map(r => [`${r.root}|${r.branch}`, r]))
  const lines = ['date,repo,pr,branch,title,hours,raw_hours,first,last']
  sheet.dates.forEach((date, i) => {
    for (const repo of byDate.get(date)?.repos ?? []) {
      for (const g of repo.groups) {
        const row = rows.get(`${repo.root}|${g.branch}`)
        const rounded = row?.cells[i] ?? 0
        if (g.minutes <= 0 && rounded <= 0) continue
        lines.push(
          [
            date,
            repo.slug ?? repo.name,
            g.pr ? g.pr.number : '',
            g.branch,
            headline(g) ?? '',
            (rounded / 60).toFixed(2),
            (g.minutes / 60).toFixed(2),
            g.first,
            g.last,
          ]
            .map(csvCell)
            .join(','),
        )
      }
    }
  })
  return `${lines.join('\n')}\n`
}
