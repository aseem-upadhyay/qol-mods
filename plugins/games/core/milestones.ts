/**
 * Milestones (SPEC.md §5.4): each game's table is data plus one predicate per
 * row. The hooks module evaluates them, the board draws them, so both import
 * this file.
 */

import type { Facts, GameRecord } from '../types'

export type Milestone = {
  id: string
  name: string
  /** How to get it, shown whether it's unlocked or not. */
  goal: string
  /** Count-based: the target and how far the record is (shown as "12 of 25"). */
  of?: number
  count?: (record: GameRecord) => number
  /**
   * Whether the facts of the game under way (or just ended) and the record,
   * with that game already applied when `ended`, earn it.
   */
  check: (facts: Facts, record: GameRecord, ended: boolean) => boolean
}

/** The ids newly earned: not yet in the record, and checked true. */
export function evaluate(table: readonly Milestone[], facts: Facts, record: GameRecord, ended: boolean): string[] {
  return table.filter(m => record.milestones[m.id] === undefined && m.check(facts, record, ended)).map(m => m.id)
}

/** A count-based milestone over the record, or undefined. */
export function progress(m: Milestone, record: GameRecord): { at: number; of: number } | undefined {
  if (m.of === undefined || !m.count) return undefined

  return { at: Math.min(m.of, m.count(record)), of: m.of }
}

/** Shorthand for "this many games played". */
export const played = (n: number, id = 'regular', name = 'Regular', goal = `Play ${n} games`): Milestone => ({
  id,
  name,
  goal,
  of: n,
  count: r => r.stats.played,
  check: (_f, r) => r.stats.played >= n,
})
