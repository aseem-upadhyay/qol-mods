/**
 * What running hooks/scan.py takes and gives (SPEC.md §5.2): the settings and
 * paths it runs with, its argv, and a reader for the NDJSON it prints. The
 * run itself is in register.tsx, where `$` is.
 */
import type { GradingInput, Report } from '../types'

export type Settings = {
  excludeProjects: string
  storeExcerpts: boolean
  contextThresholdK: number
  weekStartsOn: 'monday' | 'sunday'
  promptGrading: boolean
  gradingModel: 'haiku' | 'sonnet'
  gradingCapUsd: number
  liveHints: boolean
}

export const DEFAULTS: Settings = {
  excludeProjects: '',
  storeExcerpts: true,
  contextThresholdK: 300,
  weekStartsOn: 'monday',
  promptGrading: false,
  gradingModel: 'haiku',
  gradingCapUsd: 0.25,
  liveHints: false,
}

/** The manifest's userConfig values, read with the defaults filled in. */
export function settingsFrom(options: Readonly<Record<string, unknown>>): Settings {
  const pick = <K extends keyof Settings>(key: K, ok: (v: unknown) => boolean): Settings[K] =>
    (ok(options[key]) ? options[key] : DEFAULTS[key]) as Settings[K]
  return {
    excludeProjects: pick('excludeProjects', v => typeof v === 'string'),
    storeExcerpts: pick('storeExcerpts', v => typeof v === 'boolean'),
    contextThresholdK: pick('contextThresholdK', v => typeof v === 'number' && v > 0),
    weekStartsOn: pick('weekStartsOn', v => v === 'monday' || v === 'sunday'),
    promptGrading: pick('promptGrading', v => typeof v === 'boolean'),
    gradingModel: pick('gradingModel', v => v === 'haiku' || v === 'sonnet'),
    gradingCapUsd: pick('gradingCapUsd', v => typeof v === 'number' && v >= 0),
    liveHints: pick('liveHints', v => typeof v === 'boolean'),
  }
}

export type Paths = { home: string; config: string; projects: string; data: string }

export function pathsFrom(home: string | undefined, configDir: string | undefined): Paths {
  const h = home ?? ''
  const config = configDir ?? `${h}/.claude`
  return { home: h, config, projects: `${config}/projects`, data: `${config}/coach` }
}

export type ScanExtra = { full?: boolean; gradeWeek?: string }

export function argvFor(root: string, paths: Paths, settings: Settings, extra: ScanExtra = {}): string[] {
  const argv = [
    '/usr/bin/env',
    'python3',
    `${root}/hooks/scan.py`,
    '--projects',
    paths.projects,
    '--data',
    paths.data,
    '--config-dir',
    paths.config,
    '--home',
    paths.home,
    '--threshold-k',
    String(settings.contextThresholdK),
    '--week-start',
    settings.weekStartsOn,
    '--excerpts',
    settings.storeExcerpts ? 'on' : 'off',
    '--progress',
  ]
  if (settings.excludeProjects.trim()) argv.push('--exclude', settings.excludeProjects)
  if (extra.full) argv.push('--full')
  if (extra.gradeWeek) argv.push('--grade-week', extra.gradeWeek)
  return argv
}

/** Why a failed run failed, in words a person can act on. */
export function reasonOf(text: string): string {
  if (/python3/.test(text) && /No such file|not found/i.test(text)) return 'python3 not found'
  return 'scan failed (see claude --debug)'
}

export type ScanMessage = {
  progress?: [number, number]
  report?: Report | null
  grading?: GradingInput
  busy?: boolean
}

/** Turns the pieces of stdout, cut anywhere, into the whole lines' messages. */
export function lineReader(): { push: (text: string) => ScanMessage[]; end: () => ScanMessage[] } {
  let buffer = ''
  const parse = (line: string): ScanMessage[] => {
    if (!line.trim()) return []
    try {
      const msg = JSON.parse(line) as unknown
      return msg && typeof msg === 'object' ? [msg as ScanMessage] : []
    } catch {
      return []
    }
  }
  return {
    push(text) {
      buffer += text
      const out: ScanMessage[] = []
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        out.push(...parse(buffer.slice(0, nl)))
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf('\n')
      }
      return out
    },
    end() {
      const rest = buffer
      buffer = ''
      return parse(rest)
    },
  }
}
