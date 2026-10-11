/** 2048 (SPEC.md §10.6). */

import { direction } from '../../core/game'
import type { BoardRoom, GameDef } from '../../core/game'
import { played } from '../../core/milestones'
import type { Milestone } from '../../core/milestones'
import { BOARD, dim as dimmed, inkOn, TILE_BIG, TILES } from '../../core/palette'
import { int, next } from '../../core/rng'

type Dir = 'up' | 'down' | 'left' | 'right'

export type State2048 = {
  /** 16 cells, row by row: 0 for empty, else the tile's value. */
  grid: number[]
  score: number
  moves: number
  rng: number
  maxTile: number
  /** Moves taken to first make 2048; 0 until then. */
  movesTo2048: number
  /** Cells that merged on the last move, drawn bright for a moment. */
  pop: number[]
  /** Ticks the pop lasts. */
  anim: number
  /** Where a pointer drag began, for swipes. */
  drag?: [number, number]
  isOver: boolean
}

function spawn(grid: number[], rng: number): { grid: number[]; rng: number } {
  const empty = grid.flatMap((v, i) => (v === 0 ? [i] : []))
  if (empty.length === 0) return { grid, rng }
  const [pick, r1] = int(rng, empty.length)
  const [f, r2] = next(r1)
  const out = [...grid]
  out[empty[pick] ?? 0] = f < 0.9 ? 2 : 4

  return { grid: out, rng: r2 }
}

/** The 4 lines a move slides along, each listed from the side tiles slide toward. */
function lines(dir: Dir): number[][] {
  const out: number[][] = []
  for (let i = 0; i < 4; i++) {
    const line: number[] = []
    for (let j = 0; j < 4; j++) {
      if (dir === 'left') line.push(i * 4 + j)
      if (dir === 'right') line.push(i * 4 + (3 - j))
      if (dir === 'up') line.push(j * 4 + i)
      if (dir === 'down') line.push((3 - j) * 4 + i)
    }
    out.push(line)
  }

  return out
}

/** Slides and merges; returns undefined when nothing would move. */
export function slide(grid: number[], dir: Dir): { grid: number[]; gained: number; merged: number[] } | undefined {
  const out = [...grid]
  let gained = 0
  const merged: number[] = []
  for (const line of lines(dir)) {
    const values = line.map(i => grid[i] ?? 0).filter(v => v !== 0)
    const result: number[] = []
    for (let k = 0; k < values.length; k++) {
      const v = values[k] ?? 0
      if (v === values[k + 1]) {
        result.push(v * 2)
        gained += v * 2
        merged.push(line[result.length - 1] ?? 0)
        k += 1
      } else {
        result.push(v)
      }
    }
    line.forEach((cell, k) => (out[cell] = result[k] ?? 0))
  }
  if (out.every((v, i) => v === grid[i])) return undefined

  return { grid: out, gained, merged }
}

const canMove = (grid: number[]) => (['up', 'down', 'left', 'right'] as const).some(d => slide(grid, d))

function play(s: State2048, dir: Dir): State2048 {
  if (s.isOver) return s
  const moved = slide(s.grid, dir)
  if (!moved) return s
  const spawned = spawn(moved.grid, s.rng)
  const maxTile = Math.max(...spawned.grid)
  const moves = s.moves + 1

  return {
    ...s,
    grid: spawned.grid,
    rng: spawned.rng,
    score: s.score + moved.gained,
    moves,
    maxTile,
    movesTo2048: s.movesTo2048 === 0 && maxTile >= 2048 ? moves : s.movesTo2048,
    pop: moved.merged,
    anim: moved.merged.length > 0 ? 3 : 0,
    isOver: !canMove(spawned.grid),
  }
}

/** Tile sizes: roomy where 17 rows fit, compact in a terminal's inline pane (SPEC.md §10.6). */
function layout(room: BoardRoom) {
  return room.rows >= 17 ? { tileW: 7, tileH: 3 } : { tileW: 6, tileH: 2 }
}

const tile = (n: number) => (n >= 4096 ? TILE_BIG : (TILES[Math.max(0, Math.log2(Math.max(2, n)) - 1)] ?? TILE_BIG))

const milestones: Milestone[] = [
  { id: '256', name: '256', goal: 'Make a 256 tile', check: f => (f.maxTile ?? 0) >= 256 },
  { id: '512', name: '512', goal: 'Make a 512 tile', check: f => (f.maxTile ?? 0) >= 512 },
  { id: '1024', name: '1024', goal: 'Make a 1024 tile', check: f => (f.maxTile ?? 0) >= 1024 },
  { id: '2048', name: '2048', goal: 'Make a 2048 tile', check: f => (f.maxTile ?? 0) >= 2048 },
  { id: '4096', name: '4096', goal: 'Make a 4096 tile', check: f => (f.maxTile ?? 0) >= 4096 },
  { id: 'twenty-thousand', name: 'Twenty thousand', goal: 'Score 20,000 in one game', check: f => (f.score ?? 0) >= 20000 },
  {
    id: 'efficient',
    name: 'Efficient',
    goal: 'Make 2048 in under 1,000 moves',
    check: f => (f.movesTo2048 ?? 0) > 0 && (f.movesTo2048 ?? 0) < 1000,
  },
  played(25),
]

export const game2048: GameDef<State2048> = {
  id: '2048',
  name: '2048',
  v: 1,
  kind: 'turn',
  lowerIsBetter: [],
  milestones,

  init: ({ seed }) => {
    const first = spawn(Array<number>(16).fill(0), seed)
    const second = spawn(first.grid, first.rng)

    return {
      grid: second.grid,
      score: 0,
      moves: 0,
      rng: second.rng,
      maxTile: Math.max(...second.grid),
      movesTo2048: 0,
      pop: [],
      anim: 0,
      isOver: false,
    }
  },

  key: (s, k) => {
    const dir = direction(k)

    return dir ? play(s, dir) : undefined
  },

  pointer: (s, p) => {
    if (p.type === 'down') return { ...s, drag: [p.x, p.y] }
    if (p.type !== 'up' || !s.drag) return undefined
    const dx = p.x - s.drag[0]
    const dy = (p.y - s.drag[1]) * 2 // a row is about two columns tall
    const rest = { ...s }
    delete rest.drag
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 3) return rest
    const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'

    return play(rest, dir)
  },

  tick: s => (s.anim > 0 ? { ...s, anim: s.anim - 1, pop: s.anim === 1 ? [] : s.pop } : undefined),

  over: s =>
    s.isOver
      ? {
          result: s.maxTile >= 2048 ? 'won' : 'ended',
          facts: game2048.facts(s),
          best: { score: s.score, tile: s.maxTile },
        }
      : undefined,

  facts: s => ({ score: s.score, maxTile: s.maxTile, moves: s.moves, movesTo2048: s.movesTo2048 }),

  isUnderway: s => s.moves > 0 && !s.isOver,

  size: (_s, room) => {
    const { tileW, tileH } = layout(room)

    return { columns: 4 * tileW + 5, rows: 4 * tileH + 5 }
  },

  draw: (s, { E, room, dim }) => {
    const { Box, Text } = E
    // Not `h`: JSX compiles to the global `h`, which a local of that name would hide.
    const { tileW, tileH } = layout(room)
    const color = (c: string) => (dim ? dimmed(c) : c)
    const rows = [0, 1, 2, 3].map(r => (
      <Box key={`row${r}`} flexDirection="row" gap={1}>
        {[0, 1, 2, 3].map(c => {
          const i = r * 4 + c
          const v = s.grid[i] ?? 0
          const bg = v === 0 ? TILES[0] ?? BOARD : tile(v)
          const isPopping = s.pop.includes(i) && s.anim > 0

          return (
            <Box
              key={`t${i}`}
              width={tileW}
              height={tileH}
              backgroundColor={color(bg)}
              justifyContent="center"
              alignItems="center"
            >
              {v > 0 ? (
                <Text bold color={color(isPopping ? '#ffffff' : inkOn(bg))}>
                  {String(v)}
                </Text>
              ) : null}
            </Box>
          )
        })}
      </Box>
    ))

    return (
      <Box flexDirection="column" gap={1} padding={1} backgroundColor={color(BOARD)}>
        {rows}
      </Box>
    )
  },

  status: (s, best) =>
    `${s.maxTile >= 2048 && s.movesTo2048 === s.moves ? '2048! ' : ''}score ${s.score.toLocaleString('en-US')} · best ${Math.max(best.score ?? 0, s.score).toLocaleString('en-US')}`,

  controls: () => ['←↑→↓ slide'],

  card: (s, _o, best) => ({
    title: s.maxTile >= 2048 ? `You made ${s.maxTile}!` : 'No moves left',
    lines: [
      `Score ${s.score.toLocaleString('en-US')} · ${s.moves} moves`,
      s.score > (best.score ?? 0) ? 'New best!' : `Best ${(best.score ?? 0).toLocaleString('en-US')}`,
    ],
  }),
}
