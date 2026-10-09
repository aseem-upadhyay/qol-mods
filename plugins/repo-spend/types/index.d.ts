/** What the transcript scan of earlier sessions came to (scan.py's output). */
export type History = {
  usd: number
  sessions: number
  estimatedUsd: number
  today: number
  week: number
  /** Epoch ms of the oldest message counted; null when no session has any. */
  since: number | null
  /** Models that used tokens but have no price row: the total is a floor. */
  unpriced: string[]
}

/** One reading of this session's cost: when, and the running total. */
export type Sample = { at: number; usd: number }

declare module 'claude-code' {
  interface PluginState {
    'repo-spend': {
      history: History | null
      scanError: string | null
      samples: Sample[]
      isHidden: boolean
      /** Bumped every minute so the rate and sparkline slide while idle. */
      tick: number
    }
  }
}
