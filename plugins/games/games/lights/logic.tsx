/** Lights Out (SPEC.md §10.8). */

import { paint } from '../../core/canvas'
import type { Frame } from '../../core/canvas'
import { direction, isEnter, isSpace } from '../../core/game'
import type { GameDef } from '../../core/game'
import type { Milestone } from '../../core/milestones'
import { BOARD } from '../../core/palette'
import { int, seedFrom } from '../../core/rng'

export type LightsState = {
  level: number
  /** 25 characters, row by row: '1' lit, '0' off. */
  lights: string
  moves: number
  /** Presses that built the level, less any that cancel out. */
  par: number
  /** Cells pressed, for undo. */
  history: number[]
  cursor: [number, number]
  hasCursor: boolean
  isCleared: boolean
}

const N = 5
const LIT = '#f6c445'
const LIT_CURSOR = '#ffe08a'
const OFF = '#2f323b'
const OFF_CURSOR = '#4a4f5c'
/** A light is 2 × 2 canvas cells (4 columns × 2 rows), with one canvas cell between lights. */
const STRIDE = 3
const SIZE = N * STRIDE - 1

function press(lights: string, i: number): string {
  const out = lights.split('')
  const x = i % N
  const y = Math.floor(i / N)
  const flip = (cx: number, cy: number) => {
    if (cx < 0 || cy < 0 || cx >= N || cy >= N) return
    const j = cy * N + cx
    out[j] = out[j] === '1' ? '0' : '1'
  }
  flip(x, y)
  flip(x - 1, y)
  flip(x + 1, y)
  flip(x, y - 1)
  flip(x, y + 1)

  return out.join('')
}

/** Level n: n + 2 presses from dark, seeded by the level, so it's solvable and the same for everyone. */
export function level(n: number): { lights: string; par: number } {
  let rng = seedFrom(n * 7919 + 13)
  let lights = '0'.repeat(N * N)
  const pressed = new Set<number>()
  for (let k = 0; k < n + 2 || !lights.includes('1'); k++) {
    const [i, next] = int(rng, N * N)
    rng = next
    lights = press(lights, i)
    if (pressed.has(i)) pressed.delete(i)
    else pressed.add(i)
  }

  return { lights, par: pressed.size }
}

function fresh(n: number): LightsState {
  const l = level(n)

  return { level: n, lights: l.lights, par: l.par, moves: 0, history: [], cursor: [2, 2], hasCursor: false, isCleared: false }
}

function act(s: LightsState, i: number, hasCursor: boolean): LightsState {
  if (s.isCleared) return s
  const lights = press(s.lights, i)

  return {
    ...s,
    lights,
    moves: s.moves + 1,
    history: [...s.history, i],
    cursor: [i % N, Math.floor(i / N)],
    hasCursor,
    isCleared: !lights.includes('1'),
  }
}

const cleared = (n: number) => (f: Record<string, number>) => f.cleared === 1 && (f.level ?? 0) >= n

const milestones: Milestone[] = [
  { id: 'lights-off', name: 'Lights off', goal: 'Clear level 1', check: cleared(1) },
  { id: 'ten', name: 'Ten', goal: 'Clear level 10', check: cleared(10) },
  { id: 'twenty-five', name: 'Twenty-five', goal: 'Clear level 25', check: cleared(25) },
  { id: 'fifty', name: 'Fifty', goal: 'Clear level 50', check: cleared(50) },
  { id: 'on-par', name: 'On par', goal: 'Clear a level at par', check: f => f.cleared === 1 && f.onPar === 1 },
  {
    id: 'ten-on-par',
    name: 'Ten on par',
    goal: 'Clear 10 levels at par',
    of: 10,
    count: r => r.stats.extra.onPar ?? 0,
    check: (_f, r, ended) => ended && (r.stats.extra.onPar ?? 0) >= 10,
  },
]

export const lights: GameDef<LightsState> = {
  id: 'lights',
  name: 'Lights Out',
  v: 1,
  kind: 'turn',
  lowerIsBetter: [],
  milestones,

  init: ({ previous, record }) => {
    const prev = previous as Partial<LightsState> | undefined
    // The level after the one just cleared, the same one when restarting, else the one after your best.
    const n = prev?.level !== undefined ? prev.level + (prev.isCleared ? 1 : 0) : (record.stats.best.level ?? 0) + 1

    return fresh(n)
  },

  key: (s, k) => {
    if (k.key.toLowerCase() === 'u') {
      const last = s.history[s.history.length - 1]
      if (last === undefined || s.isCleared) return s

      // Pressing a light twice undoes it; the undo still counts as a move, so par stays honest.
      return { ...s, lights: press(s.lights, last), moves: s.moves + 1, history: s.history.slice(0, -1) }
    }
    const dir = direction({ key: ['w', 'a', 's', 'd'].includes(k.key) ? '' : k.key })
    if (dir) {
      const [x, y] = s.cursor
      const nx = Math.max(0, Math.min(N - 1, x + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0)))
      const ny = Math.max(0, Math.min(N - 1, y + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0)))

      return { ...s, cursor: [nx, ny], hasCursor: true }
    }
    if (isSpace(k) || isEnter(k)) return act(s, s.cursor[1] * N + s.cursor[0], true)

    return undefined
  },

  pointer: (s, p) => {
    if (p.type !== 'down') return undefined
    const cx = Math.floor(p.x / 2)
    const x = Math.floor(cx / STRIDE)
    const y = Math.floor(p.y / STRIDE)
    if (cx % STRIDE === STRIDE - 1 || p.y % STRIDE === STRIDE - 1 || x >= N || y >= N || x < 0 || y < 0) return undefined

    return act(s, y * N + x, false)
  },

  over: s =>
    s.isCleared
      ? {
          result: 'won',
          facts: lights.facts(s),
          best: { level: s.level },
          extra: { onPar: s.moves <= s.par ? 1 : 0 },
        }
      : undefined,

  facts: s => ({ level: s.level, moves: s.moves, par: s.par, cleared: s.isCleared ? 1 : 0, onPar: s.isCleared && s.moves <= s.par ? 1 : 0 }),

  isUnderway: s => s.moves > 0 && !s.isCleared,

  size: () => ({ columns: SIZE * 2, rows: SIZE }),

  draw: (s, { E, dim }) => {
    const frame: Frame = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => BOARD))
    for (let i = 0; i < N * N; i++) {
      const x = i % N
      const y = Math.floor(i / N)
      const isLit = s.lights[i] === '1'
      const isCursor = s.hasCursor && s.cursor[0] === x && s.cursor[1] === y && !s.isCleared
      const color = isLit ? (isCursor ? LIT_CURSOR : LIT) : isCursor ? OFF_CURSOR : OFF
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const row = frame[y * STRIDE + dy]
          if (row) row[x * STRIDE + dx] = color
        }
    }

    return paint(E, frame, 'box', dim)
  },

  status: s => `level ${s.level} · ${s.moves} moves · par ${s.par}`,

  controls: () => ['click a light', '←↑→↓ space', 'u undo'],

  card: s => ({
    title: `Level ${s.level} cleared`,
    lines: [s.moves <= s.par ? `${s.moves} moves · on par!` : `${s.moves} moves · par ${s.par}`],
    again: 'next level',
  }),
}
