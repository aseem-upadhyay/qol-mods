/** What git and this machine say about each worktree, and the pane's own state. */

/** One worktree of the repo. Times are epoch milliseconds. */
export type Worktree = {
  path: string
  /** The branch checked out, short; null when HEAD is detached. */
  branch: string | null
  head: string
  isMain: boolean
  isLocked: boolean
  lockReason: string | null
  /** git still lists it, but its folder is gone: `git worktree prune` clears it. */
  isMissing: boolean
  /** HEAD's commit; null for a missing folder or an unborn branch. */
  lastCommitAt: number | null
  /** The newest change to a file with uncommitted changes. */
  lastEditAt: number | null
  /** The newest write to a transcript of a Claude Code session started here. */
  lastSessionAt: number | null
  /** Files with uncommitted changes, untracked ones included. */
  dirty: number
  /** Commits on HEAD the base branch doesn't have. */
  ahead: number
  /** Commits on HEAD its upstream doesn't have; null with no upstream. */
  unpushed: number | null
  /** It has an upstream and the remote branch is gone: merged and deleted, usually. */
  isUpstreamGone: boolean
  /** Claude Code processes running in it now; null when that can't be told. */
  liveSessions: number | null
  /** This session runs in it. */
  isThisSession: boolean
}

export type Scan = {
  status: 'idle' | 'running' | 'failed'
  error: string | null
  /** The main worktree's folder. */
  root: string | null
  /** What `ahead` counts against, such as origin/main; null when there's none. */
  base: string | null
  worktrees: Worktree[]
}

/** Each folder's size on disk in KiB, by path; null when du couldn't read it. */
export type Sizes = Record<string, number | null>

export type Sort = 'stale' | 'size'

declare module 'claude-code' {
  interface PluginState {
    worktrees: {
      scan: Shaped<Scan>
      sizes: Shaped<Sizes>
      /** Folders du is reading now. */
      measuring: string[]
      /** The worktree whose Remove is waiting to be confirmed. */
      confirm: string | null
      /** The worktree being removed. */
      busy: string | null
      /** The worktree whose details the pane shows. */
      open: string | null
      sort: Sort
    }
  }
}
