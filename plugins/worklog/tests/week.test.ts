import { describe, expect, test } from 'claude-code/testing'

import { boot, SURFACES } from './helpers'

for (const surface of SURFACES) {
  const rich = surface !== 'terminal'
  describe(surface, () => {
    test('/standup last week reads that week and answers with its timesheet', async ($, on) => {
      const { run, output, seen } = await boot($, on, surface)
      const reply = await run('standup', 'last week')
      expect((seen.argv.at(-1) ?? []).join(' ')).toContain('--from=2026-10-05 --to=2026-10-11')
      expect(reply.text).toMatch(/^Week of Mon 5 Oct · 5h 15m\n/)
      expect(reply.text).toContain('Rounded to 15 minutes; each day still adds up.')
      const ui = await output(reply.text ?? '')
      if (rich) expect(await ui.find({ text: /^\| Repo \| Branch \| Mon 5 \|/ })).toBeDefined()
      else expect(await ui.find({ text: 'Fri 9' })).toBeDefined()
      expect(await ui.find({ text: /Week of Mon 5 Oct/ })).toBeDefined()
    })

    test('/standup week is this week so far', async ($, on) => {
      const { run, seen } = await boot($, on, surface)
      const reply = await run('standup', 'week')
      expect((seen.argv.at(-1) ?? []).join(' ')).toContain('--from=2026-10-12 --to=2026-10-12')
      expect(reply.text).toMatch(/^Week of Mon 12 Oct · 45m\n/)
    })

    test('/worklog week opens the timesheet; weeks move, copy and save as CSV', async ($, on) => {
      const { run, pane, seen } = await boot($, on, surface)
      expect((await run('worklog', 'week')).text).toBe('Opened your timesheet.')
      const ui = await pane(110)
      expect((await ui.find({ key: 'tab-week' }))?.props.variant).toBe('primary')
      expect(await ui.find({ text: /Week of Mon 12 Oct/ })).toBeDefined()
      expect(await ui.find({ key: 'next-week' })).toBeUndefined()
      await ui.press({ key: 'prev-week' })
      expect(await ui.find({ text: /Week of Mon 5 Oct/ })).toBeDefined()
      await ui.press({ key: 'copy-csv' })
      expect(seen.copies[0]).toMatch(/^date,repo,pr,branch,title,hours,raw_hours,first,last\n2026-10-09,me\/qol-mods,2,coach,A weekly coach,2\.00,2\.00,13:53,16:47\n/)
      await ui.press({ key: 'save-csv' })
      expect(seen.writes.map(w => w.path)).toEqual(['/home/me/Documents/worklog/week-of-2026-10-05.csv'])
      expect(seen.toasts.at(-1)).toBe('Saved ~/Documents/worklog/week-of-2026-10-05.csv')
      await ui.press({ key: 'copy-week' })
      expect(seen.copies[1]).toMatch(/^\| Repo \| Branch \|/)
      await ui.press({ key: 'this-week' })
      expect(await ui.find({ text: /Week of Mon 12 Oct/ })).toBeDefined()
      await ui.press({ key: 'tab-day' })
      expect(await ui.find({ text: 'Today, Monday 12 October 2026' })).toBeDefined()
    })

    test('the CSV folder setting, with ~', { options: { csvFolder: '~/timesheets/' } }, async ($, on) => {
      const { run, pane, seen } = await boot($, on, surface)
      await run('worklog', 'last week')
      const ui = await pane(110)
      await ui.press({ key: 'save-csv' })
      expect(seen.writes.map(w => w.path)).toEqual(['/home/me/timesheets/week-of-2026-10-05.csv'])
    })

    test('the standup lists the PRs reviewed and the open ones', async ($, on) => {
      const { run, output } = await boot($, on, surface)
      const reply = await run('standup')
      expect(reply.text).toContain('- Reviewed: api #3 Their fix')
      expect(reply.text).toContain('Open PRs\n- qol-mods #9 Add worklog')
      const ui = await output(reply.text ?? '')
      expect(await ui.find({ text: 'Reviewed' })).toBeDefined()
      expect(await ui.find({ text: /^api #3 Their fix/ })).toBeDefined()
      expect(await ui.find({ text: 'Open PRs' })).toBeDefined()
    })

    test(
      'GitHub, the archive and extra folders reach the scan',
      { options: { useGitHub: false, extraRoots: '~/code', roundTo: 30 } },
      async ($, on) => {
        const { run, seen } = await boot($, on, surface)
        const reply = await run('standup', 'last week')
        const argv = (seen.argv[0] ?? []).join(' ')
        expect(argv).toContain('--archive /home/me/.local/share/claude-worklog/days')
        expect(argv).toContain('--github off')
        expect(argv).toContain('--extra-roots ~/code')
        expect(reply.text).toContain('Rounded to 30 minutes')
      },
    )
  })
}
