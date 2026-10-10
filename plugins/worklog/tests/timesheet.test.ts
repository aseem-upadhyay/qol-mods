import { expect, test } from 'claude-code/testing'

import { roundDay, sheetCsv, sheetMarkdown, sheetOf, sheetText, weekStartOf } from '../hooks/timesheet'
import type { Day } from '../types'
import { empty, FRIDAY } from './fixtures'

const WEEK = { start: '2026-10-05', days: [empty('2026-10-08'), FRIDAY], roundTo: 15 }

test('a week starts on its Monday, or its Sunday', async () => {
  expect(weekStartOf('2026-10-09', 'monday')).toBe('2026-10-05')
  expect(weekStartOf('2026-10-05', 'monday')).toBe('2026-10-05')
  expect(weekStartOf('2026-10-09', 'sunday')).toBe('2026-10-04')
  expect(weekStartOf('2026-10-04', 'monday')).toBe('2026-09-28')
})

test("rounded cells add up to the day's rounded total", async () => {
  expect(roundDay([50, 50, 20], 15)).toEqual([60, 45, 15])
  expect(roundDay([120, 130, 6, 62], 15)).toEqual([120, 135, 0, 60])
  expect(roundDay([10, 10], 0)).toEqual([10, 10])
})

test('a cell of more than half a step is never rounded away', async () => {
  expect(roundDay([8, 100], 15)).toEqual([15, 90])
  expect(roundDay([7, 100], 15)).toEqual([0, 105])
})

test('the sheet: a row per branch with time, repos with most first, branches with most first', async () => {
  const sheet = sheetOf(WEEK)
  expect(sheet.rows.map(r => [r.repo, r.label, r.cells[4], r.total])).toEqual([
    ['qol-mods', 'main', 135, 135],
    ['qol-mods', '#2 coach', 120, 120],
    ['api', 'master', 60, 60],
  ])
  expect(sheet.dayTotals).toEqual([0, 0, 0, 0, 315, 0, 0])
  expect(sheet.total).toBe(315)
})

test('as plain text, in columns', async () => {
  const lines = sheetText(sheetOf(WEEK)).split('\n')
  expect(lines[0]).toMatch(/^ +Mon 5 +Tue 6 +Wed 7 +Thu 8 +Fri 9 +Sat 10 +Sun 11 +Total$/)
  expect(lines[1]).toBe('qol-mods')
  expect(lines[2]).toMatch(/^ {2}main +· +· +· +· +2:15 +· +· +2:15$/)
  expect(lines.at(-1)).toMatch(/^Total +· +· +· +· +5:15 +· +· +5:15$/)
})

test('as a Markdown table, the repo named on its first row', async () => {
  const lines = sheetMarkdown(sheetOf(WEEK)).split('\n')
  expect(lines[0]).toBe('| Repo | Branch | Mon 5 | Tue 6 | Wed 7 | Thu 8 | Fri 9 | Sat 10 | Sun 11 | Total |')
  expect(lines[2]).toBe('| qol-mods | main |  |  |  |  | 2:15 |  |  | 2:15 |')
  expect(lines[3]).toBe('|  | #2 coach |  |  |  |  | 2:00 |  |  | 2:00 |')
  expect(lines.at(-1)).toBe('| **Total** | |  |  |  |  | **5:15** |  |  | **5:15** |')
})

test('as CSV, a row per day and branch, titles quoted where they need it', async () => {
  const day: Day = {
    ...FRIDAY,
    repos: [{ ...FRIDAY.repos[1]!, groups: [{ ...FRIDAY.repos[1]!.groups[0]!, what: ['Rate limit, then "retry"'] }] }],
  }
  const week = { start: '2026-10-05', days: [day], roundTo: 15 }
  expect(sheetCsv(sheetOf(week), week.days)).toBe(
    'date,repo,pr,branch,title,hours,raw_hours,first,last\n2026-10-09,me/api,,master,"Rate limit, then ""retry""",1.00,1.03,10:00,12:00\n',
  )
})
