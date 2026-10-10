/** A scan as scan.py prints it: Monday 12 October 2026, after a Friday's work and an empty weekend. */
import type { Day, Group, ScanResult } from '../types'

function group(branch: string, minutes: number, extra: Partial<Group> = {}): Group {
  return {
    branch,
    isDefault: branch === 'main',
    pr: null,
    minutes,
    rawMin: minutes,
    unattendedMin: 0,
    first: '10:00',
    last: '12:00',
    what: [],
    asks: [],
    commits: [],
    commitCount: 0,
    files: [],
    fileCount: 0,
    dirs: [],
    dirCount: 0,
    tests: 0,
    spans: [[360, 480]],
    aloneSpans: [],
    sessions: [],
    ...extra,
  }
}

const hours = (filled: Record<number, number>) => Array.from({ length: 24 }, (_, i) => filled[i] ?? 0)

export const FRIDAY: Day = {
  date: '2026-10-09',
  totalMin: 318,
  unattendedMin: 14,
  hours: hours({ 6: 52, 7: 45, 8: 55, 9: 42, 11: 51, 12: 47, 13: 26 }),
  repos: [
    {
      name: 'qol-mods',
      slug: 'me/qol-mods',
      root: '/work/qol-mods',
      minutes: 256,
      hours: hours({ 8: 55, 9: 60, 10: 60, 11: 51, 12: 30 }),
      groups: [
        group('coach', 120, {
          pr: { number: 2, url: 'https://github.com/me/qol-mods/pull/2', repo: 'me/qol-mods', title: 'A weekly coach' },
          asks: ['coach report is not available in the desktop app', 'make the report cards in the desktop app'],
          commits: ['coach 0.2.0: the report as cards', 'coach 0.1.0: a weekly coach'],
          commitCount: 3,
          files: [['plugins/coach/hooks/pane.tsx', 4], ['plugins/coach/hooks/art.ts', 1]],
          fileCount: 7,
          dirs: [['plugins/coach/hooks', 6], ['.', 1]],
          dirCount: 2,
          tests: 12,
          rawMin: 124,
          unattendedMin: 14,
          first: '13:53',
          last: '16:47',
          what: ['Coach report pane', 'Marketplace source mismatch'],
          spans: [[593, 680], [690, 723]],
          aloneSpans: [[723, 737]],
        }),
        group('main', 130, { first: '12:16', last: '13:54', what: ['README previews'], spans: [[496, 594]] }),
        group('tidy', 6, { first: '09:00', last: '09:06', spans: [[300, 306]] }),
      ],
    },
    {
      name: 'api',
      slug: 'me/api',
      root: '/work/api',
      minutes: 62,
      hours: hours({ 6: 52, 7: 10 }),
      groups: [group('master', 62, { isDefault: true, what: ['Rate limit the search endpoint'] }), group('scratch', 0, { unattendedMin: 2 })],
    },
  ],
}

export const empty = (date: string): Day => ({ date, totalMin: 0, unattendedMin: 0, hours: hours({}), repos: [] })

export const MONDAY: Day = {
  date: '2026-10-12',
  totalMin: 45,
  unattendedMin: 0,
  hours: hours({ 6: 45 }),
  repos: [
    {
      name: 'qol-mods',
      slug: 'me/qol-mods',
      root: '/work/qol-mods',
      minutes: 45,
      hours: hours({ 6: 45 }),
      groups: [group('worklog', 45, { first: '10:15', last: '11:00', what: ['Standup and worklog plugin'], spans: [[375, 420]] })],
    },
  ],
}

export const FOUND: ScanResult = {
  today: '2026-10-12',
  days: [empty('2026-10-08'), FRIDAY, empty('2026-10-10'), empty('2026-10-11'), MONDAY],
  warnings: [],
}
