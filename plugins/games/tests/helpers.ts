/** Boots games against a test engine: answers what it asks for, and records what it does. */
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

export const SURFACES = ['terminal', 'desktop'] as const
export type Surface = (typeof SURFACES)[number]

/** Monday 12 October 2026, 15:00 UTC. */
export const NOW = 1791817200000

export type Seen = { toasts: string[]; opened: number; closed: number; commands: string[] }

export async function boot($: Engine, on: On, surface: Surface, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, store)
  const seen: Seen = { toasts: [], opened: 0, closed: 0, commands: [] }

  on('command.register', async (_$, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', async () => {
    seen.opened += 1
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', async () => {
    seen.closed += 1
    return { value: undefined }
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  // Beneath the plugin, a turn's start and end as the engine answers them.
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  // Beneath the plugin, the band as the engine draws it.
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'engine', ref: 0 }) as never)
  on('ui.toast', async (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.start({ cwd: '/work/my-app', surface, isInteractive: true })
  await clock.settle()

  /** The pane, as a docked desktop pane or a terminal's inline strip (SPEC.md §4.3 P6). */
  const pane = () =>
    $.ui.mount({
      plugin: 'games',
      surface,
      component: 'Pane',
      requestId: 'games',
      props: {
        title: 'Games',
        isFocused: true,
        bodyColumns: surface === 'desktop' ? 42 : 87,
        placement: surface === 'desktop' ? 'dock' : 'inline',
        scroll: { offset: 0, bodyRows: surface === 'desktop' ? 45 : 17 },
        view: {},
      },
    })
  const run = async (args = '') => {
    const result = await $.command.run({
      command: 'games',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 120 },
    })
    await clock.settle()
    return result
  }

  return { clock, seen, pane, run }
}
