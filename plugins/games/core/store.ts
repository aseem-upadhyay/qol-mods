/**
 * The store's records and every change to them (SPEC.md §7, §8). Pure: the
 * hooks module reads a record, applies one of these, and writes it back in the
 * same hook, so parallel sessions merge instead of overwriting (§7.4).
 */

import type { GameId, GameRecord, Outcome, Profile, Save, Stats } from '../types'

export const SCHEMA = 1

export const gameKey = (id: GameId) => `game:${id}`

export function emptyStats(): Stats {
  return { played: 0, won: 0, lost: 0, totalMs: 0, best: {}, streak: { current: 0, best: 0, at: 0 }, extra: {} }
}

export function emptyRecord(): GameRecord {
  return { stats: emptyStats(), milestones: {} }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

function numbers(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (isObject(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'number' && Number.isFinite(x)) out[k] = x

  return out
}

function readSave(v: unknown): Save | undefined {
  if (!isObject(v) || typeof v.v !== 'number' || !('state' in v)) return undefined

  return { v: v.v, at: num(v.at), state: v.state }
}

/** A record as stored, or a fresh one: anything malformed reads as its default (§7.3). */
export function readRecord(value: unknown): GameRecord {
  if (!isObject(value)) return emptyRecord()
  const s = isObject(value.stats) ? value.stats : {}
  const streak = isObject(s.streak) ? s.streak : {}
  const record: GameRecord = {
    stats: {
      played: num(s.played),
      won: num(s.won),
      lost: num(s.lost),
      totalMs: num(s.totalMs),
      best: numbers(s.best),
      streak: { current: num(streak.current), best: num(streak.best), at: num(streak.at) },
      extra: numbers(s.extra),
    },
    milestones: numbers(value.milestones),
  }
  if (typeof s.lastPlayedAt === 'number') record.stats.lastPlayedAt = s.lastPlayedAt
  const save = readSave(value.save)
  if (save) record.save = save
  if (isObject(value.daily) && typeof value.daily.date === 'string') {
    const daily: NonNullable<GameRecord['daily']> = { date: value.daily.date }
    const dailySave = readSave(value.daily.save)
    if (dailySave) daily.save = dailySave
    if ('result' in value.daily) daily.result = value.daily.result
    record.daily = daily
  }

  return record
}

export function readProfile(value: unknown): Profile {
  if (!isObject(value)) return {}
  const profile: Profile = {}
  if (typeof value.firstPlayedAt === 'number') profile.firstPlayedAt = value.firstPlayedAt
  if (typeof value.lastGame === 'string') profile.lastGame = value.lastGame as GameId

  return profile
}

/** Days since 1970-01-01 for a YYYY-MM-DD date. */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)

  return Math.round(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86400000)
}

/** A finished game: counters add, bests keep the better, the streak moves, the save goes (§7.4). */
export function applyOutcome(
  record: GameRecord,
  outcome: Outcome,
  lowerIsBetter: readonly string[],
  at: number,
): GameRecord {
  const stats: Stats = {
    ...record.stats,
    best: { ...record.stats.best },
    extra: { ...record.stats.extra },
    streak: { ...record.stats.streak },
  }
  stats.played += 1
  if (outcome.result === 'won') stats.won += 1
  if (outcome.result === 'lost') stats.lost += 1
  stats.totalMs += Math.max(0, outcome.ms)
  stats.lastPlayedAt = at

  for (const [key, value] of Object.entries(outcome.best)) {
    const old = stats.best[key]
    const isLower = lowerIsBetter.includes(key)
    if (old === undefined || (isLower ? value < old : value > old)) stats.best[key] = value
  }
  for (const [key, value] of Object.entries(outcome.extra ?? {})) stats.extra[key] = (stats.extra[key] ?? 0) + value

  if (outcome.daily !== undefined) {
    // A daily streak counts consecutive dates: a gap or a loss starts it again.
    const day = dayNumber(outcome.daily)
    const last = stats.extra.streakDay
    if (outcome.streak === 'won') stats.streak.current = last === day - 1 ? stats.streak.current + 1 : last === day ? stats.streak.current : 1
    if (outcome.streak === 'lost') stats.streak.current = 0
    stats.extra.streakDay = day
  } else if (outcome.streak === 'won') {
    stats.streak.current += 1
  } else if (outcome.streak === 'lost') {
    stats.streak.current = 0
  }
  if (outcome.streak) stats.streak.at = at
  stats.streak.best = Math.max(stats.streak.best, stats.streak.current)

  const next: GameRecord = { ...record, stats }
  if (outcome.daily !== undefined) {
    next.daily = { date: outcome.daily, result: { result: outcome.result, facts: outcome.facts } }
  } else {
    delete next.save
  }

  return next
}

/** A game in progress saved, or cleared with null; the last writer wins (§7.4). */
export function applySave(record: GameRecord, save: Save | null, daily?: string): GameRecord {
  if (daily !== undefined) {
    const previous = record.daily?.date === daily ? record.daily : { date: daily }
    const next = { ...previous }
    if (save) next.save = save
    else delete next.save

    return { ...record, daily: next }
  }
  const next = { ...record }
  if (save) next.save = save
  else delete next.save

  return next
}

/** Milestones unlocked; one already there keeps its earlier date. */
export function unlock(record: GameRecord, ids: readonly string[], at: number): GameRecord {
  if (ids.length === 0) return record
  const milestones = { ...record.milestones }
  for (const id of ids) if (milestones[id] === undefined) milestones[id] = at

  return { ...record, milestones }
}

/** Reset: stats and save always, milestones only when asked (§8.3). */
export function resetRecord(record: GameRecord, milestones: boolean): GameRecord {
  return milestones ? emptyRecord() : { stats: emptyStats(), milestones: record.milestones }
}
