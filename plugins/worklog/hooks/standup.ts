/**
 * The words: what a branch's work was, a day as lines of text, and the
 * standup made of days (SPEC.md §4.1). Each branch reads in three layers:
 * a headline that says what it was, one line of counts, and the details
 * underneath (what was asked, the commits, where files changed), shown
 * only when asked for. The text is what the model reads, what Copy copies
 * and what a surface draws when worklog's own drawing isn't there: a
 * Markdown list that reads as plain text too.
 */
import type { Day, Group, Repo, ScanResult, Standup } from '../types'
import { addDays, dayLabel, duration, standupDays } from './days'

/** Claude's time alone is worth a mention from this many minutes. */
export const NOTICEABLE_ALONE = 5
/** A branch under this many minutes, with no PR and no commit, folds into one "Also" line in a standup. */
export const MINOR_MIN = 10

export function footerFor(full: boolean): string {
  return full
    ? 'Estimated from your Claude Code sessions. /standup copy copies this; /worklog shows any day.'
    : 'Estimated from your Claude Code sessions. /standup full adds what you asked, committed and changed; /standup copy copies it; /worklog shows any day.'
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "#12 fix-login" for a branch with a PR, the branch alone without. */
export function groupLabel(g: Group): string {
  const branch = g.branch || 'no branch'
  return g.pr ? `#${g.pr.number} ${branch}` : branch
}

/** Whether a group is worth a line: time of the user's, or Claude's alone worth a mention. */
export function isShown(g: Group): boolean {
  return g.minutes > 0 || g.unattendedMin >= NOTICEABLE_ALONE
}

/** A short stretch that left nothing behind: no PR, no commit. */
export function isMinor(g: Group): boolean {
  return !g.pr && g.commitCount === 0 && g.minutes < MINOR_MIN
}

export function hasWork(day: Day | undefined): day is Day {
  return !!day && day.repos.some(r => r.groups.some(isShown))
}

export function emptyDay(date: string): Day {
  return { date, totalMin: 0, unattendedMin: 0, hours: Array(24).fill(0), repos: [] }
}

/** "3 repos · 7 branches · 2 PRs" */
export function counts(day: Day): string {
  const groups = day.repos.flatMap(r => r.groups.filter(isShown))
  const repos = day.repos.filter(r => r.groups.some(isShown)).length
  const prs = groups.filter(g => g.pr).length
  const parts = [plural(repos, 'repo', 'repos'), plural(groups.length, 'branch', 'branches')]
  if (prs) parts.push(plural(prs, 'PR', 'PRs'))
  return parts.join(' · ')
}

/**
 * What a branch's work was, in one line: the PR's title, else the name of
 * the session that spent most time on it, else its first commit, else the
 * longest thing the user asked. Null when there's nothing to say.
 */
export function headline(g: Group): string | null {
  const longest = [...g.asks].sort((a, b) => b.length - a.length)[0]
  return g.pr?.title || g.what[0] || g.commits[0] || (longest ? `“${longest}”` : null)
}

/** The counts under the headline: "13:53–16:47 · 4 commits · 42 files · 44 test runs". */
export function metaOf(g: Group): string {
  const parts = [`${g.first}–${g.last}`]
  if (g.commitCount) parts.push(plural(g.commitCount, 'commit', 'commits'))
  if (g.fileCount) parts.push(plural(g.fileCount, 'file', 'files'))
  if (g.tests) parts.push(plural(g.tests, 'test run', 'test runs'))
  if (g.unattendedMin >= NOTICEABLE_ALONE) parts.push(`Claude alone ${duration(g.unattendedMin)}`)
  return parts.join(' · ')
}

/** One line of a section: its words, and a quieter note after them. */
export type Item = { text: string; note?: string; isDim?: boolean }

/** A labelled list under a branch: what was asked, the commits, where files changed. */
export type Section = { label: string; items: Item[] }

/**
 * A branch's details, a section each, every line from one source in the
 * logs: the user's prompts, the commits Claude made, the folders its edits
 * were in, the other sessions on the branch. `withTime` adds how its time
 * was shared with parallel sessions.
 */
export function sectionsOf(g: Group, withTime = true): Section[] {
  const out: Section[] = []
  if (withTime && g.rawMin > g.minutes) {
    out.push({
      label: 'Time',
      items: [{ text: `${duration(g.rawMin)} on this branch`, note: ` · ${duration(g.minutes)} counted, parallel sessions share the rest`, isDim: true }],
    })
  }
  if (g.asks.length) out.push({ label: 'Asked', items: g.asks.map(a => ({ text: `“${a}”` })) })
  if (g.commitCount) {
    const more = g.commitCount - g.commits.length
    const items: Item[] = g.commits.map(c => ({ text: c }))
    if (more > 0) items.push({ text: `+${more} more`, isDim: true })
    out.push({ label: 'Commits', items })
  }
  if (g.dirCount) {
    const items: Item[] = g.dirs.map(([dir, n]) => ({ text: dir === '.' ? 'top level' : dir, note: ` · ${plural(n, 'file', 'files')}` }))
    const more = g.dirCount - g.dirs.length
    if (more > 0) items.push({ text: `+${plural(more, 'more folder', 'more folders')}`, isDim: true })
    out.push({ label: 'Changed', items })
  }
  const head = headline(g)
  const others = g.what.filter(t => t !== head)
  if (others.length) out.push({ label: 'Sessions', items: [{ text: others.join(' · '), isDim: true }] })
  return out
}

/** The minor branches of a repo, folded: "Also: master 11m · page-title 5m". */
export function alsoLine(groups: Group[]): string {
  return `Also: ${groups.map(g => `${groupLabel(g)} ${duration(g.minutes)}`).join(' · ')}`
}

/** A repo's branches to list, and the minor ones folded into "Also" when `fold`. */
export function splitMinor(repo: Repo, fold: boolean): { listed: Group[]; folded: Group[] } {
  const shown = repo.groups.filter(isShown)
  if (!fold) return { listed: shown, folded: [] }
  const listed = shown.filter(g => !isMinor(g))
  // Folding every branch away would leave the repo with nothing to read.
  return listed.length ? { listed, folded: shown.filter(isMinor) } : { listed: shown, folded: [] }
}

/**
 * A day's lines under `heading`: each repo, then each PR or branch with its
 * headline and its counts. `full` adds the details under each; without it,
 * short branches that left nothing behind fold into one line.
 */
export function dayLines(day: Day, heading: string, full = false): string[] {
  if (!hasWork(day)) return [`${heading} · nothing in your logs`]
  const lines = [`${heading} · ${duration(day.totalMin)}`]
  for (const repo of day.repos) {
    const { listed, folded } = splitMinor(repo, !full)
    if (!listed.length) continue
    lines.push(`- ${repo.name} · ${duration(repo.minutes)}`)
    for (const g of listed) {
      const head = headline(g)
      lines.push(`  - ${groupLabel(g)} · ${duration(g.minutes)}${head ? ` · ${head}` : ''}`)
      lines.push(`    - ${metaOf(g)}`)
      if (!full) continue
      for (const s of sectionsOf(g, false)) {
        const text = (i: Item) => `${i.text}${i.note ?? ''}`
        const only = s.items.length === 1 ? s.items[0] : undefined
        if (only) {
          lines.push(`    - ${s.label}: ${text(only)}`)
          continue
        }
        lines.push(`    - ${s.label}:`)
        for (const item of s.items) lines.push(`      - ${text(item)}`)
      }
    }
    if (folded.length) lines.push(`  - ${alsoLine(folded)}`)
  }
  return lines
}

export function todayHeading(date: string): string {
  return `Today so far (${dayLabel(date)})`
}

/** What /standup asked for: the usual standup, or one day. */
export type Ask = { kind: 'standup' } | { kind: 'day'; date: string }

/**
 * The standup as data. The usual one covers the days since the last work day
 * (only those with work, unless none had any) and today so far.
 */
export function standupFor(found: ScanResult, ask: Ask, workDays: Set<number>, full = false): Standup {
  const byDate = new Map(found.days.map(d => [d.date, d]))
  const day = (date: string) => byDate.get(date) ?? emptyDay(date)
  const today = found.today
  const base = { lead: null, footer: footerFor(full), full }

  if (ask.kind === 'day') {
    const isToday = ask.date === today
    const heading = isToday ? todayHeading(today) : dayLabel(ask.date)
    return { ...base, title: null, blocks: [{ heading, isToday, day: day(ask.date) }], note: null }
  }

  const past = standupDays(today, workDays)
  const first = past[0] ?? addDays(today, -1)
  const worked = past.filter(d => hasWork(byDate.get(d)))
  const blocks = worked.map(date => ({ heading: dayLabel(date), isToday: false, day: day(date) }))
  if (hasWork(byDate.get(today))) blocks.push({ heading: todayHeading(today), isToday: true, day: day(today) })
  const title = past.length === 1 ? `Standup for ${dayLabel(first)}` : `Standup since ${dayLabel(first)}`
  const note = worked.length ? null : `Nothing in your logs since ${dayLabel(first)}.`
  // With nothing before today, the note leads and today follows it.
  return { ...base, title, blocks, note }
}

/** The standup's text: lead, title, the note or nothing, each day, footer. */
export function standupText(s: Standup): string {
  const parts: string[] = []
  if (s.lead) parts.push(s.lead)
  if (s.title) parts.push(s.title)
  if (s.note) parts.push(s.note)
  for (const b of s.blocks) parts.push(dayLines(b.day, b.heading, s.full).join('\n'))
  if (s.footer) parts.push(s.footer)
  return parts.join('\n\n')
}
