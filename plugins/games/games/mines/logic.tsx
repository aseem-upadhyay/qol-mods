/** Minesweeper (SPEC.md §10.7). */

import { footprint, paint } from '../../core/canvas'
import type { Cell, Frame } from '../../core/canvas'
import { direction, isEnter, isSpace } from '../../core/game'
import type { BoardRoom, GameDef } from '../../core/game'
import type { Milestone } from '../../core/milestones'
import { BOARD, GRAY, INK, NUMBERS, RED } from '../../core/palette'
import { int } from '../../core/rng'

export const LEVELS = [
  { name: 'Easy', w: 9, h: 9, mines: 10 },
  { name: 'Medium', w: 16, h: 16, mines: 40 },
  { name: 'Hard', w: 30, h: 16, mines: 99 },
] as const

export type MinesState = {
  level: number
  w: number
  h: number
  mines: number
  /** Mine cells, placed on the first reveal so it's never a mine. */
  mineAt: number[]
  /** One character a cell: 'h' hidden, 'o' open, 'f' flagged. */
  cells: string
  cursor: [number, number]
  hasCursor: boolean
  rng: number
  ms: number
  flagsPlaced: number
  isStarted: boolean
  isOver: boolean
  isWon: boolean
  boom?: number
}

const HIDDEN = '#454955'
const HIDDEN_ALT = '#3e424d'
const OPEN = '#24272e'
const CURSOR = '#6a7080'

/** Which levels the room fits: Medium and Hard need their rows and columns (SPEC.md §10.7). */
export function levelsFor(room: BoardRoom): number[] {
  return LEVELS.flatMap((l, i) => {
    const f = footprint(l.w, l.h, 'box')

    return i === 0 || (f.columns <= room.columns && f.rows <= room.rows) ? [i] : []
  })
}

function fresh(level: number, seed: number): MinesState {
  const l = LEVELS[level] ?? LEVELS[0]

  return {
    level,
    w: l.w,
    h: l.h,
    mines: l.mines,
    mineAt: [],
    cells: 'h'.repeat(l.w * l.h),
    cursor: [Math.floor(l.w / 2), Math.floor(l.h / 2)],
    hasCursor: false,
    rng: seed,
    ms: 0,
    flagsPlaced: 0,
    isStarted: false,
    isOver: false,
    isWon: false,
  }
}

function neighbours(s: Pick<MinesState, 'w' | 'h'>, i: number): number[] {
  const x = i % s.w
  const y = Math.floor(i / s.w)
  const out: number[] = []
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < s.w && ny < s.h) out.push(ny * s.w + nx)
    }

  return out
}

const count = (s: MinesState, i: number) => neighbours(s, i).filter(n => s.mineAt.includes(n)).length

/** Lays the mines anywhere but the first cell and its neighbours. */
function layMines(s: MinesState, first: number): MinesState {
  const keep = new Set([first, ...neighbours(s, first)])
  const pool = Array.from({ length: s.w * s.h }, (_, i) => i).filter(i => !keep.has(i))
  const mineAt: number[] = []
  let rng = s.rng
  for (let k = 0; k < s.mines && pool.length > 0; k++) {
    const [pick, next] = int(rng, pool.length)
    rng = next
    mineAt.push(...pool.splice(pick, 1))
  }

  return { ...s, mineAt, rng, isStarted: true }
}

function reveal(s0: MinesState, i: number): MinesState {
  let s = s0.isStarted ? s0 : layMines(s0, i)
  if (s.cells[i] !== 'h' || s.isOver) return s
  if (s.mineAt.includes(i)) return { ...s, boom: i, isOver: true }

  const cells = s.cells.split('')
  const queue = [i]
  while (queue.length > 0) {
    const c = queue.pop() ?? 0
    if (cells[c] !== 'h') continue
    cells[c] = 'o'
    if (count(s, c) === 0) for (const n of neighbours(s, c)) if (cells[n] === 'h') queue.push(n)
  }
  s = { ...s, cells: cells.join('') }
  const hidden = cells.filter(c => c !== 'o').length
  if (hidden === s.mines) return { ...s, isOver: true, isWon: true }

  return s
}

/** Clicking an open number whose flags are all placed opens the rest around it. */
function chord(s: MinesState, i: number): MinesState {
  const around = neighbours(s, i)
  const flags = around.filter(n => s.cells[n] === 'f').length
  if (flags !== count(s, i)) return s

  return around.reduce((acc, n) => (acc.cells[n] === 'h' ? reveal(acc, n) : acc), s)
}

function flag(s: MinesState, i: number): MinesState {
  const c = s.cells[i]
  if (c === 'o' || s.isOver || !s.isStarted) return s
  const cells = s.cells.split('')
  cells[i] = c === 'f' ? 'h' : 'f'

  return { ...s, cells: cells.join(''), flagsPlaced: s.flagsPlaced + (c === 'f' ? 0 : 1) }
}

function act(s: MinesState, i: number, isFlag: boolean): MinesState {
  if (s.isOver) return s
  if (isFlag) return flag(s, i)
  if (s.cells[i] === 'o') return chord(s, i)

  return reveal(s, i)
}

const time = (ms: number) => {
  const sec = Math.floor(ms / 1000)

  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

const won = (level: number) => (f: Record<string, number>) => f.won === 1 && f.level === level

const milestones: Milestone[] = [
  { id: 'cleared', name: 'Cleared', goal: 'Win on Easy', check: won(0) },
  { id: 'quick', name: 'Quick', goal: 'Win Easy in under 60 seconds', check: f => won(0)(f) && (f.seconds ?? 99) < 60 },
  { id: 'medium', name: 'Medium', goal: 'Win on Medium', check: won(1) },
  { id: 'medium-quick', name: 'Medium quick', goal: 'Win Medium in under 3 minutes', check: f => won(1)(f) && (f.seconds ?? 999) < 180 },
  { id: 'no-flags', name: 'No flags', goal: 'Win without placing a flag', check: f => f.won === 1 && f.flags === 0 },
  {
    id: 'streak',
    name: 'Streak',
    goal: 'Win 5 games in a row',
    of: 5,
    count: r => r.stats.streak.current,
    check: (_f, r, ended) => ended && r.stats.streak.current >= 5,
  },
  { id: 'hard', name: 'Hard', goal: 'Win on Hard', check: won(2) },
]

export const mines: GameDef<MinesState> = {
  id: 'mines',
  name: 'Minesweeper',
  v: 1,
  kind: 'turn',
  isTimed: true,
  lowerIsBetter: ['time.easy', 'time.medium', 'time.hard'],
  milestones,

  init: ({ seed, previous, room }) => {
    const wanted = (previous as Partial<MinesState> | undefined)?.level ?? 0

    return fresh(levelsFor(room).includes(wanted) ? wanted : 0, seed)
  },

  key: (s, k) => {
    if (!s.isStarted && ['1', '2', '3'].includes(k.key)) {
      const level = Number(k.key) - 1

      return level === s.level ? s : { ...fresh(level, s.rng), hasCursor: s.hasCursor }
    }
    const dir = direction({ key: k.key === 'w' || k.key === 'a' || k.key === 's' || k.key === 'd' ? '' : k.key })
    if (dir) {
      const [x, y] = s.cursor
      const nx = Math.max(0, Math.min(s.w - 1, x + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0)))
      const ny = Math.max(0, Math.min(s.h - 1, y + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0)))

      return { ...s, cursor: [nx, ny], hasCursor: true }
    }
    const i = s.cursor[1] * s.w + s.cursor[0]
    if (isSpace(k) || isEnter(k)) return act({ ...s, hasCursor: true }, i, false)
    if (k.key === 'f') return act({ ...s, hasCursor: true }, i, true)

    return undefined
  },

  pointer: (s, p) => {
    if (p.type !== 'down') return undefined
    const x = Math.floor(p.x / 2)
    const y = p.y
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) return undefined

    return act({ ...s, cursor: [x, y], hasCursor: false }, y * s.w + x, p.shift === true)
  },

  tick: s => (s.isStarted && !s.isOver ? { ...s, ms: s.ms + 50 } : undefined),

  over: s => {
    if (!s.isOver) return undefined
    const name = (LEVELS[s.level]?.name ?? 'Easy').toLowerCase()
    const seconds = Math.floor(s.ms / 1000)
    const best: Record<string, number> = s.isWon ? { [`time.${name}`]: seconds } : {}
    const extra: Record<string, number> = s.isWon && s.flagsPlaced === 0 ? { noFlagWins: 1 } : {}

    return { result: s.isWon ? 'won' : 'lost', facts: mines.facts(s), best, extra, streak: s.isWon ? 'won' : 'lost' }
  },

  facts: s => ({
    won: s.isWon ? 1 : 0,
    level: s.level,
    seconds: Math.floor(s.ms / 1000),
    flags: s.flagsPlaced,
  }),

  isUnderway: s => s.isStarted && !s.isOver,

  size: s => footprint(s.w, s.h, 'box'),

  draw: (s, { E, dim }) => {
    const frame: Frame = []
    for (let y = 0; y < s.h; y++) {
      const row: Cell[] = []
      for (let x = 0; x < s.w; x++) {
        const i = y * s.w + x
        const c = s.cells[i]
        const isCursor = s.hasCursor && s.cursor[0] === x && s.cursor[1] === y && !s.isOver
        const isMine = s.mineAt.includes(i)
        let cell: Cell
        if (s.isOver && isMine && c !== 'f') {
          cell = { bg: i === s.boom ? RED : HIDDEN, ch: '●', fg: i === s.boom ? BOARD : INK }
        } else if (c === 'f') {
          cell = { bg: s.isOver && !isMine ? GRAY : HIDDEN, ch: '⚑', fg: RED, bold: true }
        } else if (c === 'o') {
          const n = count(s, i)
          cell = n > 0 ? { bg: OPEN, ch: String(n), fg: NUMBERS[n - 1] ?? INK, bold: true } : OPEN
        } else {
          cell = (x + y) % 2 === 0 ? HIDDEN : HIDDEN_ALT
        }
        if (isCursor) cell = typeof cell === 'string' ? CURSOR : { ...cell, bg: CURSOR }
        row.push(cell)
      }
      frame.push(row)
    }

    return paint(E, frame, 'box', dim)
  },

  status: s => {
    const flags = s.cells.split('').filter(c => c === 'f').length

    return `${LEVELS[s.level]?.name ?? 'Easy'} · ⚑ ${s.mines - flags} · ${time(s.ms)}`
  },

  controls: s =>
    s.isStarted
      ? ['click reveal', '⇧click or f flag', '←↑→↓ space']
      : ['click to start', '1 2 3 size', '⇧click or f flag'],

  card: (s, _o, best) => {
    const name = LEVELS[s.level]?.name ?? 'Easy'
    const key = `time.${name.toLowerCase()}`
    const seconds = Math.floor(s.ms / 1000)
    const old = best[key]

    return s.isWon
      ? {
          title: 'Cleared!',
          lines: [`${name} in ${time(s.ms)}`, old === undefined || seconds < old ? 'New best!' : `Best ${time(old * 1000)}`],
        }
      : { title: 'Boom', lines: [`${name} · ${time(s.ms)}`] }
  },
}
