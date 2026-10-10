import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { History } from '../types'

const SURFACES = ['terminal', 'desktop'] as const
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const START = Date.UTC(2026, 9, 9, 12)

/** Ten earlier sessions, the oldest 58 days back: "last 2 months". */
const HISTORY: History = {
  usd: 1000,
  sessions: 10,
  estimatedUsd: 800,
  today: 4,
  week: 50,
  since: START - 58 * DAY,
  unpriced: [],
}

const ran = (exitCode: number, stdout: string, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

type Setup = {
  /** What scan.py prints; a string is its stderr on a failed run instead. */
  scan: History | string | ((liveId: string) => History)
  cwd?: string
  /** A line another mod's band draws beneath this one; absent, only the engine's own. */
  beneath?: string
  /** The live session, which a test may change (a /clear); 'live-session' at $0 when absent. */
  session?: { id: string; cost: number }
}

/** Answers everything the band asks the engine for, then starts the session. */
async function boot($: Engine, on: On, surface: (typeof SURFACES)[number], setup: Setup) {
  const clock = mock.clock(on, { now: START })
  mock.env(on, { HOME: '/home/me' })
  const seen: { scan: readonly string[] } = { scan: [] }

  // Beneath the plugin: another mod's band, or the engine's own drawing.
  on('ui.render', { component: 'AbovePrompt' }, async (below, e) => {
    if (setup.beneath === undefined) return { type: 'engine', ref: 0 }
    const { Text } = below.ui.resolve(e)
    return Text({ children: setup.beneath })
  })

  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') {
      return setup.cwd === undefined
        ? ran(0, '/work/my.app/.git\n')
        : ran(128, '', 'fatal: not a git repository')
    }
    seen.scan = e.argv
    if (typeof setup.scan === 'string') return ran(127, '', setup.scan)
    // As scan.py does, the history leaves out the session named last.
    const found = typeof setup.scan === 'function' ? setup.scan(e.argv.at(-1) ?? '') : setup.scan
    return ran(0, JSON.stringify(found))
  })
  on('session.id', async () => ({ value: setup.session?.id ?? 'live-session' }))
  on('session.usage', async () => ({
    value: {
      startedAt: START,
      context: { window: 1_000_000 },
      rateLimits: [],
      cost: { usd: setup.session?.cost ?? 0 },
    },
  }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', async () => ({ value: { command: 'repo-spend' } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', async (_$, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: setup.cwd ?? '/work/my.app', surface, isInteractive: true })
  await clock.advance(0)

  /** The session's running cost reaches `usd`, `msAfter` ms later. */
  const spend = async (usd: number, msAfter: number) => {
    await clock.advance(msAfter)
    if (setup.session) setup.session.cost = usd
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

  /**
   * A /clear, as the engine does it: the session ends with reason "clear", the
   * process carries on under `nextId` with its cost back at $0, and no
   * session.start follows.
   */
  const clear = async (nextId: string) => {
    if (!setup.session) throw new Error('clear() needs a setup.session')
    const ending = setup.session.id
    setup.session.id = nextId
    setup.session.cost = 0
    await $.session.end({ reason: 'clear', sessionId: ending, resume: { id: ending } })
    await clock.advance(200)
  }

  return { seen, spend, mount, clear, clock }
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
      expect(await ui.find({ text: 'last 2 months' })).toBeDefined()
      expect(await ui.find({ text: 'to date' })).toBeUndefined()
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
      expect(await compact.find({ text: 'last 2mo' })).toBeDefined()
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

    // The window is rounded UP, so every counted session falls inside it.
    const windows = [
      { name: '64.5 days', back: 64.5 * DAY, label: 'last 3 months', today: true, week: true },
      { name: '400 days', back: 400 * DAY, label: 'last 14 months', today: true, week: true },
      { name: '10 days', back: 10 * DAY, label: 'last 10 days', today: true, week: true },
      { name: '3 days', back: 3 * DAY, label: 'last 3 days', today: true, week: false },
      { name: '2 hours', back: 2 * HOUR, label: 'last 24 hours', today: false, week: false },
    ]
    for (const w of windows) {
      test(`history reaching back ${w.name} reads "${w.label}"`, async ($, on) => {
        const { mount } = await boot($, on, surface, {
          scan: { ...HISTORY, since: START - w.back },
        })
        const ui = await mount(160)
        expect(await ui.find({ text: w.label })).toBeDefined()
        // A figure that would only repeat the total is left out.
        expect((await ui.find({ text: 'today' })) !== undefined).toBe(w.today)
        expect((await ui.find({ text: 'last 7d' })) !== undefined).toBe(w.week)
      })
    }

    test('with no earlier sessions, the window is this session', async ($, on) => {
      const scan = {
        ...HISTORY,
        usd: 0,
        sessions: 0,
        estimatedUsd: 0,
        today: 0,
        week: 0,
        since: null,
      }
      const { spend, mount } = await boot($, on, surface, { scan })
      await spend(0.5, 10 * 60 * 1000)
      const ui = await mount(160)
      expect(await ui.find({ text: 'last 24 hours' })).toBeDefined()
      expect(await ui.find({ text: 'today' })).toBeUndefined()
    })

    test('flags models it has no price for', async ($, on) => {
      const scan = { ...HISTORY, estimatedUsd: 0, unpriced: ['claude-future-9'] }
      const { mount } = await boot($, on, surface, { scan })
      const ui = await mount(160)
      expect(await ui.find({ text: '≈' })).toBeDefined()
      expect(await ui.find({ text: '+' })).toBeDefined()
      expect(await ui.find({ text: 'no price: claude-future-9' })).toBeDefined()
    })

    test('keeps the bands other mods draw beneath it', async ($, on) => {
      const { mount } = await boot($, on, surface, { scan: HISTORY, beneath: 'another mod' })
      const ui = await mount(120)
      expect(await ui.find({ text: 'my.app' })).toBeDefined()
      expect(await ui.find({ text: 'another mod' })).toBeDefined()
    })

    test('a /clear keeps the cleared session in the total and counts the new one once', async ($, on) => {
      // What each session's log holds; scan.py leaves out the live one.
      const logs: Record<string, number> = { S1: 0, S2: 0 }
      const scan = (liveId: string) => ({
        ...HISTORY,
        usd: 1000 + (liveId === 'S1' ? 0 : logs.S1!) + (liveId === 'S2' ? 0 : logs.S2!),
      })
      const session = { id: 'S1', cost: 0 }
      const { spend, clear, mount, clock } = await boot($, on, surface, { scan, session })

      await spend(3, 10 * MINUTE)
      logs.S1 = 3
      await clear('S2')
      await spend(0.5, MINUTE)
      logs.S2 = 0.5
      await clock.advance(2 * MINUTE) // the periodic rescan

      const ui = await mount(160)
      // 1000 earlier + S1's $3 from its log + S2's $0.50 live, counted once.
      expect(await ui.find({ text: '$1,003.50' })).toBeDefined()
      // This session started over at the /clear, as Claude Code's own figure does.
      expect(await ui.find({ text: '$0.50' })).toBeDefined()
    })

    test('a /clear puts the hide toggle back, as the engine wipes session state', async ($, on) => {
      // The engine resets a session's $.state on /clear (seen in a real run);
      // the band must write the toggle again for the new session.
      const writes: unknown[] = []
      on('state.set', async (_$, e, next) => {
        if (e.plugin === 'repo-spend' && e.key === 'isHidden') writes.push(e.value)
        return next(e)
      })
      const session = { id: 'S1', cost: 0 }
      const { clear, mount } = await boot($, on, surface, { scan: HISTORY, session })
      await $.command.run({
        command: 'repo-spend',
        args: '',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 120 },
      })
      await clear('S2')
      expect(writes).toEqual([true, true])
      const ui = await mount(160)
      expect(await ui.find({ text: 'this session' })).toBeUndefined()
    })

    test('a session change no event announced is caught within a minute', async ($, on) => {
      const session = { id: 'S1', cost: 0 }
      const { seen, clock } = await boot($, on, surface, { scan: HISTORY, session })
      expect(seen.scan.at(-1)).toBe('S1')
      session.id = 'S2'
      await clock.advance(MINUTE)
      expect(seen.scan.at(-1)).toBe('S2')
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
