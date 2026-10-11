/** Connect Four (SPEC.md §10.10): you're red and move first; the bot is yellow. */

import { direction, isEnter, isSpace } from '../../core/game'
import type { GameDef } from '../../core/game'
import type { Milestone } from '../../core/milestones'
import { BOARD, dim as dimmed, RED, YELLOW } from '../../core/palette'
import { int } from '../../core/rng'

const COLS = 7
const ROWS = 6
const FRAME = '#2f5fb3'
const RED_WIN = '#ff9a93'
const YELLOW_WIN = '#ffe08a'
export const LEVELS = ['Easy', 'Normal', 'Hard'] as const
/** How far each level looks ahead; Easy only sees wins and blocks one move out. */
const DEPTH = [0, 4, 7] as const
const ORDER = [3, 2, 4, 1, 5, 0, 6] as const
/** The bot waits this many ticks before it moves, so its move can be seen. */
const BOT_WAIT = 8

type Piece = 'r' | 'y'

export type Connect4State = {
  /** 42 characters, top row first: '.', 'r' or 'y'. */
  grid: string
  level: number
  turn: Piece
  /** Your moves this game. */
  moves: number
  cursor: number
  /** A disc on its way down: drawn at row `at` until it lands at `row`. */
  drop?: { col: number; row: number; at: number; piece: Piece }
  botWait: number
  winner: '' | Piece | 'draw'
  /** The winning four, and whether they run diagonally. */
  line: number[]
  isDiagonal: boolean
  rng: number
}

const at = (grid: string, col: number, row: number) => grid[row * COLS + col] ?? '.'

/** The row a disc dropped in `col` lands on, or -1 when the column is full. */
export function landing(grid: string, col: number): number {
  for (let row = ROWS - 1; row >= 0; row--) if (at(grid, col, row) === '.') return row

  return -1
}

const place = (grid: string, col: number, row: number, piece: Piece) =>
  grid.slice(0, row * COLS + col) + piece + grid.slice(row * COLS + col + 1)

const DIRS: readonly [number, number][] = [[1, 0], [0, 1], [1, 1], [1, -1]]

/** The four that won, if any. */
export function winLine(grid: string): { piece: Piece; line: number[]; isDiagonal: boolean } | undefined {
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++) {
      const piece = at(grid, col, row)
      if (piece === '.') continue
      for (const [dx, dy] of DIRS) {
        const line: number[] = []
        for (let k = 0; k < 4; k++) {
          const c = col + dx * k
          const r = row + dy * k
          if (c < 0 || r < 0 || c >= COLS || r >= ROWS || at(grid, c, r) !== piece) break
          line.push(r * COLS + c)
        }
        if (line.length === 4) return { piece: piece as Piece, line, isDiagonal: dx !== 0 && dy !== 0 }
      }
    }

  return undefined
}

// ---------------------------------------------------------------- the bot

/** Every window of four cells on the board, for scoring. */
const WINDOWS: number[][] = (() => {
  const out: number[][] = []
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++)
      for (const [dx, dy] of DIRS) {
        const w: number[] = []
        for (let k = 0; k < 4; k++) {
          const c = col + dx * k
          const r = row + dy * k
          if (c < 0 || r < 0 || c >= COLS || r >= ROWS) break
          w.push(r * COLS + c)
        }
        if (w.length === 4) out.push(w)
      }

  return out
})()

/** How good the board is for `me`: open threes and twos, and the center column. */
function evaluate(cells: Piece[] | string, me: Piece): number {
  const them: Piece = me === 'y' ? 'r' : 'y'
  let score = 0
  for (const w of WINDOWS) {
    let mine = 0
    let theirs = 0
    for (const i of w) {
      if (cells[i] === me) mine++
      else if (cells[i] === them) theirs++
    }
    if (theirs === 0) score += mine === 3 ? 5 : mine === 2 ? 2 : 0
    if (mine === 0) score -= theirs === 3 ? 4 : 0
  }
  for (let row = 0; row < ROWS; row++) if (cells[row * COLS + 3] === me) score += 3

  return score
}

const WIN = 1_000_000

/** Negamax with alpha-beta: the best score `turn` can force from here. */
function search(grid: string, turn: Piece, depth: number, alpha: number, beta: number): number {
  const other: Piece = turn === 'y' ? 'r' : 'y'
  let best = -Infinity
  let any = false
  for (const col of ORDER) {
    const row = landing(grid, col)
    if (row < 0) continue
    any = true
    const next = place(grid, col, row, turn)
    let score: number
    if (winLine(next)?.piece === turn) score = WIN + depth
    else if (depth === 0) score = evaluate(next, turn)
    else score = -search(next, other, depth - 1, -beta, -alpha)
    if (score > best) best = score
    if (best > alpha) alpha = best
    if (alpha >= beta) break
  }

  return any ? best : 0
}

/** The column the bot plays. */
export function botMove(grid: string, level: number, rng: number): { col: number; rng: number } {
  const legal = ORDER.filter(col => landing(grid, col) >= 0)
  const wins = (piece: Piece) => legal.find(col => winLine(place(grid, col, landing(grid, col), piece))?.piece === piece)
  if (level === 0) {
    const col = wins('y') ?? wins('r')
    if (col !== undefined) return { col, rng }
    const [i, next] = int(rng, legal.length)

    return { col: legal[i] ?? legal[0] ?? 3, rng: next }
  }
  let bestCol = legal[0] ?? 3
  let best = -Infinity
  for (const col of legal) {
    const next = place(grid, col, landing(grid, col), 'y')
    const score = winLine(next)?.piece === 'y' ? WIN * 2 : -search(next, 'r', (DEPTH[level] ?? 4) - 1, -Infinity, Infinity)
    if (score > best) {
      best = score
      bestCol = col
    }
  }

  return { col: bestCol, rng }
}

// ---------------------------------------------------------------- play

function fresh(level: number, seed: number): Connect4State {
  return { grid: '.'.repeat(COLS * ROWS), level, turn: 'r', moves: 0, cursor: 3, botWait: 0, winner: '', line: [], isDiagonal: false, rng: seed }
}

function startDrop(s: Connect4State, col: number, piece: Piece): Connect4State {
  const row = landing(s.grid, col)
  if (row < 0) return s

  return { ...s, drop: { col, row, at: 0, piece }, moves: s.moves + (piece === 'r' ? 1 : 0) }
}

/** A disc lands: the winner, a draw, or the other side's turn. */
function land(s: Connect4State): Connect4State {
  const d = s.drop
  if (!d) return s
  const grid = place(s.grid, d.col, d.row, d.piece)
  const won = winLine(grid)
  const base = { ...s, grid, drop: undefined }
  if (won) return { ...base, winner: won.piece, line: won.line, isDiagonal: won.isDiagonal }
  if (!grid.includes('.')) return { ...base, winner: 'draw' }
  const turn: Piece = d.piece === 'r' ? 'y' : 'r'

  return { ...base, turn, botWait: turn === 'y' ? BOT_WAIT : 0 }
}

const isMyTurn = (s: Connect4State) => s.turn === 'r' && !s.drop && !s.winner

const won = (f: Record<string, number>) => f.won === 1

const milestones: Milestone[] = [
  { id: 'four', name: 'Four', goal: 'Win a game', check: won },
  { id: 'normal', name: 'Normal', goal: 'Win on Normal', check: f => won(f) && (f.level ?? 0) >= 1 },
  { id: 'hard', name: 'Hard', goal: 'Win on Hard', check: f => won(f) && f.level === 2 },
  { id: 'diagonal', name: 'Diagonal', goal: 'Win with a diagonal', check: f => won(f) && f.diagonal === 1 },
  { id: 'quick-four', name: 'Quick four', goal: 'Win in 10 or fewer of your moves', check: f => won(f) && (f.moves ?? 99) <= 10 },
  {
    id: 'streak',
    name: 'Streak',
    goal: 'Win 3 games on Hard in a row',
    of: 3,
    count: r => r.stats.streak.current,
    check: (_f, r, ended) => ended && r.stats.streak.current >= 3,
  },
]

export const connect4: GameDef<Connect4State> = {
  id: 'connect4',
  name: 'Connect Four',
  v: 1,
  kind: 'turn',
  lowerIsBetter: [],
  milestones,

  init: ({ seed, previous }) => fresh((previous as Partial<Connect4State> | undefined)?.level ?? 0, seed),

  key: (s, k) => {
    if (s.moves === 0 && !s.drop && ['1', '2', '3'].includes(k.key)) return { ...s, level: Number(k.key) - 1 }
    const dir = direction({ key: ['w', 'a', 's', 'd'].includes(k.key) ? '' : k.key })
    if (dir === 'left' || dir === 'right') return { ...s, cursor: Math.max(0, Math.min(COLS - 1, s.cursor + (dir === 'left' ? -1 : 1))) }
    if ((isSpace(k) || isEnter(k) || dir === 'down') && isMyTurn(s)) return startDrop(s, s.cursor, 'r')

    return undefined
  },

  pointer: (s, p) => {
    const col = Math.floor((p.x - 1) / 4)
    if (col < 0 || col >= COLS || (p.x - 1) % 4 === 3) return undefined
    if (p.type === 'move') return col === s.cursor ? undefined : { ...s, cursor: col }
    if (p.type !== 'down' || !isMyTurn(s)) return undefined

    return startDrop({ ...s, cursor: col }, col, 'r')
  },

  tick: s => {
    if (s.winner) return undefined
    if (s.drop) return s.drop.at >= s.drop.row ? land(s) : { ...s, drop: { ...s.drop, at: s.drop.at + 1 } }
    if (s.turn === 'y') {
      if (s.botWait > 1) return { ...s, botWait: s.botWait - 1 }
      const move = botMove(s.grid, s.level, s.rng)

      return startDrop({ ...s, rng: move.rng, botWait: 0 }, move.col, 'y')
    }

    return undefined
  },

  over: s => {
    if (!s.winner) return undefined
    const isWon = s.winner === 'r'
    const isHard = s.level === 2

    return {
      result: isWon ? 'won' : s.winner === 'draw' ? 'ended' : 'lost',
      facts: connect4.facts(s),
      best: {},
      // The streak is Hard wins in a row (SPEC.md §10.10).
      ...(isHard ? { streak: isWon ? ('won' as const) : ('lost' as const) } : {}),
    }
  },

  facts: s => ({ won: s.winner === 'r' ? 1 : 0, level: s.level, diagonal: s.isDiagonal ? 1 : 0, moves: s.moves }),

  isUnderway: s => s.moves > 0 && !s.winner,

  size: () => ({ columns: COLS * 4 + 1, rows: ROWS * 2 + 2 }),

  draw: (s, { E, dim }) => {
    const { Box } = E
    const color = (c: string) => (dim ? dimmed(c) : c)
    const showHover = isMyTurn(s)
    const hover = (
      <Box key="hover" flexDirection="row" height={1} paddingLeft={1} gap={1}>
        {Array.from({ length: COLS }, (_, col) => (
          <Box key={`h${col}`} width={3} height={1} backgroundColor={showHover && col === s.cursor ? color(RED) : undefined} />
        ))}
      </Box>
    )
    const rows = Array.from({ length: ROWS }, (_, row) => (
      <Box key={`r${row}`} flexDirection="row" gap={1} height={1}>
        {Array.from({ length: COLS }, (_, col) => {
          const i = row * COLS + col
          let piece = at(s.grid, col, row)
          if (s.drop && s.drop.col === col && s.drop.at === row) piece = s.drop.piece
          const isWin = s.line.includes(i)
          const bg = piece === 'r' ? (isWin ? RED_WIN : RED) : piece === 'y' ? (isWin ? YELLOW_WIN : YELLOW) : BOARD

          return <Box key={`c${col}`} width={3} height={1} backgroundColor={color(bg)} />
        })}
      </Box>
    ))

    return (
      <Box flexDirection="column">
        {hover}
        <Box flexDirection="column" gap={1} padding={1} paddingTop={1} backgroundColor={color(FRAME)}>
          {rows}
        </Box>
      </Box>
    )
  },

  status: s => {
    const turn = s.winner ? '' : s.turn === 'r' ? ' · your move' : ' · thinking…'

    return `${LEVELS[s.level] ?? 'Easy'}${turn}`
  },

  controls: s => (s.moves === 0 ? ['click a column', '1 2 3 level', '←→ space'] : ['click a column', '←→ space']),

  card: s =>
    s.winner === 'r'
      ? { title: 'You win!', lines: [`${LEVELS[s.level]} · ${s.moves} moves`] }
      : s.winner === 'draw'
        ? { title: 'A draw', lines: [`${LEVELS[s.level]}`] }
        : { title: 'Yellow wins', lines: [`${LEVELS[s.level]}`] },
}
