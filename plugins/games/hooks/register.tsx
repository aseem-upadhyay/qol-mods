/**
 * games: every engine call (SPEC.md §6). The board draws and plays; this
 * module owns the store, evaluates milestones, raises toasts, answers
 * /games, and tells the board when to pause.
 */

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { evaluate } from '../core/milestones'
import { applyOutcome, applySave, gameKey, readProfile, readRecord, resetRecord, SCHEMA, unlock } from '../core/store'
import type { Ack, Batch, BoardPost, GameId, GameRecord, Records, Request, Screen, Settings } from '../types'
import { CATALOG, GAMES, READY, resolve, suggest } from './catalog'

const PANE = 'games'
const records = atom({ plugin: 'games', key: 'records' } as const, { profile: {}, games: {} } as Records)
const request = atom({ plugin: 'games', key: 'request' } as const, { screen: 'hub', n: 0 } as Request)
const pauseSignal = atom({ plugin: 'games', key: 'pause' } as const, 0)
const ack = atom({ plugin: 'games', key: 'ack' } as const, { inst: '', id: 0 } as Ack)

/** The last post handled from each board instance (Batch). */
const handled = new Map<string, number>()

type Config = Settings & { notifyTurnEnd: boolean }

function configFrom(options: PluginOptions): Config {
  const o = options as Record<string, unknown>

  return {
    highContrast: o.highContrast === true,
    wordleHardMode: o.wordleHardMode === true,
    notifyTurnEnd: o.notifyTurnEnd !== false,
  }
}

/** What this session knows of the pane: whether it's open and what it shows. */
const pane = { isOpen: false, screen: 'hub' as Screen, lastPause: 0 }

const nameOf = (id: GameId) => CATALOG.find(e => e.id === id)?.name ?? id

/** Reads every playable game's record and the profile, fresh (SPEC.md §7.4). */
async function load($: EngineInterface): Promise<Records> {
  const games: Records['games'] = {}
  for (const entry of READY) {
    const value = await $.store.get(gameKey(entry.id))
    if (value !== undefined) games[entry.id] = readRecord(value)
  }

  return { profile: readProfile(await $.store.get('profile')), games }
}

async function refresh($: EngineInterface) {
  const fresh = await load($)
  await update($, records, () => fresh)
}

/** Reads one record, applies a change, writes it back, in one go (SPEC.md §7.4). */
async function change($: EngineInterface, id: GameId, fn: (r: GameRecord) => GameRecord): Promise<GameRecord> {
  const next = fn(readRecord(await $.store.get(gameKey(id))))
  await $.store.set(gameKey(id), next)
  if ((await $.store.get('schema')) !== SCHEMA) await $.store.set('schema', SCHEMA)

  return next
}

function announce($: EngineInterface, id: GameId, ids: readonly string[]) {
  const def = GAMES[id]
  if (!def || ids.length === 0) return
  if (ids.length === 1) {
    const m = def.milestones.find(one => one.id === ids[0])
    if (m) $.ui.toast(`★ ${nameOf(id)}: ${m.name} (${m.goal.charAt(0).toLowerCase()}${m.goal.slice(1)})`)

    return
  }
  $.ui.toast(`★ ${ids.length} milestones in ${nameOf(id)}`)
}

async function onPost($: EngineInterface, post: BoardPost) {
  if (post.type === 'save') {
    const def = GAMES[post.game]
    if (!def) return
    const now = await $.clock.now()
    let unlocked: string[] = []
    await change($, post.game, r => {
      const saved = applySave(r, post.save, post.daily)
      unlocked = post.save ? evaluate(def.milestones, post.facts, saved, false) : []

      return unlock(saved, unlocked, now)
    })
    announce($, post.game, unlocked)
    await refresh($)
  }

  if (post.type === 'over') {
    const def = GAMES[post.game]
    if (!def) return
    const now = await $.clock.now()
    let unlocked: string[] = []
    await change($, post.game, r => {
      const ended = applyOutcome(r, post.outcome, def.lowerIsBetter, now)
      unlocked = evaluate(def.milestones, post.outcome.facts, ended, true)

      return unlock(ended, unlocked, now)
    })
    const profile = readProfile(await $.store.get('profile'))
    await $.store.set('profile', { ...profile, firstPlayedAt: profile.firstPlayedAt ?? now, lastGame: post.game })
    announce($, post.game, unlocked)
    await refresh($)
  }

  if (post.type === 'nav') {
    pane.screen = post.screen
  }

  if (post.type === 'reset') {
    const targets = post.target === 'all' ? READY.map(e => e.id) : [post.target]
    for (const id of targets) await change($, id, r => resetRecord(r, post.milestones))
    $.ui.toast(`Reset ${post.target === 'all' ? 'every game' : nameOf(post.target)}${post.milestones ? ', milestones too' : ''}.`)
    await refresh($)
  }

  if (post.type === 'stale') {
    $.ui.toast(`Your saved ${nameOf(post.game)} game was from an older version and couldn't be restored.`)
  }

  if (post.type === 'close') {
    await $.ui.close({ id: PANE })
  }
}

/** Tells the board the player did something else: arcade games pause (SPEC.md §7.2). */
async function signalPause($: EngineInterface) {
  if (!pane.isOpen || !pane.screen.startsWith('game:')) return
  const now = await $.clock.now()
  // A burst of keystrokes in the prompt is one signal.
  if (now - pane.lastPause < 1000) return
  pane.lastPause = now
  await update($, pauseSignal, n => n + 1)
}

async function open($: EngineInterface, screen: Screen) {
  await refresh($)
  await update($, request, r => ({ screen, n: r.n + 1 }))
  const opened = await $.ui.open({ id: PANE, title: 'Games', focus: true, rows: 19 })
  pane.isOpen = opened.isPlaced || pane.isOpen

  return opened
}

const today = (now: number) => {
  const d = new Date(now)

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** What `/games <args>` asks for (SPEC.md §12). */
export function parse(args: string): { screen: Screen; text: string; toast?: string; isClose?: boolean } {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const [first = '', ...rest] = words
  const word = first.toLowerCase()
  if (word === '') return { screen: 'hub', text: 'Opened games.' }
  if (word === 'close') return { screen: 'hub', text: 'Closed games.', isClose: true }
  if (word === 'milestones' || word === 'trophies') return { screen: 'trophies', text: 'Opened all milestones.' }
  if (word === 'reset') {
    const target = rest.join(' ')
    if (target.toLowerCase() === 'all') return { screen: 'reset:all', text: 'Choose what to reset in the pane.' }
    const id = resolve(target)
    if (id) return { screen: `reset:${id}`, text: 'Choose what to reset in the pane.' }

    return { screen: 'hub', text: `No game called "${target}".`, toast: `No game called "${target}".` }
  }
  const id = resolve(words.join(' '))
  if (id) return { screen: `game:${id}`, text: `Opened ${nameOf(id)}.` }
  const close = suggest(words.join(' '))
  const toast = `No game called "${args.trim()}".${close ? ` Did you mean ${close.name}?` : ''}`

  return { screen: 'hub', text: toast, toast }
}

export const register: Register = (on, options) => {
  const config = configFrom(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'games',
      description: 'Play a game in a side pane: Snake, 2048, Minesweeper, Wordle',
      argumentHint: '[game]',
      immediate: true,
    })
    void refresh($).catch(() => {})

    return next(e)
  })

  on('command.run', { command: 'games' }, async ($, e) => {
    const asked = parse(e.args)
    if (asked.isClose) {
      await $.ui.close({ id: PANE })

      return { text: asked.text }
    }
    if (asked.toast) $.ui.toast(asked.toast)
    const opened = await open($, asked.screen)

    return { text: opened.isPlaced ? asked.text : 'Games will show when the window is wide enough for a pane.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    pane.isOpen = true
    const data = await read($, records)
    const asked = await read($, request)
    const pause = await read($, pauseSignal)
    const acked = await read($, ack)
    const now = await $.clock.now()

    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      // Mobile and the editor can't draw a board: the hub's stats, read-only (SPEC.md §4.1).
      const { Box, Text } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          <Text bold>Games</Text>
          {READY.map(entry => {
            const record = data.games[entry.id]
            const got = Object.keys(record?.milestones ?? {}).length

            return (
              <Text key={entry.id}>
                {entry.name} · ★ {got}/{GAMES[entry.id]?.milestones.length ?? 0}
              </Text>
            )
          })}
          <Text dimColor>Open Claude Code on your computer to play.</Text>
        </Box>
      )
    }

    const { Box, Client } = $.ui.resolve(e)
    const props = {
      records: data,
      request: asked,
      pause,
      settings: { highContrast: config.highContrast, wordleHardMode: config.wordleHardMode },
      room: {
        surface: e.surface,
        columns: e.props.bodyColumns,
        rows: e.props.scroll?.bodyRows ?? 24,
        placement: e.props.placement,
      },
      today: today(now),
      now,
      ack: acked,
    }

    return (
      <Box flexDirection="column">
        <Client key="board" module="./board.tsx" width="100%" props={props} />
      </Box>
    )
  })

  on('ui.message', async ($, e, next) => {
    const batch = e.data as Batch
    if (batch && batch.type === 'batch' && Array.isArray(batch.items)) {
      for (const item of batch.items) {
        if (item.id <= (handled.get(batch.inst) ?? 0)) continue
        handled.set(batch.inst, item.id)
        await onPost($, item.post).catch(() => {})
      }
      await update($, ack, () => ({ inst: batch.inst, id: handled.get(batch.inst) ?? 0 }))
    }

    return next(e)
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    pane.isOpen = false
    // Closing pauses: the board saves before it goes (SPEC.md §7.2).
    await update($, pauseSignal, n => n + 1).catch(() => {})

    return next(e)
  })

  // The player doing something else pauses an arcade game (SPEC.md §7.2).
  on('prompt.edit', ($, e, next) => {
    void signalPause($).catch(() => {})

    return next(e)
  })
  on('prompt.submit', ($, e, next) => {
    void signalPause($).catch(() => {})

    return next(e)
  })
  on('turn.start', ($, e, next) => {
    void signalPause($).catch(() => {})

    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (pane.isOpen && pane.screen.startsWith('game:')) {
      void signalPause($).catch(() => {})
      if (config.notifyTurnEnd) $.ui.toast('Claude finished')
    }

    return done
  })
}
