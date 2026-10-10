import { describe, expect, test } from 'claude-code/testing'

import { boot, SURFACES } from './helpers'

for (const surface of SURFACES) {
  describe(surface, () => {
    test('registers /standup and /worklog, and reads nothing until asked', async ($, on) => {
      const { seen } = await boot($, on, surface)
      expect(seen.commands).toEqual(['standup', 'worklog'])
      expect(seen.argv).toEqual([])
    })

    test('/standup reads the last eight days and today with the default settings', async ($, on) => {
      const { run, seen } = await boot($, on, surface)
      const reply = await run('standup')
      expect(seen.argv.length).toBe(1)
      const argv = (seen.argv[0] ?? []).join(' ')
      expect(argv).toMatch(/^\/usr\/bin\/env python3 \S+\/hooks\/scan\.py /)
      expect(argv).toContain('--projects /home/me/.claude/projects')
      expect(argv).toContain('--cache /home/me/.cache/claude-worklog/scan.json')
      expect(argv).toContain('--from=-8 --to=0')
      expect(argv).toContain('--idle-gap 15 --lead-in 5 --max-unattended 30 --day-start 04:00')
      expect(argv).not.toContain('--exclude')
      expect(argv).not.toContain('--include-non-repo')
      expect(argv).not.toContain('--no-asks')
      expect(reply.text).toMatch(/^Standup since Fri 9 Oct\n\nFri 9 Oct · 5h 18m\n/)
      expect(reply.text).toContain('Today so far (Mon 12 Oct) · 45m')
      expect(reply.text).toMatch(/\/standup full adds what you asked, committed and changed; \/standup copy copies it; \/worklog shows any day\.$/)
    })

    test(
      'settings reach the scan',
      { options: { idleGapMin: 20, maxUnattendedMin: 10, dayStartsAt: '05:30', excludeProjects: '/work/client', includeNonRepo: true, includePrompts: false } },
      async ($, on) => {
        const { run, seen } = await boot($, on, surface)
        await run('standup')
        const argv = (seen.argv[0] ?? []).join(' ')
        expect(argv).toContain('--idle-gap 20 --lead-in 5 --max-unattended 10 --day-start 05:30')
        expect(argv).toContain('--exclude /work/client')
        expect(argv).toContain('--include-non-repo')
        expect(argv).toContain('--no-asks')
      },
    )

    test('/standup with a date shows that day alone', async ($, on) => {
      const { run, seen } = await boot($, on, surface)
      const reply = await run('standup', '2026-10-09')
      expect((seen.argv[0] ?? []).join(' ')).toContain('--from=2026-10-09 --to=2026-10-09')
      expect(reply.text).toMatch(/^Fri 9 Oct · 5h 18m\n/)
    })

    test('/standup today and yesterday count from the scan\'s today', async ($, on) => {
      const { run, seen } = await boot($, on, surface)
      expect((await run('standup', 'today')).text).toMatch(/^Today so far \(Mon 12 Oct\) · 45m/)
      expect((seen.argv[0] ?? []).join(' ')).toContain('--from=0 --to=0')
      expect((await run('standup', 'yesterday')).text).toMatch(/^Sun 11 Oct · nothing in your logs/)
    })

    test('/standup copy puts the standup on the clipboard, without the footer', async ($, on) => {
      const { run, seen } = await boot($, on, surface)
      const reply = await run('standup', 'copy')
      expect(seen.copies.length).toBe(1)
      expect(seen.copies[0]).toMatch(/^Standup since Fri 9 Oct\n/)
      expect(seen.copies[0]).not.toContain('/standup copy')
      expect(reply.text).toMatch(/^Copied to your clipboard:\n\nStandup since Fri 9 Oct/)
    })

    test('anything else explains the command', async ($, on) => {
      const { run, seen } = await boot($, on, surface)
      for (const args of ['help', 'last month', '2026-10-09 2026-10-10', 'week 2026-10-09']) {
        expect((await run('standup', args)).text).toMatch(/^worklog reads your Claude Code sessions and git on this machine/)
      }
      expect((await run('worklog', 'whenever')).text).toMatch(/^worklog reads your Claude Code sessions and git/)
      expect(seen.argv).toEqual([])
    })

    test('a scan that fails says why', async ($, on) => {
      const { run } = await boot($, on, surface, { scanError: '/usr/bin/env: python3: No such file or directory' })
      expect((await run('standup')).text).toBe('worklog needs python3, and it was not found.')
    })

    test('/worklog where panes are not drawn answers with the day as text', async ($, on) => {
      const { run, seen } = await boot($, on, surface, { placed: false })
      const reply = await run('worklog')
      expect(seen.opened).toBe(1)
      expect(reply.text).toMatch(/^Today so far \(Mon 12 Oct\) · 45m\n- qol-mods · 45m\n/)
    })

    test('/worklog in a bare claude -p answers with the day as text', async ($, on) => {
      const { run } = await boot($, on, surface, { headless: true })
      expect((await run('worklog', '2026-10-09')).text).toMatch(/^Fri 9 Oct · 5h 18m\n- qol-mods · 4h 16m\n/)
    })
  })
}
