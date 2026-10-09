/** Boots coach against a test engine: answers what it asks for, and records what it does. */
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { GradingInput, Report } from '../types'
import { REPORT } from './fixtures/report'

export const SURFACES = ['terminal', 'desktop'] as const
export type Surface = (typeof SURFACES)[number]

/** beginner.NOW: Wednesday 7 October 2026, 15:00 UTC, two days into the fourth week. */
export const NOW = 1791385200000

export type Setup = {
  /** What scan.py reports; null for a scan that reports nothing yet. */
  report?: Report | null
  /** A failed scan's stderr instead of a report. */
  scanError?: string
  store?: Record<string, unknown>
  /** Whether $.ui.open places the pane (false: a surface without panes). */
  placed?: boolean
  /** The text already in the prompt box. */
  draft?: string
  /** Context tokens $.session.usage reports. */
  contextTokens?: number
  /** A band another mod draws beneath coach's; absent, the engine's own drawing. */
  beneath?: string
  /** What scan.py hands out for --grade-week. */
  grading?: GradingInput
  /** How the model answers $.model.complete: the reply's text by its system prompt, or null for no answer. */
  model?: (system: string) => string | null
}

export type Seen = {
  /** What coach keeps in $.store, as it stands. */
  store: Map<string, unknown>
  /** The system prompts $.model.complete was called with. */
  modelCalls: string[]
  argv: string[][]
  fills: { text: string; mode?: string }[]
  copies: string[]
  toasts: string[]
  opened: number
  tools: string[]
  commands: string[]
}

export async function boot($: Engine, on: On, surface: Surface, setup: Setup = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/me' })
  const seen: Seen = {
    store: new Map(Object.entries(setup.store ?? {})),
    modelCalls: [],
    argv: [],
    fills: [],
    copies: [],
    toasts: [],
    opened: 0,
    tools: [],
    commands: [],
  }
  // $.store in memory, readable by the test (mock.store keeps its own to itself).
  on('store.get', async (_$, e) => ({ value: seen.store.get(e.key) }))
  on('store.set', async (_$, e) => {
    seen.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', async (_$, e) => {
    seen.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', async () => ({ value: [...seen.store.keys()] }))

  on('process.spawn', async function* (_$, e) {
    seen.argv.push([...e.argv])
    if (e.argv.includes('--grade-week')) {
      if (setup.grading) yield { stream: 'stdout' as const, text: `${JSON.stringify({ grading: setup.grading })}\n` }
      return { value: { code: 0, signal: null } }
    }
    if (setup.scanError !== undefined) {
      yield { stream: 'stderr' as const, text: setup.scanError }
      return { value: { code: 127, signal: null } }
    }
    yield { stream: 'stdout' as const, text: `${JSON.stringify({ progress: [3, 4] })}\n{"report":` }
    yield { stream: 'stdout' as const, text: `${JSON.stringify(setup.report === undefined ? REPORT : setup.report)}}\n` }
    return { value: { code: 0, signal: null } }
  })
  on('command.register', async (_$, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('tool.register', async (_$, e) => {
    seen.tools.push(e.name)
    return { value: { tool: `mcp__coach__${e.name}` } }
  })
  on('session.id', async () => ({ value: 'live-session' }))
  on('session.usage', async () => ({
    value: { startedAt: NOW, context: { window: 1_000_000, tokens: setup.contextTokens ?? 40_000 }, rateLimits: [] },
  }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('ui.open', async () => {
    seen.opened += 1
    return { value: setup.placed === false ? { isPlaced: false as const, reason: 'no panes on this surface' } : { isPlaced: true as const } }
  })
  on('ui.toast', async (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', async () => ({ value: undefined }))
  on('ui.copy', async (_$, e) => {
    seen.copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('prompt.read', async () => ({ value: { text: setup.draft ?? '', cursor: 0 } }))
  on('prompt.fill', async (_$, e) => {
    seen.fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('model.complete', async (_$, e) => {
    const system = typeof e.system === 'string' ? e.system : ''
    seen.modelCalls.push(system)
    const usage = { input_tokens: 2000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    const text = setup.model?.(system) ?? null
    return {
      value:
        text === null
          ? { isAnswered: false as const, reason: 'empty-reply' as const, usage }
          : { isAnswered: true as const, text, usage },
    }
  })
  on('ui.render', { component: 'AbovePrompt' }, async (below, e) => {
    if (setup.beneath === undefined) return { type: 'engine', ref: 0 }
    const { Text } = below.ui.resolve(e)
    return Text({ children: setup.beneath })
  })

  await $.session.start({ cwd: '/work/my-app', surface, isInteractive: true })
  await clock.settle()

  const pane = (bodyColumns = 100) =>
    $.ui.mount({
      plugin: 'coach',
      surface,
      component: 'Pane',
      requestId: 'coach-report',
      props: {
        title: 'Coach',
        isFocused: true,
        bodyColumns,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 40 },
        view: {},
      },
    })
  const bar = (bodyColumns = 120, maxRows = 3) =>
    $.ui.mount({
      plugin: 'coach',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows,
        bodyColumns,
        scroll: { offset: 0, bodyRows: 1 },
        view: {},
      },
    })
  /** The person types `text` and presses Enter; hints are worked out after. */
  const submit = async (text: string) => {
    await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
    await clock.settle()
  }
  const command = async (args = '') => {
    const result = await $.command.run({
      command: 'coach',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 120 },
    })
    await clock.settle()
    return result
  }
  return { clock, seen, pane, bar, command, submit }
}
