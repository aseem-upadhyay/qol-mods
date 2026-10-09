import { expect, mock, test } from 'claude-code/testing'

const HISTORY = { usd: 1000, sessions: 10, estimatedUsd: 800, today: 4, week: 50, unpriced: [] }
const SURFACES = ['terminal', 'desktop'] as const

for (const surface of SURFACES) {
  test(`band shows repo total and live session spend (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.env(on, { HOME: '/home/me' })
    let scanArgv: readonly string[] = []

    on('process.run', async (_$, e) => {
      if (e.argv[0] === 'git') {
        return { value: { exitCode: 0, stdout: '/work/my.app/.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      scanArgv = e.argv
      return { value: { exitCode: 0, stdout: JSON.stringify(HISTORY), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('session.id', async () => ({ value: 'live-session' }))
    on('session.usage', async () => ({
      value: {
        startedAt: 1_000_000,
        context: { window: 1_000_000 },
        rateLimits: [],
        cost: { usd: 0 },
      },
    }))
    on('command.register', async () => ({ value: { command: 'repo-spend' } }))
    on('session.start', async (_$, e) => ({ cwd: e.cwd }))
    on('session.measure', async (_$, e) => ({ changed: e.changed }))

    await $.session.start({ cwd: '/work/my.app', surface, isInteractive: true })
    await clock.advance(0)

    // An hour in, the session has spent $3.
    await clock.advance(60 * 60 * 1000 - 1)
    await $.session.measure({
      context: { window: 1_000_000 },
      rateLimits: [],
      cost: { usd: 3 },
      changed: ['cost'],
    })

    expect(scanArgv.slice(0, 2)).toEqual(['/usr/bin/env', 'python3'])
    expect(scanArgv[3]).toBe('/home/me/.claude/projects')
    expect(scanArgv[4]).toBe('-work-my-app')
    expect(scanArgv[6]).toBe('live-session')

    const ui = await $.ui.mount({
      plugin: 'repo-spend',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 3,
        bodyColumns: 120,
        scroll: { offset: 0, bodyRows: 1 },
        view: {},
      },
    })
    expect((await ui.find({ text: '≈$1,003.00' }))).toBeDefined()
    expect((await ui.find({ text: /today \$7\.00 · 7d \$53\.00/ }))).toBeDefined()
    expect((await ui.find({ text: '$3.00/hr' }))).toBeDefined()
  })
}

for (const surface of SURFACES) {
  test(`band says so when python3 is missing (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.env(on, { HOME: '/home/me' })
    on('process.run', async (_$, e) => {
      if (e.argv[0] === 'git') {
        return { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return { value: { exitCode: 127, stdout: '', stderr: 'env: python3: No such file or directory', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('session.id', async () => ({ value: 'live-session' }))
    on('session.usage', async () => ({
      value: { startedAt: 1_000_000, context: { window: 1_000_000 }, rateLimits: [], cost: { usd: 0.5 } },
    }))
    on('command.register', async () => ({ value: { command: 'repo-spend' } }))
    on('session.start', async (_$, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: '/tmp/scratch', surface, isInteractive: true })
    await clock.advance(0)

    const ui = await $.ui.mount({
      plugin: 'repo-spend',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120, scroll: { offset: 0, bodyRows: 1 }, view: {} },
    })
    expect(await ui.find({ text: 'history unavailable: python3 not found' })).toBeDefined()
    expect(await ui.find({ text: 'scratch ' })).toBeDefined()
    expect(await ui.find({ text: '$0.50' })).toBeDefined()
  })
}
