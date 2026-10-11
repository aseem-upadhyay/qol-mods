/** Pong (SPEC.md §10.5): you're the left paddle, first to 7. */

import { footprint, paint } from '../../core/canvas'
import type { Frame } from '../../core/canvas'
import { direction, isSpace } from '../../core/game'
import type { GameDef } from '../../core/game'
import type { Milestone } from '../../core/milestones'
import { BOARD, CYAN, EDGE, ORANGE } from '../../core/palette'
import { next } from '../../core/rng'

const W = 21
const H = 13
const PADDLE_H = 3
const TO_WIN = 7
const BALL = '#ffffff'
export const LEVELS = ['Easy', 'Normal', 'Hard'] as const
/** The bot per level: cells it moves a tick, ticks between looks at the ball, and how far off it aims. */
const BOT = [
  { speed: 0.22, every: 6, error: 1.6 },
  { speed: 0.32, every: 4, error: 0.9 },
  { speed: 0.48, every: 2, error: 0.35 },
] as const
const SERVE_TICKS = 16

export type PongState = {
  level: number
  /** Each paddle's top row, in cells. */
  me: number
  bot: number
  botTarget: number
  ball: { x: number; y: number; vx: number; vy: number }
  /** Cells a second. */
  speed: number
  myScore: number
  botScore: number
  rally: number
  maxRally: number
  /** Ticks before the next serve, and which way it goes. */
  serveIn: number
  serveTo: 1 | -1
  ticks: number
  rng: number
  isStarted: boolean
  isOver: boolean
}

const center = (top: number) => top + PADDLE_H / 2
const clampPaddle = (top: number) => Math.max(0, Math.min(H - PADDLE_H, top))

function serve(s: PongState): PongState {
  const [f, rng] = next(s.rng)
  const angle = (f - 0.5) * 0.9

  return {
    ...s,
    rng,
    speed: 8,
    rally: 0,
    ball: { x: W / 2, y: H / 2, vx: Math.cos(angle) * s.serveTo, vy: Math.sin(angle) },
    serveIn: 0,
  }
}

/** A paddle sends the ball back: the farther from its middle, the steeper, and a little faster each time. */
function bounce(s: PongState, top: number, dir: 1 | -1): PongState {
  const offset = Math.max(-1, Math.min(1, (s.ball.y - center(top)) / (PADDLE_H / 2 + 0.5)))
  const angle = offset * 1.0
  const rally = s.rally + 1

  return {
    ...s,
    ball: { x: dir === 1 ? 1.01 : W - 1.01, y: s.ball.y, vx: Math.cos(angle) * dir, vy: Math.sin(angle) },
    speed: Math.min(16, s.speed + 0.4),
    rally,
    maxRally: Math.max(s.maxRally, rally),
  }
}

function point(s: PongState, isMine: boolean): PongState {
  const myScore = s.myScore + (isMine ? 1 : 0)
  const botScore = s.botScore + (isMine ? 0 : 1)
  const isOver = myScore >= TO_WIN || botScore >= TO_WIN

  return { ...s, myScore, botScore, isOver, serveIn: SERVE_TICKS, serveTo: isMine ? 1 : -1, ball: { x: W / 2, y: H / 2, vx: 0, vy: 0 } }
}

function step(s0: PongState, d: number): PongState {
  let s = { ...s0, ball: { ...s0.ball } }
  const b = s.ball
  let nx = b.x + b.vx * d
  let ny = b.y + b.vy * d
  if (ny < 0) {
    ny = -ny
    b.vy = -b.vy
  }
  if (ny >= H) {
    ny = 2 * H - ny - 0.001
    b.vy = -b.vy
  }
  b.y = ny
  if (nx < 1 && b.vx < 0) {
    if (ny >= s.me - 0.5 && ny < s.me + PADDLE_H + 0.5) return bounce(s, s.me, 1)
    if (nx < 0) return point(s, false)
  }
  if (nx >= W - 1 && b.vx > 0) {
    if (ny >= s.bot - 0.5 && ny < s.bot + PADDLE_H + 0.5) return bounce(s, s.bot, -1)
    if (nx >= W) return point(s, true)
  }
  b.x = nx
  s = { ...s, ball: b }

  return s
}

/** The bot looks at the ball every few ticks and heads for where it is, give or take its error. */
function moveBot(s: PongState): PongState {
  const bot = BOT[s.level] ?? BOT[0]
  let target = s.botTarget
  let rng = s.rng
  if (s.ticks % bot.every === 0) {
    const [f, r] = next(rng)
    rng = r
    const aim = s.ball.vx > 0 ? s.ball.y : H / 2
    target = aim + (f - 0.5) * 2 * bot.error - PADDLE_H / 2
  }
  const delta = Math.max(-bot.speed, Math.min(bot.speed, target - s.bot))

  return { ...s, bot: clampPaddle(s.bot + delta), botTarget: target, rng }
}

const won = (f: Record<string, number>) => f.won === 1

const milestones: Milestone[] = [
  { id: 'first-point', name: 'First point', goal: 'Score a point', check: f => (f.myScore ?? 0) >= 1 },
  { id: 'first-win', name: 'First win', goal: 'Win a match', check: won },
  { id: 'normal', name: 'Normal', goal: 'Win on Normal', check: f => won(f) && (f.level ?? 0) >= 1 },
  { id: 'hard', name: 'Hard', goal: 'Win on Hard', check: f => won(f) && f.level === 2 },
  { id: 'rally', name: 'Rally', goal: 'A 20-hit rally', check: f => (f.maxRally ?? 0) >= 20 },
  { id: 'shutout', name: 'Shutout', goal: 'Win 7–0', check: f => won(f) && f.botScore === 0 },
]

export const pong: GameDef<PongState> = {
  id: 'pong',
  name: 'Pong',
  v: 1,
  kind: 'arcade',
  wantsHover: true,
  lowerIsBetter: [],
  milestones,

  init: ({ seed, previous }) => ({
    level: (previous as Partial<PongState> | undefined)?.level ?? 0,
    me: (H - PADDLE_H) / 2,
    bot: (H - PADDLE_H) / 2,
    botTarget: (H - PADDLE_H) / 2,
    ball: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
    speed: 8,
    myScore: 0,
    botScore: 0,
    rally: 0,
    maxRally: 0,
    serveIn: 0,
    serveTo: -1,
    ticks: 0,
    rng: seed,
    isStarted: false,
    isOver: false,
  }),

  key: (s, k) => {
    if (s.isOver) return undefined
    if (!s.isStarted && ['1', '2', '3'].includes(k.key)) return { ...s, level: Number(k.key) - 1 }
    const dir = direction(k)
    if (dir === 'up' || dir === 'down') {
      const moved = { ...s, me: clampPaddle(Math.round(s.me) + (dir === 'up' ? -1 : 1)) }

      return s.isStarted ? moved : serve({ ...moved, isStarted: true })
    }
    if (isSpace(k) && !s.isStarted) return serve({ ...s, isStarted: true })

    return undefined
  },

  pointer: (s, p) => {
    if (s.isOver) return undefined
    const moved = { ...s, me: clampPaddle(Math.round(p.y - PADDLE_H / 2)) }
    if (p.type === 'down' && !s.isStarted) return serve({ ...moved, isStarted: true })

    return moved.me === s.me ? undefined : moved
  },

  tick: s0 => {
    if (!s0.isStarted || s0.isOver) return undefined
    let s = moveBot({ ...s0, ticks: s0.ticks + 1 })
    if (s.serveIn > 0) return s.serveIn === 1 ? serve(s) : { ...s, serveIn: s.serveIn - 1 }
    const dist = (s.speed * 50) / 1000
    const steps = Math.ceil(dist / 0.4)
    for (let i = 0; i < steps && s.serveIn === 0 && !s.isOver; i++) s = step(s, dist / steps)

    return s
  },

  over: s =>
    s.isOver
      ? { result: s.myScore > s.botScore ? 'won' : 'lost', facts: pong.facts(s), best: { rally: s.maxRally } }
      : undefined,

  facts: s => ({
    won: s.isOver && s.myScore > s.botScore ? 1 : 0,
    level: s.level,
    myScore: s.myScore,
    botScore: s.botScore,
    maxRally: s.maxRally,
  }),

  isUnderway: s => s.isStarted && !s.isOver,

  size: () => footprint(W, H, 'box'),

  draw: (s, { E, dim }) => {
    const frame: Frame = Array.from({ length: H }, (_, y) =>
      Array.from({ length: W }, (_, x) => (x === Math.floor(W / 2) && y % 2 === 0 ? EDGE : BOARD)),
    )
    for (let dy = 0; dy < PADDLE_H; dy++) {
      const mine = frame[Math.round(s.me) + dy]
      if (mine) mine[0] = CYAN
      const theirs = frame[Math.round(s.bot) + dy]
      if (theirs) theirs[W - 1] = ORANGE
    }
    if (s.isStarted && s.serveIn === 0 && !s.isOver) {
      const row = frame[Math.min(H - 1, Math.max(0, Math.floor(s.ball.y)))]
      if (row) row[Math.min(W - 1, Math.max(0, Math.floor(s.ball.x)))] = BALL
    }

    return paint(E, frame, 'box', dim)
  },

  status: s => `${LEVELS[s.level] ?? 'Easy'} · you ${s.myScore} – ${s.botScore} bot`,

  controls: s => (s.isStarted ? ['↑↓ or mouse'] : ['space or click to serve', '1 2 3 level', '↑↓ or mouse']),

  card: s =>
    s.myScore > s.botScore
      ? { title: 'You win!', lines: [`${s.myScore}–${s.botScore} on ${LEVELS[s.level]}`, `longest rally ${s.maxRally}`] }
      : { title: 'The bot wins', lines: [`${s.myScore}–${s.botScore} on ${LEVELS[s.level]}`, `longest rally ${s.maxRally}`] },
}
