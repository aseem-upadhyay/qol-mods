import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { History } from '../types'

const SURFACES = ['terminal', 'desktop'] as const
const HOUR = 60 * 60 * 1000
const START = 1_000_000

const HISTORY: History = {
  usd: 1000,
  sessions: 10,
  estimatedUsd: 800,
  today: 4,
  week: 50,
  unpriced: [],
}

const ran = (exitCode: number, stdout: string, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

type Setup = {
  /** What scan.py prints; a string is its stderr on a failed run instead. */
  scan: History | string
  cwd?: string
}

/** Answers everything the band asks the engine for, then starts the session. */
async function boot($: Engine, on: On, surface: (typeof SURFACES)[number], setup: Setup) {
  const clock = mock.clock(on, { now: START })
  mock.env(on, { HOME: '/home/me' })
  const seen: { scan: readonly string[] } = { scan: [] }

  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') {
      return setup.cwd === undefined
        ? ran(0, '/work/my.app/.git\n')
        : ran(128, '', 'fatal: not a git repository')
    }
    seen.scan = e.argv
    return typeof setup.scan === 'string'
      ? ran(127, '', setup.scan)
      : ran(0, JSON.stringify(setup.scan))
  })
  on('session.id', async () => ({ value: 'live-session' }))
  on('session.usage', async () => ({
    value: { startedAt: START, context: { window: 1_000_000 }, rateLimits: [], cost: { usd: 0 } },
  }))
  on('command.register', async () => ({ value: { command: 'repo-spend' } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', async (_$, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: setup.cwd ?? '/work/my.app', surface, isInteractive: true })
  await clock.advance(0)

  /** The session's running cost reaches `usd`, `msAfter` ms later. */
  const spend = async (usd: number, msAfter: number) => {
    await clock.advance(msAfter)
    await $.session.measure({
      context: { window: 1_000_000 },
      rateLimits: [],
      cost: { usd },
      changed: ['cost'],
    })
  }

  const mount = (bodyColumns: number) =>
    $.ui.mount({
      plugin: 'repo-spend',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 3,
        bodyColumns,
        scroll: { offset: 0, bodyRows: 1 },
        view: {},
      },
    })

  return { seen, spend, mount }
}

for (const surface of SURFACES) {
  describe(surface, () => {
    test('scans the main checkout, skipping the live session', async ($, on) => {
      const { seen } = await boot($, on, surface, { scan: HISTORY })
      expect(seen.scan.slice(0, 2)).toEqual(['/usr/bin/env', 'python3'])
      expect(seen.scan[3]).toBe('/home/me/.claude/projects')
      expect(seen.scan[4]).toBe('-work-my-app')
      expect(seen.scan[6]).toBe('live-session')
    })

    test('wide: totals on the left, the live session and its burn on the right', async ($, on) => {
      const { spend, mount } = await boot($, on, surface, { scan: HISTORY })
      // An hour in, the session has spent $3, all of it inside the last half hour.
      await spend(3, HOUR - 1)
      const ui = await mount(120)

      expect(await ui.find({ text: 'my.app' })).toBeDefined()
      expect(await ui.find({ text: '$1,003.00' })).toBeDefined()
      expect(await ui.find({ text: '≈' })).toBeDefined()
      expect(await ui.find({ text: '$7.00' })).toBeDefined()
      expect(await ui.find({ text: '$53.00' })).toBeDefined()
      expect(await ui.find({ text: 'last 7d' })).toBeDefined()
      expect(await ui.find({ text: 'this session' })).toBeDefined()
      expect(await ui.find({ text: '$6.00/hr' })).toBeDefined()
      if (surface === 'desktop') {
        expect(await ui.find({ type: 'Svg' })).toBeDefined()
      } else {
        // The spend landed in the newest slice: a full bar after nine empty ones.
        expect(await ui.find({ text: '▁▁▁▁▁▁▁▁▁' })).toBeDefined()
        expect(await ui.find({ text: '█' })).toBeDefined()
      }
    })

    test('narrower bands drop detail instead of truncating', async ($, on) => {
      const { spend, mount } = await boot($, on, surface, { scan: HISTORY })
      await spend(3, HOUR - 1)

      const medium = await mount(100)
      expect(await medium.find({ text: 'last 7d' })).toBeUndefined()
      expect(await medium.find({ text: 'this session' })).toBeDefined()

      const compact = await mount(80)
      expect(await compact.find({ text: '$1.00k' })).toBeDefined()
      expect(await compact.find({ text: 'my.app' })).toBeDefined()
      expect(await compact.find({ type: 'Svg' })).toBeUndefined()
      expect(await compact.find({ text: '█' })).toBeUndefined()

      const tiny = await mount(40)
      expect(await tiny.find({ text: 'my.app' })).toBeUndefined()
      expect(await tiny.find({ text: '$1.00k' })).toBeDefined()
      expect(await tiny.find({ text: '$6.00/hr' })).toBeDefined()
    })

    test('the burn covers the last half hour only', async ($, on) => {
      const { spend, mount } = await boot($, on, surface, { scan: HISTORY })
      // $3 early on, then only a cent in the last half hour: $0.02/hr.
      await spend(3, 5 * 60 * 1000)
      await spend(3.01, HOUR)
      const ui = await mount(120)
      expect(await ui.find({ text: '$0.02/hr' })).toBeDefined()
      if (surface === 'terminal') {
        // A cent is a stub, not a full bar: the scale never drops below the warm pace.
        expect(await ui.find({ text: '▂' })).toBeDefined()
        expect(await ui.find({ text: '█' })).toBeUndefined()
      }
    })

    test('flags models it has no price for', async ($, on) => {
      const scan = { ...HISTORY, estimatedUsd: 0, unpriced: ['claude-future-9'] }
      const { mount } = await boot($, on, surface, { scan })
      const ui = await mount(160)
      expect(await ui.find({ text: '≈' })).toBeDefined()
      expect(await ui.find({ text: '+' })).toBeDefined()
      expect(await ui.find({ text: 'no price: claude-future-9' })).toBeDefined()
    })

    test('says so when python3 is missing, and still shows the session', async ($, on) => {
      const { spend, mount } = await boot($, on, surface, {
        scan: 'env: python3: No such file or directory',
        cwd: '/tmp/scratch',
      })
      await spend(0.5, 10 * 60 * 1000)
      const ui = await mount(120)
      expect(await ui.find({ text: 'scratch' })).toBeDefined()
      expect(await ui.find({ text: 'history unavailable: python3 not found' })).toBeDefined()
      expect(await ui.find({ text: '$0.50' })).toBeDefined()
    })
  })
}
