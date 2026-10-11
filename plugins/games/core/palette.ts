/** Colors (SPEC.md §9.2): raw hex on the board's own dark background, the same in both themes. */

export const BOARD = '#1b1d23'
export const EDGE = '#2b2e37'
export const EMPTY = '#3a3d46'
export const INK = '#e6e6e6'
export const GREEN = '#5fbf6a'
export const RED = '#e5534b'
export const YELLOW = '#e3b341'
export const ORANGE = '#f08c3a'
export const CYAN = '#4fc1e9'
export const BLUE = '#4a8fe7'
export const PURPLE = '#a77de8'
export const GRAY = '#9aa0a6'

/** 2048's tiles, from 2 to 2048, then 4096 and up. */
export const TILES: readonly string[] = [
  '#3f4350', '#4a5060', '#e4a04b', '#ea8a3e', '#ec6f3e', '#e9573f',
  '#e8c34f', '#e8bd3e', '#e7b82f', '#e6b31f', '#e5ae10',
]
export const TILE_BIG = '#c06bd8'

/** Minesweeper's numbers 1–8. */
export const NUMBERS: readonly string[] = [BLUE, GREEN, RED, PURPLE, '#d9822b', '#3fb8af', INK, GRAY]

/** Wordle's states, normal and high contrast (SPEC.md §11). */
export function wordleColors(highContrast: boolean) {
  return highContrast
    ? { correct: ORANGE, present: CYAN, absent: EMPTY }
    : { correct: GREEN, present: YELLOW, absent: EMPTY }
}

const hex = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))

/** A color pulled most of the way to the board's, for a paused or finished board. */
export function dim(color: string, amount = 0.6): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color
  const [r, g, b] = hex(color)
  const [br, bg, bb] = hex(BOARD)
  const mix = (a = 0, z = 0) => Math.round(a + (z - a) * amount).toString(16).padStart(2, '0')

  return `#${mix(r, br)}${mix(g, bg)}${mix(b, bb)}`
}

/** Text on a colored tile: dark on light tiles, light on dark ones. */
export function inkOn(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return INK
  const [r = 0, g = 0, b = 0] = hex(color)

  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? BOARD : '#ffffff'
}
