/**
 * The manifest's settings, and the argv scan.py runs with (SPEC.md §7.2, §9).
 * The run itself is in register.tsx, where `$` is.
 */

export type Settings = {
  idleGapMin: number
  leadInMin: number
  maxUnattendedMin: number
  parallelSplit: 'focus' | 'even'
  dayStartsAt: string
  workDays: string
  excludeProjects: string
  includeNonRepo: boolean
  includePrompts: boolean
  weekStartsOn: 'monday' | 'sunday'
  roundTo: number
  useGitHub: boolean
  extraRoots: string
  csvFolder: string
}

export const DEFAULTS: Settings = {
  idleGapMin: 15,
  leadInMin: 5,
  maxUnattendedMin: 30,
  parallelSplit: 'focus',
  dayStartsAt: '04:00',
  workDays: 'mon,tue,wed,thu,fri',
  excludeProjects: '',
  includeNonRepo: false,
  includePrompts: true,
  weekStartsOn: 'monday',
  roundTo: 15,
  useGitHub: true,
  extraRoots: '',
  csvFolder: '~/Documents/worklog',
}

/** The steps a timesheet can round to, in minutes; 0 for none. */
export const ROUNDINGS = [0, 5, 6, 10, 15, 30, 60]

const WHOLE = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 24 * 60
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** The manifest's userConfig values, with the defaults where one is missing or wrong. */
export function settingsFrom(options: Readonly<Record<string, unknown>>): Settings {
  const pick = <K extends keyof Settings>(key: K, ok: (v: unknown) => boolean): Settings[K] =>
    (ok(options[key]) ? options[key] : DEFAULTS[key]) as Settings[K]
  return {
    idleGapMin: pick('idleGapMin', v => WHOLE(v) && (v as number) > 0),
    leadInMin: pick('leadInMin', WHOLE),
    maxUnattendedMin: pick('maxUnattendedMin', WHOLE),
    parallelSplit: pick('parallelSplit', v => v === 'focus' || v === 'even'),
    dayStartsAt: pick('dayStartsAt', v => typeof v === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim())).trim(),
    workDays: pick('workDays', v => typeof v === 'string' && workDaysFrom(v).size > 0),
    excludeProjects: pick('excludeProjects', v => typeof v === 'string'),
    includeNonRepo: pick('includeNonRepo', v => typeof v === 'boolean'),
    includePrompts: pick('includePrompts', v => typeof v === 'boolean'),
    weekStartsOn: pick('weekStartsOn', v => v === 'monday' || v === 'sunday'),
    roundTo: pick('roundTo', v => typeof v === 'number' && ROUNDINGS.includes(v)),
    useGitHub: pick('useGitHub', v => typeof v === 'boolean'),
    extraRoots: pick('extraRoots', v => typeof v === 'string'),
    csvFolder: pick('csvFolder', v => typeof v === 'string' && v.trim() !== '').trim(),
  }
}

/** "mon,tue" or "mon-fri" as weekday numbers, Sunday 0. */
export function workDaysFrom(text: string): Set<number> {
  const days = new Set<number>()
  for (const part of text.toLowerCase().split(',')) {
    const [from, to] = part.split('-').map(s => DAY_NAMES.indexOf(s.trim().slice(0, 3)))
    if (from === undefined || from < 0) continue
    if (to === undefined) {
      days.add(from)
      continue
    }
    if (to < 0) continue
    for (let d = from; ; d = (d + 1) % 7) {
      days.add(d)
      if (d === to) break
    }
  }
  return days
}

export type Paths = { home: string; projects: string; cache: string; archive: string }

export function pathsFrom(
  home: string | undefined,
  configDir: string | undefined,
  cacheHome: string | undefined,
  dataHome?: string | undefined,
): Paths {
  const h = home ?? ''
  return {
    home: h,
    projects: `${configDir || `${h}/.claude`}/projects`,
    // The cache can go at any time; the archive is the only record of days
    // whose logs are gone, so it lives with data.
    cache: `${cacheHome || `${h}/.cache`}/claude-worklog/scan.json`,
    archive: `${dataHome || `${h}/.local/share`}/claude-worklog/days`,
  }
}

/** A path with a leading ~ as the home folder. */
export function expandHome(path: string, home: string): string {
  return path === '~' ? home : path.startsWith('~/') ? `${home}${path.slice(1)}` : path
}

/** scan.py's argv for the days `from` to `to`: dates, or days from today ("-1"). */
export function argvFor(root: string, paths: Paths, settings: Settings, from: string, to: string): string[] {
  const argv = [
    '/usr/bin/env',
    'python3',
    `${root}/hooks/scan.py`,
    '--projects',
    paths.projects,
    '--cache',
    paths.cache,
    '--home',
    paths.home,
    `--from=${from}`,
    `--to=${to}`,
    '--idle-gap',
    String(settings.idleGapMin),
    '--lead-in',
    String(settings.leadInMin),
    '--max-unattended',
    String(settings.maxUnattendedMin),
    '--day-start',
    settings.dayStartsAt,
    '--archive',
    paths.archive,
  ]
  if (settings.parallelSplit === 'even') argv.push('--split', 'even')
  if (!settings.useGitHub) argv.push('--github', 'off')
  if (settings.extraRoots.trim()) argv.push('--extra-roots', settings.extraRoots)
  if (settings.excludeProjects.trim()) argv.push('--exclude', settings.excludeProjects)
  if (settings.includeNonRepo) argv.push('--include-non-repo')
  if (!settings.includePrompts) argv.push('--no-asks')
  return argv
}
