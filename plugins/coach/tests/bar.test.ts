import { describe, expect, test } from 'claude-code/testing'

import type { Report } from '../types'
import { REPORT } from './fixtures/report'
import { boot, SURFACES } from './helpers'

const MINUTE = 60 * 1000

/** The fixture, with this week's progress on starting fresh at 2 of 3. */
function withProgress(): Report {
  const current = REPORT.current
  if (!current) throw new Error('fixture has no current week')
  const fresh = { value: 0.667, sample: 3, target: 0.7, min: 3, eligible: true, impactUsd: 1, evidence: [], done: 2, total: 3 }
  return { ...REPORT, current: { ...current, habits: { ...current.habits, 'fresh-start': fresh } } }
}

for (const surface of SURFACES) {
  describe(surface, () => {
    test('before the first report is opened, the line says it is ready', async ($, on) => {
      const { bar } = await boot($, on, surface)
      const ui = await bar()
      expect(await ui.find({ text: 'Coach: your first report is ready, based on your last 23 days' })).toBeDefined()
      expect(await ui.find({ text: '/coach' })).toBeDefined()
    })

    test('once opened, it keeps the habit in view with this week so far', async ($, on) => {
      const { bar, command } = await boot($, on, surface, { report: withProgress() })
      await command('')
      const ui = await bar()
      expect(await ui.find({ text: '/clear when you switch topics' })).toBeDefined()
      expect(await ui.find({ text: '2 of 3 switches' })).toBeDefined()
      if (surface === 'desktop') expect(await ui.find({ type: 'Svg' })).toBeDefined()
      else expect(await ui.find({ text: '●●' })).toBeDefined()
    })

    test('narrower lines drop detail instead of cutting off', async ($, on) => {
      const { bar, command } = await boot($, on, surface, { report: withProgress() })
      await command('')
      const medium = await bar(60)
      expect(await medium.find({ text: '2 of 3' })).toBeDefined()
      expect(await medium.find({ text: '2 of 3 switches' })).toBeUndefined()
      const tiny = await bar(34)
      expect(await tiny.find({ text: 'Coach: /clear on topic switch' })).toBeDefined()
    })

    test('/coach bar hides the line, for good', async ($, on) => {
      const { bar, command, seen } = await boot($, on, surface)
      expect((await command('bar')).text).toBe('Coach line hidden.')
      const ui = await bar()
      expect(await ui.find({ text: /Coach/ })).toBeUndefined()
      expect(seen.store.get('barHidden')).toBe(true)
      expect((await command('bar')).text).toBe('Coach line shown.')
    })

    test('another mod\'s band stacks beneath it', async ($, on) => {
      const { bar } = await boot($, on, surface, { beneath: 'my-app · $12.30 today' })
      const ui = await bar()
      expect(await ui.find({ text: /your first report is ready/ })).toBeDefined()
      expect(await ui.find({ text: 'my-app · $12.30 today' })).toBeDefined()
    })

    test('with room for one row and another band, it gives way', async ($, on) => {
      const { bar } = await boot($, on, surface, { beneath: 'my-app · $12.30 today' })
      const ui = await bar(120, 1)
      expect(await ui.find({ text: /Coach/ })).toBeUndefined()
      expect(await ui.find({ text: 'my-app · $12.30 today' })).toBeDefined()
    })

    test('a live nudge on a topic change in a big session, which can be turned off', { options: { liveHints: true } }, async ($, on) => {
      const { bar, command, submit, clock, seen } = await boot($, on, surface, { contextTokens: 400_000 })
      await command('')
      await submit('refactor the auth middleware to use the new session store')
      await clock.advance(50 * MINUTE)
      await submit('write a migration for the orders table index')
      const ui = await bar()
      expect(await ui.find({ text: /New topic\? This session is 400k tokens deep/ })).toBeDefined()
      await ui.press({ key: 'nudge-off' })
      expect(await ui.find({ text: /New topic/ })).toBeUndefined()
      const hints = seen.store.get('hints') as { off: string[] }
      expect(hints.off).toEqual(['topic-switch'])
    })

    test('no nudges unless live hints are on', async ($, on) => {
      const { bar, command, submit, clock } = await boot($, on, surface, { contextTokens: 400_000 })
      await command('')
      await submit('refactor the auth middleware to use the new session store')
      await clock.advance(50 * MINUTE)
      await submit('write a migration for the orders table index')
      const ui = await bar()
      expect(await ui.find({ text: /New topic/ })).toBeUndefined()
    })
  })
}
