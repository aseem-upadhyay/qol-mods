/** Boots worktrees against a test engine over a made-up repo: answers git, lsof and du, and records what ran. */
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

export const SURFACES = ['terminal', 'desktop'] as const
export type Surface = (typeof SURFACES)[number]

/** Saturday 31 October 2026, 12:00 UTC. */
export const NOW = Date.UTC(2026, 9, 31, 12)
const DAY = 24 * 60 * 60 * 1000

export const ROOT = '/home/me/app'
export const OLD = `${ROOT}/.claude/worktrees/old`
export const HERE = `${ROOT}/.claude/worktrees/here`
export const HOTFIX = '/home/me/hotfix'
export const GONE = `${ROOT}/.claude/worktrees/gone`

const LIST = [
  `worktree ${ROOT}\nHEAD aaaaaaa\nbranch refs/heads/main`,
  `worktree ${OLD}\nHEAD bbbbbbb\nbranch refs/heads/feature/old`,
  `worktree ${HERE}\nHEAD ccccccc\nbranch refs/heads/claude/here`,
  `worktree ${HOTFIX}\nHEAD ddddddd\nbranch refs/heads/hotfix`,
  `worktree ${GONE}\nHEAD eeeeeee\nbranch refs/heads/gone\nprunable gitdir file points to non-existent location`,
].join('\n\n')

/** Each worktree's git facts: commit age in days, status (porcelain v2, NUL-separated), commits past main. */
const GIT: Record<string, { commitDaysAgo: number; status: string; ahead: number }> = {
  [ROOT]: { commitDaysAgo: 2, status: '# branch.oid aaaaaaa\x00# branch.head main\x00', ahead: 0 },
  // Merged on GitHub and the remote branch deleted: upstream named, no ahead/behind.
  [OLD]: { commitDaysAgo: 40, status: '# branch.oid bbbbbbb\x00# branch.head feature/old\x00# branch.upstream origin/feature/old\x00', ahead: 0 },
  [HERE]: {
    commitDaysAgo: 0.1,
    status: '# branch.head claude/here\x00# branch.upstream origin/claude/here\x00# branch.ab +1 -0\x001 .M N... 100644 100644 100644 abc abc src/a.ts\x00? notes.md\x00',
    ahead: 3,
  },
  [HOTFIX]: {
    commitDaysAgo: 20,
    status: '# branch.head hotfix\x001 .M N... 100644 100644 100644 abc abc fix.ts\x002 R. N... 100644 100644 100644 abc abc R100 new.ts\x00old.ts\x00? x.log\x00',
    ahead: 1,
  },
}

const KB: Record<string, number> = { [ROOT]: 900_000, [OLD]: 400_000, [HERE]: 100_000, [HOTFIX]: 2_200_000 }

export type Seen = { argv: string[][]; toasts: string[]; opened: number; commands: string[] }

const ran = (exitCode: number, stdout: string, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

export type Setup = { placed?: boolean; noLsof?: boolean; removeFails?: string }

export async function boot($: Engine, on: On, surface: Surface, setup: Setup = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/me' })
  const seen: Seen = { argv: [], toasts: [], opened: 0, commands: [] }

  on('process.run', async (_$, e) => {
    const argv = [...e.argv]
    seen.argv.push(argv)
    const [cmd] = argv
    if (cmd === 'lsof') {
      if (setup.noLsof) throw new Error('spawn lsof ENOENT')
      // This session, another in the same worktree (in a subfolder), one in the hotfix, one elsewhere.
      return ran(0, `p1\nfcwd\nn${HERE}\np2\nfcwd\nn${HERE}/src\np3\nfcwd\nn${HOTFIX}\np4\nfcwd\nn/home/me/other\n`)
    }
    if (cmd === 'du') {
      const path = argv[2] ?? ''
      return ran(0, `${KB[path] ?? 0}\t${path}\n`)
    }
    const at = argv.indexOf('-C')
    const dir = argv[at + 1] ?? ''
    const sub = argv[at + 2]
    if (sub === 'worktree' && argv[at + 3] === 'list') return ran(0, LIST + '\n')
    if (sub === 'worktree' && argv[at + 3] === 'remove') {
      return setup.removeFails ? ran(128, '', `fatal: ${setup.removeFails}\n`) : ran(0, '')
    }
    if (sub === 'worktree' && argv[at + 3] === 'prune') return ran(0, '')
    if (sub === 'symbolic-ref') return ran(0, 'origin/main\n')
    const g = GIT[dir]
    if (!g) return ran(128, '', 'fatal: not a git repository')
    if (sub === 'log') return ran(0, `${Math.floor((NOW - g.commitDaysAgo * DAY) / 1000)}\n`)
    if (sub === 'status') return ran(0, g.status)
    if (sub === 'rev-list') return ran(0, `${g.ahead}\n`)
    return ran(1, '')
  })
  // Uncommitted files were last changed 12 days ago in the hotfix, an hour ago elsewhere.
  on('fs.stat', async (_$, e) => ({
    value: { kind: 'file' as const, size: 1, mtimeMs: NOW - (e.path.startsWith(HOTFIX) ? 12 * DAY : 60 * 60 * 1000), isLink: false },
  }))
  on('fs.list', async (_$, e) => {
    // A Claude session last wrote its transcript in the hotfix worktree 9 days ago.
    if (e.path === '/home/me/.claude/projects/-home-me-hotfix') {
      return { value: [{ name: 's.jsonl', kind: 'file' as const, size: 1, mtimeMs: NOW - 9 * DAY, isLink: false }] }
    }
    return { value: [] }
  })
  on('session.repo', async () => ({ value: { root: ROOT, remote: null, internal: false, name: null, id: 'app' } }))
  on('session.cwd', async () => ({ value: `${HERE}/src` }))
  on('command.register', async (_$, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', async () => {
    seen.opened += 1
    return { value: setup.placed === false ? { isPlaced: false as const, reason: 'no panes on this surface' } : { isPlaced: true as const } }
  })
  on('session.surfaces', async () => ({ value: [surface] }))
  on('ui.toast', async (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.start({ cwd: HERE, surface, isInteractive: true })
  await clock.settle()

  const pane = (bodyColumns = 100) =>
    $.ui.mount({
      plugin: 'worktrees',
      surface,
      component: 'Pane',
      requestId: 'worktrees',
      props: {
        title: 'Worktrees',
        isFocused: true,
        bodyColumns,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 60 },
        view: {},
      },
    })
  const run = async () => {
    const result = await $.command.run({
      command: 'worktree',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 120 },
    })
    await clock.settle()
    return result
  }
  /** The git commands that changed something. */
  const changes = () => seen.argv.filter(a => a[0] === 'git' && (a.includes('remove') || a.includes('prune')))
  return { clock, seen, pane, run, changes }
}
