/**
 * The board (SPEC.md §5, §6): the pane's one `Client` surface module. It runs
 * the hub, each game, the milestone views and the reset card, takes keys and
 * the pointer, and posts saves and outcomes to the hooks module, which owns
 * the store.
 */

import type { ClientKeyEvent, ClientModule, ClientPointerEvent, ClientSurface, JsonValue, RenderElement } from 'claude-code'

import type { AnyGame, BoardRoom, Key } from '../core/game'
import { progress } from '../core/milestones'
import { BOARD, EDGE, GRAY, INK, YELLOW } from '../core/palette'
import { seedFrom } from '../core/rng'
import { emptyRecord } from '../core/store'
import type { Batch, BoardPost, BoardProps, GameId, GameRecord, Outcome, Save, Screen } from '../types'
import { CATALOG, GAMES, headline, READY } from './catalog'

type Play = {
  id: GameId
  s: unknown
  isPaused: boolean
  /** The outcome once the game ended; the card shows it until a restart. */
  outcome?: Omit<Outcome, 'ms'>
  /** Bests before this game, for the card's "New best!". */
  best: Record<string, number>
  confirm?: 'restart' | 'practice'
  ticksSinceSave: number
}

type Local = {
  screen: Screen
  /** The screen `b` returns to from a milestone view. */
  back: Screen
  sel: number
  scroll: number
  play?: Play
  /** The last state of each game left, so a new game keeps its difficulty. */
  previous: Partial<Record<GameId, unknown>>
  seenRequest: number
  seenPause: number
  hasInput: boolean
}

/** Per instance, outside the redrawn state: props, timing and click targets. */
type Side = {
  props: BoardProps
  /** Milliseconds played in the current game, paused time excluded. */
  ms: number
  /** Rows of the last drawing that a click acts on, by row from the top. */
  targets: Map<number, (l: Local) => Local>
  /** Where the current game's board was drawn: its top row and left column. */
  boardAt: { top: number; left: number }
}

const sides = new WeakMap<object, Side>()
let seedCounter = 0

const gameOf = (screen: Screen): GameId | undefined =>
  screen.startsWith('game:') ? (screen.slice(5) as GameId) : undefined
const milestonesOf = (screen: Screen): GameId | undefined =>
  screen.startsWith('milestones:') ? (screen.slice(11) as GameId) : undefined
const resetOf = (screen: Screen): GameId | 'all' | undefined =>
  screen.startsWith('reset:') ? (screen.slice(6) as GameId | 'all') : undefined

const recordOf = (props: BoardProps, id: GameId): GameRecord => props.records.games[id] ?? emptyRecord()

function boardRoom(props: BoardProps, columns: number): BoardRoom {
  return {
    surface: props.room.surface,
    columns: Math.max(20, Math.min(props.room.columns, columns || props.room.columns)),
    rows: Math.max(8, props.room.rows - 2),
  }
}

/** The save to resume: Wordle's daily first, then practice once the daily is done (SPEC.md §10.12). */
function saveFor(def: AnyGame, record: GameRecord, today: string): Save | undefined {
  if (!def.daily) return record.save
  if (record.daily?.date === today) return record.daily.save ?? (record.daily.result !== undefined ? record.save : undefined)

  return undefined
}

function startGame(local: Local, id: GameId, props: BoardProps, columns: number, post: (p: BoardPost) => void, isPractice = false): Local {
  const def = GAMES[id]
  if (!def) return local
  const record = recordOf(props, id)
  const room = boardRoom(props, columns)
  const save = isPractice ? undefined : saveFor(def, record, props.today)
  let s: unknown
  if (save && save.v === def.v) {
    s = save.state
  } else {
    if (save) post({ type: 'stale', game: id })
    seedCounter += 1
    s = def.init({
      seed: seedFrom(props.now + seedCounter * 7919),
      room,
      settings: props.settings,
      today: props.today,
      record,
      previous: local.previous[id],
      isPractice,
    })
  }
  // An arcade game resumed from a save waits for the player (SPEC.md §7.2).
  const isPaused = save !== undefined && save.v === def.v && def.kind === 'arcade' && def.isUnderway(s)
  post({ type: 'nav', screen: `game:${id}` })

  return {
    ...local,
    screen: `game:${id}`,
    play: { id, s, isPaused, best: { ...record.stats.best }, ticksSinceSave: 0 },
  }
}

function saveOf(def: AnyGame, play: Play, now: number): BoardPost {
  const daily = def.daily?.(play.s)

  return {
    type: 'save',
    game: play.id,
    save: { v: def.v, at: now, state: play.s },
    facts: def.facts(play.s),
    ...(daily !== undefined ? { daily } : {}),
  }
}

/** Leaves the game on screen: saved if under way, else its save cleared. */
function leaveGame(local: Local, side: Side, post: (p: BoardPost) => void): Local {
  const play = local.play
  if (!play) return local
  const def = GAMES[play.id]
  if (def && !play.outcome) {
    if (def.isUnderway(play.s)) post(saveOf(def, play, side.props.now))
  }

  return { ...local, play: undefined, previous: { ...local.previous, [play.id]: play.s } }
}

function initial(props: BoardProps): Local {
  return {
    screen: 'hub',
    back: 'hub',
    sel: 0,
    scroll: 0,
    previous: {},
    seenRequest: -1,
    seenPause: props.pause,
    hasInput: false,
  }
}

/** Goes to a screen the hooks module or a key asked for. */
function go(local: Local, screen: Screen, side: Side, columns: number, post: (p: BoardPost) => void): Local {
  const id = gameOf(screen)
  if (id) {
    if (local.play?.id === id) return { ...local, screen }
    if (!GAMES[id]) return { ...leaveGame(local, side, post), screen: 'hub' }

    return startGame(leaveGame(local, side, post), id, side.props, columns, post)
  }
  const ms = milestonesOf(screen)
  if (ms || screen === 'trophies') {
    const pausedPlay = local.play && pause(local.play)
    if (local.play && pausedPlay) {
      const def = GAMES[local.play.id]
      if (def && def.isUnderway(local.play.s) && !local.play.outcome) post(saveOf(def, pausedPlay, side.props.now))
    }

    return { ...local, play: pausedPlay, back: local.screen.startsWith('game:') ? local.screen : 'hub', screen, scroll: 0 }
  }
  if (screen === 'hub') {
    const left = leaveGame(local, side, post)
    const sel = Math.max(0, READY.findIndex(e => e.id === local.play?.id))
    post({ type: 'nav', screen: 'hub' })

    return { ...left, screen, sel: local.play ? sel : local.sel }
  }

  return { ...leaveGame(local, side, post), screen }
}

function pause(play: Play): Play {
  const def = GAMES[play.id]
  if (!def || play.outcome || !(def.kind === 'arcade' || def.isTimed) || !def.isUnderway(play.s)) return play

  return { ...play, isPaused: true }
}

/**
 * Posts not yet acknowledged, per instance. One post a frame reaches the hooks
 * module and a later one replaces it, so each send carries them all (Batch).
 */
const outboxes = new WeakMap<object, { inst: string; next: number; items: Batch['items'] }>()

function outbox(surface: ClientSurface<Local>) {
  let box = outboxes.get(surface)
  if (!box) {
    box = { inst: Math.random().toString(36).slice(2, 10), next: 1, items: [] }
    outboxes.set(surface, box)
  }

  return box
}

// Props and posts are plain JSON; the engine types them loosely, these modules exactly.
function send(surface: ClientSurface<Local>, p: BoardPost) {
  const box = outbox(surface)
  box.items = [...box.items, { id: box.next, post: p }].slice(-50)
  box.next += 1
  const batch: Batch = { type: 'batch', inst: box.inst, items: box.items }
  surface.post(batch as unknown as JsonValue)
}

const Board: ClientModule<JsonValue, Local> = (raw, surface) => {
  const props = raw as unknown as BoardProps
  const post = (p: BoardPost) => send(surface, p)
  let side = sides.get(surface)
  if (!side) {
    side = { props, ms: 0, targets: new Map(), boardAt: { top: 1, left: 0 } }
    sides.set(surface, side)
    start(surface)
  }
  side.props = props
  const box = outbox(surface)
  if (props.ack?.inst === box.inst) box.items = box.items.filter(item => item.id > props.ack.id)

  let local = surface.state ?? initial(props)
  let isChanged = surface.state === undefined
  if (props.request.n !== local.seenRequest) {
    local = { ...go(local, props.request.screen, side, surface.columns, post), seenRequest: props.request.n }
    if (gameOf(local.screen)) side.ms = 0
    isChanged = true
  }
  if (props.pause !== local.seenPause) {
    const paused = local.play ? pause(local.play) : undefined
    if (local.play && paused && paused !== local.play) {
      const def = GAMES[local.play.id]
      if (def) post(saveOf(def, paused, props.now))
    }
    local = { ...local, play: paused, seenPause: props.pause }
    isChanged = true
  }
  // Once per new props at most: the engine counts props as the input behind it.
  if (isChanged) surface.setState(local)

  return draw(local, side, surface)
}

/** Starts the instance's clock and input, once (SPEC.md §4.2). */
function start(surface: ClientSurface<Local>) {
  const post = (p: BoardPost) => send(surface, p)

  surface.every(50, () => {
    const local = surface.state
    const side = sides.get(surface)
    const play = local?.play
    if (!local || !side || !play || play.isPaused || play.outcome || play.confirm || !gameOf(local.screen)) return
    const def = GAMES[play.id]
    if (!def) return
    if (def.isUnderway(play.s)) side.ms += 50
    const s = def.tick?.(play.s)
    if (s === undefined) return
    let next: Play = { ...play, s, ticksSinceSave: play.ticksSinceSave + 1 }
    next = settle(def, next, side, post)
    if (def.kind === 'arcade' && !next.outcome && next.ticksSinceSave >= 40) {
      post(saveOf(def, next, side.props.now))
      next = { ...next, ticksSinceSave: 0 }
    }
    surface.setState({ ...local, play: next })
  })

  surface.onKey(event => {
    const local = surface.state
    const side = sides.get(surface)
    if (!local || !side) return
    const next = onKey(local, event, side, surface.columns, post)
    if (next !== local) surface.setState({ ...next, hasInput: true })
    else if (!local.hasInput) surface.setState({ ...local, hasInput: true })
  })

  surface.onPointer(event => {
    const local = surface.state
    const side = sides.get(surface)
    if (!local || !side) return
    const next = onPointer(local, event, side, post)
    if (next !== local) surface.setState({ ...next, hasInput: true })
  })
}

/** After a move or a tick: the outcome posted once the game ends (SPEC.md §6.2). */
function settle(def: AnyGame, play: Play, side: Side, post: (p: BoardPost) => void): Play {
  if (play.outcome) return play
  const outcome = def.over(play.s)
  if (!outcome) return play
  post({ type: 'over', game: play.id, outcome: { ...outcome, ms: side.ms } })
  side.ms = 0

  return { ...play, outcome }
}

/** A game key moved the game: settled, and a turn game saved (SPEC.md §7.2). */
function moved(def: AnyGame, play: Play, s: unknown, side: Side, post: (p: BoardPost) => void): Play {
  const next = settle(def, { ...play, s, isPaused: false }, side, post)
  if (!next.outcome && def.kind === 'turn') post(saveOf(def, next, side.props.now))

  return next
}

function restart(local: Local, side: Side, columns: number, post: (p: BoardPost) => void, isPractice = false): Local {
  const play = local.play
  if (!play) return local
  const def = GAMES[play.id]
  if (def && !play.outcome && !def.daily?.(play.s)) post({ type: 'save', game: play.id, save: null, facts: {} })
  const kept = { ...local, play: undefined, previous: { ...local.previous, [play.id]: play.s } }
  side.ms = 0
  const fresh = startGame(kept, play.id, side.props, columns, post, isPractice)

  return fresh.play ? { ...fresh, play: { ...fresh.play, isPaused: false } } : fresh
}

function onKey(local: Local, event: ClientKeyEvent, side: Side, columns: number, post: (p: BoardPost) => void): Local {
  const k: Key = event
  const key = event.key
  const id = gameOf(local.screen)

  if (id && local.play) {
    const play = local.play
    const def = GAMES[play.id]
    if (!def) return local
    // Word games type letters, so their commands take shift (SPEC.md §5.3).
    // Once a game is over, letters aren't guesses: plain h, r, t, q and n work there too.
    const isShifted = key.length === 1 && key === key.toUpperCase() && /[A-Z]/.test(key)
    const cmd = def.isWordy && !play.outcome ? (isShifted ? key.toLowerCase() : '') : key.toLowerCase()

    if (play.confirm) {
      if (cmd === 'y' || key === 'y' || key === 'Y') return restart(local, side, columns, post, play.confirm === 'practice')

      return { ...local, play: { ...play, confirm: undefined } }
    }
    if (cmd === 'q') {
      post({ type: 'close' })

      return { ...leaveGame(local, side, post), screen: 'hub' }
    }
    if (cmd === 'h') return go(local, 'hub', side, columns, post)
    if (cmd === 't') return go(local, `milestones:${play.id}`, side, columns, post)
    if (cmd === 'p' && (def.kind === 'arcade' || def.isTimed) && !play.outcome && def.isUnderway(play.s)) {
      return { ...local, play: play.isPaused ? { ...play, isPaused: false } : pause(play) }
    }
    if ((cmd === 'r' && (!def.isWordy || play.outcome)) || (cmd === 'n' && def.isWordy)) {
      const isPractice = def.isWordy === true
      if (def.isUnderway(play.s) && !play.outcome) return { ...local, play: { ...play, confirm: isPractice ? 'practice' : 'restart' } }

      return restart(local, side, columns, post, isPractice)
    }
    if (play.outcome) return local
    if (def.isWordy && cmd) return local
    const s = def.key(play.s, k)
    if (s === undefined) return local

    return { ...local, play: moved(def, play, s, side, post) }
  }

  const lower = key.toLowerCase()
  if (lower === 'q') {
    post({ type: 'close' })

    return local
  }

  const ms = milestonesOf(local.screen)
  if (ms || local.screen === 'trophies') {
    if (key === 'up') return { ...local, scroll: Math.max(0, local.scroll - 1) }
    if (key === 'down') return { ...local, scroll: local.scroll + 1 }
    if (lower === 'h') return go(local, 'hub', side, columns, post)
    if (lower === 'b' || lower === 't' || key === 'return') return go(local, local.back, side, columns, post)

    return local
  }

  const reset = resetOf(local.screen)
  if (reset) {
    if (key === '1' || key === '2') {
      post({ type: 'reset', target: reset, milestones: key === '2' })

      return go(local, 'hub', side, columns, post)
    }
    if (lower === 'n' || lower === 'b' || lower === 'h') return go(local, 'hub', side, columns, post)

    return local
  }

  // The hub.
  if (key === 'up') return { ...local, sel: (local.sel + READY.length - 1) % READY.length }
  if (key === 'down') return { ...local, sel: (local.sel + 1) % READY.length }
  if (key === 'return' || key === ' ' || key === 'space') {
    const entry = READY[local.sel]
    if (entry) {
      side.ms = 0

      return go(local, `game:${entry.id}`, side, columns, post)
    }
  }
  if (key === 'T') return go(local, 'trophies', side, columns, post)
  if (lower === 't') {
    const entry = READY[local.sel]
    if (entry) return go(local, `milestones:${entry.id}`, side, columns, post)
  }
  const n = Number(key)
  if (Number.isInteger(n) && n >= 1 && n <= READY.length) {
    side.ms = 0

    return go({ ...local, sel: n - 1 }, `game:${READY[n - 1]?.id ?? 'snake'}`, side, columns, post)
  }

  return local
}

function onPointer(local: Local, event: ClientPointerEvent, side: Side, post: (p: BoardPost) => void): Local {
  if (event.type !== 'down' && event.type !== 'up' && event.type !== 'move') return local
  if (event.type === 'move' && !event.button) return local
  const id = gameOf(local.screen)
  if (id && local.play) {
    const play = local.play
    const def = GAMES[play.id]
    if (!def || play.confirm) return local
    if (play.isPaused) return event.type === 'down' ? { ...local, play: { ...play, isPaused: false } } : local
    if (play.outcome || !def.pointer) return local
    const room = boardRoom(side.props, side.props.room.columns)
    const s = def.pointer(
      play.s,
      { type: event.type, x: event.x - side.boardAt.left, y: event.y - side.boardAt.top, ...(event.shift ? { shift: true } : {}) },
      room,
    )
    if (s === undefined) return local

    return { ...local, play: moved(def, play, s, side, post) }
  }
  if (event.type !== 'down') return local
  const target = side.targets.get(event.y)

  return target ? target(local) : local
}

// ---------------------------------------------------------------- drawing

/** The controls line: as many as fit, most important first (SPEC.md §5.3). */
function fit(items: readonly string[], width: number): string {
  const out: string[] = []
  for (const item of items) {
    const next = [...out, item].join(' · ')
    if (next.length > width) break
    out.push(item)
  }

  return out.join(' · ')
}

function draw(local: Local, side: Side, surface: ClientSurface<Local>): RenderElement {
  side.targets = new Map()
  const props = side.props
  const width = Math.max(30, Math.min(props.room.columns, surface.columns || props.room.columns))
  const columns = surface.columns
  const on = (row: number, action: (l: Local) => Local) => side.targets.set(row, action)

  const id = gameOf(local.screen)
  if (id && local.play) return drawGame(local, local.play, side, surface, width)
  const ms = milestonesOf(local.screen)
  if (ms) return drawMilestones(local, side, surface, width, [ms], on)
  if (local.screen === 'trophies') return drawMilestones(local, side, surface, width, READY.map(e => e.id), on)
  const reset = resetOf(local.screen)
  if (reset) return drawReset(reset, surface, width, on, side, columns)

  return drawHub(local, side, surface, width, on, columns)
}

function header(surface: ClientSurface<Local>, left: string, right: string, width: number): RenderElement {
  const { Box, Text } = surface.elements

  return (
    <Box key="header" flexDirection="row" justifyContent="space-between" width={width} height={1}>
      <Text bold wrap="truncate">
        {left}
      </Text>
      <Text dimColor wrap="truncate">
        {right}
      </Text>
    </Box>
  )
}

function footer(surface: ClientSurface<Local>, items: readonly string[], width: number): RenderElement {
  const { Text } = surface.elements

  return (
    <Text key="footer" dimColor wrap="truncate">
      {fit(items, width)}
    </Text>
  )
}

function drawGame(local: Local, play: Play, side: Side, surface: ClientSurface<Local>, width: number): RenderElement {
  const { Box, Button, Text } = surface.elements
  const def = GAMES[play.id]
  if (!def) return <Text>Unknown game</Text>
  const props = side.props
  const room = boardRoom(props, surface.columns)
  const size = def.size(play.s, room)
  // A finished board stays bright: the result takes the controls line (SPEC.md §5.3).
  const isDim = play.isPaused || play.confirm !== undefined
  const boardWidth = Math.max(size.columns, Math.min(width, 42))
  side.boardAt = { top: 1, left: 0 }

  const best = recordOf(props, play.id).stats.best
  const common = def.isWordy
    ? ['H hub', 'T milestones', 'Q close']
    : [...(def.kind === 'arcade' || def.isTimed ? ['p pause'] : []), 'r new', 'h hub', 't milestones', 'q close']
  const controls = local.hasInput ? [...def.controls(play.s), ...common] : ['click to play', ...def.controls(play.s), ...common]

  let card: { title: string; lines: string[]; hint: string } | undefined
  if (play.confirm === 'restart') card = { title: 'Start a new game?', lines: ['This one is not saved.'], hint: 'y yes · any key no' }
  else if (play.confirm === 'practice') card = { title: 'Start a new one?', lines: ['This one is not saved.'], hint: 'y yes · any key no' }
  else if (play.isPaused && !play.outcome) card = { title: 'Paused', lines: [], hint: 'p or click to resume' }

  let result: RenderElement | undefined
  if (play.outcome) {
    const c = def.card(play.s, play.outcome, play.best)
    const again = c.again ?? 'again'
    // Buttons, so a click works and so does the hotkey while the pane has the
    // keys, even if the board itself lost them on a redraw.
    const press = (fn: (l: Local) => Local) => () => {
      const current = surface.state
      if (current) surface.setState(fn(current))
    }
    const post = (p: BoardPost) => send(surface, p)
    result = (
      <Box key="result" flexDirection="row" width={boardWidth} height={1}>
        <Text bold color={play.outcome.result === 'won' ? YELLOW : INK} wrap="truncate">
          {c.title}
        </Text>
        <Text color={INK} wrap="truncate">
          {c.lines.length ? ` · ${fit(c.lines, Math.max(0, boardWidth - c.title.length - again.length - 16))}` : ''}
        </Text>
        <Box flexGrow={1} />
        <Button
          key="again"
          plain
          hotkey="r"
          label={again}
          onPress={press(l => restart(l, side, surface.columns, post, def.isWordy === true))}
        />
        <Text> </Text>
        <Button key="hub" plain hotkey="h" label="hub" onPress={press(l => go(l, 'hub', side, surface.columns, post))} />
      </Box>
    )
  }

  const cardWidth = Math.min(Math.max(size.columns, 24), 30)
  const cardRows = card ? card.lines.length + 4 : 0

  return (
    <Box flexDirection="column" width={boardWidth}>
      {header(surface, def.name, def.status(play.s, best), boardWidth)}
      <Box key="board" height={size.rows} width={size.columns}>
        {def.draw(play.s, { E: surface.elements, room, settings: props.settings, dim: isDim })}
      </Box>
      {result ?? footer(surface, controls, boardWidth)}
      {card ? (
        // A child of the root is placed from the region's corner on both surfaces (SPEC.md §4.3 P8).
        <Box
          key="card"
          position="absolute"
          top={1 + Math.max(0, Math.floor((size.rows - cardRows) / 2))}
          left={Math.max(0, Math.floor((boardWidth - cardWidth) / 2))}
          width={cardWidth}
          flexDirection="column"
          alignItems="center"
          borderStyle="round"
          borderColor={GRAY}
          backgroundColor={EDGE}
        >
          <Text bold color={INK}>
            {card.title}
          </Text>
          {card.lines.map((line, i) => (
            <Text key={`l${i}`} color={INK}>
              {line}
            </Text>
          ))}
          <Text dimColor>{card.hint}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function drawHub(
  local: Local,
  side: Side,
  surface: ClientSurface<Local>,
  width: number,
  on: (row: number, action: (l: Local) => Local) => void,
  columns: number,
): RenderElement {
  const { Box, Text } = surface.elements
  const props = side.props
  const post = (p: BoardPost) => send(surface, p)
  const total = READY.reduce((n, e) => n + (GAMES[e.id]?.milestones.length ?? 0), 0)
  const unlocked = READY.reduce((n, e) => n + Object.keys(recordOf(props, e.id).milestones).length, 0)
  const isNarrow = width < 46
  const rows: RenderElement[] = [header(surface, 'Games', `★ ${unlocked} of ${total}`, width)]
  let y = 1
  let lastGroup = ''
  READY.forEach((entry, i) => {
    if (entry.group !== lastGroup) {
      lastGroup = entry.group
      rows.push(
        <Text key={`g${entry.group}`} dimColor>
          {entry.group}
        </Text>,
      )
      y += 1
    }
    const record = props.records.games[entry.id]
    const def = GAMES[entry.id]
    const isSel = i === local.sel
    const got = Object.keys(record?.milestones ?? {}).length
    const save = def ? saveFor(def, record ?? emptyRecord(), props.today) : undefined
    const isDailyOpen = entry.id === 'wordle' && record?.daily?.date !== props.today
    const isNew = !record || (record.stats.played === 0 && !save)
    const marker = isNew ? 'New' : save ? (isNarrow ? '●' : '● resume') : isDailyOpen ? (isNarrow ? '●' : '● today') : ''
    on(y, l => go({ ...l, sel: i }, `game:${entry.id}`, side, columns, post))
    rows.push(
      <Box key={`e${entry.id}`} flexDirection="row" width={width} height={1} backgroundColor={isSel ? EDGE : undefined}>
        <Text color={isSel ? INK : undefined}>{isSel ? '▸ ' : '  '}</Text>
        <Box width={2} height={1} backgroundColor={entry.color} justifyContent="center">
          <Text color={BOARD}>{entry.glyph}</Text>
        </Box>
        <Text bold={isSel}> {entry.name}</Text>
        <Box flexGrow={1} />
        {headline(entry.id, record) ? <Text dimColor>{headline(entry.id, record)}  </Text> : null}
        <Text dimColor>
          ★ {got}/{def?.milestones.length ?? 0}
        </Text>
        <Text color={marker === 'New' ? GRAY : YELLOW}>{marker ? `  ${marker}` : ''}</Text>
      </Box>,
    )
    y += 1
  })
  rows.push(<Box key="spacer" height={1} />)
  rows.push(footer(surface, ['↑↓ choose', '⏎ play', 't milestones', 'T all', 'q close'], width))

  return (
    <Box flexDirection="column" width={width}>
      {rows}
    </Box>
  )
}

function formatDate(at: number): string {
  const d = new Date(at)
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] ?? ''

  return `${d.getDate()} ${month}`
}

function drawMilestones(
  local: Local,
  side: Side,
  surface: ClientSurface<Local>,
  width: number,
  ids: readonly GameId[],
  on: (row: number, action: (l: Local) => Local) => void,
): RenderElement {
  const { Box, Text } = surface.elements
  const props = side.props
  const lines: RenderElement[] = []
  let total = 0
  let unlocked = 0
  for (const id of ids) {
    const def = GAMES[id]
    if (!def) continue
    const record = recordOf(props, id)
    const got = def.milestones.filter(m => record.milestones[m.id] !== undefined).length
    total += def.milestones.length
    unlocked += got
    if (ids.length > 1) {
      lines.push(
        <Box key={`h${id}`} flexDirection="row" justifyContent="space-between" width={width}>
          <Text bold>{CATALOG.find(e => e.id === id)?.name ?? id}</Text>
          <Text dimColor>
            ★ {got}/{def.milestones.length}
          </Text>
        </Box>,
      )
    }
    for (const m of def.milestones) {
      const at = record.milestones[m.id]
      const p = progress(m, record)
      const right = at !== undefined ? formatDate(at) : p ? `${p.at} of ${p.of}` : ''
      lines.push(
        <Box key={`m${id}${m.id}`} flexDirection="row" width={width}>
          <Text color={at !== undefined ? YELLOW : GRAY}>{at !== undefined ? '★ ' : '☆ '}</Text>
          <Text bold={at !== undefined} dimColor={at === undefined}>
            {m.name}
          </Text>
          <Box flexGrow={1} />
          <Text dimColor>{right}</Text>
        </Box>,
      )
      lines.push(
        <Text key={`g${id}${m.id}`} dimColor wrap="truncate">
          {'  '}
          {m.goal}
        </Text>,
      )
    }
  }
  const room = Math.max(4, props.room.rows - 3)
  const maxScroll = Math.max(0, lines.length - room)
  const scroll = Math.min(local.scroll, maxScroll)
  const title = ids.length === 1 ? `${CATALOG.find(e => e.id === ids[0])?.name ?? ''} milestones` : 'All milestones'
  on(props.room.rows - 1, l => go(l, l.back, side, surface.columns, p => send(surface, p)))

  return (
    <Box flexDirection="column" width={width}>
      {header(surface, title, `★ ${unlocked} of ${total}`, width)}
      {lines.slice(scroll, scroll + room)}
      {footer(surface, [...(maxScroll > 0 ? ['↑↓ scroll'] : []), 'b back', 'h hub', 'q close'], width)}
    </Box>
  )
}

function drawReset(
  target: GameId | 'all',
  surface: ClientSurface<Local>,
  width: number,
  on: (row: number, action: (l: Local) => Local) => void,
  side: Side,
  columns: number,
): RenderElement {
  const { Box, Text } = surface.elements
  const post = (p: BoardPost) => send(surface, p)
  const name = target === 'all' ? 'every game' : (CATALOG.find(e => e.id === target)?.name ?? target)
  const pick = (milestones: boolean) => (l: Local) => {
    post({ type: 'reset', target, milestones })

    return go(l, 'hub', side, columns, post)
  }
  on(2, pick(false))
  on(3, pick(true))
  on(4, l => go(l, 'hub', side, columns, post))

  return (
    <Box flexDirection="column" width={width}>
      {header(surface, `Reset ${name}?`, '', width)}
      <Box height={1} />
      <Text>
        <Text bold>1</Text> Reset stats and saved game
      </Text>
      <Text>
        <Text bold>2</Text> Reset everything, milestones too
      </Text>
      <Text>
        <Text bold>n</Text> Cancel
      </Text>
    </Box>
  )
}

export default Board
