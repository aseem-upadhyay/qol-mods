/** Dino Run (SPEC.md §10.4): jump the cacti, duck the birds, run as far as you can. */

import { footprint, paint } from '../../core/canvas'
import type { Frame } from '../../core/canvas'
import { direction, isSpace } from '../../core/game'
import type { GameDef } from '../../core/game'
import { played } from '../../core/milestones'
import type { Milestone } from '../../core/milestones'
import { BOARD, GREEN, INK, ORANGE } from '../../core/palette'
import { int } from '../../core/rng'

const W = 21
const H = 10
const GROUND = H - 1
const DINO_X = 3
/** A jump: cells a second up at the start, and the pull down. Peaks near 2.8 cells. */
const JUMP_V = 15
const GRAVITY = 40
const DUCK_MS = 400
/** Birds fly low (jump them), at head height (duck or jump), or high (run under). */
const BIRD_ROWS = [GROUND - 1, GROUND - 2, GROUND - 4] as const

type Obstacle = { x: number; w: number; h: number; row?: number; isPassed?: boolean }

export type DinoState = {
  /** Height above the ground, in cells, and speed up. */
  y: number
  vy: number
  duckMs: number
  obstacles: Obstacle[]
  /** Distance run, in cells; the score follows from it. */
  dist: number
  untilNext: number
  cleared: number
  rng: number
  isStarted: boolean
  isOver: boolean
}

/** About 10 points a second at the starting speed. */
export const scoreOf = (s: Pick<DinoState, 'dist'>) => Math.floor(s.dist * 1.25)
/** Cells a second: 8, up to 20 as the score grows. */
export const speedOf = (s: Pick<DinoState, 'dist'>) => Math.min(20, 8 + scoreOf(s) / 150)
/** Every 700 points the colors turn for the next 100: night. */
export const isNight = (score: number) => score >= 700 && score % 700 < 100

function dinoCells(s: DinoState): [number, number][] {
  const lift = Math.floor(s.y)
  const isDucking = s.duckMs > 0 && s.y === 0

  return isDucking ? [[DINO_X, GROUND - 1]] : [[DINO_X, GROUND - 1 - lift], [DINO_X, GROUND - 2 - lift]]
}

function obstacleCells(o: Obstacle): [number, number][] {
  const out: [number, number][] = []
  const left = Math.round(o.x)
  for (let dx = 0; dx < o.w; dx++) {
    if (o.row !== undefined) out.push([left + dx, o.row])
    else for (let dy = 0; dy < o.h; dy++) out.push([left + dx, GROUND - 1 - dy])
  }

  return out
}

function spawn(s: DinoState): DinoState {
  const score = scoreOf(s)
  let rng = s.rng
  const roll = (n: number) => {
    const [v, next] = int(rng, n)
    rng = next

    return v
  }
  const isBird = score >= 400 && roll(4) === 0
  const obstacle: Obstacle = isBird
    ? { x: W, w: 1, h: 1, row: BIRD_ROWS[roll(BIRD_ROWS.length)] ?? GROUND - 1 }
    : { x: W, w: 1 + roll(3), h: 1 + roll(2) }
  // Gaps grow with speed, so there's always room to land between jumps.
  const gap = 8 + roll(7) + Math.floor(speedOf(s) * 0.35)

  return { ...s, obstacles: [...s.obstacles, obstacle], untilNext: gap + obstacle.w, rng }
}

function jump(s: DinoState): DinoState {
  if (s.isOver) return s
  const started = s.isStarted ? s : { ...s, isStarted: true }

  return started.y === 0 ? { ...started, vy: JUMP_V, duckMs: 0 } : started
}

const milestones: Milestone[] = [
  { id: 'hop', name: 'Hop', goal: 'Jump your first cactus', check: f => (f.cleared ?? 0) >= 1 },
  { id: 'five-hundred', name: 'Five hundred', goal: 'Score 500', check: f => (f.score ?? 0) >= 500 },
  { id: 'night-run', name: 'Night run', goal: 'Reach the first night (700)', check: f => (f.score ?? 0) >= 700 },
  { id: 'two-thousand', name: 'Two thousand', goal: 'Score 2,000', check: f => (f.score ?? 0) >= 2000 },
  { id: 'fifty-jumps', name: 'Fifty jumps', goal: 'Clear 50 obstacles in one run', check: f => (f.cleared ?? 0) >= 50 },
  played(25, 'regular', 'Regular', 'Play 25 runs'),
]

export const dino: GameDef<DinoState> = {
  id: 'dino',
  name: 'Dino Run',
  v: 1,
  kind: 'arcade',
  lowerIsBetter: [],
  milestones,

  init: ({ seed }) => ({ y: 0, vy: 0, duckMs: 0, obstacles: [], dist: 0, untilNext: 12, cleared: 0, rng: seed, isStarted: false, isOver: false }),

  key: (s, k) => {
    const dir = direction(k)
    if (isSpace(k) || dir === 'up') return jump(s)
    if (dir === 'down' && s.isStarted && !s.isOver) return { ...s, duckMs: DUCK_MS, vy: s.y > 0 ? Math.min(s.vy, -JUMP_V) : s.vy }

    return undefined
  },

  pointer: (s, p) => (p.type === 'down' ? jump(s) : undefined),

  tick: s0 => {
    if (!s0.isStarted || s0.isOver) return undefined
    const dt = 0.05
    let s: DinoState = { ...s0, duckMs: Math.max(0, s0.duckMs - 50) }
    // The dino rises and falls.
    if (s.y > 0 || s.vy > 0) {
      const vy = s.vy - GRAVITY * dt
      const y = s.y + s.vy * dt
      s = y <= 0 ? { ...s, y: 0, vy: 0 } : { ...s, y, vy }
    }
    // The ground scrolls.
    const move = speedOf(s) * dt
    let cleared = s.cleared
    const obstacles = s.obstacles
      .map(o => {
        const x = o.x - move
        if (!o.isPassed && x + o.w <= DINO_X) {
          cleared += 1

          return { ...o, x, isPassed: true }
        }

        return { ...o, x }
      })
      .filter(o => o.x + o.w > -1)
    s = { ...s, obstacles, cleared, dist: s.dist + move, untilNext: s.untilNext - move }
    if (s.untilNext <= 0) s = spawn(s)

    const body = dinoCells(s)
    const isHit = s.obstacles.some(o => obstacleCells(o).some(([ox, oy]) => body.some(([bx, by]) => bx === ox && by === oy)))

    return isHit ? { ...s, isOver: true } : s
  },

  over: s => (s.isOver ? { result: 'ended', facts: dino.facts(s), best: { score: scoreOf(s) } } : undefined),

  facts: s => ({ score: scoreOf(s), cleared: s.cleared }),

  isUnderway: s => s.isStarted && !s.isOver,

  size: () => footprint(W, H, 'box'),

  draw: (s, { E, dim }) => {
    const night = isNight(scoreOf(s))
    const sky = night ? '#d9dce3' : BOARD
    const ground = night ? '#9aa0a6' : '#4a4f5c'
    const body = night ? '#2b2e37' : INK
    const cactus = night ? '#3f8f4a' : GREEN
    const frame: Frame = Array.from({ length: H }, (_, y) => Array.from({ length: W }, () => (y === GROUND ? ground : sky)))
    for (const o of s.obstacles)
      for (const [x, y] of obstacleCells(o)) {
        const row = frame[y]
        if (row && x >= 0 && x < W) row[x] = o.row !== undefined ? ORANGE : cactus
      }
    for (const [x, y] of dinoCells(s)) {
      const row = frame[y]
      if (row && y >= 0) row[x] = body
    }

    return paint(E, frame, 'box', dim)
  },

  status: (s, best) => `${String(scoreOf(s)).padStart(5, '0')} · best ${Math.max(best.score ?? 0, scoreOf(s))}`,

  controls: s => (s.isStarted ? ['space or ↑ jump', '↓ duck', 'click jumps'] : ['space to start']),

  card: (s, _o, best) => ({
    title: 'Game over',
    lines: [`${scoreOf(s)} points`, `${s.cleared} cleared`, scoreOf(s) > (best.score ?? 0) && scoreOf(s) > 0 ? 'new best!' : `best ${best.score ?? 0}`],
  }),
}
