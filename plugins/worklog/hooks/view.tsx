/**
 * How a day looks, on every surface (SPEC.md §4): a summary with the day
 * split by repo, then each repo's PRs and branches on a timeline of the day.
 * The pane and /standup's row are both made of these pieces.
 *
 * Where the surface draws Svg (the desktop app, VS Code, mobile) the bars and
 * the timeline are pictures (art.ts) and the headings Markdown. The terminal
 * draws the same in text: block characters in the theme's colors. Every name,
 * time and duration is Text either way, in the person's own theme.
 */
import type { Color, ElementTable, RenderElement, RenderSurface } from 'claude-code'

import type { Day, Group, OpenPr, Repo, Standup, Week } from '../types'
import * as A from './art'
import { duration } from './days'
import { alsoLine, counts, groupLabel, hasWork, headline, isShown, metaOf, NOTICEABLE_ALONE, prLine, sectionsOf, splitMinor } from './standup'
import { clockHours, columnLabel, roundingNote, sheetMarkdown, sheetOf, weekTitle } from './timesheet'
import type { Sheet } from './timesheet'
import type { Section } from './standup'

/** The terminal's stand-ins for the palette's slots: theme colors, so they follow light and dark. */
export const TERM: Color[] = ['suggestion', 'claude', 'success', 'warning', 'merged', 'planMode', 'ide', 'permission']

const SLOTS = 8
const DURATION_COLS = 8
const MIN_STRIP_COLS = 16
/** Narrower than this beside the name, the timeline goes on a line of its own. */
const MIN_INLINE_COLS = 24
/** How far a group's timeline and details sit in from the left. */
const INDENT = 4
/** About how many pixels a body column is on a surface that draws Svg. */
const PX_PER_COL = 8

export type Look = {
  els: ElementTable
  /** Draws Svg and Markdown. */
  rich: boolean
  columns: number
  /** Minutes after midnight the day starts. */
  dayStart: number
}

export function lookFor(els: ElementTable, surface: RenderSurface, columns: number, dayStartsAt: string): Look {
  const [h = 0, m = 0] = dayStartsAt.split(':').map(Number)
  return {
    els,
    rich: surface !== 'terminal' && 'Svg' in els && 'Markdown' in els,
    columns: columns > 0 ? columns : 80,
    dayStart: h * 60 + m,
  }
}

function hash(text: string): number {
  let h = 5381
  for (const ch of text) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0
  return h
}

/**
 * Each repo's palette slot. A repo keeps its slot from day to day (it comes
 * from its name), and the day's busiest repo wins a clash; the next takes
 * the next free slot. Past eight repos, slots repeat.
 */
export function slotsFor(repos: Repo[]): Map<string, number> {
  const out = new Map<string, number>()
  const taken = new Set<number>()
  for (const repo of [...repos].sort((a, b) => b.minutes - a.minutes)) {
    let slot = hash(repo.slug ?? repo.name) % SLOTS
    for (let i = 0; i < SLOTS && taken.has(slot); i++) slot = (slot + 1) % SLOTS
    taken.add(slot)
    out.set(repo.root, slot)
  }
  return out
}

/** The characters Markdown would read as markup, escaped. */
function md(text: string): string {
  return text.replace(/([\\`*_[\]<>~|#])/g, '\\$1')
}

function shownRepos(day: Day): Repo[] {
  return day.repos.filter(r => r.groups.some(isShown))
}

// -- pieces

function dot(look: Look, slot: number, name: string): RenderElement {
  const { Text } = look.els
  if (look.rich && 'Svg' in look.els) {
    const { Svg } = look.els
    return <Svg source={A.dotSvg(slot)} alt={name} width={10} height={10} />
  }
  return <Text color={TERM[slot % SLOTS]}>●</Text>
}

/** The day split by repo, as wide as `cols`. */
function shareBar(look: Look, day: Day, slots: Map<string, number>, cols: number): RenderElement {
  const { Text } = look.els
  const parts = shownRepos(day).map(r => ({ slot: slots.get(r.root) ?? 0, minutes: r.minutes, name: `${r.name} ${duration(r.minutes)}` }))
  if (look.rich && 'Svg' in look.els) {
    const { Svg } = look.els
    const alt = parts.map(p => p.name).join(', ')
    return <Svg source={A.shareSvg(parts, cols * PX_PER_COL)} alt={`Time by repo: ${alt}`} height={10} />
  }
  const total = parts.reduce((a, p) => a + p.minutes, 0) || 1
  let used = 0
  const segments = parts.map((p, i) => {
    const width = i === parts.length - 1 ? cols - used : Math.max(1, Math.round((p.minutes / total) * cols))
    used += width
    return <Text color={TERM[p.slot % SLOTS]}>{'━'.repeat(Math.max(0, width))}</Text>
  })
  return <Text>{segments}</Text>
}

function legend(look: Look, day: Day, slots: Map<string, number>): RenderElement {
  const { Box, Text } = look.els
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
      {shownRepos(day).map(r => (
        <Box flexDirection="row" columnGap={1} alignItems="center">
          {dot(look, slots.get(r.root) ?? 0, r.name)}
          <Text>
            {r.name} <Text dimColor>{duration(r.minutes)}</Text>
          </Text>
        </Box>
      ))}
    </Box>
  )
}

/** What the day held, Claude's time alone, and whether it came from the archive. */
function countsLine(look: Look, day: Day, alone: string): RenderElement | null {
  const { Text } = look.els
  const parts = [counts(day) + alone]
  if (day.source === 'archive') parts.push('from the archive: its logs are gone')
  const text = parts.filter(Boolean).join(' · ').replace(/^ · /, '')
  return text ? <Text dimColor>{text}</Text> : null
}

/** Heading and total, what the day held, and the day split by repo. */
export function summary(look: Look, day: Day, heading: string, isToday: boolean, withLegend = true): RenderElement {
  const { Box, Text } = look.els
  const slots = slotsFor(day.repos)
  const total = `${duration(day.totalMin)}${isToday ? ' so far' : ''}`
  const alone = day.unattendedMin >= NOTICEABLE_ALONE ? ` · Claude alone another ${duration(day.unattendedMin)}` : ''
  const top =
    look.rich && 'Markdown' in look.els ? (
      (() => {
        const { Markdown } = look.els
        return (
          <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
            <Markdown text={`### ${md(heading)}`} />
            {hasWork(day) ? <Markdown text={`### ${md(total)}`} /> : null}
          </Box>
        )
      })()
    ) : (
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text bold>{heading}</Text>
        {hasWork(day) ? (
          <Text bold>
            {duration(day.totalMin)}
            {isToday ? <Text dimColor> so far</Text> : null}
          </Text>
        ) : null}
      </Box>
    )
  if (!hasWork(day)) {
    return (
      <Box flexDirection="column">
        {top}
        <Text dimColor>Nothing in your logs for this day.</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" rowGap={look.rich ? 1 : 0}>
      {top}
      {countsLine(look, day, alone)}
      <Box flexDirection="column" marginTop={look.rich ? 0 : 1}>
        {shareBar(look, day, slots, Math.max(10, look.columns - 2))}
      </Box>
      {withLegend ? legend(look, day, slots) : null}
    </Box>
  )
}

// -- the timeline

export type Range = A.Range

/** The hours the day's work covers, whole hours either side, at least three. */
export function rangeOf(day: Day, dayStart: number): Range | null {
  let from = Infinity
  let to = -Infinity
  for (const g of day.repos.flatMap(r => r.groups.filter(isShown))) {
    for (const [a, b] of [...g.spans, ...g.aloneSpans]) {
      from = Math.min(from, a)
      to = Math.max(to, b)
    }
  }
  if (!Number.isFinite(from)) return null
  from = Math.floor(from / 60) * 60
  to = Math.max(Math.ceil(to / 60) * 60, from + 180)
  return { from, to, dayStart }
}

type Cell = 'full' | 'part' | 'alone' | 'none'

function overlap(spans: [number, number][], a: number, b: number): number {
  return spans.reduce((sum, [s, e]) => sum + Math.max(0, Math.min(e, b) - Math.max(s, a)), 0)
}

/** A group's timeline in `n` cells: worked most of the cell, some of it, Claude alone, or nothing. */
export function cellsOf(g: Group, range: Range, n: number): Cell[] {
  const width = (range.to - range.from) / n
  return Array.from({ length: n }, (_, i) => {
    const a = range.from + i * width
    const b = a + width
    const att = overlap(g.spans, a, b) / width
    if (att >= 0.5) return 'full'
    if (att > 0) return 'part'
    return overlap(g.aloneSpans, a, b) > 0 ? 'alone' : 'none'
  })
}

const GLYPH: Record<Cell, string> = { full: '█', part: '▄', alone: '░', none: '·' }

function stripText(look: Look, g: Group, slot: number, range: Range, n: number): RenderElement {
  const { Text } = look.els
  const cells = cellsOf(g, range, n)
  const runs: { cell: Cell; count: number }[] = []
  for (const cell of cells) {
    const last = runs.at(-1)
    if (last && last.cell === cell) last.count += 1
    else runs.push({ cell, count: 1 })
  }
  return (
    <Text>
      {runs.map(r =>
        r.cell === 'none' ? (
          <Text color="subtle">{GLYPH.none.repeat(r.count)}</Text>
        ) : (
          <Text color={TERM[slot % SLOTS]}>{GLYPH[r.cell].repeat(r.count)}</Text>
        ),
      )}
    </Text>
  )
}

/** Hour labels placed over `n` cells, none overlapping. */
export function axisText(range: Range, n: number): string {
  const line = Array<string>(n).fill(' ')
  let free = 0
  for (const m of A.ticks(range)) {
    const label = A.clock(m, range.dayStart).slice(0, 2)
    let at = Math.round(((m - range.from) / (range.to - range.from)) * n)
    at = Math.min(Math.max(at, 0), n - label.length)
    if (at < free) continue
    for (let i = 0; i < label.length; i++) line[at + i] = label[i] ?? ' '
    free = at + label.length + 1
  }
  return line.join('').trimEnd()
}

/** A branch's name: its PR number in the accent color, then the branch. In
 * the pane it is a Button that opens and closes its details (▸ ▾). */
function labelOf(look: Look, g: Group, key: string, open: boolean | null, onToggle?: (key: string) => void): RenderElement {
  const { Text, Button } = look.els
  const parts: (string | RenderElement)[] = ['  ']
  if (open !== null) parts.push(open ? '▾ ' : '▸ ')
  if (g.pr) parts.push(<Text color="suggestion">{`#${g.pr.number} `}</Text>)
  parts.push(g.branch || 'no branch')
  if (onToggle) {
    return (
      <Button key={`group:${key}`} label={`${groupLabel(g)}: ${open ? 'hide' : 'show'} details`} plain onPress={() => onToggle(key)}>
        {parts}
      </Button>
    )
  }
  return <Text wrap="truncate-end">{parts}</Text>
}

/** How wide the sections' labels are: the longest, "Sessions", and a space. */
const SECTION_LABEL_COLS = 9

/** A branch's details: each section's label dim on the left, its lines one under another. */
function sectionRows(look: Look, sections: Section[]): RenderElement {
  const { Box, Text } = look.els
  return (
    <Box flexDirection="column">
      {sections.map(s => (
        <Box flexDirection="row">
          <Box width={SECTION_LABEL_COLS} flexShrink={0}>
            <Text dimColor>{s.label}</Text>
          </Box>
          <Box flexDirection="column" flexShrink={1}>
            {s.items.map(item => (
              <Text wrap="wrap" {...(item.isDim ? { dimColor: true } : {})}>
                {item.text}
                {item.note ? <Text dimColor>{item.note}</Text> : null}
              </Text>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** Where a group's timeline goes: beside its name, on a line of its own beneath, or nowhere. */
type Placement = 'inline' | 'below' | 'none'

/** How much of each branch to show: its headline and counts, those and its details, or details where opened. */
export type Detail = 'compact' | 'full' | 'toggle'

export type ListOptions = {
  /** Each branch's stretches of the day, where the width allows. */
  timeline: boolean
  detail: Detail
  /** The time before sharing with parallel sessions, among the details. */
  withTime: boolean
  /** Short branches that left nothing behind, folded into one "Also" line. */
  foldMinor: boolean
  /** With `detail: 'toggle'`: whether a branch is open, and what opens or closes it. */
  isOpen?: (key: string) => boolean
  onToggle?: (key: string) => void
}

/** A branch's address in the pane's open/closed state. */
export function groupKey(repo: Repo, g: Group): string {
  return `${repo.root}|${g.branch}`
}

/**
 * Each repo with its PRs and branches. A branch reads in three layers: its
 * name and time (with its stretches of the day when `timeline`: beside the
 * name where the width allows, else on a line of their own, as in a docked
 * pane), a headline that says what it was, and one dim line of counts.
 * Its details (what was asked, commits, where files changed) follow when
 * shown. A blank line between branches keeps them apart.
 */
export function repoList(look: Look, day: Day, opts: ListOptions): RenderElement {
  const { Box, Text } = look.els
  const slots = slotsFor(day.repos)
  const repos = shownRepos(day)
  const toggles = opts.detail === 'toggle'
  const longest = Math.max(0, ...repos.flatMap(r => r.groups.filter(isShown).map(g => groupLabel(g).length)))
  const labelCols = Math.min(30, Math.max(12, longest + (toggles ? 6 : 4)))
  const inlineCols = look.columns - labelCols - DURATION_COLS - 2
  const belowCols = look.columns - INDENT
  const range = opts.timeline ? rangeOf(day, look.dayStart) : null
  const placement: Placement =
    range === null ? 'none' : inlineCols >= MIN_INLINE_COLS ? 'inline' : belowCols >= MIN_STRIP_COLS ? 'below' : 'none'
  const stripCols = placement === 'inline' ? inlineCols : belowCols
  const Svg = look.rich && 'Svg' in look.els ? look.els.Svg : null
  const stripPx = stripCols * PX_PER_COL

  const stripOf = (g: Group, slot: number, r: Range) =>
    Svg ? (
      <Svg
        source={A.stripSvg(g.spans, g.aloneSpans, slot, r, stripPx)}
        alt={`${groupLabel(g)}: ${g.first} to ${g.last}`}
        height={12}
        isInteractive
      />
    ) : (
      stripText(look, g, slot, r, stripCols)
    )
  const axisOf = (r: Range) =>
    Svg ? <Svg source={A.axisSvg(r, stripPx)} alt="" height={14} /> : <Text dimColor>{axisText(r, stripCols)}</Text>

  /** Name, then the timeline when it sits inline, then the time at the right edge. */
  const line = (label: RenderElement, middle: RenderElement | null, right: RenderElement) =>
    placement === 'inline' ? (
      <Box flexDirection="row" columnGap={1}>
        <Box width={labelCols} flexShrink={0}>
          {label}
        </Box>
        <Box width={stripCols} flexShrink={0} alignItems="center">
          {middle}
        </Box>
        <Box width={DURATION_COLS} flexShrink={0} justifyContent="flex-end">
          {right}
        </Box>
      </Box>
    ) : (
      <Box flexDirection="row" justifyContent="space-between" columnGap={1} width={look.columns}>
        <Box flexShrink={1}>{label}</Box>
        <Box flexShrink={0}>{right}</Box>
      </Box>
    )
  const under = (child: RenderElement) => <Box paddingLeft={INDENT}>{child}</Box>

  const axis =
    range === null || placement === 'none'
      ? null
      : placement === 'inline'
        ? line(<Text> </Text>, axisOf(range), <Text> </Text>)
        : under(axisOf(range))

  return (
    <Box flexDirection="column">
      {axis}
      {repos.map(repo => {
        const slot = slots.get(repo.root) ?? 0
        const { listed, folded } = splitMinor(repo, opts.foldMinor)
        return (
          <Box flexDirection="column" marginTop={1}>
            <Box flexDirection="row" justifyContent="space-between" width={look.columns}>
              <Box flexDirection="row" columnGap={1} alignItems="center">
                {dot(look, slot, repo.name)}
                <Text bold>{repo.name}</Text>
              </Box>
              <Text bold>{duration(repo.minutes)}</Text>
            </Box>
            {listed.map((g, i) => {
              const key = groupKey(repo, g)
              const open = opts.detail === 'full' || (toggles && !!opts.isOpen?.(key))
              const strip = range && placement !== 'none' ? stripOf(g, slot, range) : null
              const head = headline(g)
              const sections = open ? sectionsOf(g, opts.withTime) : []
              return (
                <Box flexDirection="column" marginTop={i === 0 ? 0 : 1}>
                  {line(
                    labelOf(look, g, key, toggles ? open : null, toggles ? opts.onToggle : undefined),
                    placement === 'inline' ? strip : null,
                    <Text>{duration(g.minutes)}</Text>,
                  )}
                  {placement === 'below' && strip ? under(strip) : null}
                  {head ? under(<Text wrap="truncate-end">{head}</Text>) : null}
                  {under(<Text dimColor wrap="wrap">{metaOf(g)}</Text>)}
                  {sections.length ? <Box marginTop={1}>{under(sectionRows(look, sections))}</Box> : null}
                </Box>
              )
            })}
            {folded.length ? (
              <Box marginTop={1} paddingLeft={2}>
                <Text dimColor wrap="wrap">
                  {alsoLine(folded)}
                </Text>
              </Box>
            ) : null}
          </Box>
        )
      })}
    </Box>
  )
}

export function footnote(look: Look, idleGapMin: number, maxUnattendedMin: number, split: 'focus' | 'even'): RenderElement {
  const { Text } = look.els
  const shared =
    split === 'focus' ? 'a minute parallel sessions share goes mostly to the one you last typed in' : 'parallel sessions share each minute evenly'
  return (
    <Text dimColor>
      {`Estimated from your Claude Code sessions and git. A ${idleGapMin}-minute gap ends a stretch of work, Claude working alone counts for ${maxUnattendedMin} minutes after your last message, and ${shared}.`}
    </Text>
  )
}

// -- /standup's row

/** A /standup reply drawn from its data: each day's summary and its repos, no timeline; details with `/standup full`. */
export function drawStandup(look: Look, s: Standup): RenderElement {
  const { Box, Text } = look.els
  const title =
    s.title === null
      ? null
      : look.rich && 'Markdown' in look.els
        ? (() => {
            const { Markdown } = look.els
            return <Markdown text={`## ${md(s.title)}`} />
          })()
        : <Text bold color="claude">{s.title}</Text>
  return (
    <Box flexDirection="column">
      {s.lead ? <Text color="success">{s.lead}</Text> : null}
      {title}
      {s.note ? <Text dimColor>{s.note}</Text> : null}
      {s.week ? weekView(look, s.week) : null}
      {s.blocks.map((b, i) => (
        <Box flexDirection="column" marginTop={i === 0 && s.title === null ? 0 : 1}>
          {summary(look, b.day, b.heading, b.isToday, false)}
          {hasWork(b.day)
            ? repoList(look, b.day, { timeline: false, detail: s.full ? 'full' : 'compact', withTime: false, foldMinor: !s.full })
            : null}
          {reviewList(look, b.day)}
        </Box>
      ))}
      {openPrList(look, s.openPrs ?? [])}
      {s.footer ? (
        <Box marginTop={1}>
          <Text dimColor>{s.footer}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

// -- reviews and open PRs, from GitHub

/** "Reviewed": the PRs the user reviewed that day, a line each with when. */
export function reviewList(look: Look, day: Day): RenderElement | null {
  const { Box, Text } = look.els
  const reviews = day.reviews ?? []
  if (!reviews.length) return null
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Reviewed</Text>
      {reviews.map(r => (
        <Box paddingLeft={2}>
          <Text wrap="wrap">
            {prLine(r)}
            <Text dimColor>{`  ${r.at}`}</Text>
          </Text>
        </Box>
      ))}
    </Box>
  )
}

/** The user's open PRs, after a standup's days. */
export function openPrList(look: Look, prs: OpenPr[]): RenderElement | null {
  const { Box, Text } = look.els
  if (!prs.length) return null
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Open PRs</Text>
      {prs.map(p => (
        <Box paddingLeft={2}>
          <Text wrap="wrap">
            {`${p.repo.split('/').pop() ?? p.repo} `}
            <Text color="suggestion">{`#${p.number}`}</Text>
            {` ${p.title}`}
            {p.isDraft ? <Text dimColor> · draft</Text> : null}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

// -- the week

const DAY_COLS = 7
const TOTAL_COLS = 8
/** Narrower than this for the names, the week is two lists instead of a grid. */
const MIN_SHEET_LABEL_COLS = 14

/** The repos of a timesheet, as slotsFor takes them, so each keeps its day-view color. */
function sheetRepos(sheet: Sheet): Repo[] {
  const byRoot = new Map<string, Repo>()
  for (const r of sheet.rows) {
    const repo = byRoot.get(r.root) ?? { name: r.repo, slug: r.slug, root: r.root, minutes: 0, hours: [], groups: [] }
    repo.minutes += r.total
    byRoot.set(r.root, repo)
  }
  return [...byRoot.values()]
}

/**
 * A week's timesheet: its title and total, then a row per repo and branch
 * with a column per day. A Markdown table where the surface draws one;
 * columns of text on the terminal, or, too narrow for seven columns, the
 * days' totals and the branches' as two lists.
 */
export function weekView(look: Look, week: Week): RenderElement {
  const { Box, Text } = look.els
  const sheet = sheetOf(week)
  const title = weekTitle(sheet)
  const Markdown = look.rich && 'Markdown' in look.els ? look.els.Markdown : null
  const header = Markdown ? (
    <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
      <Markdown text={`### ${md(title)}`} />
      {sheet.rows.length ? <Markdown text={`### ${duration(sheet.total)}`} /> : null}
    </Box>
  ) : (
    <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
      <Text bold>{title}</Text>
      {sheet.rows.length ? <Text bold>{duration(sheet.total)}</Text> : null}
    </Box>
  )
  if (!sheet.rows.length) {
    return (
      <Box flexDirection="column">
        {header}
        <Text dimColor>Nothing in your logs for this week.</Text>
      </Box>
    )
  }
  const slots = slotsFor(sheetRepos(sheet))
  const note = <Text dimColor>{roundingNote(sheet.roundTo)}</Text>
  if (Markdown) {
    return (
      <Box flexDirection="column" rowGap={1}>
        {header}
        <Markdown text={sheetMarkdown(sheet)} />
        {note}
      </Box>
    )
  }

  // Names get what the seven columns leave, up to what the longest needs; long ones are cut.
  const longest = Math.max(12, ...sheet.rows.map(r => Math.max(r.label.length + 2, r.repo.length + 2))) + 1
  const labelCols = Math.min(longest, 32, look.columns - 7 * DAY_COLS - TOTAL_COLS)
  if (labelCols < MIN_SHEET_LABEL_COLS) {
    // Too narrow for the grid: each day's total, then each branch's.
    return (
      <Box flexDirection="column" rowGap={1}>
        {header}
        <Box flexDirection="column">
          {sheet.dates.map((d, i) => (
            <Box flexDirection="row" justifyContent="space-between" width={Math.min(look.columns, 30)}>
              <Text>{columnLabel(d)}</Text>
              <Text {...((sheet.dayTotals[i] ?? 0) ? {} : { dimColor: true })}>{clockHours(sheet.dayTotals[i] ?? 0) || '·'}</Text>
            </Box>
          ))}
        </Box>
        <Box flexDirection="column">
          {sheet.rows.map((r, i) => (
            <Box flexDirection="column">
              {i === 0 || sheet.rows[i - 1]?.root !== r.root ? (
                <Box flexDirection="row" columnGap={1}>
                  {dot(look, slots.get(r.root) ?? 0, r.repo)}
                  <Text bold>{r.repo}</Text>
                </Box>
              ) : null}
              <Box flexDirection="row" justifyContent="space-between" width={look.columns}>
                <Box flexShrink={1}>
                  <Text wrap="truncate-end">{`  ${r.label}`}</Text>
                </Box>
                <Text>{clockHours(r.total)}</Text>
              </Box>
            </Box>
          ))}
        </Box>
        {note}
      </Box>
    )
  }

  const cells = (values: string[], total: string, bold = false): RenderElement[] => [
    ...values.map(v => (
      <Box width={DAY_COLS} flexShrink={0} justifyContent="flex-end">
        <Text {...(bold ? { bold: true } : {})} {...(v === '·' ? { dimColor: true } : {})}>
          {v}
        </Text>
      </Box>
    )),
    <Box width={TOTAL_COLS} flexShrink={0} justifyContent="flex-end">
      <Text bold>{total}</Text>
    </Box>,
  ]
  return (
    <Box flexDirection="column" rowGap={1}>
      {header}
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Box width={labelCols} flexShrink={0}>
            <Text> </Text>
          </Box>
          {sheet.dates.map(d => (
            <Box width={DAY_COLS} flexShrink={0} justifyContent="flex-end">
              <Text dimColor>{columnLabel(d)}</Text>
            </Box>
          ))}
          <Box width={TOTAL_COLS} flexShrink={0} justifyContent="flex-end">
            <Text dimColor>Total</Text>
          </Box>
        </Box>
        {sheet.rows.map((r, i) => (
          <Box flexDirection="column">
            {i === 0 || sheet.rows[i - 1]?.root !== r.root ? (
              <Box flexDirection="row" columnGap={1} marginTop={i === 0 ? 0 : 1}>
                {dot(look, slots.get(r.root) ?? 0, r.repo)}
                <Text bold>{r.repo}</Text>
              </Box>
            ) : null}
            <Box flexDirection="row">
              <Box width={labelCols} flexShrink={0}>
                <Text wrap="truncate-end">
                  {'  '}
                  {r.pr ? <Text color="suggestion">{`#${r.pr.number} `}</Text> : null}
                  {r.branch || 'no branch'}
                </Text>
              </Box>
              {cells(r.cells.map(c => clockHours(c) || '·'), clockHours(r.total))}
            </Box>
          </Box>
        ))}
        <Box flexDirection="row" marginTop={1}>
          <Box width={labelCols} flexShrink={0}>
            <Text bold>Total</Text>
          </Box>
          {cells(sheet.dayTotals.map(t => clockHours(t) || '·'), clockHours(sheet.total), true)}
        </Box>
      </Box>
      {note}
    </Box>
  )
}

