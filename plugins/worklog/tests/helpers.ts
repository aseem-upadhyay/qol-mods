/** Boots worklog against a test engine: answers what it asks for, and records what it does. */
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { ScanResult } from '../types'
import { FOUND } from './fixtures'

export const SURFACES = ['terminal', 'desktop'] as const
export type Surface = (typeof SURFACES)[number]

/** Monday 12 October 2026, 15:00 UTC. */
export const NOW = 1791817200000

export type Setup = {
  /** What scan.py prints. */
  found?: ScanResult
  /** A failed scan's stderr instead. */
  scanError?: string
  /** Whether $.ui.open places the pane (false: a surface without panes). */
  placed?: boolean
  /** No surface attached, as in a bare `claude -p`. */
  headless?: boolean
}

export type Seen = {
  argv: string[][]
  copies: string[]
  toasts: string[]
  opened: number
  commands: string[]
  /** Files written with $.fs.write. */
  writes: { path: string; text: string }[]
}

const ran = (exitCode: number, stdout: string, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

export async function boot($: Engine, on: On, surface: Surface, setup: Setup = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/me' })
  const seen: Seen = { argv: [], copies: [], toasts: [], opened: 0, commands: [], writes: [] }

  on('process.run', async (_$, e) => {
    seen.argv.push([...e.argv])
    if (setup.scanError !== undefined) return ran(127, '', setup.scanError)
    return ran(0, JSON.stringify(setup.found ?? FOUND))
  })
  on('command.register', async (_$, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', async () => {
    seen.opened += 1
    return { value: setup.placed === false ? { isPlaced: false as const, reason: 'no panes on this surface' } : { isPlaced: true as const } }
  })
  on('session.surfaces', async () => ({ value: setup.headless ? [] : [surface] }))
  on('ui.toast', async (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', async () => ({ value: undefined }))
  on('fs.write', async (_$, e) => {
    seen.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  // Beneath the plugin, a command's row as the engine draws it.
  on('ui.render', { component: 'CommandOutput' }, async () => ({ type: 'engine', ref: 0 }))
  on('ui.copy', async (_$, e) => {
    seen.copies.push(e.text)
    return { value: { isCopied: true as const } }
  })

  await $.session.start({ cwd: '/work/my-app', surface, isInteractive: true })
  await clock.settle()

  const pane = (bodyColumns = 100) =>
    $.ui.mount({
      plugin: 'worklog',
      surface,
      component: 'Pane',
      requestId: 'worklog',
      props: {
        title: 'Worklog',
        isFocused: true,
        bodyColumns,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 40 },
        view: {},
      },
    })
  const run = async (command: 'standup' | 'worklog', args = '') => {
    const result = await $.command.run({
      command,
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 120 },
    })
    await clock.settle()
    return result
  }
  /** The transcript row a command's reply shows in. */
  const output = (text: string, command: 'standup' | 'worklog' = 'standup') =>
    $.ui.mount({
      plugin: 'worklog',
      surface,
      component: 'CommandOutput',
      requestId: 'row-1',
      props: { command, args: '', text, isErrored: false },
    })
  return { clock, seen, pane, run, output }
}
