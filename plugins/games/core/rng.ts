/**
 * A seeded generator whose state is one number, so it travels in a save
 * (SPEC.md §3, decision 6). mulberry32: fast, and good enough for games.
 */

/** Returns a float in [0, 1) and the next seed. */
export function next(seed: number): [number, number] {
  const s = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s]
}

/** Returns an integer in [0, n) and the next seed. */
export function int(seed: number, n: number): [number, number] {
  const [f, s] = next(seed)

  return [Math.floor(f * n), s]
}

/** A seed from a number such as a timestamp. */
export function seedFrom(n: number): number {
  return next(Math.floor(n) | 0)[1] ^ 0x9e3779b9
}
