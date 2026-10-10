/** What hooks/scan.py reports (SPEC.md §7.3), and worklog's own state. */

/** One session's share of a group: its attended minutes before overlaps were split. */
export type Session = { id: string; title: string | null; min: number }

/** A PR: from a `pr-link` record in the transcripts, or GitHub's, matched by branch. */
export type Pr = {
  number: number
  url: string
  repo: string
  /** GitHub's title, else the --title Claude gave `gh pr create`; null when neither was seen. */
  title: string | null
  /** From GitHub; null without it. */
  state: 'open' | 'merged' | 'closed' | null
  isDraft: boolean
}

/** A PR the user reviewed, on the day they did. */
export type Review = { repo: string; number: number; title: string; url: string; at: string }

/** One of the user's open PRs, from GitHub. */
export type OpenPr = { repo: string; number: number; title: string; url: string; isDraft: boolean }

/** Work on one branch of one repo, in one day. */
export type Group = {
  branch: string
  isDefault: boolean
  pr: Pr | null
  /** The group's share of the day, overlaps split: the day's groups add up to its total. */
  minutes: number
  /** Minutes the user was there for, before overlaps were split. */
  rawMin: number
  /** Minutes Claude worked on alone, past the cap: not in `minutes`. */
  unattendedMin: number
  /** Local "HH:MM". */
  first: string
  last: string
  /** Session titles, the ones with the most time first. */
  what: string[]
  /** Up to three of the user's prompts that day, quoted, in the order asked; empty with includePrompts off. */
  asks: string[]
  /** Subjects of the commits made (Claude's from its commands, all of them from git), the first six, and how many in all. */
  commits: string[]
  commitCount: number
  /** Those made outside Claude: by hand, with no session at work in the repo. */
  handCommits: string[]
  /** Files Claude changed, as [path in the repo, edits], the five most edited, and how many in all. */
  files: [string, number][]
  fileCount: number
  /** The same files by folder (three levels deep), as [folder, files], the four with most, and how many folders. */
  dirs: [string, number][]
  dirCount: number
  /** How many times tests ran. */
  tests: number
  /** Minutes attended, as [from, to) minutes after the day's start. */
  spans: [number, number][]
  /** Minutes Claude worked on alone, the same way. */
  aloneSpans: [number, number][]
  sessions: Session[]
}

export type Repo = {
  name: string
  slug: string | null
  root: string
  minutes: number
  /** Attended minutes in each hour, counted from dayStartsAt. */
  hours: number[]
  groups: Group[]
}

/** One day of a standup, under its heading ("Fri 9 Oct", "Today so far (Mon 12 Oct)"). */
export type StandupBlock = { heading: string; isToday: boolean; day: Day }

/** A /standup reply as data, so its row can be drawn from it. */
export type Standup = {
  /** "Standup since Fri 9 Oct"; null for one day asked for. */
  title: string | null
  blocks: StandupBlock[]
  /** Said instead of the blocks when there's nothing: "Nothing in your logs since Fri 9 Oct." */
  note: string | null
  /** The line above it all: "Copied to your clipboard:"; null for none. */
  lead: string | null
  /** `/standup full`: what was asked, committed and changed under each branch, not only its headline. */
  full: boolean
  /** The user's open PRs, listed after the days; empty without GitHub. */
  openPrs: OpenPr[]
  /** `/standup week`: the week's timesheet in place of the days. */
  week: Week | null
  footer: string | null
}

export type Day = {
  /** YYYY-MM-DD, the day that starts at dayStartsAt. */
  date: string
  totalMin: number
  unattendedMin: number
  /** Minutes active in each hour, counted from dayStartsAt. */
  hours: number[]
  repos: Repo[]
  /** PRs the user reviewed that day, from GitHub. */
  reviews: Review[]
  /** "archive" for a day read back after Claude Code deleted its logs. */
  source: 'logs' | 'archive'
}

export type ScanResult = {
  today: string
  days: Day[]
  openPrs: OpenPr[]
  /** Whether GitHub was read: off in the settings, or unavailable (no gh, signed out, offline). */
  github: 'ok' | 'off' | 'unavailable'
  warnings: string[]
}

/** A week of days, as /standup week and the pane's Week view show it. */
export type Week = {
  /** The week's first day, YYYY-MM-DD. */
  start: string
  /** Its seven days, a day with nothing in it included. */
  days: Day[]
  /** Minutes each cell is rounded to; 0 for none. */
  roundTo: number
}

export type ScanState = { status: 'idle' | 'running' | 'failed'; error: string | null }

declare module 'claude-code' {
  interface PluginState {
    worklog: {
      /** Every day scanned this session, by date. */
      days: Record<string, Day>
      /** Today's date by dayStartsAt, from the last scan; null before the first. */
      today: string | null
      /** The day the pane shows; null for today. */
      date: string | null
      scan: ScanState
      /** The standups replied this session, by the reply's text, so their rows draw from data. */
      standups: Record<string, Standup>
      /** Branches opened or closed in the pane, by "root|branch"; unset follows allOpen. */
      open: Record<string, boolean>
      /** Every branch's details shown in the pane. */
      allOpen: boolean
      /** Which view the pane shows. */
      tab: 'day' | 'week'
      /** The week the Week view shows, by its first day; null for this week. */
      week: string | null
    }
  }
}
