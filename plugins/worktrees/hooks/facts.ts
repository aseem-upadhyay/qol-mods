/**
 * Plain functions over what git, lsof and du print: no `$` here. The hooks
 * module runs the commands and hands their output to these.
 */
import type { Sizes, Sort, Worktree } from '../types'

/** A worktree as `git worktree list --porcelain` lists it. */
export type Listed = {
  path: string
  head: string
  branch: string | null
  isMain: boolean
  isBare: boolean
  isLocked: boolean
  lockReason: string | null
  isMissing: boolean
}

export function parseWorktrees(porcelain: string): Listed[] {
  const out: Listed[] = []
  for (const block of porcelain.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter(Boolean)
    const first = lines[0]
    if (!first?.startsWith('worktree ')) continue
    const w: Listed = {
      path: first.slice('worktree '.length),
      head: '',
      branch: null,
      isMain: out.length === 0,
      isBare: false,
      isLocked: false,
      lockReason: null,
      isMissing: false,
    }
    for (const line of lines.slice(1)) {
      const [word = '', ...rest] = line.split(' ')
      const value = rest.join(' ')
      if (word === 'HEAD') w.head = value
      else if (word === 'branch') w.branch = value.replace(/^refs\/heads\//, '')
      else if (word === 'bare') w.isBare = true
      else if (word === 'locked') {
        w.isLocked = true
        w.lockReason = value || null
      } else if (word === 'prunable') w.isMissing = true
    }
    out.push(w)
  }
  return out
}

/** What `git status --porcelain=v2 --branch -z` says about upstream and changes. */
export type Status = { upstream: string | null; unpushed: number | null; isUpstreamGone: boolean; paths: string[] }

export function parseStatus(out: string): Status {
  const tokens = out.split('\0')
  let upstream: string | null = null
  let unpushed: number | null = null
  const paths: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? ''
    if (t.startsWith('# branch.upstream ')) upstream = t.slice('# branch.upstream '.length)
    else if (t.startsWith('# branch.ab ')) unpushed = Number(/\+(\d+)/.exec(t)?.[1] ?? 0)
    else if (t.startsWith('1 ')) paths.push(t.split(' ').slice(8).join(' '))
    else if (t.startsWith('2 ')) {
      paths.push(t.split(' ').slice(9).join(' '))
      i++ // the path it was renamed from
    } else if (t.startsWith('u ')) paths.push(t.split(' ').slice(10).join(' '))
    else if (t.startsWith('? ')) paths.push(t.slice(2))
  }
  // A gone upstream is still named, with no ahead/behind line.
  return { upstream, unpushed, isUpstreamGone: upstream !== null && unpushed === null, paths }
}

/** The working directories in `lsof -Fn` output, one per process. */
export function parseLsof(out: string): string[] {
  return out
    .split('\n')
    .filter(line => line.startsWith('n'))
    .map(line => line.slice(1))
}

/** The worktree a folder lies in: the deepest one, since others nest inside the main one. */
export function ownerOf(dir: string, paths: readonly string[]): string | null {
  let best: string | null = null
  for (const p of paths) {
    if ((dir === p || dir.startsWith(p.endsWith('/') ? p : p + '/')) && (best === null || p.length > best.length)) best = p
  }
  return best
}

/** The folder under ~/.claude/projects that holds a directory's session transcripts. */
export function projectDir(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-')
}

/** `du -sk` output's KiB, or null. */
export function parseDu(out: string): number | null {
  const kb = Number(/^(\d+)/.exec(out.trim())?.[1])
  return Number.isFinite(kb) ? kb : null
}

const DAY = 24 * 60 * 60 * 1000

export function ago(at: number, now: number): string {
  const s = Math.max(0, now - at) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  const d = Math.floor(s / 86400)
  if (d < 14) return `${d}d ago`
  if (d < 60) return `${Math.floor(d / 7)}w ago`
  if (d < 365) return `${Math.floor(d / 30)}mo ago`
  return `${Math.floor(d / 365)}y ago`
}

export function sizeText(kb: number): string {
  if (kb < 1024) return `${kb} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  const gb = mb / 1024
  return `${gb < 100 ? gb.toFixed(1) : Math.round(gb)} GB`
}

export function lastActivity(w: Worktree): number | null {
  const times = [w.lastCommitAt, w.lastEditAt, w.lastSessionAt].filter((t): t is number => t !== null)
  return times.length ? Math.max(...times) : null
}

export type Tier = 'active' | 'idle' | 'stale' | 'very-stale' | 'unknown'

/** Active within a day; stale past `staleDays`; very stale past four times that. */
export function tierOf(w: Worktree, now: number, staleDays: number): Tier {
  const at = lastActivity(w)
  if (at === null) return 'unknown'
  const days = (now - at) / DAY
  if (days < 1) return 'active'
  if (days < staleDays) return 'idle'
  if (days < staleDays * 4) return 'stale'
  return 'very-stale'
}

export const TIER_LABEL: Record<Tier, string> = {
  active: 'Active',
  idle: 'Idle',
  stale: 'Stale',
  'very-stale': 'Very stale',
  unknown: 'No activity found',
}

export function isStale(w: Worktree, now: number, staleDays: number): boolean {
  const tier = tierOf(w, now, staleDays)
  return tier === 'stale' || tier === 'very-stale'
}

/**
 * The disk a worktree's own folder takes: the main one's less the worktrees
 * nested in it, which du counted twice. null while unknown.
 */
export function ownSize(w: Worktree, all: readonly Worktree[], sizes: Sizes): number | null {
  const kb = sizes[w.path]
  if (kb === undefined || kb === null) return null
  const nested = all.filter(o => o.path !== w.path && o.path.startsWith(w.path + '/'))
  return Math.max(0, kb - nested.reduce((sum, o) => sum + (sizes[o.path] ?? 0), 0))
}

/** Whether the pane offers Remove, or why not. */
export function removable(w: Worktree): { ok: true } | { ok: false; why: string } {
  if (w.isMain) return { ok: false, why: 'The main worktree holds the repository, so it stays.' }
  if (w.isThisSession) return { ok: false, why: 'This session runs here, so it can’t be removed from here.' }
  if (w.isLocked) return { ok: false, why: `Locked${w.lockReason ? ` (${w.lockReason})` : ''}: git worktree unlock it first.` }
  if (w.isMissing) return { ok: false, why: 'Its folder is already gone: Prune clears it from git’s list.' }
  return { ok: true }
}

/** The main worktree first, then the stalest or the largest. */
export function sorted(all: readonly Worktree[], sort: Sort, sizes: Sizes): Worktree[] {
  const rank = (w: Worktree) => (w.isMain ? 0 : 1)
  return [...all].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    if (sort === 'size') return (ownSize(b, all, sizes) ?? -1) - (ownSize(a, all, sizes) ?? -1)
    return (lastActivity(a) ?? 0) - (lastActivity(b) ?? 0)
  })
}

/** A path as the pane shows it: under the main worktree, relative to it; else with ~ for home. */
export function shortPath(path: string, root: string | null, home: string | null): string {
  if (root && path !== root && path.startsWith(root + '/')) return path.slice(root.length + 1)
  if (home && (path === home || path.startsWith(home + '/'))) return '~' + path.slice(home.length)
  return path
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`
}

/** The worktree's name in a sentence: its branch, else the folder's name. */
export function nameOf(w: Worktree): string {
  return w.branch ?? w.path.split('/').pop() ?? w.path
}

/** The live sessions other than this one. */
export function otherSessions(w: Worktree): number {
  return Math.max(0, (w.liveSessions ?? 0) - (w.isThisSession ? 1 : 0))
}

/** What a worktree holds that its main branch doesn't, in a few words each. */
export function factsOf(w: Worktree, base: string | null): { text: string; warn: boolean }[] {
  if (w.isMissing) return [{ text: 'folder missing', warn: true }]
  const out: { text: string; warn: boolean }[] = []
  out.push(w.dirty ? { text: `${plural(w.dirty, 'uncommitted change')}`, warn: true } : { text: 'clean', warn: false })
  // The main worktree is where the base branch usually lives: nothing to compare.
  if (base !== null && !w.isMain) {
    out.push(w.ahead === 0 ? { text: `nothing beyond ${base}`, warn: false } : { text: `${plural(w.ahead, 'commit')} not in ${base}`, warn: false })
  }
  if (w.isUpstreamGone) out.push({ text: 'remote branch deleted', warn: false })
  else if (w.unpushed) out.push({ text: `${w.unpushed} not pushed`, warn: false })
  return out
}
