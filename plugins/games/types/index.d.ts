/** The games mod's records (SPEC.md §8) and its $.state contract (§8.4). */

/** Every game in the catalog; `READY` in hooks/catalog.ts says which are playable. */
export type GameId =
  | 'snake' | 'tetris' | 'breakout' | 'dino' | 'pong'
  | '2048' | 'mines' | 'lights' | 'memory'
  | 'connect4' | 'tictactoe'
  | 'wordle' | 'hangman' | 'twenty'

/** A game in progress: its version and its serialized state (plain JSON). */
export type Save = { v: number; at: number; state: unknown }

export type Stats = {
  played: number
  won: number
  lost: number
  /** Time played, paused time excluded. */
  totalMs: number
  lastPlayedAt?: number
  /** Per game: 'score', 'time.easy', 'flips', ...; whether higher or lower is better is the game's. */
  best: Record<string, number>
  streak: { current: number; best: number; at: number }
  /** The game's own counters: 'solved', 'noFlagWins', ... */
  extra: Record<string, number>
}

export type GameRecord = {
  stats: Stats
  /** Milestone id → when it unlocked (epoch ms). */
  milestones: Record<string, number>
  save?: Save
  /** Wordle only: today's daily puzzle. */
  daily?: { date: string; save?: Save; result?: unknown }
}

export type Profile = {
  firstPlayedAt?: number
  lastGame?: GameId
}

/** Everything the board draws from: the store, read whole. */
export type Records = {
  profile: Profile
  games: Partial<Record<GameId, GameRecord>>
}

/** What the pane shows: the hub, a game, a game's milestones, all milestones, or a reset card. */
export type Screen =
  | 'hub'
  | 'trophies'
  | `game:${GameId}`
  | `milestones:${GameId}`
  | `reset:${GameId | 'all'}`

/** A screen the hooks module asks the board to show; `n` changes on every ask. */
export type Request = { screen: Screen; n: number }

/** The settings of the manifest's userConfig (SPEC.md §11) the board needs. */
export type Settings = { highContrast: boolean; wordleHardMode: boolean }

/** The room the pane gives the board (SPEC.md §4.3 P6). */
export type Room = {
  surface: 'terminal' | 'desktop'
  columns: number
  rows: number
  placement: 'dock' | 'inline'
}

/** Props the hooks module hands the board (SPEC.md §6.2). */
export type BoardProps = {
  records: Records
  request: Request
  /** Changes when the player does something else: arcade games pause (SPEC.md §7.2). */
  pause: number
  settings: Settings
  room: Room
  /** Today's local date, YYYY-MM-DD, for Wordle's daily puzzle. */
  today: string
  /** Epoch ms when the props were made; the board's clock between them is its own ticks. */
  now: number
  /** The last post the hooks module has handled, by board instance (see Batch). */
  ack: Ack
}

export type Ack = { inst: string; id: number }

/** What a game reports for its milestones and stats: plain numbers. */
export type Facts = Record<string, number>

/** A game that ended. */
export type Outcome = {
  /** Won, lost, or neither (a score game ends with neither). */
  result: 'won' | 'lost' | 'ended'
  ms: number
  facts: Facts
  /** Bests to record: key → value. */
  best: Record<string, number>
  /** Counters to add. */
  extra?: Record<string, number>
  /** Streak: 'won' extends it, 'lost' resets it, absent leaves it. */
  streak?: 'won' | 'lost'
  /** Wordle's daily puzzle, by date. */
  daily?: string
}

/** What the board posts to the hooks module (SPEC.md §6.2). */
export type BoardPost =
  | { type: 'save'; game: GameId; save: Save | null; facts: Facts; daily?: string }
  | { type: 'over'; game: GameId; outcome: Outcome }
  | { type: 'nav'; screen: Screen }
  | { type: 'reset'; target: GameId | 'all'; milestones: boolean }
  | { type: 'stale'; game: GameId }
  | { type: 'close' }

/**
 * What the board actually sends: a post that lands in the same frame as
 * another replaces it, so every post not yet acknowledged rides again in each
 * batch, and the hooks module handles each id once.
 */
export type Batch = { type: 'batch'; inst: string; items: { id: number; post: BoardPost }[] }

declare module 'claude-code' {
  interface PluginState {
    games: {
      records: Records
      request: Request
      pause: number
      ack: Ack
    }
  }
}
