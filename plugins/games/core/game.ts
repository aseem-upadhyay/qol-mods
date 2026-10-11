/**
 * What a game is to the board (SPEC.md §6.1): pure functions over a plain JSON
 * state, so a save is the state itself and a test needs no engine.
 */

import type { ClientElements, RenderElement } from 'claude-code'

import type { Facts, GameId, GameRecord, Outcome, Room, Settings } from '../types'
import type { Milestone } from './milestones'

/** A key as the board hands it on: `Client` `onKey`'s shape. */
export type Key = { key: string; shift?: boolean; ctrl?: boolean; meta?: boolean }

/** A pointer event, in cells of the board: `x` in columns, `y` in rows, both from the board's top-left. */
export type Point = { type: 'down' | 'up' | 'move'; x: number; y: number; shift?: boolean }

/** Room for the board itself: the pane less the header and footer lines. */
export type BoardRoom = Pick<Room, 'surface'> & { columns: number; rows: number }

export type DrawContext = {
  E: ClientElements
  room: BoardRoom
  settings: Settings
  /** A paused or finished board is drawn dimmed. */
  dim: boolean
}

export type InitContext = {
  seed: number
  room: BoardRoom
  settings: Settings
  /** Today's local date, YYYY-MM-DD. */
  today: string
  /** What the player picked last time (difficulty, mode), carried into a new game. */
  previous?: unknown
  /** The game's record: Wordle reads whether today's daily is done. */
  record: GameRecord
  /** Asked for explicitly (Wordle's N): a practice game rather than the daily. */
  isPractice?: boolean
}

export type GameDef<S> = {
  id: GameId
  name: string
  /** The save version: a save of another version is dropped (SPEC.md §7.3). */
  v: number
  /** Arcade games tick, pause, and save on a timer; turn games save on every move (SPEC.md §7.2). */
  kind: 'arcade' | 'turn'
  /** A turn game with a running clock (Minesweeper): it pauses like an arcade game. */
  isTimed?: boolean
  /** Letters are the game's input (Wordle): the common commands take shift (H, T, Q, N). */
  isWordy?: boolean
  /** Best keys where lower is better ('time.easy', 'guesses'). */
  lowerIsBetter: readonly string[]
  milestones: readonly Milestone[]
  init: (ctx: InitContext) => S
  /** A new state, or undefined when the key means nothing to the game. */
  key: (s: S, k: Key) => S | undefined
  pointer?: (s: S, p: Point, room: BoardRoom) => S | undefined
  /** Every 50 ms while the game runs; undefined when nothing changed. */
  tick?: (s: S) => S | undefined
  /** The outcome once the game has ended, else undefined. */
  over: (s: S) => Omit<Outcome, 'ms'> | undefined
  /** Numbers for milestones checked mid-game (on each save). */
  facts: (s: S) => Facts
  /** Whether a game is under way, so `r` asks before restarting. */
  isUnderway: (s: S) => boolean
  /** The board's size in columns and rows, for the layout around it. */
  size: (s: S, room: BoardRoom) => { columns: number; rows: number }
  draw: (s: S, ctx: DrawContext) => RenderElement
  /** The header's right side: "score 14 · best 61". */
  status: (s: S, best: Record<string, number>) => string
  /** The footer's controls, most important first: dropped from the end when narrow. */
  controls: (s: S) => readonly string[]
  /** The game-over card's lines below its title. */
  card: (s: S, outcome: Omit<Outcome, 'ms'>, best: Record<string, number>) => { title: string; lines: string[] }
  /** Wordle's daily puzzle: the date a state belongs to, saved apart from practice games. */
  daily?: (s: S) => string | undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGame = GameDef<any>

/** Whether a key is one of the arrows or its WASD twin, as a direction. */
export function direction(k: Key): 'up' | 'down' | 'left' | 'right' | undefined {
  const key = k.key.toLowerCase()
  if (key === 'up' || key === 'w') return 'up'
  if (key === 'down' || key === 's') return 'down'
  if (key === 'left' || key === 'a') return 'left'
  if (key === 'right' || key === 'd') return 'right'

  return undefined
}

export const isSpace = (k: Key) => k.key === ' ' || k.key === 'space'
export const isEnter = (k: Key) => k.key === 'return' || k.key === 'enter'
