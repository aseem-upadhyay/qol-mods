import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { History, Sample } from '../types'

const history = atom({ plugin: 'repo-spend', key: 'history' } as const, null)
const samples = atom({ plugin: 'repo-spend', key: 'samples' } as const, [])
const isHidden = atom({ plugin: 'repo-spend', key: 'isHidden' } as const, false)
const scanError = atom({ plugin: 'repo-spend', key: 'scanError' } as const, null)

const RESCAN_MS = 2 * 60 * 1000
const RATE_WINDOW_MS = 30 * 60 * 1000
const HOT_PER_HOUR = 20

const usd = (n: number) =>
  '$' +
  n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

/** Claude Code's project-folder name for a path: every non-alphanumeric a dash. */
const slugOf = (path: string) => path.replace(/[^A-Za-z0-9]/g, '-')

/** $/hour over the last half hour of samples (or since the session began). */
function burnRate(list: Sample[], startedAt: number, now: number): number | null {
  const latest = list[list.length - 1]
  if (!latest) return null
  const cutoff = now - RATE_WINDOW_MS
  const before = list.filter(s => s.at <= cutoff)
  const base: Sample = before[before.length - 1] ?? { at: startedAt, usd: 0 }
  const hours = (now - base.at) / 3_600_000
  if (hours < 1 / 60) return null
  return (latest.usd - base.usd) / hours
}

/** Appends this session's running cost, keeping a baseline older than the window. */
async function record($: EngineInterface, cost: number) {
  const at = await $.clock.now()
  await update($, samples, list => {
    const last = list[list.length - 1]
    if (last && last.usd === cost) return list
    const keep = list.filter(s => s.at > at - 2 * RATE_WINDOW_MS)
    return [...keep, { at, usd: cost }]
  })
}

export const register: Register = on => {
  let repoName = ''
  let scanArgs: string[] | null = null
  let startedAt = 0
  let timer: Timer | null = null

  on('session.start', async ($, e, next) => {
    const started = await next(e)

    // The repo's main checkout, so a worktree session counts toward it too.
    const git = await $.process.run(
      ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: e.cwd },
    )
    const root =
      git.exitCode === 0 ? git.stdout.trim().replace(/\/\.git\/?$/, '') : e.cwd
    repoName = root.split('/').pop() ?? root

    const home = (await $.env.get('HOME')) ?? ''
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
    const slug = slugOf(root)
    scanArgs = [
      '/usr/bin/env',
      'python3',
      `${$.plugin.root}/hooks/scan.py`,
      `${config}/projects`,
      slug,
      `${home}/.cache/claude-repo-spend/${slug}.json`,
      await $.session.id(),
    ]

    const usage = await $.session.usage()
    startedAt = usage.startedAt
    await record($, usage.cost?.usd ?? 0)

    const rescan = async () => {
      if (!scanArgs) return
      try {
        const run = await $.process.run(scanArgs, { timeoutMs: 120_000 })
        if (run.exitCode !== 0) throw new Error(run.stderr.slice(0, 300))
        const found = JSON.parse(run.stdout) as History
        await update($, history, () => found)
        await update($, scanError, () => null)
      } catch (error) {
        const text = String(error)
        $.ui.log(`repo-spend: scan failed: ${text}`, { to: 'debug' })
        const reason = /python3/.test(text) && /No such file|not found/i.test(text)
          ? 'python3 not found'
          : 'scan failed (see claude --debug)'
        await update($, scanError, () => reason)
      }
    }
    void rescan()
    timer?.cancel()
    timer = $.clock.every(RESCAN_MS, () => void rescan())

    await $.command.register({
      name: 'repo-spend',
      description: 'Show or hide the repo spend band above the prompt',
    })

    return started
  })

  on('command.run', { command: 'repo-spend' }, async $ => {
    const hidden = await update($, isHidden, was => !was)
    return { text: hidden ? 'Repo spend band hidden.' : 'Repo spend band shown.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.cost) await record($, e.cost.usd)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const past = await read($, history)
    const list = await read($, samples)
    const session = list[list.length - 1]?.usd ?? 0
    const rate = burnRate(list, startedAt, await $.clock.now())
    const { Box, Text } = $.ui.resolve(e)

    const failed = await read($, scanError)
    const total = past ? past.usd + session : null
    const unpriced = past?.unpriced ?? []
    const isEstimate = past !== null && (past.estimatedUsd > 0 || unpriced.length > 0)
    const isHot = rate !== null && rate >= HOT_PER_HOUR

    const parts = [<Text dimColor>{repoName || 'repo'} </Text>]
    if (past === null || total === null) {
      parts.push(
        failed === null
          ? <Text dimColor>scanning history…</Text>
          : <Text color="warning">{`history unavailable: ${failed}`}</Text>,
      )
    } else {
      parts.push(
        <Text bold color="claude">
          {(isEstimate ? '≈' : '') + usd(total)}
        </Text>,
        <Text dimColor>
          {` to date · today ${usd(past.today + session)} · 7d ${usd(past.week + session)}`}
        </Text>,
      )
      if (unpriced.length > 0) {
        parts.push(<Text color="warning">{` (+ unpriced: ${unpriced.join(', ')})`}</Text>)
      }
    }
    parts.push(<Text dimColor>{'  │  this session '}</Text>, <Text bold>{usd(session)}</Text>)
    if (rate !== null) {
      parts.push(
        <Text dimColor> · burn </Text>,
        <Text color={isHot ? 'warning' : 'success'}>{usd(rate) + '/hr'}</Text>,
      )
    }

    return (
      <Box>
        <Text wrap="truncate-end">{parts}</Text>
      </Box>
    )
  })
}
