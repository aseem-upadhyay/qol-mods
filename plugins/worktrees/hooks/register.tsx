/**
 * worktrees: every git worktree of the session's repo, in a pane that /worktree opens.
 *
 * Everything that talks to the engine is here; facts.ts reads what the
 * commands print and pane.tsx draws. Reading runs git, lsof and du and
 * changes nothing. The one thing it changes is a worktree the person
 * removes with the pane's Remove, pressed twice, through `git worktree
 * remove`, which keeps the branch.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Scan, Worktree } from '../types'
import { nameOf, ownerOf, ownSize, parseDu, parseLsof, parseStatus, parseWorktrees, projectDir, sizeText } from './facts'
import type { Listed } from './facts'
import { drawPane, listText, PANE, TITLE } from './pane'
import type { PaneActions, PaneContext } from './pane'

const EMPTY: Scan = { status: 'idle', error: null, root: null, base: null, worktrees: [] }

const scanAtom = atom({ plugin: 'worktrees', key: 'scan' } as const, EMPTY, { shape: 'scan-1' })
const sizesAtom = atom({ plugin: 'worktrees', key: 'sizes' } as const, {}, { shape: 'sizes-1' })
const measuringAtom = atom({ plugin: 'worktrees', key: 'measuring' } as const, [])
const confirmAtom = atom({ plugin: 'worktrees', key: 'confirm' } as const, null)
const busyAtom = atom({ plugin: 'worktrees', key: 'busy' } as const, null)
const sortAtom = atom({ plugin: 'worktrees', key: 'sort' } as const, 'stale')
const openAtom = atom({ plugin: 'worktrees', key: 'open' } as const, null)

/** Files whose times are read for "edited": enough to find the newest. */
const EDITS_READ = 50
/** du runs this many at once: more only fights over the disk. */
const DU_AT_ONCE = 3
const DU_TIMEOUT_MS = 5 * 60 * 1000
const REMOVE_TIMEOUT_MS = 5 * 60 * 1000

type Ctx = { staleDays: number }

async function git($: EngineInterface, argv: string[], timeoutMs = 60_000) {
  try {
    const run = await $.process.run(['git', ...argv], { timeoutMs })
    return run.exitCode === 0 ? run.stdout : null
  } catch {
    return null
  }
}

/** What "ahead" counts against: origin's default branch, else a local main or master. */
async function baseOf($: EngineInterface, root: string): Promise<string | null> {
  const remote = await git($, ['-C', root, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  if (remote?.trim()) return remote.trim()
  for (const name of ['main', 'master']) {
    if ((await git($, ['-C', root, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`])) !== null) return name
  }
  return null
}

/** The working directories of the Claude Code processes running now; null where lsof can't say. */
async function liveDirs($: EngineInterface): Promise<string[] | null> {
  try {
    // lsof exits 1 when nothing matched, and over a process it may not read: what it printed stands.
    const run = await $.process.run(['lsof', '-a', '-d', 'cwd', '-c', 'claude', '-Fn'], { timeoutMs: 10_000 })
    return parseLsof(run.stdout)
  } catch {
    return null
  }
}

async function newestMtime($: EngineInterface, paths: string[]): Promise<number | null> {
  const times = await Promise.all(paths.map(p => $.fs.stat(p).then(s => s.mtimeMs, () => null)))
  const known = times.filter((t): t is number => t !== null)
  return known.length ? Math.max(...known) : null
}

/** The newest write to a transcript of a session started in `path`. */
async function lastSessionAt($: EngineInterface, projects: string | null, path: string): Promise<number | null> {
  if (!projects) return null
  try {
    const files = (await $.fs.list(`${projects}/${projectDir(path)}`)).filter(f => f.kind === 'file' && f.name.endsWith('.jsonl'))
    return files.length ? Math.max(...files.map(f => f.mtimeMs)) : null
  } catch {
    return null
  }
}

async function inspect(
  $: EngineInterface,
  l: Listed,
  base: string | null,
  projects: string | null,
): Promise<Omit<Worktree, 'liveSessions' | 'isThisSession'>> {
  const known = {
    path: l.path,
    branch: l.branch,
    head: l.head,
    isMain: l.isMain,
    isLocked: l.isLocked,
    lockReason: l.lockReason,
    isMissing: l.isMissing,
  }
  if (l.isMissing) {
    return { ...known, lastCommitAt: null, lastEditAt: null, lastSessionAt: null, dirty: 0, ahead: 0, unpushed: null, isUpstreamGone: false }
  }
  const [log, status, ahead, session] = await Promise.all([
    git($, ['-C', l.path, 'log', '-1', '--format=%ct', 'HEAD']),
    // No optional locks: reading must not touch the index, or its time.
    git($, ['--no-optional-locks', '-C', l.path, 'status', '--porcelain=v2', '--branch', '-z']),
    base ? git($, ['-C', l.path, 'rev-list', '--count', `${base}..HEAD`]) : Promise.resolve(null),
    lastSessionAt($, projects, l.path),
  ])
  const st = status === null ? null : parseStatus(status)
  const commit = Number(log?.trim())
  return {
    ...known,
    lastCommitAt: log && Number.isFinite(commit) ? commit * 1000 : null,
    lastEditAt: st ? await newestMtime($, st.paths.slice(0, EDITS_READ).map(p => `${l.path}/${p}`)) : null,
    lastSessionAt: session,
    dirty: st?.paths.length ?? 0,
    ahead: Number(ahead?.trim()) || 0,
    unpushed: st?.unpushed ?? null,
    isUpstreamGone: st?.isUpstreamGone ?? false,
  }
}

/**
 * Reads every worktree. Sizes are measured after, a few at a time, for every
 * folder or only those not yet measured; waited for only when asked.
 */
async function scan($: EngineInterface, opts: { remeasure: boolean; waitForSizes?: boolean }): Promise<Scan> {
  await update($, scanAtom, (was): Scan => ({ ...was, status: 'running', error: null }))
  const repo = await $.session.repo()
  if (!repo) {
    const failed: Scan = { ...EMPTY, status: 'failed', error: 'This session isn’t in a git repository.' }
    await update($, scanAtom, () => failed)
    return failed
  }
  const listed = await git($, ['-C', repo.root, 'worktree', 'list', '--porcelain'])
  if (listed === null) {
    const failed: Scan = { ...EMPTY, root: repo.root, status: 'failed', error: 'git worktree list failed. Is git installed?' }
    await update($, scanAtom, () => failed)
    return failed
  }
  const home = (await $.env.get('HOME')) ?? null
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : null)
  const projects = configDir ? `${configDir}/projects` : null
  const all = parseWorktrees(listed).filter(l => !l.isBare)
  const [base, live, cwd] = await Promise.all([baseOf($, repo.root), liveDirs($), $.session.cwd()])
  const paths = all.map(l => l.path)
  const here = ownerOf(cwd, paths)
  const counts = new Map<string, number>()
  for (const dir of live ?? []) {
    const owner = ownerOf(dir, paths)
    if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1)
  }
  const worktrees = await Promise.all(
    all.map(async l => ({
      ...(await inspect($, l, base, projects)),
      liveSessions: live === null ? null : (counts.get(l.path) ?? 0),
      isThisSession: l.path === here,
    })),
  )
  const done: Scan = { status: 'idle', error: null, root: repo.root, base, worktrees }
  await update($, scanAtom, () => done)
  const sized = measure($, worktrees, opts.remeasure)
  if (opts.waitForSizes) await sized
  return done
}

async function measureOne($: EngineInterface, path: string): Promise<void> {
  await update($, measuringAtom, was => [...was.filter(p => p !== path), path])
  let kb: number | null = null
  try {
    // du exits 1 over a file it can't read, and still prints the total.
    kb = parseDu((await $.process.run(['du', '-sk', path], { timeoutMs: DU_TIMEOUT_MS })).stdout)
  } catch {
    kb = null
  }
  await update($, sizesAtom, was => ({ ...was, [path]: kb }))
  await update($, measuringAtom, was => was.filter(p => p !== path))
}

async function measure($: EngineInterface, worktrees: Worktree[], remeasure: boolean): Promise<void> {
  const sizes = await read($, sizesAtom)
  const busy = await read($, measuringAtom)
  // The main worktree last: it is the slowest, holding .git and often the others.
  const queue = worktrees
    .filter(w => !w.isMissing && !busy.includes(w.path) && (remeasure || sizes[w.path] === undefined))
    .sort((a, b) => Number(a.isMain) - Number(b.isMain))
    .map(w => w.path)
  const worker = async () => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) await measureOne($, path)
  }
  await Promise.all(Array.from({ length: DU_AT_ONCE }, worker))
}

function actionsFor($: EngineInterface): PaneActions {
  return {
    refresh: () => void scan($, { remeasure: true }),
    setSort: sort => void update($, sortAtom, () => sort),
    toggle: path => void update($, openAtom, was => (was === path ? null : path)),
    prune: () =>
      void (async () => {
        const root = (await read($, scanAtom)).root
        if (!root) return
        const done = await git($, ['-C', root, 'worktree', 'prune'])
        $.ui.toast(done === null ? 'git worktree prune failed.' : 'Pruned the worktrees whose folders were gone.')
        await scan($, { remeasure: false })
      })(),
    ask: path =>
      void (async () => {
        await update($, confirmAtom, () => path)
        if (path === null) return
        // Whether a session is in it is checked again now, not taken from the last scan.
        const live = await liveDirs($)
        if (live === null) return
        await update($, scanAtom, was => {
          const paths = was.worktrees.map(w => w.path)
          const count = live.filter(dir => ownerOf(dir, paths) === path).length
          return { ...was, worktrees: was.worktrees.map(w => (w.path === path ? { ...w, liveSessions: count } : w)) }
        })
      })(),
    remove: (path, force) =>
      void (async () => {
        const state = await read($, scanAtom)
        const w = state.worktrees.find(one => one.path === path)
        if (!state.root || !w || (await read($, busyAtom))) return
        await update($, confirmAtom, () => null)
        await update($, busyAtom, () => path)
        const kb = ownSize(w, state.worktrees, await read($, sizesAtom))
        try {
          const run = await $.process.run(['git', '-C', state.root, 'worktree', 'remove', ...(force ? ['--force'] : []), path], {
            timeoutMs: REMOVE_TIMEOUT_MS,
          })
          if (run.exitCode !== 0) {
            const why = run.stderr.trim().split('\n')[0]?.replace(/^fatal: /, '') ?? `exit ${run.exitCode}`
            $.ui.toast(`Couldn’t remove ${nameOf(w)}: ${why}`)
          } else {
            const freed = kb !== null ? `, freeing about ${sizeText(kb)}` : ''
            $.ui.toast(`Removed ${nameOf(w)}${freed}.${w.branch ? ` The branch ${w.branch} is kept.` : ''}`)
            await update($, sizesAtom, was => Object.fromEntries(Object.entries(was).filter(([p]) => p !== path)))
          }
        } catch (error) {
          $.ui.toast(`Couldn’t remove ${nameOf(w)}: ${String(error)}`)
        }
        await update($, busyAtom, () => null)
        await scan($, { remeasure: false })
      })(),
  }
}

async function contextFor($: EngineInterface, ctx: Ctx, bodyColumns = 80): Promise<PaneContext> {
  return {
    scan: await read($, scanAtom),
    sizes: await read($, sizesAtom),
    measuring: await read($, measuringAtom),
    confirm: await read($, confirmAtom),
    busy: await read($, busyAtom),
    open: await read($, openAtom),
    sort: await read($, sortAtom),
    now: await $.clock.now(),
    home: (await $.env.get('HOME')) ?? null,
    staleDays: ctx.staleDays,
    bodyColumns,
  }
}

export const register: Register = (on, options) => {
  const days = Number(options.staleAfterDays)
  const ctx: Ctx = { staleDays: Number.isFinite(days) && days > 0 ? days : 14 }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'worktree',
      description: "This repo's git worktrees in a pane: how stale each is, its size, which a Claude session is using, and Remove",
    })
    return started
  })

  on('command.run', { command: 'worktree' }, async $ => {
    await update($, confirmAtom, () => null)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    // Where nothing draws (a bare `claude -p`) or no surface places panes, the answer comes as text.
    const isDrawn = opened.isPlaced && (await $.session.surfaces()).length > 0
    if (isDrawn) {
      void scan($, { remeasure: true })
      return { text: 'Opened the worktrees pane.' }
    }
    const done = await scan($, { remeasure: false, waitForSizes: true })
    if (done.status === 'failed') return { text: done.error ?? 'Could not read the worktrees.' }
    return { text: listText(await contextFor($, ctx)) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    drawPane($.ui.resolve(e), await contextFor($, ctx, e.props.bodyColumns), actionsFor($)),
  )
}
