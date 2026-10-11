/** The 14 games (SPEC.md §1, §12): names, aliases, look, and which are playable yet. */

import type { AnyGame } from '../core/game'
import { BLUE, CYAN, GREEN, ORANGE, PURPLE, RED, YELLOW } from '../core/palette'
import { game2048 } from '../games/2048/logic'
import { breakout } from '../games/breakout/logic'
import { connect4 } from '../games/connect4/logic'
import { dino } from '../games/dino/logic'
import { hangman } from '../games/hangman/logic'
import { lights } from '../games/lights/logic'
import { memory } from '../games/memory/logic'
import { mines } from '../games/mines/logic'
import { pong } from '../games/pong/logic'
import { snake } from '../games/snake/logic'
import { tetris } from '../games/tetris/logic'
import { tictactoe } from '../games/tictactoe/logic'
import { wordle } from '../games/wordle/logic'
import type { GameId, GameRecord } from '../types'

export type Group = 'Arcade' | 'Puzzles' | 'Versus' | 'Words'

export type Entry = { id: GameId; name: string; group: Group; color: string; glyph: string; aliases: readonly string[] }

export const CATALOG: readonly Entry[] = [
  { id: 'snake', name: 'Snake', group: 'Arcade', color: GREEN, glyph: '■', aliases: [] },
  { id: 'tetris', name: 'Tetris', group: 'Arcade', color: PURPLE, glyph: '▦', aliases: [] },
  { id: 'breakout', name: 'Breakout', group: 'Arcade', color: ORANGE, glyph: '▤', aliases: [] },
  { id: 'dino', name: 'Dino Run', group: 'Arcade', color: GREEN, glyph: '♣', aliases: ['dino-run', 'dinorun'] },
  { id: 'pong', name: 'Pong', group: 'Arcade', color: CYAN, glyph: '▮', aliases: [] },
  { id: '2048', name: '2048', group: 'Puzzles', color: ORANGE, glyph: '◆', aliases: [] },
  { id: 'mines', name: 'Minesweeper', group: 'Puzzles', color: RED, glyph: '✸', aliases: ['minesweeper'] },
  { id: 'lights', name: 'Lights Out', group: 'Puzzles', color: YELLOW, glyph: '◼', aliases: ['lights-out', 'lightsout'] },
  { id: 'memory', name: 'Memory', group: 'Puzzles', color: BLUE, glyph: '♠', aliases: [] },
  { id: 'connect4', name: 'Connect Four', group: 'Versus', color: RED, glyph: '●', aliases: ['connect-four', 'connectfour', 'c4'] },
  { id: 'tictactoe', name: 'Tic-tac-toe', group: 'Versus', color: CYAN, glyph: '✕', aliases: ['tic-tac-toe', 'ttt', 'xo'] },
  { id: 'wordle', name: 'Wordle', group: 'Words', color: GREEN, glyph: '▣', aliases: [] },
  { id: 'hangman', name: 'Hangman', group: 'Words', color: PURPLE, glyph: '☐', aliases: [] },
  { id: 'twenty', name: '20 Questions', group: 'Words', color: BLUE, glyph: '?', aliases: ['20q', '20-questions', '20questions'] },
]

/** The games playable in this release (SPEC.md §14, phases 1 to 3). */
export const GAMES: Partial<Record<GameId, AnyGame>> = {
  snake,
  tetris,
  breakout,
  dino,
  pong,
  '2048': game2048,
  mines,
  lights,
  memory,
  connect4,
  tictactoe,
  wordle,
  hangman,
}

export const READY: readonly Entry[] = CATALOG.filter(e => GAMES[e.id] !== undefined)

const fold = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '')

/** A game by id, name or alias, ignoring case and hyphens; playable ones only. */
export function resolve(name: string): GameId | undefined {
  const want = fold(name)
  const hit = READY.find(e => [e.id, e.name, ...e.aliases].some(n => fold(n) === want))

  return hit?.id
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const old = row[j] ?? 0
      row[j] = Math.min((row[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = old
    }
  }

  return row[b.length] ?? 0
}

/** The closest playable game to a mistyped name, within an edit distance of 2 (SPEC.md §12). */
export function suggest(name: string): Entry | undefined {
  const want = fold(name)
  let best: { e: Entry; d: number } | undefined
  for (const e of READY)
    for (const n of [e.id, e.name, ...e.aliases]) {
      const d = distance(want, fold(n))
      if (d <= 2 && (!best || d < best.d)) best = { e, d }
    }

  return best?.e
}

const time = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

/** A game's headline stat in the hub (SPEC.md §10, each game's "Headline"). */
export function headline(id: GameId, record: GameRecord | undefined): string {
  if (!record || record.stats.played === 0) return ''
  const best = record.stats.best
  if (id === 'snake' || id === '2048' || id === 'tetris' || id === 'breakout' || id === 'dino')
    return best.score !== undefined ? `best ${best.score.toLocaleString('en-US')}` : ''
  if (id === 'pong') return `${record.stats.won} ${record.stats.won === 1 ? 'win' : 'wins'}`
  if (id === 'mines') return best['time.easy'] !== undefined ? `best ${time(best['time.easy'])}` : ''
  if (id === 'wordle') return `streak ${record.stats.streak.current}`
  if (id === 'lights') return best.level !== undefined ? `level ${best.level}` : ''
  if (id === 'memory') return best.flips !== undefined ? `best ${best.flips} flips` : ''
  if (id === 'connect4') return `${record.stats.won} ${record.stats.won === 1 ? 'win' : 'wins'}`
  if (id === 'tictactoe') return `${record.stats.won}W ${record.stats.extra.draws ?? 0}D`
  if (id === 'hangman') return `${record.stats.won} solved`

  return ''
}
