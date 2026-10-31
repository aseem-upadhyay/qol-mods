import { describe, expect, test } from 'claude-code/testing'

import { boot, GONE, HERE, HOTFIX, OLD, ROOT, SURFACES } from './helpers'

for (const surface of SURFACES) {
  describe(surface, () => {
    test('registers /worktree and reads nothing until asked', async ($, on) => {
      const { seen } = await boot($, on, surface)
      expect(seen.commands).toEqual(['worktree'])
      expect(seen.argv).toEqual([])
    })

    test('/worktree lists every worktree with its staleness, size and sessions', async ($, on) => {
      const { run, pane, seen } = await boot($, on, surface)
      expect((await run()).text).toBe('Opened the worktrees pane.')
      expect(seen.opened).toBe(1)
      const ui = await pane(60)
      expect(await ui.find({ text: 'app' })).toBeDefined()
      // The main worktree's 900 MB less the three nested in it that du counted again.
      expect(await ui.find({ text: '3.0 GB' })).toBeDefined()
      expect(await ui.find({ text: '5 worktrees · 1 stale · 391 MB to reclaim' })).toBeDefined()
      // The disk bar: 48 cells, the hotfix's 2.1 GB the largest share.
      expect(await ui.find({ text: '█'.repeat(48) })).toBeDefined()
      expect(await ui.find({ text: '█'.repeat(34) })).toBeDefined()

      expect((await ui.find({ key: `row:${ROOT}` }))?.text).toBe('● main')
      expect(await ui.find({ text: '⌂ main worktree' })).toBeDefined()
      expect((await ui.find({ key: `row:${OLD}` }))?.text).toBe('● feature/old')
      expect(await ui.find({ text: 'stale · 5w ago' })).toBeDefined()
      expect(await ui.find({ text: '391 MB' })).toBeDefined()
      expect(await ui.find({ text: '◉ you’re here +1' })).toBeDefined()
      expect(await ui.find({ text: 'active · 1h ago · 2 changes · 3 ahead' })).toBeDefined()
      // The last Claude session there (9 days) is newer than its last commit (20 days) and edits (12).
      expect(await ui.find({ text: '◉ in use' })).toBeDefined()
      expect(await ui.find({ text: 'idle · 9d ago · 3 changes · 1 ahead' })).toBeDefined()
      expect(await ui.find({ text: '2.1 GB' })).toBeDefined()
      expect(await ui.find({ text: 'folder missing' })).toBeDefined()
      expect(await ui.find({ key: 'prune' })).toBeDefined()
      // Details stay folded until asked for.
      expect(await ui.find({ text: '~/hotfix' })).toBeUndefined()
    })

    test('pressing a name shows its details, and pressing again hides them', async ($, on) => {
      const { run, pane } = await boot($, on, surface)
      await run()
      const ui = await pane()
      await ui.press({ key: `row:${HOTFIX}` })
      expect(await ui.find({ text: '~/hotfix' })).toBeDefined()
      expect(await ui.find({ text: 'commit 2w ago · edit 12d ago · Claude 9d ago' })).toBeDefined()
      expect(await ui.find({ text: '3 uncommitted changes · 1 commit not in origin/main' })).toBeDefined()
      await ui.press({ key: `row:${HERE}` })
      expect(await ui.find({ text: '~/hotfix' })).toBeUndefined()
      expect(await ui.find({ text: /This session runs here/ })).toBeDefined()
      await ui.press({ key: `row:${HERE}` })
      expect(await ui.find({ text: /This session runs here/ })).toBeUndefined()
    })

    test('the main worktree, this session’s and a missing one offer no Remove', async ($, on) => {
      const { run, pane } = await boot($, on, surface)
      await run()
      const ui = await pane()
      for (const path of [ROOT, HERE, GONE]) expect(await ui.find({ key: `remove:${path}` })).toBeUndefined()
      expect(await ui.find({ key: `remove:${OLD}` })).toBeDefined()
      expect(await ui.find({ key: `remove:${HOTFIX}` })).toBeDefined()
    })

    test('Remove asks first, and Cancel removes nothing', async ($, on) => {
      const { run, pane, changes } = await boot($, on, surface)
      await run()
      const ui = await pane()
      await ui.press({ key: `remove:${OLD}` })
      expect(await ui.find({ text: 'Remove feature/old?' })).toBeDefined()
      expect(await ui.find({ text: 'Deletes the folder · frees 391 MB · the branch stays' })).toBeDefined()
      expect(await ui.find({ text: /will be lost/ })).toBeUndefined()
      expect(await ui.find({ key: `remove:${OLD}` })).toBeUndefined()
      await ui.press({ key: `cancel:${OLD}` })
      expect(await ui.find({ key: `confirm:${OLD}` })).toBeUndefined()
      expect(changes()).toEqual([])
    })

    test('confirming removes a clean worktree with git, keeping its branch', async ($, on) => {
      const { run, pane, changes, seen } = await boot($, on, surface)
      await run()
      const ui = await pane()
      await ui.press({ key: `remove:${OLD}` })
      await ui.press({ key: `confirm:${OLD}` })
      expect(changes()).toEqual([['git', '-C', ROOT, 'worktree', 'remove', OLD]])
      expect(seen.toasts).toEqual(['Removed feature/old, freeing about 391 MB. The branch feature/old is kept.'])
    })

    test('a worktree with changes and a live session warns, and removes with --force', async ($, on) => {
      const { run, pane, changes } = await boot($, on, surface)
      await run()
      const ui = await pane()
      await ui.press({ key: `remove:${HOTFIX}` })
      expect(await ui.find({ text: '⚠ 3 uncommitted changes will be lost' })).toBeDefined()
      expect(await ui.find({ text: '⚠ a Claude session is working in it' })).toBeDefined()
      expect((await ui.find({ key: `confirm:${HOTFIX}` }))?.text).toBe('Discard & remove')
      await ui.press({ key: `confirm:${HOTFIX}` })
      expect(changes()).toEqual([['git', '-C', ROOT, 'worktree', 'remove', '--force', HOTFIX]])
    })

    test('a refusal from git is shown, not swallowed', async ($, on) => {
      const { run, pane, seen } = await boot($, on, surface, { removeFails: "'/x' contains modified or untracked files, use --force to delete it" })
      await run()
      const ui = await pane()
      await ui.press({ key: `remove:${OLD}` })
      await ui.press({ key: `confirm:${OLD}` })
      expect(seen.toasts).toEqual(["Couldn’t remove feature/old: '/x' contains modified or untracked files, use --force to delete it"])
    })

    test('Prune runs git worktree prune', async ($, on) => {
      const { run, pane, changes } = await boot($, on, surface)
      await run()
      const ui = await pane()
      await ui.press({ key: 'prune' })
      expect(changes()).toEqual([['git', '-C', ROOT, 'worktree', 'prune']])
    })

    test('without lsof, sessions go unmentioned', async ($, on) => {
      const { run, pane } = await boot($, on, surface, { noLsof: true })
      await run()
      const ui = await pane()
      expect(await ui.find({ text: '◉ in use' })).toBeUndefined()
      expect(await ui.find({ text: '◉ you’re here' })).toBeDefined()
    })
  })
}

test('where no pane is placed, /worktree answers as text', async ($, on) => {
  const { run } = await boot($, on, 'desktop', { placed: false })
  const { text } = await run()
  expect(text).toMatch(/^5 worktrees of \/home\/me\/app:\n/)
  expect(text).toContain('- feature/old: Stale, 5w ago · 391 MB · clean, nothing beyond origin/main, remote branch deleted')
  expect(text).toContain('- claude/here: Active, 1h ago · 98 MB · 2 uncommitted changes, 3 commits not in origin/main, 1 not pushed · this session')
})
