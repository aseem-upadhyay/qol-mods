/** Hangman (SPEC.md §10.13): coding words, dealt in a fixed shuffle with no repeats until all are used. */

import type { GameDef } from '../../core/game'
import type { Milestone } from '../../core/milestones'
import { dim as dimmed, EMPTY, GREEN, INK, inkOn, RED } from '../../core/palette'
import { int } from '../../core/rng'
import { WORDS } from '../../words/hangman'
import type { Category } from '../../words/hangman'

export const MAX_MISSES = 6
const KEYS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'] as const
const KEY_UNKNOWN = '#4a5060'
const CATEGORIES = Object.keys(WORDS) as Category[]

/** Every word with its category, shuffled once with a fixed seed: the deal order (SPEC.md §10.13). */
export const DEAL: readonly { word: string; category: Category }[] = (() => {
  const all = CATEGORIES.flatMap(category => (WORDS[category] ?? []).map(word => ({ word, category })))
  let rng = 20261011
  for (let i = all.length - 1; i > 0; i--) {
    const [j, next] = int(rng, i + 1)
    rng = next
    const t = all[i]
    const u = all[j]
    if (t && u) {
      all[i] = u
      all[j] = t
    }
  }

  return all
})()

export type HangmanState = {
  /** Where this word sits in the deal. */
  index: number
  word: string
  category: Category
  /** Letters guessed, in order. */
  guessed: string
  misses: number
  isOver: boolean
  isWon: boolean
}

/** The gallows, one more part a miss: head, body, arms, legs. */
export function gallows(misses: number): string[] {
  const part = (n: number, ch: string) => (misses >= n ? ch : ' ')

  return [
    ' ┌────┐ ',
    ` │    ${part(1, 'O')} `,
    ` │   ${part(3, '/')}${part(2, '|')}${part(4, '\\')}`,
    ` │   ${part(5, '/')} ${part(6, '\\')}`,
    ' │      ',
    '─┴──────',
  ]
}

function guess(s: HangmanState, letter: string): HangmanState {
  if (s.isOver || s.guessed.includes(letter)) return s
  const guessed = s.guessed + letter
  const misses = s.misses + (s.word.includes(letter) ? 0 : 1)
  const isWon = s.word.split('').every(ch => guessed.includes(ch))

  return { ...s, guessed, misses, isWon, isOver: isWon || misses >= MAX_MISSES }
}

/** The tile rows sit under the gallows, the word and a gap. */
const KEYBOARD_TOP = 9
const keyRowLeft = (r: number) => Math.floor((39 - ((KEYS[r]?.length ?? 0) * 4 - 1)) / 2)

const milestones: Milestone[] = [
  { id: 'saved', name: 'Saved', goal: 'Solve a word', check: f => f.won === 1 },
  { id: 'clean', name: 'Clean', goal: 'Solve with no misses', check: f => f.won === 1 && f.misses === 0 },
  {
    id: 'streak',
    name: 'Streak',
    goal: 'Solve 10 in a row',
    of: 10,
    count: r => r.stats.streak.current,
    check: (_f, r, ended) => ended && r.stats.streak.current >= 10,
  },
  {
    id: 'fifty',
    name: 'Fifty',
    goal: 'Solve 50 words',
    of: 50,
    count: r => r.stats.won,
    check: (_f, r, ended) => ended && r.stats.won >= 50,
  },
  {
    id: 'every-category',
    name: 'Every category',
    goal: 'Solve a word in each of the 4 categories',
    of: 4,
    count: r => CATEGORIES.filter(c => (r.stats.extra[`cat.${c}`] ?? 0) > 0).length,
    check: (_f, r, ended) => ended && CATEGORIES.every(c => (r.stats.extra[`cat.${c}`] ?? 0) > 0),
  },
  { id: 'long-one', name: 'Long one', goal: 'Solve a word of 12 letters or more', check: f => f.won === 1 && (f.length ?? 0) >= 12 },
]

export const hangman: GameDef<HangmanState> = {
  id: 'hangman',
  name: 'Hangman',
  v: 1,
  kind: 'turn',
  isWordy: true,
  lowerIsBetter: [],
  milestones,

  init: ({ record }) => {
    // The next word in the deal: no repeats until every word has come up.
    const index = (record.stats.extra.dealt ?? 0) % DEAL.length
    const next = DEAL[index] ?? DEAL[0] ?? { word: 'closure', category: 'Concepts' as Category }

    return { index, word: next.word, category: next.category, guessed: '', misses: 0, isOver: false, isWon: false }
  },

  key: (s, k) => (/^[a-z]$/.test(k.key) ? guess(s, k.key) : undefined),

  pointer: (s, p) => {
    if (p.type !== 'down') return undefined
    const r = p.y - KEYBOARD_TOP
    const row = KEYS[r]
    if (!row) return undefined
    const offset = p.x - keyRowLeft(r)
    const key = offset >= 0 && offset % 4 < 3 ? row[Math.floor(offset / 4)] : undefined

    return key ? guess(s, key) : undefined
  },

  over: s =>
    s.isOver
      ? {
          result: s.isWon ? 'won' : 'lost',
          facts: hangman.facts(s),
          best: {},
          extra: { dealt: 1, ...(s.isWon ? { [`cat.${s.category}`]: 1 } : {}) },
          streak: s.isWon ? 'won' : 'lost',
        }
      : undefined,

  facts: s => ({ won: s.isWon ? 1 : 0, misses: s.misses, length: s.word.length }),

  isUnderway: s => s.guessed.length > 0 && !s.isOver,

  size: () => ({ columns: 39, rows: KEYBOARD_TOP + KEYS.length }),

  draw: (s, { E, dim }) => {
    const { Box, Text } = E
    const color = (c: string) => (dim ? dimmed(c) : c)
    const art = gallows(s.misses)
    const slots = s.word
      .split('')
      .map(ch => (s.guessed.includes(ch) || s.isOver ? ch.toUpperCase() : '_'))
      .join(' ')

    return (
      <Box flexDirection="column" width={39}>
        {art.map((line, i) => (
          <Box key={`g${i}`} height={1} justifyContent="center">
            <Text color={color(s.misses >= MAX_MISSES ? RED : INK)}>{line}</Text>
          </Box>
        ))}
        <Box height={1} justifyContent="center">
          <Text bold color={color(s.isOver && !s.isWon ? RED : INK)}>
            {slots}
          </Text>
        </Box>
        <Box height={1} justifyContent="center">
          <Text dimColor>{s.category}</Text>
        </Box>
        <Box height={1} />
        {KEYS.map((row, r) => (
          <Box key={`k${r}`} flexDirection="row" gap={1} marginLeft={keyRowLeft(r)} height={1}>
            {row.split('').map(ch => {
              const isTried = s.guessed.includes(ch)
              const bg = !isTried ? KEY_UNKNOWN : s.word.includes(ch) ? GREEN : EMPTY

              return (
                <Box key={`key${ch}`} width={3} height={1} backgroundColor={color(bg)} justifyContent="center">
                  <Text color={color(isTried && s.word.includes(ch) ? inkOn(bg) : INK)} dimColor={isTried && !s.word.includes(ch)}>
                    {ch.toUpperCase()}
                  </Text>
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    )
  },

  status: s => `${MAX_MISSES - s.misses} misses left`,

  controls: () => ['type a letter', 'or click one'],

  card: s =>
    s.isWon
      ? { title: 'Saved!', lines: [s.word, s.misses === 0 ? 'no misses' : `${s.misses} misses`], hint: 'N next · H hub' }
      : { title: `It was ${s.word}`, lines: [], hint: 'N next · H hub' },
}
