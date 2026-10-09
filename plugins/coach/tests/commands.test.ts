import { describe, expect, test } from 'claude-code/testing'

import { boot, SURFACES } from './helpers'

for (const surface of SURFACES) {
  describe(surface, () => {
    test('registers /coach and the report tool at the start', async ($, on) => {
      const { seen } = await boot($, on, surface)
      expect(seen.commands).toEqual(['coach'])
      expect(seen.tools).toEqual(['report'])
    })

    test('scan.py runs with the settings', { options: { contextThresholdK: 250, storeExcerpts: false, weekStartsOn: 'sunday' } }, async ($, on) => {
      const { seen } = await boot($, on, surface)
      const argv = (seen.argv[0] ?? []).join(' ')
      expect(argv).toMatch(/^\/usr\/bin\/env python3 \S+\/hooks\/scan\.py /)
      expect(argv).toContain('--projects /home/me/.claude/projects')
      expect(argv).toContain('--data /home/me/.claude/coach')
      expect(argv).toContain('--threshold-k 250')
      expect(argv).toContain('--excerpts off')
      expect(argv).toContain('--week-start sunday')
      expect(argv).toContain('--progress')
      expect(argv).not.toContain('--full')
    })

    test('excluded projects reach the scan', { options: { excludeProjects: '/work/client-a,/work/client-b' } }, async ($, on) => {
      const { seen } = await boot($, on, surface)
      expect((seen.argv[0] ?? []).join(' ')).toContain('--exclude /work/client-a,/work/client-b')
    })

    test('help, and anything it doesn\'t know, explains the command', async ($, on) => {
      const { command } = await boot($, on, surface)
      for (const arg of ['help', 'whatever']) {
        expect((await command(arg)).text).toMatch(/^coach reads your Claude Code sessions on this machine/)
      }
    })

    test('/coach rescan reads everything again', async ($, on) => {
      const { command, seen } = await boot($, on, surface)
      expect((await command('rescan')).text).toBe('Rescanning your sessions.')
      expect(seen.argv.length).toBe(2)
      expect(seen.argv[1]).toContain('--full')
    })

    test('/coach hints turns live hints on and off, and remembers', async ($, on) => {
      const { command, seen } = await boot($, on, surface)
      expect((await command('hints')).text).toBe('Live hints on.')
      expect((seen.store.get('hints') as { enabled?: boolean }).enabled).toBe(true)
      expect((await command('hints')).text).toBe('Live hints off.')
    })

    test('the first report is announced once', async ($, on) => {
      const { seen } = await boot($, on, surface)
      expect(seen.toasts.filter(t => t.startsWith('Coach: your first report is ready')).length).toBe(1)
      expect(seen.store.get('firstToast')).toBe(true)
    })

    test('a report already opened is not announced again', async ($, on) => {
      const { seen } = await boot($, on, surface, { store: { firstReportWeek: '2026-09-21' } })
      expect(seen.toasts.some(t => t.startsWith('Coach: your first report'))).toBe(false)
    })

    test('a /clear rescans, so the fresh start counts', async ($, on) => {
      const { seen, clock } = await boot($, on, surface)
      await $.session.end({ reason: 'clear', sessionId: 'live-session', resume: { id: 'live-session' } })
      await clock.settle()
      expect(seen.argv.length).toBe(2)
    })

    test('the report tool answers with the week and what the numbers mean', async ($, on) => {
      await boot($, on, surface)
      const answer = await $.tool.call({ tool: 'mcp__coach__report', tool_use_id: 't1', part: 'summary' } as never)
      const result = (answer as { result: { definitions: string; data: { week: string; volume: { prompts: number } } } }).result
      expect(result.definitions).toMatch(/estimated at API list prices/)
      expect(result.data.week).toBe('2026-09-28')
      expect(result.data.volume.prompts).toBe(18)
    })

    test('the report tool hands out the CLAUDE.md suggestions', async ($, on) => {
      await boot($, on, surface)
      const answer = await $.tool.call({ tool: 'mcp__coach__report', tool_use_id: 't2', part: 'claude-md' } as never)
      const cards = (answer as { result: { data: { project: string }[] } }).result.data
      expect(cards.map(c => c.project).sort()).toEqual(['All projects', 'my-app'])
    })
  })
}
