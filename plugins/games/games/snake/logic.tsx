/** Snake (SPEC.md §10.1). */

import { blank, footprint, modeFor, paint } from '../../core/canvas'
import type { Frame } from '../../core/canvas'
import { direction } from '../../core/game'
import type { GameDef } from '../../core/game'
import { played } from '../../core/milestones'
import type { Milestone } from '../../core/milestones'
import { BOARD, GREEN, RED } from '../../core/palette'
import { int } from '../../core/rng'

type Dir = 'up' | 'down' | 'left' | 'right'
type P = [number, number]

export type SnakeState = {
  w: number
  h: number
  /** Head first. */
  body: P[]
  dir: Dir
  /** Turns pressed ahead of the next move, at most two. */
  queued: Dir[]
  food: P
  score: number
  rng: number
  /** Milliseconds banked toward the next move. */
  acc: number
  isStarted: boolean
  isOver: boolean
}

const W = 20
const H = 14
const HEAD = '#8fe39a'
const STEP: Record<Dir, P> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }

/** Moves a second: 8, plus a quarter per food, up to 16. */
export const speed = (score: number) => Math.min(16, 8 + score / 4)

function placeFood(s: Pick<SnakeState, 'w' | 'h' | 'body' | 'rng'>): { food: P; rng: number } | undefined {
  const taken = new Set(s.body.map(([x, y]) => y * s.w + x))
  const free = s.w * s.h - taken.size
  if (free <= 0) return undefined
  let [n, rng] = int(s.rng, free)
  for (let i = 0; i < s.w * s.h; i++) {
    if (taken.has(i)) continue
    if (n === 0) return { food: [i % s.w, Math.floor(i / s.w)], rng }
    n -= 1
  }

  return undefined
}

function move(s: SnakeState): SnakeState {
  const [first, ...rest] = s.queued
  const dir = first ?? s.dir
  const [hx, hy] = s.body[0] ?? [0, 0]
  const [dx, dy] = STEP[dir]
  const head: P = [hx + dx, hy + dy]
  const eats = head[0] === s.food[0] && head[1] === s.food[1]
  // The tail moves out of the way unless the snake grows this move.
  const body = eats ? s.body : s.body.slice(0, -1)
  const hitsWall = head[0] < 0 || head[1] < 0 || head[0] >= s.w || head[1] >= s.h
  const hitsSelf = body.some(([x, y]) => x === head[0] && y === head[1])
  if (hitsWall || hitsSelf) return { ...s, dir, queued: rest, isOver: true }

  const next: SnakeState = { ...s, dir, queued: rest, body: [head, ...body] }
  if (!eats) return next
  next.score += 1
  const placed = placeFood(next)
  if (!placed) return { ...next, isOver: true }

  return { ...next, food: placed.food, rng: placed.rng }
}

const milestones: Milestone[] = [
  { id: 'first-bite', name: 'First bite', goal: 'Eat once', check: f => (f.score ?? 0) >= 1 },
  { id: 'twenty-five', name: 'Twenty-five', goal: 'Score 25 in one game', check: f => (f.score ?? 0) >= 25 },
  { id: 'fifty', name: 'Fifty', goal: 'Score 50 in one game', check: f => (f.score ?? 0) >= 50 },
  { id: 'centurion', name: 'Centurion', goal: 'Score 100 in one game', check: f => (f.score ?? 0) >= 100 },
  { id: 'half-board', name: 'Half the board', goal: 'Fill half the board', check: f => (f.fill ?? 0) >= 0.5 },
  played(25),
]

export const snake: GameDef<SnakeState> = {
  id: 'snake',
  name: 'Snake',
  v: 1,
  kind: 'arcade',
  lowerIsBetter: [],
  milestones,

  init: ({ seed }) => {
    const y = Math.floor(H / 2)
    const body: P[] = [[5, y], [4, y], [3, y]]
    const placed = placeFood({ w: W, h: H, body, rng: seed })

    return {
      w: W,
      h: H,
      body,
      dir: 'right',
      queued: [],
      food: placed?.food ?? [W - 4, y],
      score: 0,
      rng: placed?.rng ?? seed,
      acc: 0,
      isStarted: false,
      isOver: false,
    }
  },

  key: (s, k) => {
    const dir = direction(k)
    if (!dir || s.isOver) return undefined
    const last = s.queued[s.queued.length - 1] ?? s.dir
    // Reversing into yourself is ignored, and so is pressing the way you already go.
    if (dir === last || dir === OPPOSITE[last]) return s.isStarted ? s : { ...s, isStarted: true }
    if (s.queued.length >= 2) return s

    return { ...s, isStarted: true, queued: [...s.queued, dir] }
  },

  tick: s => {
    if (!s.isStarted || s.isOver) return undefined
    let next: SnakeState = { ...s, acc: s.acc + 50 }
    const interval = 1000 / speed(next.score)
    while (next.acc >= interval && !next.isOver) next = { ...move(next), acc: next.acc - interval }

    return next
  },

  over: s =>
    s.isOver
      ? { result: 'ended', facts: snake.facts(s), best: { score: s.score } }
      : undefined,

  facts: s => ({ score: s.score, fill: s.body.length / (s.w * s.h) }),

  isUnderway: s => s.isStarted && !s.isOver,

  size: (s, room) => footprint(s.w, s.h, modeFor(s.w, s.h, room)),

  draw: (s, { E, room, dim }) => {
    const frame: Frame = blank(s.w, s.h)
    s.body.forEach(([x, y], i) => {
      const row = frame[y]
      if (row) row[x] = i === 0 ? HEAD : GREEN
    })
    const foodRow = frame[s.food[1]]
    if (foodRow) foodRow[s.food[0]] = { bg: BOARD, ch: '●', fg: RED }
    const mode = modeFor(s.w, s.h, room)
    if (mode === 'half' && foodRow) foodRow[s.food[0]] = RED

    return paint(E, frame, mode, dim)
  },

  status: (s, best) => `score ${s.score} · best ${Math.max(best.score ?? 0, s.score)}`,

  controls: s => (s.isStarted ? ['←↑→↓ move'] : ['←↑→↓ to start']),

  card: (s, _o, best) => ({
    title: 'Game over',
    lines: [`Score ${s.score}`, s.score > (best.score ?? 0) && s.score > 0 ? 'New best!' : `Best ${best.score ?? 0}`],
  }),
}
