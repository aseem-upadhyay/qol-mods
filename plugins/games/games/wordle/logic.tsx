/** Wordle (SPEC.md §10.12): a daily puzzle and unlimited practice. */

import { isEnter } from '../../core/game'
import type { GameDef } from '../../core/game'
import type { Milestone } from '../../core/milestones'
import { BOARD, dim as dimmed, EDGE, inkOn, INK, wordleColors } from '../../core/palette'
import { int } from '../../core/rng'
import { dayNumber } from '../../core/store'
import type { Outcome } from '../../types'
import { ANSWERS } from '../../words/wordle-answers'
import { GUESSES } from '../../words/wordle-guesses'

type Mark = 'correct' | 'present' | 'absent'

export type WordleState = {
  answer: string
  guesses: string[]
  current: string
  /** The daily puzzle's date, or absent for practice. */
  date?: string
  isHard: boolean
  /** Ticks left on the "not a word" shake and its message. */
  shake: number
  message: string
  isOver: boolean
  isWon: boolean
}

const EPOCH = dayNumber('2026-01-01')
const ROWS = 6
const KEYS = ['qwertyuiop', 'asdfghjkl', '⏎zxcvbnm⌫'] as const
const TILE_EMPTY = '#25282f'
const TILE_TYPED = '#33363f'
const KEY_UNKNOWN = '#4a5060'

const answerCount = ANSWERS.length / 5
const answerAt = (i: number) => ANSWERS.slice(i * 5, i * 5 + 5)

/** Today's daily word: day number since 2026-01-01, modulo the list (SPEC.md §10.12). */
export function dailyAnswer(today: string): string {
  const n = (((dayNumber(today) - EPOCH) % answerCount) + answerCount) % answerCount

  return answerAt(n)
}

/** Whether a word is an accepted guess: binary search over the sorted list. */
export function isWord(word: string): boolean {
  let lo = 0
  let hi = GUESSES.length / 5 - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const w = GUESSES.slice(mid * 5, mid * 5 + 5)
    if (w === word) return true
    if (w < word) lo = mid + 1
    else hi = mid - 1
  }

  return false
}

/** Green for the right letter in the right place, yellow for one elsewhere, counted so repeats come out right. */
export function score(guess: string, answer: string): Mark[] {
  const marks: Mark[] = Array<Mark>(5).fill('absent')
  const left: Record<string, number> = {}
  for (let i = 0; i < 5; i++) {
    const a = answer[i] ?? ''
    if (guess[i] === a) marks[i] = 'correct'
    else left[a] = (left[a] ?? 0) + 1
  }
  for (let i = 0; i < 5; i++) {
    const g = guess[i] ?? ''
    if (marks[i] !== 'correct' && (left[g] ?? 0) > 0) {
      marks[i] = 'present'
      left[g] = (left[g] ?? 0) - 1
    }
  }

  return marks
}

/** Hard mode: a guess must keep every green in place and use every yellow. */
export function hardModeMiss(s: WordleState, guess: string): string | undefined {
  for (const g of s.guesses) {
    const marks = score(g, s.answer)
    for (let i = 0; i < 5; i++) {
      const letter = (g[i] ?? '').toUpperCase()
      if (marks[i] === 'correct' && guess[i] !== g[i]) return `Letter ${i + 1} must be ${letter}`
      if (marks[i] === 'present' && !guess.includes(g[i] ?? '')) return `Guess must contain ${letter}`
    }
  }

  return undefined
}

/** Each letter's best state so far, for the keyboard. */
function keyStates(s: WordleState): Record<string, Mark> {
  const rank: Record<Mark, number> = { absent: 0, present: 1, correct: 2 }
  const out: Record<string, Mark> = {}
  for (const g of s.guesses) {
    score(g, s.answer).forEach((m, i) => {
      const letter = g[i] ?? ''
      const old = out[letter]
      if (old === undefined || rank[m] > rank[old]) out[letter] = m
    })
  }

  return out
}

function submit(s: WordleState): WordleState {
  if (s.current.length < 5) return { ...s, shake: 8, message: 'Not enough letters' }
  if (!isWord(s.current)) return { ...s, shake: 8, message: 'Not in word list' }
  const miss = s.isHard ? hardModeMiss(s, s.current) : undefined
  if (miss) return { ...s, shake: 8, message: miss }
  const guesses = [...s.guesses, s.current]
  const isWon = s.current === s.answer

  return { ...s, guesses, current: '', isWon, isOver: isWon || guesses.length >= ROWS, shake: 0, message: '' }
}

function typed(s: WordleState, key: string): WordleState | undefined {
  if (s.isOver) return undefined
  if (key === 'backspace' || key === 'delete' || key === '⌫') return { ...s, current: s.current.slice(0, -1) }
  if (key === 'return' || key === 'enter' || key === '⏎') return submit(s)
  if (/^[a-z]$/.test(key)) return s.current.length < 5 ? { ...s, current: s.current + key } : s

  return undefined
}

const milestones: Milestone[] = [
  { id: 'solved', name: 'Solved', goal: 'Solve a puzzle', check: f => f.solved === 1 },
  { id: 'in-three', name: 'In three', goal: 'Solve in 3 guesses', check: f => f.solved === 1 && (f.guesses ?? 9) <= 3 },
  { id: 'in-two', name: 'In two', goal: 'Solve in 2 guesses', check: f => f.solved === 1 && (f.guesses ?? 9) <= 2 },
  {
    id: 'week',
    name: 'Week',
    goal: 'A 7-day daily streak',
    of: 7,
    count: r => r.stats.streak.current,
    check: (_f, r, ended) => ended && r.stats.streak.current >= 7,
  },
  {
    id: 'month',
    name: 'Month',
    goal: 'A 30-day daily streak',
    of: 30,
    count: r => r.stats.streak.current,
    check: (_f, r, ended) => ended && r.stats.streak.current >= 30,
  },
  { id: 'hard-mode', name: 'Hard mode', goal: 'Solve a daily in hard mode', check: f => f.solved === 1 && f.hard === 1 && f.daily === 1 },
  {
    id: 'fifty',
    name: 'Fifty',
    goal: 'Solve 50 puzzles',
    of: 50,
    count: r => r.stats.extra.solved ?? 0,
    check: (_f, r, ended) => ended && (r.stats.extra.solved ?? 0) >= 50,
  },
  { id: 'hole-in-one', name: 'Hole in one', goal: 'Solve in 1 guess', check: f => f.solved === 1 && f.guesses === 1 },
]

/** The tile rows, the gap, then the keyboard: where each row starts, in board rows. */
const KEYBOARD_TOP = ROWS * 2

/** Where keyboard row `r` starts, in columns: rows are centered in the board's 39 columns. */
const keyRowLeft = (r: number) => Math.floor((39 - ((KEYS[r]?.length ?? 0) * 4 - 1)) / 2)

export const wordle: GameDef<WordleState> = {
  id: 'wordle',
  name: 'Wordle',
  v: 1,
  kind: 'turn',
  isWordy: true,
  lowerIsBetter: ['guesses'],
  milestones,

  init: ({ seed, today, record, settings, isPractice }) => {
    const isDailyDone = record.daily?.date === today && record.daily.result !== undefined
    const base = { guesses: [], current: '', isHard: settings.wordleHardMode, shake: 0, message: '', isOver: false, isWon: false }
    if (!isPractice && !isDailyDone) return { ...base, answer: dailyAnswer(today), date: today }
    // Practice: any answer but today's.
    const daily = dailyAnswer(today)
    let [i] = int(seed, answerCount)
    if (answerAt(i) === daily) i = (i + 1) % answerCount

    return { ...base, answer: answerAt(i) }
  },

  key: (s, k) => typed(s, k.key.length === 1 ? k.key.toLowerCase() : isEnter(k) ? 'return' : k.key),

  pointer: (s, p) => {
    if (p.type !== 'down') return undefined
    const r = p.y - KEYBOARD_TOP
    const row = KEYS[r]
    if (!row) return undefined
    const i = Math.floor((p.x - keyRowLeft(r)) / 4)
    const inKey = (p.x - keyRowLeft(r)) % 4 < 3
    const key = i >= 0 && inKey ? row[i] : undefined

    return key ? typed(s, key) : undefined
  },

  tick: s => (s.shake > 0 ? { ...s, shake: s.shake - 1, message: s.shake === 1 && !s.isOver ? '' : s.message } : undefined),

  over: s => {
    if (!s.isOver) return undefined
    const outcome: Omit<Outcome, 'ms'> = {
      result: s.isWon ? 'won' : 'lost',
      facts: wordle.facts(s),
      best: s.isWon ? { guesses: s.guesses.length } : {},
      extra: s.isWon ? { solved: 1 } : {},
    }
    if (s.date !== undefined) {
      outcome.streak = s.isWon ? 'won' : 'lost'
      outcome.daily = s.date
    }

    return outcome
  },

  facts: s => ({
    solved: s.isWon ? 1 : 0,
    guesses: s.guesses.length,
    hard: s.isHard ? 1 : 0,
    daily: s.date !== undefined ? 1 : 0,
  }),

  isUnderway: s => s.guesses.length > 0 && !s.isOver,

  size: () => ({ columns: 39, rows: KEYBOARD_TOP + KEYS.length }),

  draw: (s, { E, settings, dim }) => {
    const { Box, Text } = E
    const marks = wordleColors(settings.highContrast)
    const color = (c: string) => (dim ? dimmed(c) : c)
    const keys = keyStates(s)
    const shift = s.shake > 0 ? [0, 1, 0, -1][s.shake % 4] ?? 0 : 0

    const tileRows = Array.from({ length: ROWS }, (_, r) => {
      const guess = s.guesses[r]
      const isCurrent = r === s.guesses.length
      const letters = guess ?? (isCurrent ? s.current : '')
      const rowMarks = guess ? score(guess, s.answer) : undefined

      return (
        <Box key={`g${r}`} flexDirection="row" gap={1} marginLeft={10 + (isCurrent ? shift : 0)} height={1}>
          {Array.from({ length: 5 }, (_, i) => {
            const letter = letters[i]
            const bg = rowMarks ? marks[rowMarks[i] ?? 'absent'] : letter ? TILE_TYPED : TILE_EMPTY

            return (
              <Box key={`t${i}`} width={3} height={1} backgroundColor={color(bg)} justifyContent="center">
                <Text bold color={color(rowMarks ? inkOn(bg) : INK)}>
                  {(letter ?? ' ').toUpperCase()}
                </Text>
              </Box>
            )
          })}
        </Box>
      )
    })

    const keyRows = KEYS.map((row, r) => (
      <Box key={`k${r}`} flexDirection="row" gap={1} marginLeft={keyRowLeft(r)} height={1}>
        {row.split('').map(k => {
          const state = keys[k]
          const bg = state ? marks[state] : KEY_UNKNOWN

          return (
            <Box key={`key${k}`} width={3} height={1} backgroundColor={color(bg)} justifyContent="center">
              <Text color={color(state ? inkOn(bg) : INK)}>{k.toUpperCase()}</Text>
            </Box>
          )
        })}
      </Box>
    ))

    return (
      <Box flexDirection="column" width={39} backgroundColor={color(BOARD)}>
        {tileRows.flatMap((row, r) => (r < ROWS - 1 ? [row, <Box key={`gap${r}`} height={1} />] : [row]))}
        <Box height={1} justifyContent="center">
          <Text color={color(s.message ? INK : EDGE)}>{s.message || ' '}</Text>
        </Box>
        {keyRows}
      </Box>
    )
  },

  status: (s, best) => {
    const mode = s.date !== undefined ? 'Daily' : 'Practice'

    return `${mode}${s.isHard ? ' · hard' : ''}${best.guesses !== undefined ? ` · best ${best.guesses}` : ''}`
  },

  controls: s => (s.isOver ? ['N new practice'] : ['type a word', '⏎ enter', '⌫ delete', 'N practice']),

  card: s =>
    s.isWon
      ? {
          title: s.guesses.length === 1 ? 'Hole in one!' : `Solved in ${s.guesses.length}`,
          lines: [s.answer.toUpperCase(), ...(s.date !== undefined ? ['daily done'] : [])],
          hint: s.date !== undefined ? 'N practice · H hub' : 'N another · H hub',
        }
      : { title: `The word was ${s.answer.toUpperCase()}`, lines: [], hint: 'N another · H hub' },

  daily: s => s.date,
}
