/** Tetris (SPEC.md §10.2): SRS rotation with wall kicks, a 7-bag, hold, a ghost piece. */

import { footprint, modeFor, paint } from '../../core/canvas'
import type { Frame, Mode } from '../../core/canvas'
import { isSpace } from '../../core/game'
import type { BoardRoom, GameDef } from '../../core/game'
import type { Milestone } from '../../core/milestones'
import { BOARD, dim as dimmed } from '../../core/palette'
import { int } from '../../core/rng'

type Kind = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L'
type Cell = [number, number]

const W = 10
const H = 20
const KINDS: readonly Kind[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']
export const COLORS: Record<Kind, string> = {
  I: '#4fc1e9',
  O: '#f6c445',
  T: '#a77de8',
  S: '#5fbf6a',
  Z: '#e5534b',
  J: '#4a8fe7',
  L: '#f08c3a',
}
const GHOST = '#33363f'
const WELL = '#22252c'

/** Each piece's cells in its 4 rotations, SRS's, x right and y down in a 4×4 box. */
const SHAPES: Record<Kind, readonly (readonly Cell[])[]> = {
  I: [[[0, 1], [1, 1], [2, 1], [3, 1]], [[2, 0], [2, 1], [2, 2], [2, 3]], [[0, 2], [1, 2], [2, 2], [3, 2]], [[1, 0], [1, 1], [1, 2], [1, 3]]],
  O: [[[1, 0], [2, 0], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [2, 1]]],
  T: [[[1, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [2, 1], [1, 2]], [[0, 1], [1, 1], [2, 1], [1, 2]], [[1, 0], [0, 1], [1, 1], [1, 2]]],
  S: [[[1, 0], [2, 0], [0, 1], [1, 1]], [[1, 0], [1, 1], [2, 1], [2, 2]], [[1, 1], [2, 1], [0, 2], [1, 2]], [[0, 0], [0, 1], [1, 1], [1, 2]]],
  Z: [[[0, 0], [1, 0], [1, 1], [2, 1]], [[2, 0], [1, 1], [2, 1], [1, 2]], [[0, 1], [1, 1], [1, 2], [2, 2]], [[1, 0], [0, 1], [1, 1], [0, 2]]],
  J: [[[0, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [1, 2]], [[0, 1], [1, 1], [2, 1], [2, 2]], [[1, 0], [1, 1], [0, 2], [1, 2]]],
  L: [[[2, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [1, 2], [2, 2]], [[0, 1], [1, 1], [2, 1], [0, 2]], [[0, 0], [1, 0], [1, 1], [1, 2]]],
}

/** SRS wall kicks by rotation, from → to, as (x, y up): tried in order. */
const KICKS: Record<string, readonly Cell[]> = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
}
const KICKS_I: Record<string, readonly Cell[]> = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
}

const LOCK_MS = 500
const MAX_RESETS = 15
const LINE_SCORE = [0, 100, 300, 500, 800] as const

export type Piece = { kind: Kind; r: number; x: number; y: number }

export type TetrisState = {
  /** 200 characters, top row first: '.' or the kind of the block there. */
  grid: string
  piece: Piece
  /** The pieces to come, the first shown as "next". */
  queue: Kind[]
  hold: Kind | ''
  canHold: boolean
  rng: number
  level: number
  lines: number
  score: number
  /** Milliseconds banked toward the next row down. */
  acc: number
  /** Milliseconds the piece has rested on something, and how often moving reset that. */
  lockMs: number
  resets: number
  tetrises: number
  sweeps: number
  isStarted: boolean
  isOver: boolean
}

const cells = (p: Piece): Cell[] => (SHAPES[p.kind][p.r] ?? []).map(([cx, cy]) => [p.x + cx, p.y + cy])

/** Whether a piece fits: inside the walls and floor, on no block. Above the top is open. */
export function fits(grid: string, p: Piece): boolean {
  return cells(p).every(([x, y]) => x >= 0 && x < W && y < H && (y < 0 || grid[y * W + x] === '.'))
}

/** Seconds a row takes to fall at a level, by the guideline's curve. */
export const gravityMs = (level: number) => 1000 * Math.pow(Math.max(0.05, 0.8 - (level - 1) * 0.007), level - 1)

function refill(queue: Kind[], rng: number): { queue: Kind[]; rng: number } {
  let out = queue
  let seed = rng
  // A 7-bag: every kind once, shuffled, so a long wait for an I can't happen.
  while (out.length < 7) {
    const bag = [...KINDS]
    for (let i = bag.length - 1; i > 0; i--) {
      const [j, next] = int(seed, i + 1)
      seed = next
      const t = bag[i] ?? 'I'
      bag[i] = bag[j] ?? 'I'
      bag[j] = t
    }
    out = [...out, ...bag]
  }

  return { queue: out, rng: seed }
}

const spawnOf = (kind: Kind): Piece => ({ kind, r: 0, x: 3, y: kind === 'I' ? -1 : 0 })

/** The next piece comes in; if it can't, the game is over. */
function spawn(s: TetrisState, kind?: Kind): TetrisState {
  const filled = refill(s.queue, s.rng)
  const [first = 'I', ...rest] = filled.queue
  const piece = spawnOf(kind ?? first)
  const queue = kind ? filled.queue : rest
  const next = { ...s, piece, queue, rng: filled.rng, acc: 0, lockMs: 0, resets: 0 }

  return fits(s.grid, piece) ? next : { ...next, isOver: true }
}

function lock(s: TetrisState): TetrisState {
  const grid = s.grid.split('')
  let isAbove = false
  for (const [x, y] of cells(s.piece)) {
    if (y < 0) isAbove = true
    else grid[y * W + x] = s.piece.kind
  }
  const rows: string[] = []
  for (let y = 0; y < H; y++) rows.push(grid.slice(y * W, y * W + W).join(''))
  const kept = rows.filter(row => row.includes('.'))
  const cleared = H - kept.length
  const next = '.'.repeat(W * cleared) + kept.join('')
  const lines = s.lines + cleared
  const locked: TetrisState = {
    ...s,
    grid: next,
    lines,
    level: 1 + Math.floor(lines / 10),
    score: s.score + (LINE_SCORE[cleared] ?? 800) * s.level,
    tetrises: s.tetrises + (cleared === 4 ? 1 : 0),
    sweeps: s.sweeps + (cleared > 0 && !next.split('').some(c => c !== '.') ? 1 : 0),
    canHold: true,
  }
  if (isAbove) return { ...locked, isOver: true }

  return spawn(locked)
}

function shift(s: TetrisState, dx: number, dy: number): TetrisState | undefined {
  const piece = { ...s.piece, x: s.piece.x + dx, y: s.piece.y + dy }
  if (!fits(s.grid, piece)) return undefined
  const isResting = !fits(s.grid, { ...piece, y: piece.y + 1 })
  // Moving a resting piece buys time before it locks, a limited number of times.
  const canReset = dy === 0 && s.resets < MAX_RESETS

  return { ...s, piece, lockMs: canReset || !isResting ? 0 : s.lockMs, resets: s.resets + (canReset && isResting ? 1 : 0) }
}

export function rotate(s: TetrisState, dir: 1 | -1): TetrisState {
  const to = (s.piece.r + dir + 4) % 4
  const table = s.piece.kind === 'I' ? KICKS_I : KICKS
  for (const [kx, ky] of table[`${s.piece.r}>${to}`] ?? [[0, 0]]) {
    const piece = { ...s.piece, r: to, x: s.piece.x + kx, y: s.piece.y - ky }
    if (fits(s.grid, piece)) return { ...s, piece, lockMs: s.resets < MAX_RESETS ? 0 : s.lockMs, resets: s.resets + 1 }
  }

  return s
}

export function hardDrop(s: TetrisState): TetrisState {
  let piece = s.piece
  let rows = 0
  while (fits(s.grid, { ...piece, y: piece.y + 1 })) {
    piece = { ...piece, y: piece.y + 1 }
    rows += 1
  }

  return lock({ ...s, piece, score: s.score + rows * 2 })
}

const ghostOf = (s: TetrisState): Piece => {
  let piece = s.piece
  while (fits(s.grid, { ...piece, y: piece.y + 1 })) piece = { ...piece, y: piece.y + 1 }

  return piece
}

/** The side column: 5 cells wide in Box cells, as wide in columns in half-blocks. */
const SIDE = 5

function mini(kind: Kind | ''): Frame {
  const frame: Frame = Array.from({ length: 2 }, () => Array.from({ length: 4 }, () => BOARD))
  if (!kind) return frame
  for (const [x, y] of SHAPES[kind][0] ?? []) {
    const row = frame[kind === 'I' ? y - 1 : y]
    if (row && x < 4) row[x] = COLORS[kind]
  }

  return frame
}

const modeOf = (room: BoardRoom): Mode => modeFor(W, H, room)

const milestones: Milestone[] = [
  { id: 'line', name: 'Line', goal: 'Clear a line', check: f => (f.lines ?? 0) >= 1 },
  { id: 'tetris', name: 'Tetris', goal: 'Clear 4 lines at once', check: f => (f.tetrises ?? 0) >= 1 },
  { id: 'forty', name: 'Forty', goal: 'Clear 40 lines in one game', check: f => (f.lines ?? 0) >= 40 },
  { id: 'level-5', name: 'Level 5', goal: 'Reach level 5', check: f => (f.level ?? 0) >= 5 },
  { id: 'level-10', name: 'Level 10', goal: 'Reach level 10', check: f => (f.level ?? 0) >= 10 },
  { id: 'ten-thousand', name: 'Ten thousand', goal: 'Score 10,000 in one game', check: f => (f.score ?? 0) >= 10000 },
  { id: 'clean-sweep', name: 'Clean sweep', goal: 'Clear the whole board', check: f => (f.sweeps ?? 0) >= 1 },
]

export const tetris: GameDef<TetrisState> = {
  id: 'tetris',
  name: 'Tetris',
  v: 1,
  kind: 'arcade',
  lowerIsBetter: [],
  milestones,

  init: ({ seed }) => {
    const base: TetrisState = {
      grid: '.'.repeat(W * H),
      piece: spawnOf('T'),
      queue: [],
      hold: '',
      canHold: true,
      rng: seed,
      level: 1,
      lines: 0,
      score: 0,
      acc: 0,
      lockMs: 0,
      resets: 0,
      tetrises: 0,
      sweeps: 0,
      isStarted: false,
      isOver: false,
    }

    return spawn(base)
  },

  key: (s0, k) => {
    if (s0.isOver) return undefined
    const s = s0.isStarted ? s0 : { ...s0, isStarted: true }
    const key = k.key.toLowerCase()
    if (key === 'left' || key === 'a') return shift(s, -1, 0) ?? s
    if (key === 'right' || key === 'd') return shift(s, 1, 0) ?? s
    if (key === 'down' || key === 's') {
      const moved = shift(s, 0, 1)

      return moved ? { ...moved, score: moved.score + 1, acc: 0 } : s
    }
    if (key === 'up' || key === 'w' || key === 'x') return rotate(s, 1)
    if (key === 'z') return rotate(s, -1)
    if (isSpace(k)) return hardDrop(s)
    if (key === 'c' && s.canHold) {
      const kind = s.piece.kind
      const swapped = s.hold ? spawn({ ...s, hold: kind }, s.hold) : spawn({ ...s, hold: kind })

      return { ...swapped, canHold: false }
    }

    return s0.isStarted ? undefined : s
  },

  tick: s => {
    if (!s.isStarted || s.isOver) return undefined
    let next: TetrisState = { ...s, acc: s.acc + 50 }
    const isResting = !fits(next.grid, { ...next.piece, y: next.piece.y + 1 })
    if (isResting) {
      next = { ...next, acc: 0, lockMs: next.lockMs + 50 }

      return next.lockMs >= LOCK_MS ? lock(next) : next
    }
    const interval = gravityMs(next.level)
    while (next.acc >= interval) {
      const moved = shift(next, 0, 1)
      if (!moved) break
      next = { ...moved, acc: next.acc - interval }
    }

    return next
  },

  over: s => (s.isOver ? { result: 'ended', facts: tetris.facts(s), best: { score: s.score, lines: s.lines } } : undefined),

  facts: s => ({ score: s.score, lines: s.lines, level: s.level, tetrises: s.tetrises, sweeps: s.sweeps }),

  isUnderway: s => s.isStarted && !s.isOver,

  size: (_s, room) => {
    const mode = modeOf(room)
    const field = footprint(W, H, mode)
    const side = footprint(SIDE, 2, mode)

    return { columns: field.columns + 2 + Math.max(side.columns, 8), rows: field.rows }
  },

  draw: (s, { E, room, dim }) => {
    const { Box, Text } = E
    const mode = modeOf(room)
    const frame: Frame = Array.from({ length: H }, (_, y) =>
      Array.from({ length: W }, (_, x) => {
        const c = s.grid[y * W + x] ?? '.'

        return c === '.' ? WELL : COLORS[c as Kind]
      }),
    )
    if (!s.isOver) {
      for (const [x, y] of cells(ghostOf(s))) {
        const row = frame[y]
        if (row && row[x] === WELL) row[x] = GHOST
      }
      for (const [x, y] of cells(s.piece)) {
        const row = frame[y]
        if (row) row[x] = COLORS[s.piece.kind]
      }
    }
    const label = (text: string) => <Text dimColor={!dim}>{text}</Text>
    const color = (c: string) => (dim ? dimmed(c) : c)

    return (
      <Box flexDirection="row" gap={2}>
        {paint(E, frame, mode, dim)}
        <Box flexDirection="column">
          {label('next')}
          {paint(E, mini(s.queue[0] ?? ''), mode, dim)}
          {mode === 'box' ? <Box height={1} /> : null}
          {label('hold')}
          {paint(E, mini(s.hold), mode, dim)}
          {mode === 'box' ? <Box height={1} /> : null}
          <Text color={color('#e6e6e6')}>level {s.level}</Text>
          <Text color={color('#e6e6e6')}>lines {s.lines}</Text>
        </Box>
      </Box>
    )
  },

  status: (s, best) => `score ${s.score.toLocaleString('en-US')} · best ${Math.max(best.score ?? 0, s.score).toLocaleString('en-US')}`,

  controls: s => (s.isStarted ? ['←→ move', '↑ rotate', '↓ drop', 'space slam', 'c hold'] : ['any key to start', '←→ ↑ ↓ space c']),

  card: (s, _o, best) => ({
    title: 'Game over',
    lines: [`${s.score.toLocaleString('en-US')} points`, `${s.lines} lines`, s.score > (best.score ?? 0) && s.score > 0 ? 'new best!' : `best ${(best.score ?? 0).toLocaleString('en-US')}`],
  }),
}
