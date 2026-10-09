import { expect, test } from 'claude-code/testing'

import { isVague, normalize, overlap, rareHashes, stableHash } from '../hooks/normalize'
import { REPORT } from './fixtures/report'
import { CASES } from './fixtures/normalize'

// The same vectors patterns.py's tests run: a prompt typed now must match what scan.py found.
for (const c of CASES) {
  test(`normalizes like patterns.py: ${JSON.stringify(c.text).slice(0, 50)}`, () => {
    const tokens = normalize(c.text)
    expect(tokens).toEqual(c.tokens)
    expect(stableHash(tokens.join(' '))).toBe(c.hash)
    expect([...rareHashes(tokens)].sort((a, b) => a - b)).toEqual(c.rare)
  })
}

test('a new take on a repeated prompt matches its cluster', () => {
  const cluster = REPORT.hints.clusters[0]
  if (!cluster) throw new Error('fixture has no cluster')
  expect(overlap('Write release notes for v2.0.0 from the merged PRs, grouped by area, with a one-line summary at the top', cluster.signature)).toBeGreaterThanOrEqual(0.6)
  expect(overlap('add pagination to the orders table', cluster.signature)).toBeLessThan(0.6)
})

test('vague: short, vague words, and no place named', () => {
  expect(isVague('fix it')).toBe(true)
  expect(isVague('its broken again')).toBe(true)
  expect(isVague('fix it in src/auth.ts')).toBe(false)
  expect(isVague('add a loading prop to the Button')).toBe(false)
})
