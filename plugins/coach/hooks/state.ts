/**
 * How the person's choices are kept in $.store (SPEC.md §12.2): one key per
 * field, lists capped. The $.state values and the calls that read and write
 * both live in register.tsx, where `$` is.
 */
import type { Choices } from '../types'
import { EMPTY_CHOICES } from './select'

/** The $.store keys the choices are kept under, one per field. */
export const STORE_KEYS: (keyof Choices)[] = [
  'firstReportWeek',
  'lastSeenWeek',
  'habitLog',
  'tips',
  'notRight',
  'hints',
  'grading',
  'adoptions',
  'barHidden',
]

/** Lists kept short, so the store stays well under its 4 MiB. */
export function capped<K extends keyof Choices>(key: K, value: Choices[K]): Choices[K] {
  if (key === 'habitLog') return (value as Choices['habitLog']).slice(-104) as Choices[K]
  if (key === 'notRight') return (value as Choices['notRight']).slice(-200) as Choices[K]
  if (key === 'grading') {
    const entries = Object.entries(value as Choices['grading']).sort(([a], [b]) => (a < b ? -1 : 1))
    return Object.fromEntries(entries.slice(-52)) as Choices[K]
  }
  if (key === 'adoptions') {
    const entries = Object.entries(value as Choices['adoptions']).sort(([, a], [, b]) => a.at - b.at)
    return Object.fromEntries(entries.slice(-200)) as Choices[K]
  }
  return value
}

/** Stored values over the defaults; anything malformed keeps its default. */
export function choicesFrom(stored: Partial<Record<keyof Choices, unknown>>): Choices {
  const out: Choices = { ...EMPTY_CHOICES, hints: { ...EMPTY_CHOICES.hints } }
  const kinds: Record<keyof Choices, (v: unknown) => boolean> = {
    firstReportWeek: v => typeof v === 'string' || v === null,
    lastSeenWeek: v => typeof v === 'string' || v === null,
    habitLog: Array.isArray,
    tips: v => !!v && typeof v === 'object' && !Array.isArray(v),
    notRight: Array.isArray,
    hints: v => !!v && typeof v === 'object' && Array.isArray((v as Choices['hints']).off),
    grading: v => !!v && typeof v === 'object' && !Array.isArray(v),
    adoptions: v => !!v && typeof v === 'object' && !Array.isArray(v),
    barHidden: v => typeof v === 'boolean',
  }
  for (const key of STORE_KEYS) {
    const value = stored[key]
    if (value !== undefined && kinds[key](value)) (out as Record<string, unknown>)[key] = value
  }
  return out
}
