/**
 * The worktrees pane. A header with the repo, its total size and a bar of
 * where the disk goes, colored by staleness; then a card per worktree: a
 * dot for how stale it is, its name and size, one quiet line of what
 * matters, and its details folded away until the name is pressed. Remove
 * asks once more, saying what goes, before anything is deleted. Drawn from
 * plain data; the buttons are the hooks module's.
 */
import type { ElementTable, RenderElement } from 'claude-code'

import type { Scan, Sizes, Sort, Worktree } from '../types'
import {
  ago,
  factsOf,
  isStale,
  lastActivity,
  nameOf,
  otherSessions,
  ownSize,
  plural,
  removable,
  shortPath,
  sizeText,
  sorted,
  TIER_LABEL,
  tierOf,
} from './facts'
import type { Tier } from './facts'

export const PANE = 'worktrees'
export const TITLE = 'Worktrees'

export type PaneContext = {
  scan: Scan
  sizes: Sizes
  measuring: string[]
  confirm: string | null
  busy: string | null
  /** The worktree whose details are shown. */
  open: string | null
  sort: Sort
  now: number
  home: string | null
  staleDays: number
  bodyColumns: number
}

export type PaneActions = {
  refresh: () => void
  setSort: (sort: Sort) => void
  prune: () => void
  /** Shows or hides a worktree's details. */
  toggle: (path: string) => void
  /** Asks to remove the worktree at `path`; null puts the question away. */
  ask: (path: string | null) => void
  remove: (path: string, force: boolean) => void
}

const TONE: Record<Tier, string> = {
  active: 'success',
  idle: 'suggestion',
  stale: 'warning',
  'very-stale': 'error',
  unknown: 'inactive',
}

const LEGEND: Tier[] = ['active', 'idle', 'stale', 'very-stale']

/** The widest the disk bar draws, in cells. */
const BAR_MAX = 48

function sizeOf(w: Worktree, ctx: PaneContext): string {
  const kb = ownSize(w, ctx.scan.worktrees, ctx.sizes)
  if (kb !== null) return sizeText(kb)
  if (ctx.measuring.includes(w.path)) return '…'
  return '—'
}

/** Who is in it now, as a chip; null for nobody. */
function chip(els: ElementTable, w: Worktree): RenderElement | null {
  const { Text } = els
  const others = otherSessions(w)
  if (w.isThisSession) return <Text color="claude">◉ you’re here{others ? ` +${others}` : ''}</Text>
  if (others) return <Text color="claude">◉ {others === 1 ? 'in use' : `${others} sessions`}</Text>
  if (w.isMain) return <Text dimColor>⌂ main worktree</Text>
  if (w.isLocked) return <Text dimColor>locked</Text>
  return null
}

/** Where the disk goes: a cell per share of the total, in each worktree's staleness color. */
function diskBar(els: ElementTable, list: Worktree[], ctx: PaneContext, total: number): RenderElement | null {
  const { Text } = els
  if (!total) return null
  const width = Math.max(10, Math.min(BAR_MAX, ctx.bodyColumns - 4))
  const parts = list
    .map(w => ({ w, kb: ownSize(w, list, ctx.sizes) ?? 0 }))
    .filter(p => p.kb > 0)
    .sort((a, b) => b.kb - a.kb)
  let left = width
  const cells = parts.map((p, i) => {
    const n = i === parts.length - 1 ? left : Math.min(left, Math.max(1, Math.round((p.kb / total) * width)))
    left -= n
    return { tone: TONE[tierOf(p.w, ctx.now, ctx.staleDays)], n }
  })
  return (
    <Text>
      {cells.filter(c => c.n > 0).map(c => (
        <Text color={c.tone}>{'█'.repeat(c.n)}</Text>
      ))}
    </Text>
  )
}

function question(els: ElementTable, w: Worktree, ctx: PaneContext, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = els
  const size = ownSize(w, ctx.scan.worktrees, ctx.sizes)
  const others = otherSessions(w)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1} marginTop={1}>
      <Text bold>Remove {nameOf(w)}?</Text>
      <Text dimColor>
        Deletes the folder{size !== null ? ` · frees ${sizeText(size)}` : ''} · the branch stays
      </Text>
      {w.dirty ? <Text color="warning">⚠ {plural(w.dirty, 'uncommitted change')} will be lost</Text> : null}
      {others ? <Text color="warning">⚠ {others === 1 ? 'a Claude session is' : `${others} Claude sessions are`} working in it</Text> : null}
      <Box flexDirection="row" columnGap={2} marginTop={1}>
        <Button
          key={`confirm:${w.path}`}
          label={w.dirty ? 'Discard & remove' : 'Remove'}
          variant="primary"
          onPress={() => actions.remove(w.path, w.dirty > 0)}
        />
        <Button key={`cancel:${w.path}`} label="Cancel" onPress={() => actions.ask(null)} />
      </Box>
    </Box>
  )
}

function card(els: ElementTable, w: Worktree, ctx: PaneContext, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = els
  const tier = w.isMissing ? 'unknown' : tierOf(w, ctx.now, ctx.staleDays)
  const at = lastActivity(w)
  const isOpen = ctx.open === w.path
  const can = removable(w)

  // One quiet line: how stale, then only what needs a look.
  const line: RenderElement[] = []
  if (w.isMissing) line.push(<Text color="warning">folder missing</Text>)
  else {
    const when = `${TIER_LABEL[tier].toLowerCase()}${at !== null ? ` · ${ago(at, ctx.now)}` : ''}`
    line.push(<Text color={tier === 'stale' || tier === 'very-stale' ? TONE[tier] : undefined} dimColor={!(tier === 'stale' || tier === 'very-stale')}>{when}</Text>)
    if (w.dirty) line.push(<Text color="warning">{plural(w.dirty, 'change')}</Text>)
    if (!w.isMain && ctx.scan.base !== null && w.ahead) line.push(<Text dimColor>{w.ahead} ahead</Text>)
  }
  const quiet = line.flatMap((t, i) => (i ? [<Text dimColor> · </Text>, t] : [t]))

  let action: RenderElement | null = null
  if (ctx.busy === w.path) action = <Text dimColor>removing…</Text>
  else if (w.isMissing) action = null
  else if (can.ok && ctx.confirm !== w.path) {
    action = <Button key={`remove:${w.path}`} label="Remove" plain dimColor onPress={() => actions.ask(w.path)} />
  }

  const when = [
    w.lastCommitAt !== null ? `commit ${ago(w.lastCommitAt, ctx.now)}` : null,
    w.lastEditAt !== null ? `edit ${ago(w.lastEditAt, ctx.now)}` : null,
    w.lastSessionAt !== null ? `Claude ${ago(w.lastSessionAt, ctx.now)}` : null,
  ].filter(Boolean)
  const details = isOpen ? (
    <Box flexDirection="column" paddingLeft={2}>
      <Text dimColor wrap="truncate-middle">
        {shortPath(w.path, w.isMain ? null : ctx.scan.root, ctx.home)}
      </Text>
      {when.length ? <Text dimColor>{when.join(' · ')}</Text> : null}
      <Text dimColor>{factsOf(w, ctx.scan.base).map(f => f.text).join(' · ')}</Text>
      {!can.ok && !w.isMissing ? <Text dimColor>{can.why}</Text> : null}
    </Box>
  ) : null

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Box flexDirection="row" columnGap={1} flexShrink={1}>
          <Button key={`row:${w.path}`} plain onPress={() => actions.toggle(w.path)}>
            <Text color={TONE[tier]}>●</Text> <Text bold>{w.branch ?? `detached ${w.head.slice(0, 7)}`}</Text>
          </Button>
          {chip(els, w)}
        </Box>
        {w.isMissing ? null : (
          <Text bold tabular>
            {sizeOf(w, ctx)}
          </Text>
        )}
      </Box>
      <Box flexDirection="row" justifyContent="space-between" columnGap={2} paddingLeft={2}>
        <Text>{quiet}</Text>
        {action}
      </Box>
      {details}
      {ctx.confirm === w.path ? question(els, w, ctx, actions) : null}
    </Box>
  )
}

export function drawPane(els: ElementTable, ctx: PaneContext, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = els
  const { scan } = ctx
  const list = sorted(scan.worktrees, ctx.sort, ctx.sizes)
  const missing = list.filter(w => w.isMissing).length
  const total = list.reduce((sum, w) => sum + (ownSize(w, list, ctx.sizes) ?? 0), 0)
  const stale = list.filter(w => !w.isMain && !w.isThisSession && isStale(w, ctx.now, ctx.staleDays))
  const staleKb = stale.reduce((sum, w) => sum + (ownSize(w, list, ctx.sizes) ?? 0), 0)

  if (!list.length) {
    const text = scan.status === 'failed' ? (scan.error ?? 'Could not read the worktrees.') : 'Reading the worktrees…'
    return (
      <Box paddingX={1}>
        <Text color={scan.status === 'failed' ? 'warning' : undefined} dimColor={scan.status !== 'failed'}>
          {text}
        </Text>
      </Box>
    )
  }

  const sub = [
    plural(list.length, 'worktree'),
    stale.length ? `${stale.length} stale${staleKb ? ` · ${sizeText(staleKb)} to reclaim` : ''}` : 'none stale',
  ]
  return (
    <Box flexDirection="column" paddingX={1} rowGap={1}>
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
          <Text bold size="heading">
            {scan.root ? (scan.root.split('/').pop() ?? scan.root) : 'Worktrees'}
          </Text>
          <Text bold tabular>
            {total ? sizeText(total) : ''}
            {ctx.measuring.length ? ' …' : ''}
          </Text>
        </Box>
        {diskBar(els, list, ctx, total)}
        <Text color={stale.length ? 'warning' : undefined} dimColor={!stale.length}>
          {sub.join(' · ')}
        </Text>
      </Box>
      {scan.status === 'failed' ? <Text color="warning">{scan.error ?? 'Could not read the worktrees.'}</Text> : null}
      {list.map(w => card(els, w, ctx, actions))}
      <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap" columnGap={2}>
        <Text>
          {LEGEND.flatMap((t, i) => [i ? <Text> </Text> : null, <Text color={TONE[t]}>●</Text>, <Text dimColor> {TIER_LABEL[t].toLowerCase()}</Text>])}
        </Text>
        <Box flexDirection="row" columnGap={2}>
          <Button key="refresh" label={scan.status === 'running' ? 'Refreshing…' : 'Refresh'} hotkey="r" plain dimColor onPress={() => actions.refresh()} />
          <Button
            key="sort"
            label={ctx.sort === 'stale' ? 'By size' : 'By staleness'}
            hotkey="s"
            plain
            dimColor
            onPress={() => actions.setSort(ctx.sort === 'stale' ? 'size' : 'stale')}
          />
          {missing ? <Button key="prune" label={`Prune ${missing}`} hotkey="p" plain dimColor onPress={() => actions.prune()} /> : null}
        </Box>
      </Box>
      <Text dimColor size="caption">
        Stale: nothing for {plural(ctx.staleDays, 'day')}. Press a name for details.
      </Text>
    </Box>
  )
}

/** The worktrees as text: the command's answer where no pane is drawn. */
export function listText(ctx: Omit<PaneContext, 'open' | 'bodyColumns'>): string {
  const { scan } = ctx
  const lines = [`${plural(scan.worktrees.length, 'worktree')} of ${scan.root ?? 'this repo'}:`]
  for (const w of sorted(scan.worktrees, 'stale', ctx.sizes)) {
    const at = lastActivity(w)
    const kb = ownSize(w, scan.worktrees, ctx.sizes)
    const who = w.isThisSession ? ' · this session' : otherSessions(w) ? ` · ${plural(otherSessions(w), 'Claude session')} running` : ''
    lines.push(
      `- ${w.branch ?? `detached at ${w.head.slice(0, 7)}`}${w.isMain ? ' (main)' : ''}: ${TIER_LABEL[tierOf(w, ctx.now, ctx.staleDays)]}` +
        `${at !== null ? `, ${ago(at, ctx.now)}` : ''}${kb !== null ? ` · ${sizeText(kb)}` : ''} · ` +
        factsOf(w, scan.base)
          .map(f => f.text)
          .join(', ') +
        who,
      `  ${shortPath(w.path, null, ctx.home)}`,
    )
  }
  return lines.join('\n')
}
