import { expect, test } from 'claude-code/testing'

import { addDays, dayLabel, duration, standupDays, weekday } from '../hooks/days'
import { axisText, cellsOf, rangeOf, slotsFor } from '../hooks/view'
import { DEFAULTS, settingsFrom, workDaysFrom } from '../hooks/settings'
import { dayLines, headline, metaOf, sectionsOf, standupFor, standupText } from '../hooks/standup'
import { empty, FOUND, FRIDAY } from './fixtures'

const WEEKDAYS = workDaysFrom('mon,tue,wed,thu,fri')

test('durations read as hours and minutes', async () => {
  expect([0, 5, 60, 125, 318].map(duration)).toEqual(['0m', '5m', '1h', '2h 5m', '5h 18m'])
})

test('dates move by whole days, across months', async () => {
  expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  expect(weekday('2026-10-12')).toBe(1)
  expect(dayLabel('2026-10-09')).toBe('Fri 9 Oct')
  expect(dayLabel('2026-10-09', true)).toBe('Friday 9 October 2026')
})

test('work days read as lists and ranges', async () => {
  expect([...workDaysFrom('mon-fri')].sort()).toEqual([1, 2, 3, 4, 5])
  expect([...workDaysFrom('sun, Saturday')].sort()).toEqual([0, 6])
  expect([...workDaysFrom('fri-mon')].sort()).toEqual([0, 1, 5, 6])
  expect(workDaysFrom('nonsense').size).toBe(0)
})

test("Monday's standup covers Friday and the weekend; Wednesday's, Tuesday", async () => {
  expect(standupDays('2026-10-12', WEEKDAYS)).toEqual(['2026-10-09', '2026-10-10', '2026-10-11'])
  expect(standupDays('2026-10-14', WEEKDAYS)).toEqual(['2026-10-13'])
})

test('settings out of range fall back to the defaults', async () => {
  const s = settingsFrom({ idleGapMin: 0, leadInMin: -3, dayStartsAt: '25:00', workDays: 'never', includeNonRepo: 'yes' })
  expect(s).toEqual(DEFAULTS)
  expect(settingsFrom({ dayStartsAt: ' 5:30 ', idleGapMin: 20 })).toEqual({ ...DEFAULTS, dayStartsAt: '5:30', idleGapMin: 20 })
})

test('a day reads as repos, then each branch: its headline and one line of counts', async () => {
  expect(dayLines(FRIDAY, 'Fri 9 Oct')).toEqual([
    'Fri 9 Oct · 5h 18m',
    '- qol-mods · 4h 16m',
    '  - #2 coach · 2h · A weekly coach',
    '    - 13:53–16:47 · 3 commits · 7 files · 12 test runs · Claude alone 14m',
    '  - main · 2h 10m · README previews',
    '    - 12:16–13:54',
    '  - Also: tidy 6m',
    '- api · 1h 2m',
    '  - master · 1h 2m · Rate limit the search endpoint',
    '    - 10:00–12:00',
  ])
  expect(dayLines(empty('2026-10-10'), 'Sat 10 Oct')).toEqual(['Sat 10 Oct · nothing in your logs'])
})

test('in full, each branch lists what was asked, its commits and where files changed, one to a line', async () => {
  const lines = dayLines(FRIDAY, 'Fri 9 Oct', true)
  expect(lines.slice(2, 15)).toEqual([
    '  - #2 coach · 2h · A weekly coach',
    '    - 13:53–16:47 · 3 commits · 7 files · 12 test runs · Claude alone 14m',
    '    - Asked:',
    '      - “coach report is not available in the desktop app”',
    '      - “make the report cards in the desktop app”',
    '    - Commits:',
    '      - coach 0.2.0: the report as cards',
    '      - coach 0.1.0: a weekly coach',
    '      - +1 more',
    '    - Changed:',
    '      - plugins/coach/hooks · 6 files',
    '      - top level · 1 file',
    '    - Sessions: Coach report pane · Marketplace source mismatch',
  ])
  // Nothing folds in full: the short branch has its own line.
  expect(lines).toContain('  - tidy · 6m')
})

test('the headline is the PR title, else the busiest session, else a commit, else the longest ask', async () => {
  const coach = FRIDAY.repos[0]!.groups[0]!
  expect(headline(coach)).toBe('A weekly coach')
  expect(headline({ ...coach, pr: null })).toBe('Coach report pane')
  expect(headline({ ...coach, pr: null, what: [] })).toBe('coach 0.2.0: the report as cards')
  expect(headline({ ...coach, pr: null, what: [], commits: [] })).toBe('“coach report is not available in the desktop app”')
  expect(headline({ ...coach, pr: null, what: [], commits: [], asks: [] })).toBeNull()
})

test("the pane's details say how the time was shared; the standup's leave it out", async () => {
  const coach = FRIDAY.repos[0]!.groups[0]!
  expect(sectionsOf(coach)[0]).toEqual({
    label: 'Time',
    items: [{ text: '2h 4m on this branch', note: ' · 2h counted, parallel sessions share the rest', isDim: true }],
  })
  expect(sectionsOf(coach, false).map(s => s.label)).toEqual(['Asked', 'Commits', 'Changed', 'Sessions'])
  expect(metaOf(FRIDAY.repos[1]!.groups[0]!)).toBe('10:00–12:00')
})

test("the standup skips the empty weekend and adds today so far", async () => {
  const text = standupText({ ...standupFor(FOUND, { kind: 'standup' }, WEEKDAYS), footer: null })
  expect(text.split('\n\n').map(b => b.split('\n')[0])).toEqual([
    'Standup since Fri 9 Oct',
    'Fri 9 Oct · 5h 18m',
    'Today so far (Mon 12 Oct) · 45m',
  ])
})

test('a standup with nothing to say says so', async () => {
  const found = { ...FOUND, days: FOUND.days.map(d => empty(d.date)) }
  expect(standupText({ ...standupFor(found, { kind: 'standup' }, WEEKDAYS), footer: null })).toBe(
    'Standup since Fri 9 Oct\n\nNothing in your logs since Fri 9 Oct.',
  )
})

test('one day asked for is that day alone', async () => {
  const one = (date: string) => standupText({ ...standupFor(FOUND, { kind: 'day', date }, WEEKDAYS), footer: null })
  expect(one('2026-10-09').split('\n')[0]).toBe('Fri 9 Oct · 5h 18m')
  expect(one('2026-10-12').split('\n')[0]).toBe('Today so far (Mon 12 Oct) · 45m')
  expect(one('2026-09-01')).toBe('Tue 1 Sep · nothing in your logs')
})

test('the timeline covers whole hours around the work, at least three', async () => {
  expect(rangeOf(FRIDAY, 240)).toEqual({ from: 300, to: 780, dayStart: 240 })
  expect(rangeOf(empty('2026-10-10'), 240)).toBeNull()
  expect(axisText({ from: 360, to: 780, dayStart: 240 }, 28)).toBe('10  11  12  13  14  15  16')
})

test('a timeline cell is solid when mostly worked, low when partly, pale when Claude was alone', async () => {
  const coach = FRIDAY.repos[0]!.groups[0]!
  // 13:00 to 17:00 in eight half-hours.
  const cells = cellsOf(coach, { from: 540, to: 780, dayStart: 240 }, 8)
  expect(cells).toEqual(['none', 'part', 'full', 'full', 'full', 'full', 'part', 'none'])
  expect(cellsOf(coach, { from: 725, to: 735, dayStart: 240 }, 1)).toEqual(['alone'])
})

test('a repo keeps its color from day to day, and the busiest wins a clash', async () => {
  const slots = slotsFor(FRIDAY.repos)
  expect(slots.get('/work/qol-mods')).toBe(slotsFor([FRIDAY.repos[0]!]).get('/work/qol-mods'))
  expect(new Set(slots.values()).size).toBe(2)
})
