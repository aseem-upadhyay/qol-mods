import { describe, expect, test } from 'claude-code/testing'

import { boot, SURFACES } from './helpers'

for (const surface of SURFACES) {
  const rich = surface !== 'terminal'
  describe(surface, () => {
    test("/standup's row is drawn from its data: a title, each day's total and its repos", async ($, on) => {
      const { run, output } = await boot($, on, surface)
      const reply = await run('standup')
      const ui = await output(reply.text ?? '')
      expect(await ui.find({ text: rich ? '## Standup since Fri 9 Oct' : 'Standup since Fri 9 Oct' })).toBeDefined()
      expect(await ui.find({ text: rich ? '### Fri 9 Oct' : 'Fri 9 Oct' })).toBeDefined()
      expect(await ui.find({ text: /^2 repos · 4 branches · 1 PR · 1 review · Claude alone another 14m$/ })).toBeDefined()
      expect(await ui.find({ text: 'qol-mods' })).toBeDefined()
      expect(await ui.find({ text: 'A weekly coach' })).toBeDefined()
      expect(await ui.find({ text: '13:53–16:47 · PR merged · 3 commits · 7 files · 12 test runs · Claude alone 14m' })).toBeDefined()
      expect(await ui.find({ text: 'Also: tidy 6m' })).toBeDefined()
      expect(await ui.find({ text: /^“coach report is not available/ })).toBeUndefined()
      expect((await ui.findAll({ type: 'Svg' })).length > 0).toBe(rich)
    })

    test('/standup full lists what was asked, the commits and the folders under each branch', async ($, on) => {
      const { run, output } = await boot($, on, surface)
      const reply = await run('standup', 'full')
      expect(reply.text).not.toContain('/standup full adds')
      const ui = await output(reply.text ?? '')
      expect(await ui.find({ text: '“coach report is not available in the desktop app”' })).toBeDefined()
      expect(await ui.find({ text: 'coach 0.2.0: the report as cards' })).toBeDefined()
      expect(await ui.find({ text: 'plugins/coach/hooks · 6 files' })).toBeDefined()
      expect(await ui.find({ text: 'Also: tidy 6m' })).toBeUndefined()
      expect(await ui.find({ text: /^2h 4m on this branch/ })).toBeUndefined()
    })

    test('a row that leads with the plugin\'s name is drawn too', async ($, on) => {
      const { run, output } = await boot($, on, surface)
      const reply = await run('standup')
      const ui = await output(`worklog: ${reply.text ?? ''}`)
      expect(await ui.find({ text: /^2 repos · 4 branches/ })).toBeDefined()
    })

    test('a row the plugin has no data for draws as its text', async ($, on) => {
      const { output } = await boot($, on, surface)
      const ui = await output('Standup since Fri 9 Oct\n\nsomething from before a /clear')
      expect(await ui.find({ text: 'Standup since Fri 9 Oct' })).toBeUndefined()
    })

    test('another command\'s row is left alone', async ($, on) => {
      const { run, output } = await boot($, on, surface)
      const reply = await run('standup')
      const other = await $.ui.mount({
        plugin: 'worklog',
        surface,
        component: 'CommandOutput',
        requestId: 'row-2',
        props: { command: 'cost', args: '', text: reply.text ?? '', isErrored: false },
      })
      expect(await other.find({ text: /^2 repos/ })).toBeUndefined()
      void output
    })

    test('the pane draws the day on a timeline', async ($, on) => {
      const { run, pane } = await boot($, on, surface)
      await run('worklog', '2026-10-09')
      const ui = await pane(110)
      if (rich) {
        const alts = (await ui.findAll({ type: 'Svg' })).map(p => String(p.props.alt ?? ''))
        expect(alts).toContain('Time by repo: qol-mods 4h 16m, api 1h 2m')
        expect(alts).toContain('#2 coach: 13:53 to 16:47')
      } else {
        expect(await ui.find({ text: /^09 +10 +11 +12/ })).toBeDefined()
        expect(await ui.find({ text: /█+/ })).toBeDefined()
      }
      expect(await ui.find({ text: '13:53–16:47 · PR merged · 3 commits · 7 files · 12 test runs · Claude alone 14m' })).toBeDefined()
    })

    const timelines = async (ui: Awaited<ReturnType<Awaited<ReturnType<typeof boot>>['pane']>>) => {
      if (rich) return (await ui.findAll({ type: 'Svg' })).filter(p => String(p.props.alt).includes(' to ')).length
      // A row's text is its colored runs joined: count the rows, not the runs.
      return (await ui.findAll({ type: 'Text', text: /^·*[█▄░][█▄░·]*$/ })).filter(t => t.text.length > 20).length
    }

    test('a docked pane puts the timeline under each name', async ($, on) => {
      const { run, pane } = await boot($, on, surface)
      await run('worklog', '2026-10-09')
      expect(await timelines(await pane(48))).toBe(4)
    })

    test('a very narrow pane drops the timeline and keeps the times', async ($, on) => {
      const { run, pane } = await boot($, on, surface)
      await run('worklog', '2026-10-09')
      const ui = await pane(18)
      expect(await timelines(ui)).toBe(0)
      expect(await ui.find({ text: /13:53–16:47/ })).toBeDefined()
    })
  })
}
