import { describe, expect, test } from 'claude-code/testing'

import type { BoardRoom } from '../core/game'
import { emptyRecord } from '../core/store'
import { breakout, LAYOUTS, speed } from '../games/breakout/logic'
import type { BreakoutState } from '../games/breakout/logic'
import { dino, isNight, scoreOf } from '../games/dino/logic'
import type { DinoState } from '../games/dino/logic'
import { pong } from '../games/pong/logic'
import type { PongState } from '../games/pong/logic'
import { fits, gravityMs, hardDrop, rotate, tetris } from '../games/tetris/logic'
import type { TetrisState } from '../games/tetris/logic'
import { boot, SURFACES } from './helpers'

const ROOM: BoardRoom = { surface: 'desktop', columns: 42, rows: 43 }
const INLINE: BoardRoom = { surface: 'terminal', columns: 87, rows: 15 }
const SETTINGS = { highContrast: false, wordleHardMode: false }
const init = { room: ROOM, settings: SETTINGS, today: '2026-10-12', record: emptyRecord(), seed: 11 }
const IN = { in: 'board' } as const

function ticks<S>(tick: (s: S) => S | undefined, s: S, max: number, until: (s: S) => boolean = () => false): S {
  let out = s
  for (let i = 0; i < max && !until(out); i++) out = tick(out) ?? out

  return out
}

describe('tetris', () => {
  test('waits for a key, then falls a row a second at level 1', () => {
    const s0 = tetris.init(init)
    expect(tetris.tick?.(s0)).toBeUndefined()
    const s1 = tetris.key(s0, { key: 'x' }) as TetrisState
    expect(s1.isStarted).toBe(true)
    const y = s1.piece.y
    const s2 = ticks(t => tetris.tick?.(t), s1, 20)
    expect(s2.piece.y).toBe(y + 1)
    expect(Math.round(gravityMs(1))).toBe(1000)
    expect(gravityMs(10)).toBeLessThan(100)
  })

  test('a full row clears and scores by level; four at once is a tetris and can sweep the board', () => {
    const s0 = { ...tetris.init(init), isStarted: true }
    // Four rows full but for the last column, and an I standing ready over it.
    const rows = '.'.repeat(16 * 10) + 'XXXXXXXXX.'.repeat(4)
    const s: TetrisState = { ...s0, grid: rows.replace(/X/g, 'J'), piece: { kind: 'I', r: 1, x: 7, y: 0 } }
    const dropped = hardDrop(s)
    expect(dropped.lines).toBe(4)
    expect(dropped.tetrises).toBe(1)
    expect(dropped.sweeps).toBe(1)
    expect(dropped.score).toBe(s.score + 800 + 16 * 2)
  })

  test("rotation kicks off a wall; a piece that can't spawn ends the game", () => {
    const s0 = { ...tetris.init(init), isStarted: true }
    // A T against the left wall, pointing left, rotates back by kicking right.
    const atWall: TetrisState = { ...s0, piece: { kind: 'T', r: 1, x: -1, y: 5 } }
    expect(fits(atWall.grid, atWall.piece)).toBe(true)
    const turned = rotate(atWall, 1)
    expect(turned.piece.r).toBe(2)
    expect(fits(turned.grid, turned.piece)).toBe(true)
    const full: TetrisState = { ...s0, grid: 'L'.repeat(200) }
    expect(hardDrop({ ...full, grid: '.'.repeat(10) + 'L'.repeat(190), piece: { kind: 'O', r: 0, x: 3, y: -1 } }).isOver).toBe(true)
  })

  test('hold swaps once per piece', () => {
    const s0 = { ...tetris.init(init), isStarted: true }
    const held = tetris.key(s0, { key: 'c' }) as TetrisState
    expect(held.hold).toBe(s0.piece.kind)
    expect(tetris.key(held, { key: 'c' })).toBe(undefined)
  })

  test('half-blocks in a terminal inline pane, Box cells on desktop', () => {
    const s = tetris.init(init)
    expect(tetris.size(s, ROOM).rows).toBe(20)
    expect(tetris.size(s, INLINE).rows).toBe(10)
  })
})

describe('breakout', () => {
  test('the paddle sends the ball up at an angle set by where it lands', () => {
    const s0 = breakout.init(init)
    const launched = breakout.key(s0, { key: ' ' }) as BreakoutState
    expect(launched.isLaunched).toBe(true)
    // Coming down on the right end of the paddle goes back up to the right.
    const falling: BreakoutState = { ...launched, ball: { x: launched.paddle + 3.9, y: 14.8, vx: 0, vy: 1 } }
    const back = breakout.tick?.(falling) as BreakoutState
    expect(back.ball.vy).toBeLessThan(0)
    expect(back.ball.vx).toBeGreaterThan(0)
    expect(back.hits).toBe(1)
  })

  test('bricks break and score; missing loses a life; clearing a level goes on to the next', () => {
    const s0 = { ...(breakout.key(breakout.init(init), { key: ' ' }) as BreakoutState) }
    const up: BreakoutState = { ...s0, ball: { x: 1, y: 7.2, vx: 0, vy: -1 } }
    const hit = ticks(t => breakout.tick?.(t), up, 4, t => t.score > 0)
    expect(hit.score).toBe(1)
    const missed: BreakoutState = { ...s0, paddle: 0, ball: { x: 18.5, y: 15.6, vx: 0, vy: 1 } }
    const lost = breakout.tick?.(missed) as BreakoutState
    expect(lost.lives).toBe(2)
    expect(lost.isLaunched).toBe(false)
    const lastBrick: BreakoutState = { ...s0, bricks: '1' + '0'.repeat(49), ball: { x: 0.5, y: 3.4, vx: 0, vy: -1 } }
    const next = ticks(t => breakout.tick?.(t), lastBrick, 4, t => t.level === 2)
    expect(next.level).toBe(2)
    expect(next.cleared).toBe(1)
    expect(next.flawless).toBe(1)
    expect(LAYOUTS.length).toBe(5)
    expect(speed({ level: 6, hits: 12, hasReachedTop: true })).toBe(9 + 1 + 3)
  })

  test('the paddle follows the mouse', () => {
    const s0 = breakout.init(init)
    const moved = breakout.pointer?.(s0, { type: 'move', x: 4, y: 3 }, ROOM) as BreakoutState
    expect(moved.paddle).toBe(0)
    expect(breakout.wantsHover).toBe(true)
  })
})

describe('dino run', () => {
  test('a jump clears a cactus; running into one ends the run', () => {
    const s0 = dino.key(dino.init(init), { key: ' ' }) as DinoState
    expect(s0.isStarted).toBe(true)
    const withCactus: DinoState = { ...s0, obstacles: [{ x: 5.5, w: 1, h: 2 }], untilNext: 99 }
    const cleared = ticks(t => dino.tick?.(t), withCactus, 30, t => t.cleared > 0 || t.isOver)
    expect(cleared.isOver).toBe(false)
    expect(cleared.cleared).toBe(1)
    const standing: DinoState = { ...s0, y: 0, vy: 0, obstacles: [{ x: 4.2, w: 1, h: 1 }], untilNext: 99 }
    const hit = ticks(t => dino.tick?.(t), standing, 10, t => t.isOver)
    expect(hit.isOver).toBe(true)
  })

  test('ducking passes a bird at head height; the score turns to night at 700', () => {
    const s0 = dino.key(dino.init(init), { key: ' ' }) as DinoState
    const landed: DinoState = { ...s0, y: 0, vy: 0, untilNext: 99, obstacles: [{ x: 6, w: 1, h: 1, row: 7 }] }
    const ducked = dino.key(landed, { key: 'down' }) as DinoState
    const passed = ticks(t => dino.tick?.({ ...t, duckMs: 400 }), ducked, 20, t => t.cleared > 0 || t.isOver)
    expect(passed.isOver).toBe(false)
    expect(isNight(700)).toBe(true)
    expect(isNight(800)).toBe(false)
    expect(scoreOf({ dist: 80 })).toBe(100)
  })
})

describe('pong', () => {
  test('serves on a key, the paddle returns the ball, and a miss scores', () => {
    const s0 = pong.key(pong.init(init), { key: ' ' }) as PongState
    expect(s0.isStarted).toBe(true)
    const coming: PongState = { ...s0, me: 5, ball: { x: 1.2, y: 6.5, vx: -1, vy: 0 } }
    const back = pong.tick?.(coming) as PongState
    expect(back.ball.vx).toBeGreaterThan(0)
    expect(back.rally).toBe(1)
    const missed: PongState = { ...s0, me: 0, ball: { x: 0.6, y: 11, vx: -1, vy: 0 } }
    const point = ticks(t => pong.tick?.(t), missed, 4, t => t.botScore > 0)
    expect(point.botScore).toBe(1)
  })

  test('first to 7 wins, and 7–0 is a shutout', () => {
    const s0 = pong.key(pong.init(init), { key: ' ' }) as PongState
    const nearly: PongState = { ...s0, myScore: 6, bot: 0, ball: { x: 20.6, y: 12, vx: 1, vy: 0 } }
    const won = pong.tick?.(nearly) as PongState
    expect(won.isOver).toBe(true)
    expect(pong.over(won)?.result).toBe('won')
    expect(pong.facts(won).botScore).toBe(0)
  })

  test('the bot follows the ball', () => {
    let s: PongState = { ...(pong.key(pong.init(init), { key: ' ' }) as PongState), level: 2, bot: 0, ball: { x: 15, y: 11, vx: 1, vy: 0 } }
    for (let i = 0; i < 30; i++) s = { ...(pong.tick?.(s) as PongState), ball: { x: 15, y: 11, vx: 1, vy: 0 } }
    expect(s.bot).toBeGreaterThan(7)
  })
})

for (const surface of SURFACES) {
  describe(`${surface}: the long-turn line`, () => {
    test('shows a minute into a turn and goes when it ends', { options: { suggestDuringLongTurns: true } }, async ($, on) => {
      const { clock } = await boot($, on, surface)
      const band = () =>
        $.ui.mount({ plugin: 'games', surface, component: 'AbovePrompt', props: { hasSurvey: false, maxRows: 3, bodyColumns: 80 } as never })
      await $.turn.start({ text: 'build it', turnId: 't1' })
      const ui = await band()
      await clock.advance(59_000)
      expect(await ui.find({ type: 'Text', text: '/games dino' })).toBeUndefined()
      await clock.advance(2_000)
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: '/games dino' })).toBeDefined()
      await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done', durationMs: 61_000, isAborted: false })
      await clock.settle()
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: '/games dino' })).toBeUndefined()
    })

    test('stays off by default', async ($, on) => {
      const { clock } = await boot($, on, surface)
      await $.turn.start({ text: 'build it', turnId: 't1' })
      await clock.advance(120_000)
      const ui = await $.ui.mount({ plugin: 'games', surface, component: 'AbovePrompt', props: { hasSurvey: false, maxRows: 3, bodyColumns: 80 } as never })
      expect(await ui.find({ type: 'Text', text: '/games dino' })).toBeUndefined()
    })
  })
}
