import { describe, expect, test } from 'claude-code/testing'

import { REPORT } from './fixtures/report'
import { boot, SURFACES } from './helpers'

const SKILL = REPORT.suggestions.skills[0]
const MD = REPORT.suggestions.claudeMd.find(c => c.project === 'my-app')

for (const surface of SURFACES) {
  describe(surface, () => {
    test('/coach opens the report on the last full week', async ($, on) => {
      const { pane, command, seen } = await boot($, on, surface)
      const reply = await command('')
      expect(reply.text).toBe('Opened the coach report.')
      expect(seen.opened).toBe(1)
      const ui = await pane()
      expect(await ui.find({ text: 'Your week with Claude' })).toBeDefined()
      expect(await ui.find({ text: /28 Sep to 4 Oct · week 1/ })).toBeDefined()
      for (const title of ['Habit of the week', 'Your best prompt this week', 'Could be a skill', 'Level up', 'Also noticed']) {
        expect(await ui.find({ text: title })).toBeDefined()
      }
      expect(await ui.find({ text: /Teach Claude this project · my-app/ })).toBeDefined()
      expect(await ui.find({ text: 'Nothing in this report left your computer.' })).toBeDefined()
    })

    test('the habit of the week comes with its evidence and what to try', async ($, on) => {
      const { pane, command } = await boot($, on, surface)
      await command('')
      const ui = await pane()
      expect(await ui.find({ text: 'Start fresh when you switch topics' })).toBeDefined()
      expect(await ui.find({ text: /about 330k tokens of the earlier topic/ })).toBeDefined()
      expect(await ui.find({ text: /^Try this: Type \/clear/ })).toBeDefined()
    })

    test('"See the session" opens the evidence, with a resume command to copy', async ($, on) => {
      const { pane, command, seen } = await boot($, on, surface)
      await command('')
      const ui = await pane()
      await ui.press({ key: 'habit-session' })
      expect(await ui.find({ text: /claude --resume w2-switch/ })).toBeDefined()
      await ui.press({ key: 'copy-resume' })
      expect(seen.copies).toEqual(['cd /work/my-app && claude --resume w2-switch'])
      await ui.press({ key: 'back' })
      expect(await ui.find({ text: 'Habit of the week' })).toBeDefined()
    })

    test('the glossary explains a word in place', async ($, on) => {
      const { pane, command } = await boot($, on, surface)
      await command('')
      const ui = await pane()
      await ui.press({ key: 'habit-glossary' })
      expect(await ui.find({ text: 'What is context?' })).toBeDefined()
      expect(await ui.find({ text: /everything Claude reads before it answers/ })).toBeDefined()
    })

    test('"Pick another habit" swaps it for the next one, and remembers', async ($, on) => {
      const { pane, command, seen } = await boot($, on, surface)
      await command('')
      const ui = await pane()
      await ui.press({ key: 'habit-other' })
      expect(await ui.find({ text: 'Start fresh when you switch topics' })).toBeUndefined()
      expect(await ui.find({ text: 'Point Claude at the right place' })).toBeDefined()
      const log = seen.store.get('habitLog') as { habit: string; status: string }[]
      expect(log.map(l => `${l.habit}:${l.status}`)).toEqual(['fresh-start:skipped', 'point-to-place:active'])
    })

    test('"Not right?" hides the evidence it flags', async ($, on) => {
      const { pane, command, seen } = await boot($, on, surface)
      await command('')
      const ui = await pane()
      await ui.press({ key: 'habit-not-right' })
      expect(await ui.find({ text: /330k tokens/ })).toBeUndefined()
      expect(await ui.find({ key: 'habit-session' })).toBeUndefined()
      const flags = seen.store.get('notRight') as { detector: string }[]
      expect(flags.map(f => f.detector)).toEqual(['fresh-start'])
    })

    test('a dismissed tip stays dismissed', async ($, on) => {
      const { pane, command, seen } = await boot($, on, surface)
      await command('')
      const ui = await pane()
      expect(await ui.find({ text: 'Switch to claude-opus-5-5' })).toBeDefined()
      await ui.press({ key: 'tip-dismiss:newer-model' })
      expect(await ui.find({ text: 'Switch to claude-opus-5-5' })).toBeUndefined()
      const tips = seen.store.get('tips') as Record<string, { dismissedAt?: number }>
      expect(tips['newer-model']?.dismissedAt).toBeDefined()
    })

    test('the bypass notice stands in for the matching tip', async ($, on) => {
      const { pane, command } = await boot($, on, surface)
      await command('')
      const ui = await pane()
      expect(await ui.find({ text: /permission checks turned off/ })).toBeDefined()
      expect(await ui.find({ text: 'Keep the safety checks on' })).toBeUndefined()
    })

    test('CLAUDE.md lines are suggestions: Copy, never a write', async ($, on) => {
      const { pane, command, seen } = await boot($, on, surface)
      await command('')
      const ui = await pane()
      expect(MD).toBeDefined()
      await ui.press({ key: `md-copy:${MD?.id}` })
      expect(seen.copies[0]).toBe('- Test: `pnpm test` (one file: `pnpm test <path>`)\n- Use `pnpm`, not `npm`.')
      expect(await ui.find({ text: /Claude tried `npm` first/ })).toBeDefined()
      expect(await ui.find({ text: /how to run the tests/ })).toBeDefined()
      expect(await ui.find({ text: /`src\/app\/routes.ts` at the start of most sessions/ })).toBeDefined()
      expect(seen.fills).toEqual([])
    })

    test('"Make it a skill" puts the request in the prompt box, and nothing else', async ($, on) => {
      const { pane, command, seen } = await boot($, on, surface)
      await command('')
      const ui = await pane()
      await ui.press({ key: `skill-make:${SKILL?.id}` })
      expect(seen.fills.length).toBe(1)
      const fill = seen.fills[0]
      expect(fill?.mode).toBe('replace')
      expect(fill?.text).toMatch(/^Turn this prompt, which I keep typing, into a skill I can run as \/release-notes <…>/)
      expect(fill?.text).toMatch(/saved in \/work\/my-app\/\.claude\/skills\/release-notes\//)
      expect(fill?.text).toMatch(/also link each pr/)
      expect(fill?.text).toMatch(/Write release notes for <version> from the merged prs/)
      expect(seen.toasts).toContain('The request is in the prompt box. Read it, and send it if you want the skill.')
    })

    test('"Ask Claude about this week" adds to a draft instead of replacing it', async ($, on) => {
      const { pane, command, seen } = await boot($, on, surface, { draft: 'half a thought' })
      await command('')
      const ui = await pane()
      await ui.press({ key: 'ask' })
      expect(seen.fills[0]?.mode).toBe('append')
      expect(seen.fills[0]?.text).toMatch(/^\n\nLook at my coach report for the week of 28 Sep \(the mcp__coach__report tool\)/)
    })

    test('the weeks page back and forth, and to this week so far', async ($, on) => {
      const { pane, command } = await boot($, on, surface)
      await command('')
      const ui = await pane()
      await ui.press({ key: 'prev' })
      expect(await ui.find({ text: /21 to 27 Sep/ })).toBeDefined()
      await ui.press({ key: 'next' })
      expect(await ui.find({ text: /28 Sep to 4 Oct/ })).toBeDefined()
      await ui.press({ key: 'this-week' })
      expect(await ui.find({ text: 'Your week so far' })).toBeDefined()
    })

    test('the see-all pages list everything, and lead back', async ($, on) => {
      const { pane, command } = await boot($, on, surface)
      const reply = await command('claude-md')
      expect(reply.text).toBe('Opened CLAUDE.md suggestions.')
      const ui = await pane()
      expect(await ui.find({ text: 'CLAUDE.md suggestions' })).toBeDefined()
      expect(await ui.find({ text: /coach never changes your CLAUDE.md/ })).toBeDefined()
      expect(await ui.find({ text: 'Teach Claude, in every project' })).toBeDefined()
      await ui.press({ key: 'back' })
      expect(await ui.find({ text: 'Habit of the week' })).toBeDefined()
      await command('skills')
      expect(await ui.find({ text: 'Skills worth making' })).toBeDefined()
      await command('tips')
      expect(await ui.find({ text: 'Tips for you' })).toBeDefined()
    })

    test('a narrow pane lays the headline out as lines', async ($, on) => {
      const { pane, command } = await boot($, on, surface)
      await command('')
      const ui = await pane(50)
      expect(await ui.find({ text: 'Sessions:' })).toBeDefined()
    })

    test('before the first scan lands, it says it is reading', async ($, on) => {
      const { pane, command } = await boot($, on, surface, { report: null })
      await command('')
      const ui = await pane()
      expect(await ui.find({ text: /^Reading your sessions…/ })).toBeDefined()
    })

    test('without python3, it says how to get it', async ($, on) => {
      const { pane, command } = await boot($, on, surface, { scanError: 'env: python3: No such file or directory' })
      await command('')
      const ui = await pane()
      expect(await ui.find({ text: /coach needs python3/ })).toBeDefined()
      expect(await ui.find({ key: 'rescan' })).toBeDefined()
    })

    test('where no pane can be placed, /coach answers in words', async ($, on) => {
      const { command } = await boot($, on, surface, { placed: false })
      const reply = await command('')
      expect(reply.text).toMatch(/^Your week with Claude \(28 Sep to 4 Oct\): 10 sessions, 18 prompts/)
      expect(reply.text).toMatch(/Habit of the week: Start fresh when you switch topics/)
    })
  })
}
