/** Breakout (SPEC.md §10.3). */

import { footprint, modeFor, paint } from '../../core/canvas'
import type { Frame } from '../../core/canvas'
import { direction, isSpace } from '../../core/game'
import type { BoardRoom, GameDef } from '../../core/game'
import type { Milestone } from '../../core/milestones'
import { BOARD, CYAN, GREEN, ORANGE, RED, YELLOW } from '../../core/palette'

const W = 20
const H = 16
const COLS = 10
const ROWS = 5
const TOP = 2
const PADDLE_Y = 15
const PADDLE_W = 4
const BALL = '#ffffff'
const PADDLE = '#cfd3da'
const ROW_COLORS = [RED, ORANGE, YELLOW, GREEN, CYAN] as const
const ROW_POINTS = [7, 5, 3, 1, 1] as const

/** Five layouts, a row of 10 bricks to a string; past level 5 they come round again, faster. */
export const LAYOUTS: readonly (readonly string[])[] = [
  ['1111111111', '1111111111', '1111111111', '1111111111', '1111111111'],
  ['1010101010', '0101010101', '1010101010', '0101010101', '1010101010'],
  ['0000110000', '0001111000', '0011111100', '0111111110', '1111111111'],
  ['1100110011', '1100110011', '1100110011', '1100110011', '1100110011'],
  ['1111111111', '1000000001', '1011111101', '1000000001', '1111111111'],
]

export type BreakoutState = {
  level: number
  /** 50 characters, top row first: '1' a brick, '0' none. */
  bricks: string
  /** The paddle's left edge, in cells. */
  paddle: number
  ball: { x: number; y: number; vx: number; vy: number }
  hits: number
  hasReachedTop: boolean
  lives: number
  livesAtLevel: number
  score: number
  combo: number
  maxCombo: number
  cleared: number
  flawless: number
  isLaunched: boolean
  isStarted: boolean
  isOver: boolean
}

const layout = (level: number) => (LAYOUTS[(level - 1) % LAYOUTS.length] ?? LAYOUTS[0] ?? []).join('')

/** Cells a second: faster after 4 and 12 hits, after first reaching the top, and on every lap of the levels. */
export function speed(s: Pick<BreakoutState, 'level' | 'hits' | 'hasReachedTop'>): number {
  const lap = Math.floor((s.level - 1) / LAYOUTS.length)

  return 9 + lap + (s.hits >= 4 ? 1 : 0) + (s.hits >= 12 ? 1 : 0) + (s.hasReachedTop ? 1 : 0)
}

/** The ball on the paddle, waiting to be launched. */
function onPaddle(s: BreakoutState): BreakoutState {
  return { ...s, ball: { x: s.paddle + PADDLE_W / 2, y: PADDLE_Y - 0.5, vx: 0.45, vy: -0.89 }, isLaunched: false }
}

function brickAt(s: BreakoutState, x: number, y: number): number {
  const row = Math.floor(y) - TOP
  const col = Math.floor(x / 2)
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return -1
  const i = row * COLS + col

  return s.bricks[i] === '1' ? i : -1
}

function step(s0: BreakoutState, d: number): BreakoutState {
  const s = { ...s0, ball: { ...s0.ball } }
  const b = s.ball
  let nx = b.x + b.vx * d
  let ny = b.y + b.vy * d
  if (nx < 0) {
    nx = -nx
    b.vx = -b.vx
  }
  if (nx >= W) {
    nx = 2 * W - nx - 0.001
    b.vx = -b.vx
  }
  if (ny < 0) {
    ny = -ny
    b.vy = -b.vy
  }
  if (ny < TOP && !s.hasReachedTop) s.hasReachedTop = true

  const hit = brickAt(s, nx, ny)
  if (hit >= 0) {
    const row = Math.floor(hit / COLS)
    s.bricks = s.bricks.slice(0, hit) + '0' + s.bricks.slice(hit + 1)
    s.score += ROW_POINTS[row] ?? 1
    s.combo += 1
    s.maxCombo = Math.max(s.maxCombo, s.combo)
    // Bounce off the side the ball came through.
    if (Math.floor(b.y) !== Math.floor(ny)) b.vy = -b.vy
    else b.vx = -b.vx

    return s
  }

  if (b.vy > 0 && b.y < PADDLE_Y && ny >= PADDLE_Y && nx >= s.paddle - 0.5 && nx < s.paddle + PADDLE_W + 0.5) {
    // Where it lands on the paddle sets the angle: up to 60° either side.
    const offset = Math.max(-1, Math.min(1, ((nx - s.paddle) / PADDLE_W) * 2 - 1))
    const angle = (offset * Math.PI) / 3
    b.vx = Math.sin(angle)
    b.vy = -Math.cos(angle)
    b.x = nx
    b.y = PADDLE_Y - 0.01
    s.hits += 1
    s.combo = 0

    return s
  }

  if (ny >= H) {
    const lives = s.lives - 1
    if (lives <= 0) return { ...s, lives: 0, isOver: true }

    return onPaddle({ ...s, lives, combo: 0 })
  }

  b.x = nx
  b.y = ny

  return s
}

function nextLevel(s: BreakoutState): BreakoutState {
  const level = s.level + 1

  return onPaddle({
    ...s,
    level,
    bricks: layout(level),
    hits: 0,
    hasReachedTop: false,
    cleared: s.cleared + 1,
    flawless: s.flawless + (s.lives === s.livesAtLevel ? 1 : 0),
    livesAtLevel: s.lives,
    combo: 0,
  })
}

function movePaddle(s: BreakoutState, left: number): BreakoutState {
  const paddle = Math.max(0, Math.min(W - PADDLE_W, left))
  const moved = { ...s, paddle }

  return s.isLaunched ? moved : onPaddle(moved)
}

function launch(s: BreakoutState): BreakoutState {
  if (s.isLaunched || s.isOver) return s

  return { ...s, isLaunched: true, isStarted: true }
}

const milestones: Milestone[] = [
  { id: 'breakthrough', name: 'Breakthrough', goal: 'Clear level 1', check: f => (f.cleared ?? 0) >= 1 },
  { id: 'level-3', name: 'Level 3', goal: 'Clear level 3', check: f => (f.cleared ?? 0) >= 3 },
  { id: 'all-five', name: 'All five', goal: 'Clear level 5', check: f => (f.cleared ?? 0) >= 5 },
  { id: 'flawless', name: 'Flawless', goal: 'Clear a level without losing a life', check: f => (f.flawless ?? 0) >= 1 },
  { id: 'combo', name: 'Combo', goal: 'Break 8 bricks between two paddle hits', check: f => (f.maxCombo ?? 0) >= 8 },
  { id: 'thousand', name: 'Thousand', goal: 'Score 1,000 in one game', check: f => (f.score ?? 0) >= 1000 },
]

const modeOf = (room: BoardRoom) => modeFor(W, H, room)

export const breakout: GameDef<BreakoutState> = {
  id: 'breakout',
  name: 'Breakout',
  v: 1,
  kind: 'arcade',
  wantsHover: true,
  lowerIsBetter: [],
  milestones,

  init: () =>
    onPaddle({
      level: 1,
      bricks: layout(1),
      paddle: (W - PADDLE_W) / 2,
      ball: { x: 0, y: 0, vx: 0, vy: 0 },
      hits: 0,
      hasReachedTop: false,
      lives: 3,
      livesAtLevel: 3,
      score: 0,
      combo: 0,
      maxCombo: 0,
      cleared: 0,
      flawless: 0,
      isLaunched: false,
      isStarted: false,
      isOver: false,
    }),

  key: (s, k) => {
    if (s.isOver) return undefined
    const dir = direction(k)
    if (dir === 'left' || dir === 'right') return movePaddle(s, Math.round(s.paddle) + (dir === 'left' ? -2 : 2))
    if (isSpace(k) || dir === 'up') return launch(s)

    return undefined
  },

  pointer: (s, p, room) => {
    if (s.isOver) return undefined
    const cell = modeOf(room) === 'box' ? p.x / 2 : p.x
    const moved = movePaddle(s, Math.round(cell - PADDLE_W / 2))
    if (p.type === 'down') return launch(moved)

    return moved.paddle === s.paddle ? undefined : moved
  },

  tick: s => {
    if (!s.isLaunched || s.isOver) return undefined
    let next = s
    const dist = (speed(s) * 50) / 1000
    const steps = Math.ceil(dist / 0.4)
    for (let i = 0; i < steps && next.isLaunched && !next.isOver; i++) next = step(next, dist / steps)
    if (!next.isOver && !next.bricks.includes('1')) next = nextLevel(next)

    return next
  },

  over: s => (s.isOver ? { result: 'ended', facts: breakout.facts(s), best: { score: s.score, level: s.level } } : undefined),

  facts: s => ({ score: s.score, cleared: s.cleared, flawless: s.flawless, maxCombo: s.maxCombo }),

  isUnderway: s => s.isStarted && !s.isOver,

  size: (_s, room) => footprint(W, H, modeOf(room)),

  draw: (s, { E, room, dim }) => {
    const frame: Frame = Array.from({ length: H }, () => Array.from({ length: W }, () => BOARD))
    for (let i = 0; i < s.bricks.length; i++) {
      if (s.bricks[i] !== '1') continue
      const row = Math.floor(i / COLS)
      const col = i % COLS
      const line = frame[TOP + row]
      if (line) {
        line[col * 2] = ROW_COLORS[row] ?? RED
        line[col * 2 + 1] = ROW_COLORS[row] ?? RED
      }
    }
    const paddleRow = frame[PADDLE_Y]
    if (paddleRow) for (let x = 0; x < PADDLE_W; x++) paddleRow[Math.round(s.paddle) + x] = PADDLE
    if (!s.isOver) {
      const ballRow = frame[Math.min(H - 1, Math.max(0, Math.floor(s.ball.y)))]
      if (ballRow) ballRow[Math.min(W - 1, Math.max(0, Math.floor(s.ball.x)))] = BALL
    }

    return paint(E, frame, modeOf(room), dim)
  },

  status: (s, best) => `level ${s.level} · ${'♥'.repeat(s.lives)} · score ${s.score} · best ${Math.max(best.score ?? 0, s.score)}`,

  controls: s => (s.isLaunched ? ['←→ or mouse'] : ['space or click to launch', '←→ or mouse']),

  card: (s, _o, best) => ({
    title: 'Game over',
    lines: [`${s.score} points · level ${s.level}`, s.score > (best.score ?? 0) && s.score > 0 ? 'new best!' : `best ${best.score ?? 0}`],
  }),
}
