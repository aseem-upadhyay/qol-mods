import { describe, expect, test } from 'claude-code/testing'

import { parse } from '../hooks/register'
import { boot, SURFACES } from './helpers'

const IN = { in: 'board' } as const

describe('/games arguments', () => {
  test('names, aliases, close, milestones and reset', () => {
    expect(parse('').screen).toBe('hub')
    expect(parse('Snake').screen).toBe('game:snake')
    expect(parse('minesweeper').screen).toBe('game:mines')
    expect(parse('MINES').screen).toBe('game:mines')
    expect(parse('milestones').screen).toBe('trophies')
    expect(parse('close').isClose).toBe(true)
    expect(parse('reset wordle').screen).toBe('reset:wordle')
    expect(parse('reset all').screen).toBe('reset:all')
    expect(parse('snak').toast).toBe('No game called "snak". Did you mean Snake?')
    expect(parse('tetris').toast).toBe('No game called "tetris".')
  })
})

for (const surface of SURFACES) {
  describe(surface, () => {
    test('/games opens the hub on the four games', async ($, on) => {
      const { run, pane, seen } = await boot($, on, surface)
      expect((await run()).text).toBe('Opened games.')
      expect(seen.opened).toBe(1)
      const ui = await pane()
      for (const name of ['Snake', '2048', 'Minesweeper', 'Wordle']) {
        expect(await ui.find({ type: 'Text', text: new RegExp(` ${name}$`), ...IN })).toBeDefined()
      }
      expect(await ui.find({ type: 'Text', text: '★ 0 of 29', ...IN })).toBeDefined()
      expect(await ui.findAll({ type: 'Text', text: /New/, ...IN })).toHaveLength(4)
    })

    test('enter on a hub row opens that game, h goes back', async ($, on) => {
      const { run, pane } = await boot($, on, surface)
      await run()
      const ui = await pane()
      await ui.key({ key: 'down', ...IN })
      await ui.key({ key: 'return', ...IN })
      expect(await ui.find({ type: 'Text', text: /^score 0 · best 0$/, ...IN })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '2048', ...IN })).toBeDefined()
      await ui.key({ key: 'h', ...IN })
      expect(await ui.find({ type: 'Text', text: 'Games', ...IN })).toBeDefined()
    })

    test('a snake game ends, is recorded, and unlocks a milestone', async ($, on) => {
      const { run, pane, seen, clock } = await boot($, on, surface)
      await run('snake')
      const ui = await pane()
      await ui.key({ key: 'down', ...IN })
      await ui.advance(5000)
      await clock.settle()
      expect(await ui.find({ type: 'Text', text: 'Game over', ...IN })).toBeDefined()
      await ui.key({ key: 'h', ...IN })
      await clock.settle()
      await ui.redraw()
      expect(await ui.findAll({ type: 'Text', text: /New/, ...IN })).toHaveLength(3)
      // Down from the middle row hits the bottom wall in 7 moves: no food on the way makes 0.
      expect(await ui.find({ type: 'Text', text: /best \d/, ...IN })).toBeDefined()
      expect(seen.toasts.every(t => t.startsWith('★ Snake'))).toBe(true)
    })

    test('a game left half-played resumes, paused', async ($, on) => {
      const { run, pane, clock } = await boot($, on, surface)
      await run('snake')
      const ui = await pane()
      await ui.key({ key: 'up', ...IN })
      await ui.advance(300)
      await ui.key({ key: 'right', ...IN })
      await ui.key({ key: 'h', ...IN })
      await clock.settle()
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: /resume|●/, ...IN })).toBeDefined()
      await ui.key({ key: '1', ...IN })
      expect(await ui.find({ type: 'Text', text: 'Paused', ...IN })).toBeDefined()
      await ui.key({ key: 'p', ...IN })
      expect(await ui.find({ type: 'Text', text: 'Paused', ...IN })).toBeUndefined()
    })

    test('typing in the prompt pauses an arcade game', async ($, on) => {
      const { run, pane, clock } = await boot($, on, surface)
      await run('snake')
      const ui = await pane()
      await ui.key({ key: 'up', ...IN })
      await ui.advance(200)
      await $.prompt.submit({ text: 'hello' } as never).catch(() => undefined)
      await clock.settle()
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: 'Paused', ...IN })).toBeDefined()
    })

    test('wordle takes typed letters, and its commands take shift', async ($, on) => {
      const { run, pane } = await boot($, on, surface)
      await run('wordle')
      const ui = await pane()
      for (const ch of 'crh') await ui.key({ key: ch, ...IN })
      expect(await ui.find({ type: 'Text', text: 'C', ...IN })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'H', ...IN })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Daily/, ...IN })).toBeDefined()
      await ui.key({ key: 'H', shift: true, ...IN })
      expect(await ui.find({ type: 'Text', text: 'Games', ...IN })).toBeDefined()
    })

    test('a mistyped name opens the hub with a suggestion', async ($, on) => {
      const { run, seen } = await boot($, on, surface)
      const result = await run('snak')
      expect(result.text).toBe('No game called "snak". Did you mean Snake?')
      expect(seen.toasts).toContain('No game called "snak". Did you mean Snake?')
    })

    test('q closes the pane', async ($, on) => {
      const { run, pane, seen, clock } = await boot($, on, surface)
      await run('2048')
      const ui = await pane()
      await ui.key({ key: 'q', ...IN })
      await clock.settle()
      expect(seen.closed).toBe(1)
    })

    test('every board fits the pane', async ($, on) => {
      const { run, pane } = await boot($, on, surface)
      for (const game of ['snake', '2048', 'mines', 'wordle']) {
        await run(game)
        const ui = await pane()
        await ui.resize({ columns: surface === 'desktop' ? 42 : 87, rows: surface === 'desktop' ? 45 : 17, in: 'board' })
        const boxes = await ui.findAll({ type: 'Box', ...IN })
        expect(boxes.length).toBeLessThan(2000)
        await ui.unmount()
      }
    })
  })
}
