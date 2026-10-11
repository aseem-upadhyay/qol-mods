/**
 * What games draws for the README's pictures, as JSON on stdout, for
 * scripts/games-assets.py to set in its images.
 *
 * Run by that script: bun scripts/games-art.ts
 *
 * Each board is the game's own `draw` on a made-up position, and the list of
 * games is the board module's own hub on made-up records. A small element
 * table records the trees they return, and a small layout pass places them on
 * the character grid the way Box and Text do, for the props the games use:
 * row and column, width and height, gap, padding, margins, centering, grow.
 * Out come rectangles and runs of text, in columns and rows.
 */
import type { AnyGame } from '../plugins/games/core/game'
import { emptyRecord } from '../plugins/games/core/store'
import { game2048 } from '../plugins/games/games/2048/logic'
import { connect4, winLine } from '../plugins/games/games/connect4/logic'
import type { Connect4State } from '../plugins/games/games/connect4/logic'
import { mines } from '../plugins/games/games/mines/logic'
import type { MinesState } from '../plugins/games/games/mines/logic'
import { snake } from '../plugins/games/games/snake/logic'
import type { SnakeState } from '../plugins/games/games/snake/logic'
import { fits, tetris } from '../plugins/games/games/tetris/logic'
import type { TetrisState } from '../plugins/games/games/tetris/logic'
import { wordle } from '../plugins/games/games/wordle/logic'
import type { WordleState } from '../plugins/games/games/wordle/logic'
import Board from '../plugins/games/hooks/board'
import type { BoardProps, GameRecord, Records } from '../plugins/games/types'

// ---------------------------------------------------------------- elements and layout

type Props = Record<string, unknown>
type Node = { tag: string; props: Props; kids: (Node | string)[] }

const flat = (kids: unknown[]): (Node | string)[] =>
  kids.flatMap(k => (Array.isArray(k) ? flat(k) : k === null || k === undefined || k === false || k === true ? [] : [typeof k === 'object' ? (k as Node) : String(k)]))

// JSX in the plugin's modules compiles to the global `h`.
;(globalThis as unknown as { h: unknown; Fragment: unknown }).h = (tag: unknown, props: Props | null, ...kids: unknown[]) =>
  typeof tag === 'function' ? (tag as (p: Props) => Node)({ ...(props ?? {}), children: kids }) : ({ tag: String(tag), props: props ?? {}, kids: flat(kids) })
;(globalThis as unknown as { Fragment: string }).Fragment = 'Box'

const element = (tag: string) => (props: Props) => ({ tag, props, kids: flat([props.children]) })
const E = Object.fromEntries(['Box', 'Text', 'Button', 'Input', 'Select', 'Link', 'Code', 'Markdown'].map(t => [t, element(t)]))

type Rect = { kind: 'rect'; x: number; y: number; w: number; h: number; color: string }
type Run = { kind: 'text'; x: number; y: number; text: string; color?: string; bg?: string; bold?: boolean; dim?: boolean }
type Prim = Rect | Run

const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : d)
const textOf = (n: Node | string): string => (typeof n === 'string' ? n : n.kids.map(textOf).join(''))
const len = (s: string) => [...s].length

function pad(p: Props) {
  const all = num(p.padding)
  return {
    l: num(p.paddingLeft, num(p.paddingX, all)),
    r: num(p.paddingRight, num(p.paddingX, all)),
    t: num(p.paddingTop, num(p.paddingY, all)),
    b: num(p.paddingBottom, num(p.paddingY, all)),
  }
}

function measure(n: Node | string): { w: number; h: number } {
  if (typeof n === 'string') return { w: len(n), h: 1 }
  if (n.tag === 'Text') return { w: len(textOf(n)), h: 1 }
  if (n.tag === 'Button') return { w: len(String(n.props.label ?? textOf(n))) + (n.props.hotkey ? 3 : 0), h: 1 }
  const p = n.props
  const isRow = p.flexDirection !== 'column'
  const gap = num(p.gap, isRow ? num(p.columnGap) : num(p.rowGap))
  const kids = n.kids.filter(k => typeof k !== 'string' || k.length > 0)
  const sizes = kids.map(k => {
    const s = measure(k)
    const ml = typeof k === 'string' ? 0 : num(k.props.marginLeft)
    return { w: s.w + ml, h: s.h }
  })
  const pd = pad(p)
  const inner = isRow
    ? { w: sizes.reduce((a, s) => a + s.w, 0) + gap * Math.max(0, sizes.length - 1), h: Math.max(0, ...sizes.map(s => s.h)) }
    : { w: Math.max(0, ...sizes.map(s => s.w)), h: sizes.reduce((a, s) => a + s.h, 0) + gap * Math.max(0, sizes.length - 1) }
  return {
    w: typeof p.width === 'number' ? p.width : inner.w + pd.l + pd.r,
    h: typeof p.height === 'number' ? p.height : inner.h + pd.t + pd.b,
  }
}

function place(n: Node | string, x: number, y: number, out: Prim[], width?: number, inherit: Props = {}) {
  if (typeof n === 'string') {
    out.push({ kind: 'text', x, y, text: n, color: inherit.color as string | undefined, bold: inherit.bold === true, dim: inherit.dimColor === true })
    return
  }
  const p = n.props
  if (n.tag === 'Text') {
    let cx = x
    for (const k of n.kids) {
      const props = typeof k === 'string' ? { ...inherit, ...p } : { ...inherit, ...p, ...k.props }
      const text = textOf(k)
      out.push({
        kind: 'text',
        x: cx,
        y,
        text,
        color: props.color as string | undefined,
        bg: props.backgroundColor as string | undefined,
        bold: props.bold === true,
        dim: props.dimColor === true,
      })
      cx += len(text)
    }
    return
  }
  if (n.tag === 'Button') {
    const label = String(p.label ?? textOf(n))
    out.push({ kind: 'text', x, y, text: p.hotkey ? `${p.hotkey}: ${label}` : label, color: '#e6e6e6', bold: false })
    return
  }
  const size = measure(n)
  const w = typeof p.width === 'number' ? p.width : (width ?? size.w)
  const h = size.h
  if (typeof p.backgroundColor === 'string') out.push({ kind: 'rect', x, y, w, h, color: p.backgroundColor })
  const isRow = p.flexDirection !== 'column'
  const gap = num(p.gap, isRow ? num(p.columnGap) : num(p.rowGap))
  const pd = pad(p)
  const kids = n.kids.filter(k => typeof k !== 'string' || k.length > 0)
  const sizes = kids.map(measure)
  const innerW = w - pd.l - pd.r
  const innerH = h - pd.t - pd.b
  if (isRow) {
    const used = sizes.reduce((a, s, i) => a + s.w + (typeof kids[i] === 'string' ? 0 : num((kids[i] as Node).props.marginLeft)), 0) + gap * Math.max(0, kids.length - 1)
    const growers = kids.filter(k => typeof k !== 'string' && num(k.props.flexGrow) > 0).length
    const spare = Math.max(0, innerW - used)
    const each = growers ? Math.floor(spare / growers) : 0
    let cx = x + pd.l
    if (!growers && p.justifyContent === 'center') cx += Math.floor(spare / 2)
    if (!growers && p.justifyContent === 'space-between' && kids.length > 1) {
      const between = Math.floor(spare / (kids.length - 1))
      kids.forEach((k, i) => {
        place(k, cx, y + pd.t, out, undefined, inheritOf(p, inherit))
        cx += (sizes[i]?.w ?? 0) + between
      })
      return
    }
    kids.forEach((k, i) => {
      const s = sizes[i] ?? { w: 0, h: 0 }
      const ml = typeof k === 'string' ? 0 : num(k.props.marginLeft)
      const grow = typeof k !== 'string' && num(k.props.flexGrow) > 0 ? each : 0
      const cy = p.alignItems === 'center' ? y + pd.t + Math.floor((innerH - s.h) / 2) : y + pd.t
      place(k, cx + ml, cy, out, grow ? s.w + grow : undefined, inheritOf(p, inherit))
      cx += ml + s.w + grow + gap
    })
  } else {
    let cy = y + pd.t
    const used = sizes.reduce((a, s) => a + s.h, 0) + gap * Math.max(0, kids.length - 1)
    if (p.justifyContent === 'center') cy += Math.floor((innerH - used) / 2)
    kids.forEach((k, i) => {
      const s = sizes[i] ?? { w: 0, h: 0 }
      const ml = typeof k === 'string' ? 0 : num(k.props.marginLeft)
      const cx = p.alignItems === 'center' ? x + pd.l + Math.floor((innerW - s.w) / 2) : x + pd.l + ml
      const stretch = typeof k !== 'string' && k.tag === 'Box' && typeof k.props.width !== 'number' && p.alignItems !== 'center' ? innerW - ml : undefined
      place(k, cx, cy, out, stretch, inheritOf(p, inherit))
      cy += s.h + gap
    })
  }
}

const inheritOf = (p: Props, inherit: Props): Props => inherit

/**
 * Bun compiles the plugin's JSX through its own React-style runtime rather than
 * the global `h`: elements arrive as `{ type, props: { children } }`, `type`
 * the element table's constructor. This turns them into the nodes above.
 */
function normalize(v: unknown): (Node | string)[] {
  if (v === null || v === undefined || v === false || v === true) return []
  if (Array.isArray(v)) return v.flatMap(normalize)
  if (typeof v !== 'object') return [String(v)]
  const el = v as { type?: unknown; props?: Props; tag?: string; kids?: unknown[] }
  if (el.tag !== undefined) return [{ tag: el.tag, props: el.props ?? {}, kids: (el.kids ?? []).flatMap(normalize) }]
  if (typeof el.type === 'function') {
    const made = (el.type as (p: Props) => Node)(el.props ?? {})
    return [{ tag: made.tag, props: made.props, kids: normalize((el.props ?? {}).children) }]
  }
  if (typeof el.type === 'string') return [{ tag: el.type, props: el.props ?? {}, kids: normalize((el.props ?? {}).children) }]
  return []
}

function lay(raw: unknown, width?: number) {
  const tree = normalize(raw)[0] as Node
  const out: Prim[] = []
  place(tree, 0, 0, out, width)
  const size = measure(tree)
  return { columns: width ?? size.w, rows: size.h, prims: out }
}

// ---------------------------------------------------------------- the boards

const ROOM = { surface: 'desktop' as const, columns: 42, rows: 43 }
const SETTINGS = { highContrast: false, wordleHardMode: false }
const init = { room: ROOM, settings: SETTINGS, today: '2026-10-12', record: emptyRecord(), seed: 3 }

function board(def: AnyGame, s: unknown, best: Record<string, number> = {}) {
  const drawn = lay(def.draw(s, { E: E as never, room: ROOM, settings: SETTINGS, dim: false }))
  // A finished game shows its result where the controls were, as the pane does.
  const outcome = def.over(s)
  const result = outcome ? { ...def.card(s, outcome, best), isWon: outcome.result === 'won' } : undefined
  return { name: def.name, status: def.status(s, best), controls: def.controls(s), result, ...drawn }
}

/** Tetris: a stack with a hole to fill, a T on its way down and its ghost. */
function tetrisBoard() {
  const s0 = { ...tetris.init(init), isStarted: true } as TetrisState
  const rows = [
    '..........', '..........', '..........', '..........', '..........', '..........', '..........',
    '..........', '..........', '..........', '..........', '..........', '..........',
    '........OO', 'L.......OO', 'L..SS..ZZJ', 'LLSS..JZZJ', 'IIIIT.JJJJ', 'OOTTTZZSSL', 'OOZZ.LLLSL',
  ].join('')
  const s: TetrisState = { ...s0, grid: rows, piece: { kind: 'T', r: 2, x: 3, y: 4 }, queue: ['I', 'L', 'S', 'Z', 'O', 'J', 'T'], hold: 'S', score: 4804, lines: 18, level: 2 }
  if (!fits(s.grid, s.piece)) throw new Error('tetris piece does not fit')
  return board(tetris, s, { score: 12400 })
}

function game2048Board() {
  const s = { ...game2048.init(init), grid: [2, 4, 8, 2, 16, 32, 64, 4, 256, 128, 512, 8, 2048, 1024, 16, 2], score: 23640, moves: 1012, maxTile: 2048 }
  return board(game2048, s, { score: 23640 })
}

function wordleBoard() {
  let s: WordleState = { ...wordle.init(init), answer: 'crane', date: '2026-10-12' }
  for (const word of ['arise', 'cramp']) {
    for (const ch of word) s = wordle.key(s, { key: ch }) as WordleState
    s = wordle.key(s, { key: 'return' }) as WordleState
  }
  for (const ch of 'cra') s = wordle.key(s, { key: ch }) as WordleState
  return board(wordle, s, { guesses: 3 })
}

/** Minesweeper: the real logic, a first click and a few safe moves, two flags placed. */
function minesBoard() {
  let s = mines.init({ ...init, seed: 21 }) as MinesState
  s = mines.pointer?.(s, { type: 'down', x: 8, y: 4 }, ROOM) as MinesState
  const safe = Array.from({ length: 81 }, (_, i) => i).filter(i => !s.mineAt.includes(i) && s.cells[i] === 'h')
  for (const i of safe.slice(0, 9)) s = mines.pointer?.(s, { type: 'down', x: (i % 9) * 2, y: Math.floor(i / 9) }, ROOM) as MinesState
  for (const i of s.mineAt.slice(0, 2)) s = mines.pointer?.(s, { type: 'down', x: (i % 9) * 2, y: Math.floor(i / 9), shift: true }, ROOM) as MinesState
  return board(mines, { ...s, ms: 41_000 }, { 'time.easy': 48 })
}

/** Connect Four: red has just made four on a diagonal. */
function connect4Board() {
  const grid = ['.......', '.......', '...r...', '..ry...', '.ryy.y.', 'ryyr.rr'].join('')
  const won = winLine(grid)
  const s: Connect4State = { ...connect4.init(init), grid, level: 1, moves: 7, winner: won?.piece ?? '', line: won?.line ?? [], isDiagonal: true }
  return board(connect4, s)
}

function snakeBoard() {
  const body: [number, number][] = [[12, 4], [11, 4], [10, 4], [9, 4], [8, 4], [8, 5], [8, 6], [8, 7], [9, 7], [10, 7], [11, 7], [12, 7], [13, 7], [14, 7], [14, 8], [14, 9], [13, 9], [12, 9]]
  const s: SnakeState = { ...snake.init(init), body, dir: 'right', food: [16, 4], score: 15, isStarted: true }
  return board(snake, s, { score: 61 })
}

// ---------------------------------------------------------------- the hub

function record(o: Partial<GameRecord['stats']>, milestones: string[], extra: Partial<GameRecord> = {}): GameRecord {
  const r = emptyRecord()
  return { ...r, stats: { ...r.stats, ...o }, milestones: Object.fromEntries(milestones.map(m => [m, 1791000000000])), ...extra }
}

function hub(columns: number, rows: number, surface: 'desktop' | 'terminal') {
  const save = { v: 1, at: 0, state: snake.init(init) }
  const records: Records = {
    profile: {},
    games: {
      snake: record({ played: 23, best: { score: 61 } }, ['first-bite', 'twenty-five', 'fifty'], { save }),
      tetris: record({ played: 9, best: { score: 12400 } }, ['line', 'tetris', 'level-5']),
      breakout: record({ played: 4, best: { score: 640 } }, ['breakthrough', 'level-3']),
      dino: record({ played: 12, best: { score: 1204 } }, ['hop', 'five-hundred', 'night-run']),
      pong: record({ played: 5, won: 3 }, ['first-point', 'first-win']),
      '2048': record({ played: 6, best: { score: 23640 } }, ['256', '512', '1024', '2048']),
      mines: record({ played: 14, won: 6, best: { 'time.easy': 48 } }, ['cleared', 'quick']),
      lights: record({ played: 14, won: 14, best: { level: 14 } }, ['lights-off', 'ten']),
      memory: record({ played: 3, won: 3, best: { flips: 22 } }, ['matched']),
      connect4: record({ played: 8, won: 5 }, ['four', 'normal']),
      tictactoe: record({ played: 10, won: 4, extra: { draws: 6 } }, ['three', 'second', 'unbeaten']),
      wordle: record({ played: 31, won: 29, streak: { current: 6, best: 11, at: 0 } }, ['solved', 'in-three', 'week'], { daily: { date: '2026-10-11' } }),
      hangman: record({ played: 24, won: 18 }, ['saved', 'clean']),
    },
  }
  const props: BoardProps = {
    records,
    request: { screen: 'hub', n: 1 },
    pause: 0,
    settings: SETTINGS,
    room: { surface, columns, rows, placement: surface === 'desktop' ? 'dock' : 'inline' },
    today: '2026-10-12',
    now: 1791817200000,
    ack: { inst: '', id: 0 },
  }
  const surfaceStub = {
    elements: E,
    state: undefined,
    columns,
    rows,
    setState: () => {},
    every: () => () => {},
    onKey: () => () => {},
    onPointer: () => () => {},
    post: () => {},
  }
  const tree = (Board as unknown as (p: unknown, s: unknown) => unknown)(props, surfaceStub)
  return lay(tree, columns)
}

console.log(
  JSON.stringify({
    boards: { tetris: tetrisBoard(), '2048': game2048Board(), wordle: wordleBoard(), mines: minesBoard(), connect4: connect4Board(), snake: snakeBoard() },
    hubDesktop: hub(42, 45, 'desktop'),
    hubTerminal: hub(60, 17, 'terminal'),
  }),
)
