/** Tic-tac-toe (SPEC.md §10.11): you're X; who starts swaps every game. */

import { direction, isEnter, isSpace } from '../../core/game'
import type { GameDef } from '../../core/game'
import type { Milestone } from '../../core/milestones'
import { BOARD, CYAN, dim as dimmed, EDGE, ORANGE, YELLOW } from '../../core/palette'
import { int } from '../../core/rng'

export const LEVELS = ['Easy', 'Perfect'] as const
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]] as const
const GRID_LINE = '#4a4f5c'
const BOT_WAIT = 8

/** Each mark is three lines of three characters, in a cell 7 columns × 3 rows. */
const ART = {
  x: ['╲ ╱', ' ╳ ', '╱ ╲'],
  o: ['╭─╮', '│ │', '╰─╯'],
} as const

export type TicTacToeState = {
  /** 9 characters, row by row: '.', 'x' (you) or 'o' (the bot). */
  grid: string
  level: number
  starter: 'you' | 'bot'
  turn: 'x' | 'o'
  botWait: number
  winner: '' | 'x' | 'o' | 'draw'
  line: number[]
  cursor: number
  hasCursor: boolean
  rng: number
}

export function winner(grid: string): { mark: 'x' | 'o'; line: number[] } | undefined {
  for (const line of LINES) {
    const [a, b, c] = line
    const m = grid[a]
    if (m !== '.' && m === grid[b] && m === grid[c]) return { mark: m as 'x' | 'o', line: [...line] }
  }

  return undefined
}

const free = (grid: string) => grid.split('').flatMap((c, i) => (c === '.' ? [i] : []))
const put = (grid: string, i: number, m: 'x' | 'o') => grid.slice(0, i) + m + grid.slice(i + 1)

/** Minimax over the whole game: the score for `turn`, sooner wins better. */
function minimax(grid: string, turn: 'x' | 'o', depth: number): number {
  const w = winner(grid)
  if (w) return w.mark === turn ? 10 - depth : depth - 10
  const cells = free(grid)
  if (cells.length === 0) return 0
  const other = turn === 'x' ? 'o' : 'x'
  let best = -Infinity
  for (const i of cells) best = Math.max(best, -minimax(put(grid, i, turn), other, depth + 1))

  return best
}

export function botMove(grid: string, level: number, rng: number): { cell: number; rng: number } {
  const cells = free(grid)
  if (level === 0) {
    const win = cells.find(i => winner(put(grid, i, 'o'))?.mark === 'o')
    if (win !== undefined) return { cell: win, rng }
    const [k, next] = int(rng, cells.length)

    return { cell: cells[k] ?? cells[0] ?? 4, rng: next }
  }
  let best = -Infinity
  let cell = cells[0] ?? 4
  for (const i of cells) {
    const score = -minimax(put(grid, i, 'o'), 'x', 1)
    if (score > best) {
      best = score
      cell = i
    }
  }

  return { cell, rng }
}

function settle(s: TicTacToeState): TicTacToeState {
  const w = winner(s.grid)
  if (w) return { ...s, winner: w.mark, line: w.line }
  if (!s.grid.includes('.')) return { ...s, winner: 'draw' }

  return s
}

function play(s: TicTacToeState, i: number): TicTacToeState {
  if (s.winner || s.turn !== 'x' || s.botWait > 0 || s.grid[i] !== '.') return s
  const next = settle({ ...s, grid: put(s.grid, i, 'x'), cursor: i })

  return next.winner ? next : { ...next, turn: 'o', botWait: BOT_WAIT }
}

/** Phone keypad order: 1 2 3 on the top row. */
const KEYPAD = '123456789'

const milestones: Milestone[] = [
  { id: 'three', name: 'Three', goal: 'Win on Easy', check: f => f.won === 1 && f.level === 0 },
  { id: 'second', name: 'Second', goal: 'Win on Easy when the bot starts', check: f => f.won === 1 && f.level === 0 && f.botStarted === 1 },
  { id: 'unbeaten', name: 'Unbeaten', goal: 'Draw against Perfect', check: f => f.draw === 1 && f.level === 1 },
  {
    id: 'ten-draws',
    name: 'Ten draws',
    goal: 'Draw against Perfect 10 times',
    of: 10,
    count: r => r.stats.extra.perfectDraws ?? 0,
    check: (_f, r, ended) => ended && (r.stats.extra.perfectDraws ?? 0) >= 10,
  },
  {
    id: 'patient',
    name: 'Patient',
    goal: 'Play 25 games',
    of: 25,
    count: r => r.stats.played,
    check: (_f, r) => r.stats.played >= 25,
  },
]

export const tictactoe: GameDef<TicTacToeState> = {
  id: 'tictactoe',
  name: 'Tic-tac-toe',
  v: 1,
  kind: 'turn',
  lowerIsBetter: [],
  milestones,

  init: ({ seed, previous }) => {
    const prev = previous as Partial<TicTacToeState> | undefined
    const starter = prev?.starter === 'you' ? 'bot' : prev?.starter === 'bot' ? 'you' : 'you'
    const turn = starter === 'you' ? 'x' : 'o'

    return {
      grid: '.........',
      level: prev?.level ?? 0,
      starter,
      turn,
      botWait: turn === 'o' ? BOT_WAIT : 0,
      winner: '',
      line: [],
      cursor: 4,
      hasCursor: false,
      rng: seed,
    }
  },

  key: (s, k) => {
    const mine = s.grid.split('').filter(c => c === 'x').length
    if (k.key.toLowerCase() === 'd' && mine === 0 && !s.winner) return { ...s, level: s.level === 0 ? 1 : 0 }
    const pad = KEYPAD.indexOf(k.key)
    if (pad >= 0) return play(s, pad)
    const dir = direction({ key: ['w', 'a', 's'].includes(k.key) ? '' : k.key })
    if (dir) {
      const x = s.cursor % 3
      const y = Math.floor(s.cursor / 3)
      const nx = Math.max(0, Math.min(2, x + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0)))
      const ny = Math.max(0, Math.min(2, y + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0)))

      return { ...s, cursor: ny * 3 + nx, hasCursor: true }
    }
    if (isSpace(k) || isEnter(k)) return play({ ...s, hasCursor: true }, s.cursor)

    return undefined
  },

  pointer: (s, p) => {
    if (p.type !== 'down') return undefined
    const x = Math.floor(p.x / 8)
    const y = Math.floor(p.y / 4)
    if (p.x % 8 === 7 || p.y % 4 === 3 || x > 2 || y > 2) return undefined

    return play({ ...s, hasCursor: false }, y * 3 + x)
  },

  tick: s => {
    if (s.winner || s.turn !== 'o') return undefined
    if (s.botWait > 1) return { ...s, botWait: s.botWait - 1 }
    const move = botMove(s.grid, s.level, s.rng)

    return settle({ ...s, grid: put(s.grid, move.cell, 'o'), rng: move.rng, botWait: 0, turn: 'x' })
  },

  over: s => {
    if (!s.winner) return undefined
    const isDraw = s.winner === 'draw'

    return {
      result: s.winner === 'x' ? 'won' : isDraw ? 'ended' : 'lost',
      facts: tictactoe.facts(s),
      best: {},
      extra: isDraw ? { draws: 1, ...(s.level === 1 ? { perfectDraws: 1 } : {}) } : {},
    }
  },

  facts: s => ({
    won: s.winner === 'x' ? 1 : 0,
    draw: s.winner === 'draw' ? 1 : 0,
    level: s.level,
    botStarted: s.starter === 'bot' ? 1 : 0,
  }),

  isUnderway: s => s.grid.includes('x') && !s.winner,

  size: () => ({ columns: 23, rows: 11 }),

  draw: (s, { E, dim }) => {
    const { Box, Text } = E
    const color = (c: string) => (dim ? dimmed(c) : c)
    const rows = [0, 1, 2].map(y => (
      <Box key={`r${y}`} flexDirection="row" gap={1}>
        {[0, 1, 2].map(x => {
          const i = y * 3 + x
          const mark = s.grid[i]
          const isWin = s.line.includes(i)
          const isCursor = s.hasCursor && s.cursor === i && !s.winner
          const ink = mark === 'x' ? CYAN : ORANGE

          return (
            <Box key={`c${i}`} width={7} height={3} flexDirection="column" alignItems="center" backgroundColor={color(isCursor ? EDGE : BOARD)}>
              {mark === 'x' || mark === 'o'
                ? ART[mark].map((line, j) => (
                    <Text key={`l${j}`} bold color={color(isWin ? YELLOW : ink)}>
                      {line}
                    </Text>
                  ))
                : null}
            </Box>
          )
        })}
      </Box>
    ))

    return (
      <Box flexDirection="column" gap={1} backgroundColor={color(GRID_LINE)} width={23}>
        {rows}
      </Box>
    )
  },

  status: s => {
    const turn = s.winner ? '' : s.turn === 'x' ? ' · your move' : ' · thinking…'

    return `${LEVELS[s.level] ?? 'Easy'} · you're X${turn}`
  },

  controls: s =>
    s.grid.includes('x') ? ['click a square', '1–9', '←↑→↓ space'] : ['click a square', '1–9', 'd Easy/Perfect'],

  card: s =>
    s.winner === 'x'
      ? { title: 'You win!', lines: [LEVELS[s.level] ?? 'Easy'] }
      : s.winner === 'draw'
        ? { title: 'A draw', lines: [s.level === 1 ? 'unbeaten by Perfect' : 'Easy'] }
        : { title: 'O wins', lines: [LEVELS[s.level] ?? 'Easy'] },
}
