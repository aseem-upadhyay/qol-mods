import { describe, expect, test } from 'claude-code/testing'

import * as G from '../hooks/grading'
import type { GradingInput } from '../types'
import { boot, SURFACES } from './helpers'

const INPUT: GradingInput = {
  week: '2026-09-28',
  prompts: [
    { id: 'p1', project: 'my-app', text: 'fix the login thing its broken again', followUps: 3, corrections: 2, next: ['it still fails on refresh', 'the bug is in src/auth/session.ts'] },
    { id: 'p2', project: 'my-app', text: 'In src/Button.tsx add a loading prop. Done when the tests pass.', followUps: 0, corrections: 0, next: [] },
  ],
}
const SCORES = '[{"id": "p1", "goal": 1, "place": 0, "done": 0, "scope": 2, "context": 0}, {"id": "p2", "goal": 2, "place": 2, "done": 2, "scope": 2, "context": 1}]'

test('scores are read strictly: anything malformed is dropped', () => {
  expect(G.parseScores(`Here you go: ${SCORES}`).map(s => s.id)).toEqual(['p1', 'p2'])
  expect(G.parseScores('[{"id": "x", "goal": 3}]')).toEqual([])
  expect(G.parseScores('no json at all')).toEqual([])
})

test('the weakest prompt that needed follow-ups is the one rewritten', () => {
  const scores = G.parseScores(SCORES)
  expect(G.rewriteSource(scores, INPUT)?.id).toBe('p1')
  expect(G.rewritePrompt(INPUT.prompts[0] as GradingInput['prompts'][number])).toBe(
    'Prompt:\nfix the login thing its broken again\n\nFollow-ups:\n- it still fails on refresh\n- the bug is in src/auth/session.ts',
  )
})

test('a week of grading costs cents, and the estimate is checked before anything is sent', () => {
  expect(G.estimate(INPUT, 'haiku')).toBeLessThan(0.01)
  expect(G.estimate(INPUT, 'sonnet')).toBeGreaterThan(G.estimate(INPUT, 'haiku'))
})

test('the summary: averages, the share at 7 or more, the rewrite', () => {
  const scores = G.parseScores(SCORES)
  const g = G.summarize(INPUT, 'haiku', scores, { source: INPUT.prompts[0] as GradingInput['prompts'][number], text: '  Login fails after refresh. Fix src/auth/session.ts.  ' }, 0.004)
  expect(g?.criteria).toEqual({ goal: 1.5, place: 1, done: 1, scope: 2, context: 0.5 })
  expect(g?.shareAtLeast7).toBe(0.5)
  expect(g?.rewrite?.after).toBe('Login fails after refresh. Fix src/auth/session.ts.')
  expect(G.summarize(INPUT, 'haiku', [], null, 0)).toBeNull()
})

for (const surface of SURFACES) {
  describe(surface, () => {
    test('with grading on, last week is graded once and the rewrite shows', { options: { promptGrading: true } }, async ($, on) => {
      const { pane, command, seen, clock } = await boot($, on, surface, {
        grading: INPUT,
        model: system => (system.startsWith('Rewrite') ? 'Login fails after a refresh on /dashboard. Fix it in src/auth/session.ts.' : SCORES),
      })
      await clock.settle()
      expect(seen.argv.some(a => a.join(' ').includes('--grade-week 2026-09-28'))).toBe(true)
      const graded = (seen.store.get('grading') as Record<string, { n: number; model: string }>)['2026-09-28']
      expect(graded?.n).toBe(2)
      expect(graded?.model).toBe('haiku')
      expect(seen.modelCalls.length).toBe(2)
      await command('')
      const ui = await pane()
      expect(await ui.find({ text: 'Your prompt, rewritten' })).toBeDefined()
      expect(await ui.find({ text: 'Login fails after a refresh on /dashboard. Fix it in src/auth/session.ts.' })).toBeDefined()
      expect(await ui.find({ text: /Prompt grading is on/ })).toBeDefined()
    })

    test('over the cap, nothing is sent', { options: { promptGrading: true, gradingCapUsd: 0 } }, async ($, on) => {
      const { seen, clock } = await boot($, on, surface, { grading: INPUT, model: () => SCORES })
      await clock.settle()
      expect(seen.modelCalls).toEqual([])
    })

    test('off by default: nothing goes to a model', async ($, on) => {
      const { seen, clock } = await boot($, on, surface, { grading: INPUT, model: () => SCORES })
      await clock.settle()
      expect(seen.modelCalls).toEqual([])
      expect(seen.argv.some(a => a.includes('--grade-week'))).toBe(false)
    })
  })
}
