/** Memory (SPEC.md §10.9). */

import { direction, isEnter, isSpace } from '../../core/game'
import type { BoardRoom, GameDef } from '../../core/game'
import type { Milestone } from '../../core/milestones'
import { BLUE, BOARD, CYAN, dim as dimmed, GREEN, ORANGE, PURPLE, RED, YELLOW } from '../../core/palette'
import { int } from '../../core/rng'

export type MemoryState = {
  cols: number
  rows: number
  /** Each card's face, an index into FACES; pairs share one. */
  faces: number[]
  /** Cards matched for good. */
  matched: number[]
  /** Cards face up this turn: none, one, or two. */
  open: number[]
  /** Ticks left before a missed pair turns back. */
  miss: number
  flips: number
  cursor: number
  hasCursor: boolean
  rng: number
}

export const FACES: readonly { ch: string; color: string }[] = [
  { ch: '♠', color: BLUE },
  { ch: '♥', color: RED },
  { ch: '♦', color: ORANGE },
  { ch: '♣', color: GREEN },
  { ch: '★', color: YELLOW },
  { ch: '●', color: PURPLE },
  { ch: '▲', color: CYAN },
  { ch: '■', color: '#e66fa0' },
  { ch: '◆', color: '#3fb8af' },
  { ch: '✿', color: '#d9822b' },
  { ch: '☀', color: '#e8c34f' },
  { ch: '☾', color: '#8f9cf5' },
]

const BACK = '#3b4766'
const BACK_CURSOR = '#56648a'
const FACE = '#e6e6e6'
const FACE_DONE = '#9aa0a6'
const CARD_W = 6
/** A miss stays up 0.8 seconds. */
const MISS_TICKS = 16

/** Cards 3 rows tall where 15 rows fit, else 2 (SPEC.md §10.9). */
const cardH = (room: BoardRoom) => (room.rows >= 15 ? 3 : 2)
/** 6 across needs 41 columns. */
export const fitsBig = (room: BoardRoom) => room.columns >= 6 * CARD_W + 5

function deal(cols: number, rows: number, seed: number): { faces: number[]; rng: number } {
  const pairs = (cols * rows) / 2
  const faces = Array.from({ length: pairs * 2 }, (_, i) => i % pairs)
  let rng = seed
  for (let i = faces.length - 1; i > 0; i--) {
    const [j, next] = int(rng, i + 1)
    rng = next
    const t = faces[i] ?? 0
    faces[i] = faces[j] ?? 0
    faces[j] = t
  }

  return { faces, rng }
}

function fresh(isBig: boolean, seed: number): MemoryState {
  const cols = isBig ? 6 : 4
  const rows = 4
  const { faces, rng } = deal(cols, rows, seed)

  return { cols, rows, faces, matched: [], open: [], miss: 0, flips: 0, cursor: 0, hasCursor: false, rng }
}

/** Turns a card; a third card while a miss shows turns the miss back first. */
function flip(s0: MemoryState, i: number): MemoryState {
  let s = s0
  if (s.miss > 0 || s.open.length === 2) s = { ...s, open: [], miss: 0 }
  if (s.matched.includes(i) || s.open.includes(i) || i < 0 || i >= s.faces.length) return s
  const open = [...s.open, i]
  const flips = s.flips + 1
  if (open.length < 2) return { ...s, open, flips }
  const [a = 0, b = 0] = open
  if (s.faces[a] === s.faces[b]) return { ...s, open: [], matched: [...s.matched, a, b], flips }

  return { ...s, open, flips, miss: MISS_TICKS }
}

const isDone = (s: MemoryState) => s.matched.length === s.faces.length

const milestones: Milestone[] = [
  { id: 'matched', name: 'Matched', goal: 'Clear a 4×4 board', check: f => f.cleared === 1 && f.big === 0 },
  { id: 'sharp', name: 'Sharp', goal: 'Clear 4×4 in 24 flips or fewer', check: f => f.cleared === 1 && f.big === 0 && (f.flips ?? 99) <= 24 },
  { id: 'sharper', name: 'Sharper', goal: 'Clear 4×4 in 20 flips or fewer', check: f => f.cleared === 1 && f.big === 0 && (f.flips ?? 99) <= 20 },
  {
    id: 'speedy',
    name: 'Speedy',
    goal: 'Clear 4×4 in under 40 seconds',
    check: (f, _r, ended) => ended && f.cleared === 1 && f.big === 0 && (f.seconds ?? 999) < 40,
  },
  { id: 'big-board', name: 'Big board', goal: 'Clear 6×4', check: f => f.cleared === 1 && f.big === 1 },
  {
    id: 'regular',
    name: 'Regular',
    goal: 'Clear 25 boards',
    of: 25,
    count: r => r.stats.won,
    check: (_f, r, ended) => ended && r.stats.won >= 25,
  },
]

export const memory: GameDef<MemoryState> = {
  id: 'memory',
  name: 'Memory',
  v: 1,
  kind: 'turn',
  lowerIsBetter: ['flips', 'flips.big'],
  milestones,

  init: ({ seed, previous, room }) => {
    const prev = previous as Partial<MemoryState> | undefined

    return fresh(prev?.cols === 6 && fitsBig(room), seed)
  },

  key: (s, k) => {
    if (s.flips === 0 && (k.key === '1' || k.key === '2')) return fresh(k.key === '2', s.rng)
    const dir = direction({ key: ['w', 'a', 's', 'd'].includes(k.key) ? '' : k.key })
    if (dir) {
      const x = s.cursor % s.cols
      const y = Math.floor(s.cursor / s.cols)
      const nx = Math.max(0, Math.min(s.cols - 1, x + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0)))
      const ny = Math.max(0, Math.min(s.rows - 1, y + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0)))

      return { ...s, cursor: ny * s.cols + nx, hasCursor: true }
    }
    if (isSpace(k) || isEnter(k)) return flip({ ...s, hasCursor: true }, s.cursor)

    return undefined
  },

  pointer: (s, p, room) => {
    if (p.type !== 'down') return undefined
    const stride = cardH(room) + 1
    const x = Math.floor(p.x / (CARD_W + 1))
    const y = Math.floor(p.y / stride)
    if (p.x % (CARD_W + 1) === CARD_W || p.y % stride === stride - 1 || x >= s.cols || y >= s.rows) return undefined

    return flip({ ...s, hasCursor: false, cursor: y * s.cols + x }, y * s.cols + x)
  },

  tick: s => {
    if (s.miss <= 0) return undefined

    return s.miss === 1 ? { ...s, miss: 0, open: [] } : { ...s, miss: s.miss - 1 }
  },

  over: s => {
    if (!isDone(s)) return undefined
    const isBig = s.cols === 6

    return {
      result: 'won',
      facts: memory.facts(s),
      best: { [isBig ? 'flips.big' : 'flips']: s.flips },
    }
  },

  facts: s => ({ flips: s.flips, big: s.cols === 6 ? 1 : 0, cleared: isDone(s) ? 1 : 0 }),

  isUnderway: s => s.flips > 0 && !isDone(s),

  size: (s, room) => ({ columns: s.cols * (CARD_W + 1) - 1, rows: s.rows * (cardH(room) + 1) - 1 }),

  draw: (s, { E, room, dim }) => {
    const { Box, Text } = E
    // Not `h`: JSX compiles to the global `h`, which a local of that name would hide.
    const tall = cardH(room)
    const color = (c: string) => (dim ? dimmed(c) : c)
    const rows = Array.from({ length: s.rows }, (_, y) => (
      <Box key={`r${y}`} flexDirection="row" gap={1}>
        {Array.from({ length: s.cols }, (_, x) => {
          const i = y * s.cols + x
          const isUp = s.open.includes(i) || s.matched.includes(i)
          const face = FACES[s.faces[i] ?? 0] ?? FACES[0]
          const isCursor = s.hasCursor && s.cursor === i
          const bg = isUp ? (s.matched.includes(i) ? FACE_DONE : FACE) : isCursor ? BACK_CURSOR : BACK

          return (
            <Box key={`c${i}`} width={CARD_W} height={tall} backgroundColor={color(bg)} justifyContent="center" alignItems="center">
              <Text bold color={color(isUp ? (face?.color ?? BOARD) : BACK_CURSOR)}>
                {isUp ? (face?.ch ?? '?') : '·'}
              </Text>
            </Box>
          )
        })}
      </Box>
    ))

    return (
      <Box flexDirection="column" gap={1}>
        {rows}
      </Box>
    )
  },

  status: (s, best) => {
    const key = s.cols === 6 ? 'flips.big' : 'flips'

    return `${s.cols}×${s.rows} · ${s.flips} flips${best[key] !== undefined ? ` · best ${best[key]}` : ''}`
  },

  controls: s => (s.flips === 0 ? ['click a card', '1 4×4', '2 6×4'] : ['click a card', '←↑→↓ space']),

  card: (s, _o, best) => {
    const key = s.cols === 6 ? 'flips.big' : 'flips'
    const old = best[key]

    return {
      title: 'Cleared!',
      lines: [`${s.flips} flips`, old === undefined || s.flips < old ? 'new best!' : `best ${old}`],
    }
  },
}
