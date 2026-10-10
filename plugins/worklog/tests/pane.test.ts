import { describe, expect, test } from 'claude-code/testing'

import { boot, SURFACES } from './helpers'

for (const surface of SURFACES) {
  describe(surface, () => {
    test('/worklog opens today, read from the week up to it', async ($, on) => {
      const { run, pane, seen } = await boot($, on, surface)
      expect((await run('worklog')).text).toBe('Opened your worklog.')
      expect(seen.opened).toBe(1)
      expect((seen.argv[0] ?? []).join(' ')).toContain('--from=-6 --to=0')
      const ui = await pane()
      expect(await ui.find({ text: 'Today, Monday 12 October 2026' })).toBeDefined()
      expect(await ui.find({ text: /^45m/ })).toBeDefined()
      expect(await ui.find({ text: /worklog/ })).toBeDefined()
      expect(await ui.find({ text: 'Standup and worklog plugin' })).toBeDefined()
      expect(await ui.find({ key: 'next' })).toBeUndefined()
      expect(await ui.find({ key: 'today' })).toBeUndefined()
    })

    test('moving back a day at a time reaches Friday, with its PR and Claude time alone', async ($, on) => {
      const { run, pane } = await boot($, on, surface)
      await run('worklog')
      const ui = await pane()
      await ui.press({ key: 'prev' })
      expect(await ui.find({ text: 'Sunday 11 October 2026' })).toBeDefined()
      expect(await ui.find({ text: /^Nothing in your logs for this day/ })).toBeDefined()
      expect(await ui.find({ key: 'copy' })).toBeUndefined()
      await ui.press({ key: 'prev' })
      await ui.press({ key: 'prev' })
      expect(await ui.find({ text: 'Friday 9 October 2026' })).toBeDefined()
      expect(await ui.find({ text: /#2 coach/ })).toBeDefined()
      expect(await ui.find({ text: 'A weekly coach' })).toBeDefined()
      expect(await ui.find({ text: /^2h 4m on this branch/ })).toBeUndefined()
      expect(await ui.find({ text: /scratch/ })).toBeUndefined()
      await ui.press({ key: 'today' })
      expect(await ui.find({ text: 'Today, Monday 12 October 2026' })).toBeDefined()
    })

    test("pressing a branch's name opens its details, and Show details opens every branch's", async ($, on) => {
      const { run, pane } = await boot($, on, surface)
      await run('worklog', '2026-10-09')
      const ui = await pane()
      await ui.press({ key: 'group:/work/qol-mods|coach' })
      expect(await ui.find({ text: '2h 4m on this branch · 2h counted, parallel sessions share the rest' })).toBeDefined()
      expect(await ui.find({ text: '“make the report cards in the desktop app”' })).toBeDefined()
      expect(await ui.find({ text: 'plugins/coach/hooks · 6 files' })).toBeDefined()
      expect(await ui.find({ text: 'README previews' })).toBeDefined()
      await ui.press({ key: 'group:/work/qol-mods|coach' })
      expect(await ui.find({ text: /^2h 4m on this branch/ })).toBeUndefined()
      await ui.press({ key: 'details' })
      expect(await ui.find({ text: /^2h 4m on this branch/ })).toBeDefined()
      expect((await ui.find({ key: 'details' }))?.text).toBe('Hide details')
      await ui.press({ key: 'details' })
      expect(await ui.find({ text: /^2h 4m on this branch/ })).toBeUndefined()
    })

    test('/worklog with a date opens that day, and Copy copies it', async ($, on) => {
      const { run, pane, seen } = await boot($, on, surface)
      await run('worklog', '2026-10-09')
      expect((seen.argv[0] ?? []).join(' ')).toContain('--from=2026-10-03 --to=2026-10-09')
      const ui = await pane()
      expect(await ui.find({ text: 'Friday 9 October 2026' })).toBeDefined()
      await ui.press({ key: 'copy' })
      expect(seen.copies[0]).toMatch(/^Fri 9 Oct · 5h 18m\n- qol-mods · 4h 16m\n  - #2 coach · 2h · A weekly coach\n/)
      expect(seen.toasts).toEqual(['Copied the day.'])
    })

    test('/worklog yesterday before any scan finds today first', async ($, on) => {
      const { run, pane, seen } = await boot($, on, surface)
      await run('worklog', 'yesterday')
      expect((seen.argv[0] ?? []).join(' ')).toContain('--from=-7 --to=-1')
      const ui = await pane()
      expect(await ui.find({ text: 'Sunday 11 October 2026' })).toBeDefined()
    })

    test('a failed scan shows in the pane', async ($, on) => {
      const { run, pane } = await boot($, on, surface, { scanError: 'Traceback: boom' })
      await run('worklog')
      const ui = await pane()
      expect(await ui.find({ text: 'Could not read your logs. Run claude --debug to see why.' })).toBeDefined()
    })
  })
}
