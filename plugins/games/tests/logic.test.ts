import { describe, expect, test } from 'claude-code/testing'

import type { BoardRoom } from '../core/game'
import { evaluate } from '../core/milestones'
import { applyOutcome, applySave, emptyRecord, readRecord, resetRecord, unlock } from '../core/store'
import { game2048, slide } from '../games/2048/logic'
import type { State2048 } from '../games/2048/logic'
import { levelsFor, mines } from '../games/mines/logic'
import type { MinesState } from '../games/mines/logic'
import { snake, speed } from '../games/snake/logic'
import type { SnakeState } from '../games/snake/logic'
import { dailyAnswer, hardModeMiss, isWord, score, wordle } from '../games/wordle/logic'
import type { WordleState } from '../games/wordle/logic'
import type { Outcome } from '../types'

const ROOM: BoardRoom = { surface: 'desktop', columns: 42, rows: 43 }
const INLINE: BoardRoom = { surface: 'terminal', columns: 87, rows: 15 }
const SETTINGS = { highContrast: false, wordleHardMode: false }
const init = { room: ROOM, settings: SETTINGS, today: '2026-10-12', record: emptyRecord() }

/** Runs a game's ticks until `until` holds, at most `max` ticks. */
function ticks<S>(tick: (s: S) => S | undefined, s: S, max: number, until: (s: S) => boolean = () => false): S {
  let out = s
  for (let i = 0; i < max && !until(out); i++) out = tick(out) ?? out

  return out
}

describe('snake', () => {
  test('waits for a key, then moves at 8 a second', () => {
    const s0 = snake.init({ ...init, seed: 1 })
    expect(snake.tick?.(s0)).toBeUndefined()
    const s1 = snake.key(s0, { key: 'down' })
    if (!s1) throw new Error('no state')
    expect(s1.isStarted).toBe(true)
    // 8 moves a second is one move every 125 ms: three ticks of 50 ms make one move.
    const s2 = ticks(t => snake.tick?.(t), s1, 3)
    expect(s2.body[0]).toEqual([5, 8])
    expect(speed(0)).toBe(8)
    expect(speed(40)).toBe(16)
  })

  test('reversing into itself is ignored, and two turns queue', () => {
    const s0 = { ...snake.init({ ...init, seed: 1 }), isStarted: true }
    expect(snake.key(s0, { key: 'left' })?.queued).toEqual([])
    const s1 = snake.key(snake.key(s0, { key: 'up' }) as SnakeState, { key: 'a' })
    expect(s1?.queued).toEqual(['up', 'left'])
  })

  test('eats food, grows and scores; a wall ends the game', () => {
    const s0: SnakeState = { ...snake.init({ ...init, seed: 1 }), isStarted: true, food: [6, 7] }
    const ate = ticks(t => snake.tick?.(t), s0, 3)
    expect(ate.score).toBe(1)
    expect(ate.body.length).toBe(4)
    const crashed = ticks(t => snake.tick?.(t), ate, 400, t => t.isOver)
    expect(crashed.isOver).toBe(true)
    const outcome = snake.over(crashed)
    expect(outcome?.best.score).toBe(crashed.score)
    expect(outcome?.result).toBe('ended')
  })

  test('a save restores the same game', () => {
    const s0 = snake.init({ ...init, seed: 9 })
    const copy = JSON.parse(JSON.stringify(s0)) as SnakeState
    expect(copy).toEqual(s0)
  })
})

describe('2048', () => {
  test('slides and merges once per pair, toward the move', () => {
    const grid = [2, 2, 2, 2, 4, 0, 4, 8, 0, 0, 0, 0, 2, 0, 0, 2]
    const left = slide(grid, 'left')
    expect(left?.grid.slice(0, 4)).toEqual([4, 4, 0, 0])
    expect(left?.grid.slice(4, 8)).toEqual([8, 8, 0, 0])
    expect(left?.grid.slice(12, 16)).toEqual([4, 0, 0, 0])
    expect(left?.gained).toBe(4 + 4 + 8 + 4)
    expect(slide([2, 4, 8, 16, ...Array<number>(12).fill(0)], 'left')).toBeUndefined()
  })

  test('a move adds a tile; no move left ends it', () => {
    const s0 = game2048.init({ ...init, seed: 3 })
    expect(s0.grid.filter(v => v > 0).length).toBe(2)
    const stuck: State2048 = {
      ...s0,
      grid: [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2],
    }
    expect(game2048.key(stuck, { key: 'left' })).toEqual(stuck)
    const nearly: State2048 = { ...s0, grid: [1024, 1024, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 8], maxTile: 1024 }
    const made = game2048.key(nearly, { key: 'left' }) as State2048
    expect(made.maxTile).toBe(2048)
    expect(made.movesTo2048).toBe(1)
    expect(game2048.facts(made).maxTile).toBe(2048)
  })

  test('the board is compact in a terminal inline pane', () => {
    const s = game2048.init({ ...init, seed: 3 })
    expect(game2048.size(s, ROOM)).toEqual({ columns: 33, rows: 17 })
    expect(game2048.size(s, INLINE)).toEqual({ columns: 29, rows: 13 })
  })
})

describe('minesweeper', () => {
  test('the first reveal is never a mine and opens an area', () => {
    for (let seed = 1; seed < 30; seed++) {
      const s0 = mines.init({ ...init, seed })
      const s1 = mines.pointer?.(s0, { type: 'down', x: 8, y: 4 }, ROOM) as MinesState
      expect(s1.isOver).toBe(false)
      expect(s1.mineAt.length).toBe(10)
      expect(s1.mineAt.includes(4 * 9 + 4)).toBe(false)
      expect(s1.cells.split('').filter(c => c === 'o').length).toBeGreaterThan(1)
    }
  })

  test('shift+click flags; revealing every safe cell wins, a mine loses', () => {
    const s0 = mines.init({ ...init, seed: 5 })
    const s1 = mines.pointer?.(s0, { type: 'down', x: 0, y: 0 }, ROOM) as MinesState
    const mine = s1.mineAt[0] ?? 0
    const flagged = mines.pointer?.(s1, { type: 'down', x: (mine % 9) * 2, y: Math.floor(mine / 9), shift: true }, ROOM) as MinesState
    expect(flagged.cells[mine]).toBe('f')
    expect(flagged.flagsPlaced).toBe(1)

    let won = s1
    for (let i = 0; i < 81; i++) {
      if (!won.mineAt.includes(i) && won.cells[i] === 'h') won = mines.pointer?.(won, { type: 'down', x: (i % 9) * 2, y: Math.floor(i / 9) }, ROOM) as MinesState
    }
    expect(won.isWon).toBe(true)
    const outcome = mines.over({ ...won, ms: 42_000 })
    expect(outcome?.best['time.easy']).toBe(42)
    expect(outcome?.streak).toBe('won')
    expect(outcome?.extra?.noFlagWins).toBe(1)

    const lost = mines.pointer?.(s1, { type: 'down', x: (mine % 9) * 2, y: Math.floor(mine / 9) }, ROOM) as MinesState
    expect(lost.isOver && !lost.isWon).toBe(true)
    expect(lost.boom).toBe(mine)
  })

  test('Medium is offered only where 16 rows fit', () => {
    expect(levelsFor(ROOM)).toEqual([0, 1])
    expect(levelsFor(INLINE)).toEqual([0])
    expect(levelsFor({ surface: 'desktop', columns: 149, rows: 43 })).toEqual([0, 1, 2])
  })
})

describe('wordle', () => {
  test('scores repeated letters the way Wordle does', () => {
    expect(score('allee', 'apple')).toEqual(['correct', 'present', 'absent', 'absent', 'correct'])
    expect(score('crane', 'crane')).toEqual(['correct', 'correct', 'correct', 'correct', 'correct'])
    expect(score('speed', 'abide')).toEqual(['absent', 'absent', 'present', 'absent', 'present'])
  })

  test('guesses must be words; the daily is the same all day and changes by date', () => {
    expect(isWord('crane')).toBe(true)
    expect(isWord('aahed')).toBe(true)
    expect(isWord('zzzzz')).toBe(false)
    expect(dailyAnswer('2026-10-12')).toBe(dailyAnswer('2026-10-12'))
    expect(dailyAnswer('2026-10-12')).not.toBe(dailyAnswer('2026-10-13'))
    expect(isWord(dailyAnswer('2026-10-12'))).toBe(true)
  })

  test('the daily first, practice once it is done; a win records the streak by date', () => {
    const daily = wordle.init({ ...init, seed: 1 })
    expect(daily.date).toBe('2026-10-12')
    let s: WordleState = daily
    for (const ch of daily.answer) s = wordle.key(s, { key: ch }) as WordleState
    s = wordle.key(s, { key: 'return' }) as WordleState
    expect(s.isWon).toBe(true)
    const outcome = wordle.over(s)
    expect(outcome?.daily).toBe('2026-10-12')
    expect(outcome?.streak).toBe('won')
    const record = applyOutcome(emptyRecord(), { ...(outcome as Omit<Outcome, 'ms'>), ms: 1000 }, wordle.lowerIsBetter, 1)
    const practice = wordle.init({ ...init, seed: 1, record })
    expect(practice.date).toBeUndefined()
    expect(practice.answer).not.toBe(daily.answer)
  })

  test('not a word shakes; hard mode keeps the hints', () => {
    const s0: WordleState = { ...wordle.init({ ...init, seed: 1 }), answer: 'crane', current: 'zzzzz' }
    expect(wordle.key(s0, { key: 'return' })?.message).toBe('Not in word list')
    const hard: WordleState = { ...s0, isHard: true, guesses: ['trace'], current: '' }
    expect(hardModeMiss(hard, 'blimp')).toBe('Letter 2 must be R')
    expect(hardModeMiss(hard, 'crate')).toBeUndefined()
  })

  test('the keyboard takes clicks', () => {
    const s0 = wordle.init({ ...init, seed: 1 })
    // Row 12 is the keyboard's first row; Q sits at its left edge.
    const left = Math.floor((39 - (10 * 4 - 1)) / 2)
    expect(wordle.pointer?.(s0, { type: 'down', x: left, y: 12 }, ROOM)?.current).toBe('q')
  })
})

describe('store', () => {
  const outcome = (o: Partial<Outcome>): Outcome => ({ result: 'ended', ms: 1000, facts: {}, best: {}, ...o })

  test('counters add, bests keep the better, a finished game clears the save', () => {
    let r = applySave(emptyRecord(), { v: 1, at: 1, state: { a: 1 } })
    expect(r.save?.state).toEqual({ a: 1 })
    r = applyOutcome(r, outcome({ best: { score: 10, 'time.easy': 50 } }), ['time.easy'], 2)
    r = applyOutcome(r, outcome({ best: { score: 7, 'time.easy': 40 }, result: 'won' }), ['time.easy'], 3)
    expect(r.stats.played).toBe(2)
    expect(r.stats.won).toBe(1)
    expect(r.stats.best).toEqual({ score: 10, 'time.easy': 40 })
    expect(r.save).toBeUndefined()
  })

  test('two sessions writing in turn both land', () => {
    // Each write reads what the other wrote first (SPEC.md §7.4).
    let stored = emptyRecord()
    stored = applyOutcome(readRecord(stored), outcome({ best: { score: 5 } }), [], 1)
    stored = applyOutcome(readRecord(JSON.parse(JSON.stringify(stored))), outcome({ best: { score: 3 } }), [], 2)
    expect(stored.stats.played).toBe(2)
    expect(stored.stats.best.score).toBe(5)
  })

  test('a daily streak needs consecutive dates', () => {
    let r = emptyRecord()
    const day = (daily: string, won = true) => outcome({ daily, streak: won ? 'won' : 'lost', result: won ? 'won' : 'lost' })
    r = applyOutcome(r, day('2026-10-10'), [], 1)
    r = applyOutcome(r, day('2026-10-11'), [], 2)
    expect(r.stats.streak.current).toBe(2)
    r = applyOutcome(r, day('2026-10-13'), [], 3)
    expect(r.stats.streak.current).toBe(1)
    expect(r.stats.streak.best).toBe(2)
    r = applyOutcome(r, day('2026-10-14', false), [], 4)
    expect(r.stats.streak.current).toBe(0)
  })

  test('milestones keep their first date; a reset keeps them unless asked', () => {
    const r = unlock(unlock(emptyRecord(), ['a'], 1), ['a', 'b'], 2)
    expect(r.milestones).toEqual({ a: 1, b: 2 })
    expect(resetRecord(r, false).milestones).toEqual({ a: 1, b: 2 })
    expect(resetRecord(r, true).milestones).toEqual({})
  })

  test('a malformed record reads as a fresh one', () => {
    expect(readRecord('nonsense')).toEqual(emptyRecord())
    expect(readRecord({ stats: { played: 'x' } }).stats.played).toBe(0)
  })
})

describe('milestones', () => {
  test('mid-game facts unlock score milestones; count ones wait for the record', () => {
    const r = emptyRecord()
    expect(evaluate(snake.milestones, { score: 26, fill: 0.1 }, r, false)).toEqual(['first-bite', 'twenty-five'])
    const played = { ...r, stats: { ...r.stats, played: 25 } }
    expect(evaluate(snake.milestones, { score: 0 }, played, true)).toEqual(['regular'])
    expect(evaluate(mines.milestones, { won: 1, level: 0, seconds: 30, flags: 0 }, r, true)).toEqual(['cleared', 'quick', 'no-flags'])
    expect(evaluate(wordle.milestones, { solved: 1, guesses: 1, hard: 0, daily: 1 }, r, true)).toEqual([
      'solved',
      'in-three',
      'in-two',
      'hole-in-one',
    ])
  })
})
