/** What hooks/scan.py reports (SPEC.md Appendix A), and coach's own state. */

export type HabitId = 'fresh-start' | 'point-to-place' | 'say-done' | 'check-work' | 'plan-big'

export type Evidence = {
  id: string
  detector: string
  session: string
  project: string
  root: string
  title: string
  at: number
  excerpt: string | null
  usd: number | null
  numbers: Record<string, number | string>
}

export type HabitWeek = {
  value: number | null
  sample: number
  target: number
  min: number
  eligible: boolean
  impactUsd: number
  evidence: string[]
  done: number
  total: number
}

export type Tip = {
  id: string
  family: 'tip'
  level: number
  category: string
  score: number
  impactUsd: number | null
  count: number
  evidence: string[]
  numbers: Record<string, string | number>
  conflicts: string[]
}

export type Notice = {
  id: 'bypass' | 'cost-spike' | 'api-errors' | 'unpriced'
  n?: number
  day?: string
  usd?: number
  ratio?: number
  title?: string | null
  models?: string[]
}

export type WeekRow = {
  week: string
  start: number
  end: number
  frozen: boolean
  /** The week's first activity, epoch ms; null for a week with none. */
  firstAt?: number | null
  metricsVersion: number
  coverage: { partial: boolean; firstLogAt: number | null }
  versionsSeen: string[]
  volume: { sessions: number; prompts: number; commands: number; activeDays: number }
  cost: {
    usd: number
    inputUsd: number
    outputUsd: number
    byModel: Record<string, number>
    byProject: Record<string, number>
    byDay: Record<string, number>
    unpriced: string[]
    estimated: boolean
    perPrompt: { median: number; p90: number }
    fastUsd: number
    rewarmUsd: number
    rewarmEvents: number
  }
  usage: {
    callsPerPrompt: number
    contextPerCall: { median: number; p90: number }
    cacheHitRate: number
    effortShare: Record<string, number>
    families: string[]
  }
  context: {
    oversizedSessions: number
    compactions: { auto: number; manual: number; unknown: number }
    fresh: number
    stale: number
  }
  together: {
    interrupts: number
    rejections: number
    classifierBlocks: number
    corrections: number
    apiErrors: number
    endedBadly: number
  }
  work: { codePrompts: number; checked: number; commits: number; bigChanges: number; bigChangesPlanned: number }
  prompts: {
    opening: number
    namesPlace: number
    saysDone: number
    vague: number
    bigPastes: number
    images: number
    medianWords: number
  }
  features: Record<string, number>
  safety: { bypassSessions: number }
  memory: { discoveryEpisodes: number; discoverySteps: number; wrongToolFirst: number; repeatedCorrections: number }
  repeats: { prompts: number; clusters: number }
  habits: Partial<Record<HabitId, HabitWeek>>
  tips: Tip[]
  notices: Notice[]
  evidence: Record<string, Evidence>
  /** The evidence id of the week's best opening prompt (SPEC.md §10.1), when there is one. */
  best?: string | null
  sessionIds: string[]
}

export type WeekSummary = {
  week: string
  start: number
  partial: boolean
  metricsVersion: number
  usd: number
  prompts: number
  sessions: number
  costPerPrompt: number
  correctionsPer10: number | null
  interruptsPer10: number | null
  oversized: number
  discoverySteps: number
  repeatedPrompts: number
  habits: Partial<Record<HabitId, number | null>>
}

export type ClaudeMdLine = {
  id: string
  source: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6'
  text?: string
  file: 'project' | 'user'
  machine?: boolean
  evidence: string[]
  numbers: Record<string, number>
}

export type ClaudeMdCard = {
  id: string
  family: 'claude-md'
  level: number
  project: string
  root: string
  file: string
  hasClaudeMd: boolean
  loadedLines: number
  loadedTokens: number
  lines: ClaudeMdLine[]
  pointers: { files: string[]; tasks: string[] }
  notes: { id: string; text?: string; times?: number; lines?: number; tokens?: number }[]
  impactUsd: number
  score: number
}

export type CoveredLine = {
  id: string
  project: string
  source: string
  text: string
  sessions: number
  events: number
}

export type SkillCard = {
  id: string
  family: 'skill'
  level: number
  name: string
  scope: 'project' | 'user'
  project: string | null
  location: string
  count: number
  sessions: number
  template: string | null
  slots: string[]
  followUps: { text: string | null; share: number; count: number }[]
  correctedShare: number
  existing: {
    name: string
    since: number
    handTyped: number
    uses: number
    correctionsBefore: number
    correctionsAfter: number
  } | null
  evidence: string[]
  signature: number[]
  score: number
}

export type SkillAdopted = {
  name: string
  uses: number
  since: number
  correctionsBefore: number
  correctionsAfter: number
}

export type FeatureSeen = { firstSeen: number; lastSeen: number; count: number }

export type Report = {
  generatedAt: number
  parserVersion: number
  metricsVersion: number
  weekStart: 'monday' | 'sunday'
  thresholdK: number
  excerpts: boolean
  coverage: { since: number | null; logsSince: number | null; files: number; sessions: number }
  current: WeekRow | null
  previous: WeekRow | null
  recent: WeekRow | null
  /** The last six full weeks, oldest first: what the pane pages through. */
  weeks: WeekRow[]
  history: WeekSummary[]
  features: Record<string, FeatureSeen>
  level: number
  upNext: { feature: string; reason: string | null } | null
  suggestions: {
    claudeMd: ClaudeMdCard[]
    claudeMdCovered: CoveredLine[]
    skills: SkillCard[]
    skillsAdopted: SkillAdopted[]
  }
  evidence: Record<string, Evidence>
  hints: { clusters: { id: string; name: string; count: number; signature: number[]; existing: string | null }[] }
  live: { lastRequestAt: number | null; sessions?: Record<string, [number, number]> }
  restored: boolean
  errors: string[]
}

/** One graded prompt sample handed out by scan.py --grade-week. */
export type GradingInput = {
  week: string
  prompts: {
    id: string
    project: string
    text: string
    followUps: number
    corrections: number
    next: string[]
  }[]
}

export type Grading = {
  week: string
  model: string
  rubricVersion: number
  n: number
  criteria: Record<string, number>
  shareAtLeast7: number
  costUsd: number
  rewrite: { before: string; after: string; followUps: number; project: string } | null
}

export type TipChoice = { dismissedAt?: number; snoozedUntil?: number; shownWeeks: string[] }

/** What the person chose, kept in $.store and mirrored into $.state for drawing. */
export type Choices = {
  firstReportWeek: string | null
  lastSeenWeek: string | null
  habitLog: { week: string; habit: HabitId; status: 'active' | 'learned' | 'skipped' }[]
  tips: Record<string, TipChoice>
  notRight: { detector: string; evidenceId: string; at: number }[]
  /** Live hints: when each kind last showed, today's count, kinds turned off, and /coach hints. */
  hints: { lastShownAt: Record<string, number>; day: string; count: number; off: string[]; enabled?: boolean }
  grading: Record<string, Grading>
  adoptions: Record<string, { at: number; baseline: Record<string, number>; text?: string; told?: boolean }>
  barHidden: boolean
}

export type ScanState = {
  status: 'idle' | 'scanning' | 'failed'
  progress?: [number, number]
  error?: string
  at?: number
}

/** What the pane shows: which page, which week, and an open detail. */
export type View = {
  page: 'report' | 'tips' | 'claude-md' | 'skills'
  /** A week id from the report, or null for the default one. */
  week: string | null
  /** An evidence id or `glossary:<term>` opened inline; null when none. */
  detail: string | null
}

/** A moment's hint in the bar (phase 3). */
export type Nudge = { kind: string; text: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    coach: {
      report: Report | null
      scan: ScanState
      view: View
      choices: Choices
      nudge: Nudge | null
      /** "Did it help" lines worked out when the report was opened (SPEC.md §9.6, §9.7). */
      wins: { id: string; text: string }[]
      /** Bumped every minute so a nudge can expire while the session is idle. */
      tick: number
    }
  }
}
