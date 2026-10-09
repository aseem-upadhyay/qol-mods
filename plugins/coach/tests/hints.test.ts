import { describe, expect, test } from 'claude-code/testing'

import * as H from '../hooks/hints'
import { EMPTY_CHOICES } from '../hooks/select'
import { REPORT } from './fixtures/report'
import { boot, NOW, SURFACES } from './helpers'

const MINUTE = 60 * 1000
const NOTES = 'Write release notes for v1.4.0 from the merged PRs, grouped by area, with a one-line summary at the top'

test('limits: one every 30 minutes, three a day, each kind once a day, none turned off', () => {
  const c = EMPTY_CHOICES
  expect(H.allowed(c, 'repeat-prompt', NOW, false)).toBe(false)
  expect(H.allowed(c, 'repeat-prompt', NOW, true)).toBe(true)
  const once = H.markShown(c, 'repeat-prompt', NOW)
  expect(H.allowed(once, 'vague-first', NOW + 10 * MINUTE, true)).toBe(false)
  expect(H.allowed(once, 'vague-first', NOW + 31 * MINUTE, true)).toBe(true)
  expect(H.allowed(once, 'repeat-prompt', NOW + 31 * MINUTE, true)).toBe(false)
  const thrice = H.markShown(H.markShown(once, 'vague-first', NOW + 31 * MINUTE), 'topic-switch', NOW + 62 * MINUTE)
  expect(H.allowed(thrice, 'skill-exists', NOW + 100 * MINUTE, true)).toBe(false)
  const off = { ...c, hints: { ...c.hints, off: ['vague-first'] } }
  expect(H.allowed(off, 'vague-first', NOW, true)).toBe(false)
})

test('which hint a prompt calls for', () => {
  const fresh = { prompts: [], lastAt: null }
  expect(H.hintFor(NOTES, REPORT, fresh, 0, 300, NOW)?.kind).toBe('repeat-prompt')
  expect(H.hintFor('fix it', REPORT, fresh, 0, 300, NOW)?.kind).toBe('vague-first')
  expect(H.hintFor('add a loading prop to src/Button.tsx', REPORT, fresh, 0, 300, NOW)).toBeNull()
  const busy = { prompts: ['refactor the auth middleware'], lastAt: NOW - 50 * MINUTE }
  expect(H.hintFor('write a migration for the orders index', REPORT, busy, 400_000, 300, NOW)?.kind).toBe('topic-switch')
  expect(H.hintFor('also add a test for it', REPORT, busy, 400_000, 300, NOW)).toBeNull()
  expect(H.hintFor('write a migration for the orders index', REPORT, busy, 100_000, 300, NOW)).toBeNull()
})

test('a resumed big session, idle past its cache, says what resuming costs', () => {
  const report = { ...REPORT, live: { ...REPORT.live, sessions: { s1: [NOW - 2 * 60 * MINUTE, 400_000] as [number, number] } } }
  expect(H.resumeHint(report, 's1', NOW)?.text).toBe(
    'Resuming a 400k-token session re-sends it at full price, about $2.00. A short handoff to a new session is cheaper.',
  )
  expect(H.resumeHint(report, 's1', NOW - 90 * MINUTE)).toBeNull()
  expect(H.resumeHint(report, 'other', NOW)).toBeNull()
})

for (const surface of SURFACES) {
  describe(surface, () => {
    test('a prompt typed many times is pointed at /coach skills', { options: { liveHints: true } }, async ($, on) => {
      const { submit, seen } = await boot($, on, surface)
      await submit(NOTES)
      expect(seen.toasts).toContain("You've typed this 5 times. It could be a skill: see /coach skills.")
    })

    test('hints keep their distance', { options: { liveHints: true } }, async ($, on) => {
      const { submit, seen, clock } = await boot($, on, surface)
      await submit(NOTES)
      await clock.advance(5 * MINUTE)
      await submit('fix it')
      expect(seen.toasts.filter(t => t.startsWith('Tip:') || t.startsWith("You've typed")).length).toBe(1)
    })

    test('off by default', async ($, on) => {
      const { submit, seen } = await boot($, on, surface)
      await submit(NOTES)
      expect(seen.toasts.some(t => t.startsWith("You've typed"))).toBe(false)
    })
  })
}
