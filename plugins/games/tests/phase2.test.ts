import { describe, expect, test } from 'claude-code/testing'

import type { BoardRoom } from '../core/game'
import { evaluate } from '../core/milestones'
import { applyOutcome, emptyRecord } from '../core/store'
import { botMove as c4Bot, connect4, landing, winLine } from '../games/connect4/logic'
import type { Connect4State } from '../games/connect4/logic'
import { DEAL, gallows, hangman, MAX_MISSES } from '../games/hangman/logic'
import type { HangmanState } from '../games/hangman/logic'
import { level, lights } from '../games/lights/logic'
import type { LightsState } from '../games/lights/logic'
import { fitsBig, memory } from '../games/memory/logic'
import type { MemoryState } from '../games/memory/logic'
import { botMove as tttBot, tictactoe, winner } from '../games/tictactoe/logic'
import type { TicTacToeState } from '../games/tictactoe/logic'
import type { Outcome } from '../types'

const ROOM: BoardRoom = { surface: 'desktop', columns: 42, rows: 43 }
const SETTINGS = { highContrast: false, wordleHardMode: false }
const init = { room: ROOM, settings: SETTINGS, today: '2026-10-12', record: emptyRecord(), seed: 7 }

function ticks<S>(tick: (s: S) => S | undefined, s: S, max: number, until: (s: S) => boolean = () => false): S {
  let out = s
  for (let i = 0; i < max && !until(out); i++) out = tick(out) ?? out

  return out
}

describe('lights out', () => {
  test('levels are fixed by their number and start lit', () => {
    expect(level(3)).toEqual(level(3))
    expect(level(3).lights).not.toBe(level(4).lights)
    for (let n = 1; n <= 60; n++) {
      expect(level(n).lights.includes('1')).toBe(true)
      expect(level(n).par).toBeLessThanOrEqual(n + 2)
    }
  })

  test('a press flips a light and its neighbours; clearing a level wins it, and the next is one up', () => {
    // Pressing the center from dark lights a plus; pressing it again clears it.
    const s0: LightsState = { ...lights.init(init), lights: '0000000100011100010000000', par: 1 }
    const s1 = lights.pointer?.(s0, { type: 'down', x: 12, y: 6 }, ROOM) as LightsState
    expect(s1.isCleared).toBe(true)
    const outcome = lights.over(s1)
    expect(outcome?.result).toBe('won')
    expect(outcome?.extra?.onPar).toBe(1)
    expect(lights.init({ ...init, previous: s1 }).level).toBe(s1.level + 1)
    expect(lights.init({ ...init, previous: s0 }).level).toBe(s0.level)
    // The gap between lights takes no press.
    expect(lights.pointer?.(s0, { type: 'down', x: 4, y: 0 }, ROOM)).toBeUndefined()
  })

  test('u undoes the last press', () => {
    const s0 = lights.init(init)
    const s1 = lights.pointer?.(s0, { type: 'down', x: 0, y: 0 }, ROOM) as LightsState
    const s2 = lights.key(s1, { key: 'u' }) as LightsState
    expect(s2.lights).toBe(s0.lights)
    expect(s2.moves).toBe(2)
  })
})

describe('memory', () => {
  test('every face is dealt twice', () => {
    const s = memory.init(init)
    expect(s.faces.length).toBe(16)
    for (let f = 0; f < 8; f++) expect(s.faces.filter(x => x === f).length).toBe(2)
    expect(fitsBig(ROOM)).toBe(true)
    expect(fitsBig({ ...ROOM, columns: 40 })).toBe(false)
  })

  test('a pair stays up, a miss turns back after 0.8 seconds, and clearing wins', () => {
    const s0 = memory.init(init)
    const a = 0
    const b = s0.faces.findIndex((f, i) => i !== a && f === s0.faces[a])
    const c = s0.faces.findIndex(f => f !== s0.faces[a])
    const flip = (s: MemoryState, i: number) => memory.key({ ...s, cursor: i }, { key: ' ' }) as MemoryState
    const pair = flip(flip(s0, a), b)
    expect(pair.matched).toEqual([a, b])
    // A card that's neither matched nor c's pair.
    const d = s0.faces.findIndex((f, i) => i !== c && !pair.matched.includes(i) && f !== s0.faces[c])
    const missed = flip(flip(pair, c), d)
    expect(missed.miss).toBe(16)
    const back = ticks(t => memory.tick?.(t), missed, 16)
    expect(back.open).toEqual([])

    let done = s0
    for (let f = 0; f < 8; f++) {
      const [x, y] = s0.faces.flatMap((face, i) => (face === f ? [i] : []))
      done = flip(flip(done, x ?? 0), y ?? 0)
    }
    expect(done.flips).toBe(16)
    expect(memory.over(done)?.best).toEqual({ flips: 16 })
    expect(evaluate(memory.milestones, { ...memory.facts(done), seconds: 30 }, emptyRecord(), true)).toEqual([
      'matched',
      'sharp',
      'sharper',
      'speedy',
    ])
  })
})

describe('connect four', () => {
  const grid = (rows: string[]) => rows.join('')
  const empty = '.'.repeat(42)

  test('finds a four in every direction', () => {
    expect(winLine(grid(['.......', '.......', '.......', '.......', '.......', 'rrrr...']))?.isDiagonal).toBe(false)
    expect(winLine(grid(['.......', '.......', 'r......', 'r......', 'r......', 'r......']))?.piece).toBe('r')
    const diag = winLine(grid(['.......', '.......', '...y...', '..yr...', '.yrr...', 'yrrr...']))
    expect(diag?.piece).toBe('y')
    expect(diag?.isDiagonal).toBe(true)
    expect(landing(empty, 3)).toBe(5)
  })

  test('every level takes a win and blocks one', () => {
    const toWin = grid(['.......', '.......', '.......', '.......', '.......', 'yyy.rr.'])
    const toBlock = grid(['.......', '.......', '.......', '.......', 'y......', 'rrr.y..'])
    for (const lvl of [0, 1, 2]) {
      expect(c4Bot(toWin, lvl, 1).col).toBe(3)
      expect(c4Bot(toBlock, lvl, 1).col).toBe(3)
    }
  })

  test('Hard thinks in well under a second', () => {
    const start = Date.now()
    c4Bot(empty, 2, 1)
    c4Bot(grid(['.......', '.......', '.......', '.......', '...y...', '..rr...']), 2, 1)
    expect(Date.now() - start).toBeLessThan(1500)
  })

  test('a disc drops, the bot answers, and a four ends the game', () => {
    const s0 = connect4.init(init)
    const s1 = connect4.pointer?.(s0, { type: 'down', x: 13, y: 3 }, ROOM) as Connect4State
    expect(s1.drop?.col).toBe(3)
    const s2 = ticks(t => connect4.tick?.(t), s1, 40, t => t.turn === 'r' && !t.drop && t.grid.split('').filter(c => c === 'y').length === 1)
    expect(s2.grid.split('').filter(c => c === 'r').length).toBe(1)
    expect(s2.grid.split('').filter(c => c === 'y').length).toBe(1)

    const nearly: Connect4State = { ...s0, grid: grid(['.......', '.......', '.......', 'y......', 'y......', 'rrr.y..']), moves: 3 }
    const dropped = connect4.key({ ...nearly, cursor: 3 }, { key: ' ' }) as Connect4State
    const won = ticks(t => connect4.tick?.(t), dropped, 10, t => t.winner !== '')
    expect(won.winner).toBe('r')
    expect(connect4.over(won)?.result).toBe('won')
    expect(connect4.facts(won).moves).toBe(4)
  })
})

describe('tic-tac-toe', () => {
  test('Perfect never loses, whatever you play', () => {
    let wins = 0
    const explore = (grid: string, turn: 'x' | 'o') => {
      const w = winner(grid)
      if (w) {
        if (w.mark === 'x') wins += 1
        return
      }
      if (!grid.includes('.')) return
      if (turn === 'o') {
        const { cell } = tttBot(grid, 1, 1)
        explore(grid.slice(0, cell) + 'o' + grid.slice(cell + 1), 'x')
        return
      }
      for (let i = 0; i < 9; i++) if (grid[i] === '.') explore(grid.slice(0, i) + 'x' + grid.slice(i + 1), 'o')
    }
    explore('.........', 'x')
    explore('.........', 'o')
    expect(wins).toBe(0)
  })

  test('who starts swaps every game, and the keypad plays', () => {
    const first = tictactoe.init(init)
    expect(first.starter).toBe('you')
    const second = tictactoe.init({ ...init, previous: first })
    expect(second.starter).toBe('bot')
    expect(second.turn).toBe('o')
    const played = tictactoe.key(first, { key: '1' }) as TicTacToeState
    expect(played.grid[0]).toBe('x')
    expect(played.turn).toBe('o')
    const answered = ticks(t => tictactoe.tick?.(t), played, 20, t => t.turn === 'x')
    expect(answered.grid.split('').filter(c => c === 'o').length).toBe(1)
    expect(tictactoe.key(first, { key: 'd' })?.level).toBe(1)
  })
})

describe('hangman', () => {
  test('the deal holds every word once', () => {
    expect(DEAL.length).toBeGreaterThan(350)
    expect(new Set(DEAL.map(d => d.word)).size).toBe(DEAL.length)
    expect(DEAL.every(d => /^[a-z]{4,14}$/.test(d.word))).toBe(true)
  })

  test('words come in deal order, a word solved and one lost', () => {
    const s0 = hangman.init(init)
    expect(s0.word).toBe(DEAL[0]?.word)
    let won: HangmanState = s0
    for (const ch of new Set(s0.word)) won = hangman.key(won, { key: ch }) as HangmanState
    expect(won.isWon).toBe(true)
    const outcome = hangman.over(won) as Omit<Outcome, 'ms'>
    const record = applyOutcome(emptyRecord(), { ...outcome, ms: 1000 }, [], 1)
    expect(hangman.init({ ...init, record }).word).toBe(DEAL[1]?.word)

    let lost: HangmanState = s0
    for (const ch of 'abcdefghijklmnopqrstuvwxyz'.split('').filter(c => !s0.word.includes(c)).slice(0, MAX_MISSES)) {
      lost = hangman.key(lost, { key: ch }) as HangmanState
    }
    expect(lost.isOver && !lost.isWon).toBe(true)
    expect(gallows(6).join('\n')).toContain('/|\\')
  })

  test('every category needs a solve in each', () => {
    let record = emptyRecord()
    for (const category of ['Languages', 'Tools', 'Concepts']) {
      record = applyOutcome(record, { result: 'won', ms: 1, facts: {}, best: {}, extra: { [`cat.${category}`]: 1 } }, [], 1)
    }
    expect(evaluate(hangman.milestones, { won: 1, misses: 1, length: 5 }, record, true)).not.toContain('every-category')
    record = applyOutcome(record, { result: 'won', ms: 1, facts: {}, best: {}, extra: { 'cat.Commands': 1 } }, [], 1)
    expect(evaluate(hangman.milestones, { won: 1, misses: 1, length: 5 }, record, true)).toContain('every-category')
  })
})
