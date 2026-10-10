/**
 * What a branch is called and what its work was, in a line each: shared by
 * the standup's words and the timesheet.
 */
import type { Group } from '../types'

/** "#12 fix-login" for a branch with a PR, the branch alone without. */
export function groupLabel(g: Group): string {
  const branch = g.branch || 'no branch'
  return g.pr ? `#${g.pr.number} ${branch}` : branch
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
