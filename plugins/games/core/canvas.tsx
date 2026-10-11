/**
 * The cell canvas (SPEC.md §9.3): a frame of cells drawn as Box cells, 2
 * columns × 1 row each, or in a terminal as half-blocks, 1 column × half a row.
 * Neighbouring cells of one color are packed into one Box or Text.
 */

import type { ClientElements, RenderElement } from 'claude-code'

import { BOARD, dim as dimmed } from './palette'

/** A plain color, or a colored cell with a glyph on it (Box mode only). */
export type Cell = string | { bg: string; ch: string; fg: string; bold?: boolean }

export type Frame = Cell[][]

export type Mode = 'box' | 'half'

const bgOf = (c: Cell) => (typeof c === 'string' ? c : c.bg)

/** Columns and rows a frame of `w` × `h` cells takes in a mode. */
export function footprint(w: number, h: number, mode: Mode) {
  return mode === 'box' ? { columns: w * 2, rows: h } : { columns: w, rows: Math.ceil(h / 2) }
}

/** The mode a board of `w` × `h` cells draws in, given the room: Box cells if they fit, else half-blocks in a terminal. */
export function modeFor(w: number, h: number, room: { columns: number; rows: number; surface: string }): Mode {
  const box = footprint(w, h, 'box')
  if (box.rows <= room.rows && box.columns <= room.columns) return 'box'

  return room.surface === 'terminal' ? 'half' : 'box'
}

export function paint(E: ClientElements, frame: Frame, mode: Mode, dim = false): RenderElement {
  const { Box, Text } = E
  const color = (c: string) => (dim ? dimmed(c) : c)

  if (mode === 'half') {
    const rows: RenderElement[] = []
    for (let y = 0; y < frame.length; y += 2) {
      const top = frame[y] ?? []
      const bottom = frame[y + 1] ?? []
      const runs: { fg: string; bg: string; n: number }[] = []
      for (let x = 0; x < top.length; x++) {
        const fg = color(bgOf(top[x] ?? BOARD))
        const bg = color(bgOf(bottom[x] ?? BOARD))
        const last = runs[runs.length - 1]
        if (last && last.fg === fg && last.bg === bg) last.n += 1
        else runs.push({ fg, bg, n: 1 })
      }
      rows.push(
        <Box key={`h${y}`} flexDirection="row">
          {runs.map((r, i) => (
            <Text key={`r${i}`} color={r.fg} backgroundColor={r.bg}>
              {'▀'.repeat(r.n)}
            </Text>
          ))}
        </Box>,
      )
    }

    return <Box flexDirection="column">{rows}</Box>
  }

  const rows: RenderElement[] = []
  frame.forEach((row, y) => {
    const parts: RenderElement[] = []
    let run: { bg: string; n: number } | null = null
    const flush = () => {
      if (run) parts.push(<Box key={`b${parts.length}`} width={run.n * 2} height={1} backgroundColor={color(run.bg)} />)
      run = null
    }
    for (const cell of row) {
      if (typeof cell === 'string') {
        if (run && run.bg === cell) run.n += 1
        else {
          flush()
          run = { bg: cell, n: 1 }
        }
      } else {
        flush()
        parts.push(
          <Box key={`g${parts.length}`} width={2} height={1} backgroundColor={color(cell.bg)} justifyContent="center">
            <Text color={color(cell.fg)} bold={cell.bold}>
              {cell.ch}
            </Text>
          </Box>,
        )
      }
    }
    flush()
    rows.push(
      <Box key={`r${y}`} flexDirection="row" height={1}>
        {parts}
      </Box>,
    )
  })

  return <Box flexDirection="column">{rows}</Box>
}

/** A blank frame of `w` × `h` cells. */
export function blank(w: number, h: number, fill = BOARD): Frame {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => fill))
}
