/**
 * worklog: what you worked on, day by day, from your Claude Code sessions and git (SPEC.md).
 *
 * Everything that talks to the engine is here: the engine follows `$` only
 * into this file's own functions. The rest is plain: the dates (days.ts), the
 * words (standup.ts), the timesheet (timesheet.ts), the drawings (pane.tsx,
 * view.tsx) and scan.py's argv (settings.ts). worklog only ever shows:
 * nothing it makes leaves the machine unless the user copies or saves it.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, UiPressArgument } from 'claude-code'

import type { Day, ScanResult, Standup, Week } from '../types'
import { addDays, DATE, dayLabel } from './days'
import { drawPane, PANE, TITLE } from './pane'
import type { PaneActions } from './pane'
import { argvFor, expandHome, pathsFrom, settingsFrom, workDaysFrom } from './settings'
import type { Paths, Settings } from './settings'
import { dayLines, emptyDay, footerFor, standupFor, standupText, todayHeading, weekStandup } from './standup'
import type { Ask } from './standup'
import { sheetCsv, sheetMarkdown, sheetOf, weekDates, weekStartOf } from './timesheet'
import { drawStandup, lookFor } from './view'

const daysAtom = atom({ plugin: 'worklog', key: 'days' } as const, {})
const todayAtom = atom({ plugin: 'worklog', key: 'today' } as const, null)
const dateAtom = atom({ plugin: 'worklog', key: 'date' } as const, null)
const scanAtom = atom({ plugin: 'worklog', key: 'scan' } as const, { status: 'idle', error: null })
const standupsAtom = atom({ plugin: 'worklog', key: 'standups' } as const, {})
const openAtom = atom({ plugin: 'worklog', key: 'open' } as const, {})
const allOpenAtom = atom({ plugin: 'worklog', key: 'allOpen' } as const, false)
const tabAtom = atom({ plugin: 'worklog', key: 'tab' } as const, 'day')
const weekAtom = atom({ plugin: 'worklog', key: 'week' } as const, null)

/** The first scan reads every log written to in the window; later ones mostly hit the cache. */
const SCAN_TIMEOUT_MS = 5 * 60 * 1000
/** Days the standup scan reaches back: a week to find the last work day, and one spare. */
const STANDUP_BACK = 8
/** Days kept in $.state for the pane to move between without a scan. */
const DAYS_KEPT = 62
/** Replies kept in $.state for their rows to draw from; an older row draws as its text. */
const REPLIES_KEPT = 20

const HELP_STANDUP = [
  'worklog reads your Claude Code sessions and git on this machine and shows what you worked on. Nothing is sent anywhere.',
  '',
  '  /standup             since your last work day, and today so far',
  '  /standup today       today so far',
  '  /standup yesterday   yesterday',
  '  /standup 2026-10-07  that day',
  '  /standup full        with what you asked, committed and changed under each branch',
  '  /standup week        this week as a timesheet; /standup last week for the one before',
  '  /standup copy        any of these, put on your clipboard too',
  '',
  '/worklog opens a pane to move between days and weeks.',
].join('\n')

const HELP_WORKLOG = [
  'worklog reads your Claude Code sessions and git on this machine and shows what you worked on. Nothing is sent anywhere.',
  '',
  '  /worklog             today, in a pane',
  '  /worklog yesterday   yesterday',
  '  /worklog 2026-10-07  that day',
  '  /worklog week        this week as a timesheet, to copy or save as CSV; /worklog last week for the one before',
  '',
  '/standup puts it in words for your standup.',
].join('\n')

type Ctx = { settings: Settings; paths: Paths | null; root: string }

/** A day as /standup and /worklog take it: a date, or days from today ("-1"); null when it isn't one. */
function dayArg(word: string): string | null {
  const w = word.toLowerCase()
  if (w === 'today') return '0'
  if (w === 'yesterday') return '-1'
  return DATE.test(w) ? w : null
}

/** "week" or "last week" among a command's words: how many weeks back, or null for neither. */
function weekArg(words: string[]): number | null {
  const lower = words.map(w => w.toLowerCase())
  if (!lower.includes('week')) return null
  const other = lower.filter(w => !['week', 'last', 'copy'].includes(w))
  if (other.length) return null
  return lower.includes('last') ? 1 : 0
}

function failure(error: string): string {
  return /python3/.test(error) && /No such file|not found/i.test(error)
    ? 'worklog needs python3, and it was not found.'
    : 'Could not read your logs. Run claude --debug to see why.'
}

async function scan($: EngineInterface, ctx: Ctx, from: string, to: string): Promise<ScanResult | null> {
  if (!ctx.paths) return null
  await update($, scanAtom, () => ({ status: 'running', error: null }))
  try {
    const run = await $.process.run(argvFor(ctx.root, ctx.paths, ctx.settings, from, to), { timeoutMs: SCAN_TIMEOUT_MS })
    if (run.exitCode !== 0) throw new Error(run.stderr.slice(0, 300) || `exit ${run.exitCode}`)
    const found = JSON.parse(run.stdout) as ScanResult
    for (const warning of found.warnings) $.ui.log(`worklog: ${warning}`, { to: 'debug' })
    if (found.github === 'unavailable') $.ui.log('worklog: GitHub not read (no gh, signed out or offline)', { to: 'debug' })
    await update($, daysAtom, was => {
      const all: Record<string, Day> = { ...was }
      for (const day of found.days) all[day.date] = day
      return Object.fromEntries(Object.entries(all).sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, DAYS_KEPT))
    })
    await update($, todayAtom, () => found.today)
    await update($, scanAtom, () => ({ status: 'idle', error: null }))
    return found
  } catch (error) {
    const text = String(error)
    $.ui.log(`worklog: scan failed: ${text}`, { to: 'debug' })
    await update($, scanAtom, () => ({ status: 'failed', error: failure(text) }))
    return null
  }
}

/** Today by dayStartsAt, read with the last two weeks when no scan has said yet. */
async function todayOf($: EngineInterface, ctx: Ctx): Promise<string | null> {
  const known = await read($, todayAtom)
  if (known) return known
  return (await scan($, ctx, '-13', '0'))?.today ?? null
}

/** Shows `date` in the pane (null: today) and reads the week up to it. */
async function show($: EngineInterface, ctx: Ctx, date: string | null): Promise<ScanResult | null> {
  const today = await read($, todayAtom)
  await update($, tabAtom, () => 'day')
  await update($, dateAtom, () => (date === today ? null : date))
  return date === null || date === today ? scan($, ctx, '-6', '0') : scan($, ctx, addDays(date, -6), date)
}

/** The week from `start` as far as it has been read, up to today. */
function weekFrom(days: Record<string, Day>, start: string, today: string, roundTo: number): Week {
  const got = weekDates(start)
    .filter(d => d <= today)
    .map(d => days[d])
    .filter((d): d is Day => !!d)
  return { start, days: got, roundTo }
}

/** Reads the week from `start` (null: this week), as far as today; the week read, or null. */
async function readWeek($: EngineInterface, ctx: Ctx, start: string | null): Promise<Week | null> {
  const today = await todayOf($, ctx)
  if (!today) return null
  const first = start ?? weekStartOf(today, ctx.settings.weekStartsOn)
  const last = addDays(first, 6)
  if (!(await scan($, ctx, first, last < today ? last : today))) return null
  return weekFrom(await read($, daysAtom), first, today, ctx.settings.roundTo)
}

/** Shows the week from `start` (null: this week) in the pane, and reads it. */
async function showWeek($: EngineInterface, ctx: Ctx, start: string | null): Promise<Week | null> {
  await update($, tabAtom, () => 'week')
  const today = await todayOf($, ctx)
  const thisWeek = today ? weekStartOf(today, ctx.settings.weekStartsOn) : null
  await update($, weekAtom, () => (start === null || start === thisWeek ? null : start))
  return readWeek($, ctx, start)
}

/** Keeps `s` for the row that shows `text`, and answers with that text. */
async function reply($: EngineInterface, s: Standup): Promise<{ text: string }> {
  const text = standupText(s)
  await update($, standupsAtom, was => Object.fromEntries([...Object.entries(was).filter(([k]) => k !== text), [text, s]].slice(-REPLIES_KEPT)))
  return { text }
}

/** Answers `s`, after putting it on the clipboard when asked to. */
async function answer($: EngineInterface, s: Standup, wantsCopy: boolean): Promise<{ text: string }> {
  if (!wantsCopy) return reply($, s)
  const done = await $.ui.copy({ text: standupText({ ...s, footer: null }) })
  const lead = done.isCopied ? 'Copied to your clipboard:' : "Couldn't copy here, so here it is to select:"
  return reply($, { ...s, lead, footer: null })
}

function actionsFor($: EngineInterface, ctx: Ctx): PaneActions {
  const current = async () => (await read($, dateAtom)) ?? (await read($, todayAtom))
  /** The week the pane shows: its first day, and today. */
  const shownWeek = async () => {
    const today = await read($, todayAtom)
    if (!today) return null
    return { today, start: (await read($, weekAtom)) ?? weekStartOf(today, ctx.settings.weekStartsOn) }
  }
  const weekShown = async (): Promise<Week | null> => {
    const at = await shownWeek()
    return at ? weekFrom(await read($, daysAtom), at.start, at.today, ctx.settings.roundTo) : null
  }
  return {
    setTab: (tab: 'day' | 'week') =>
      void (async () => {
        if (tab === 'day') {
          await update($, tabAtom, () => 'day')
          const date = await current()
          if (date && !(await read($, daysAtom))[date]) await show($, ctx, (await read($, dateAtom)) ?? null)
          return
        }
        await showWeek($, ctx, await read($, weekAtom))
      })(),
    go: (n: number) =>
      void (async () => {
        const today = await read($, todayAtom)
        const from = await current()
        if (!from || !today) return
        const next = addDays(from, n)
        if (next > today) return
        const known = (await read($, daysAtom))[next]
        // Yesterday can still be growing after midnight, until dayStartsAt.
        if (known && next < addDays(today, -1)) await update($, dateAtom, () => next)
        else await show($, ctx, next)
      })(),
    toToday: () => void show($, ctx, null),
    copy: (press: UiPressArgument) =>
      void (async () => {
        const date = await current()
        if (!date) return
        const day = (await read($, daysAtom))[date] ?? emptyDay(date)
        const heading = date === (await read($, todayAtom)) ? todayHeading(date) : dayLabel(date)
        const full = await read($, allOpenAtom)
        const done = await $.ui.copy({ text: dayLines(day, heading, full).join('\n'), surface: press.surface })
        $.ui.toast(done.isCopied ? 'Copied the day.' : "Couldn't copy here. Select the text instead.")
      })(),
    refresh: () =>
      void (async () => {
        if ((await read($, tabAtom)) === 'week') {
          await readWeek($, ctx, await read($, weekAtom))
          return
        }
        const date = await current()
        await show($, ctx, date === (await read($, todayAtom)) ? null : date)
      })(),
    toggle: (key: string) =>
      void (async () => {
        const all = await read($, allOpenAtom)
        await update($, openAtom, was => ({ ...was, [key]: !(was[key] ?? all) }))
      })(),
    // Every branch follows the new setting: what was opened or closed by hand is forgotten.
    toggleAll: () =>
      void (async () => {
        await update($, allOpenAtom, was => !was)
        await update($, openAtom, () => ({}))
      })(),
    goWeek: (n: number) =>
      void (async () => {
        const at = await shownWeek()
        if (!at) return
        const start = addDays(at.start, 7 * n)
        if (start > at.today) return
        await showWeek($, ctx, start)
      })(),
    toThisWeek: () => void showWeek($, ctx, null),
    copyWeek: (press: UiPressArgument, as: 'table' | 'csv') =>
      void (async () => {
        const week = await weekShown()
        if (!week) return
        const sheet = sheetOf(week)
        const text = as === 'csv' ? sheetCsv(sheet, week.days) : sheetMarkdown(sheet)
        const done = await $.ui.copy({ text, surface: press.surface })
        $.ui.toast(done.isCopied ? (as === 'csv' ? 'Copied the week as CSV.' : 'Copied the week as a table.') : "Couldn't copy here.")
      })(),
    saveCsv: () =>
      void (async () => {
        const week = await weekShown()
        const home = ctx.paths?.home ?? ''
        if (!week || !home) return
        const folder = expandHome(ctx.settings.csvFolder, home).replace(/\/+$/, '')
        const path = `${folder}/week-of-${week.start}.csv`
        try {
          await $.fs.write(path, sheetCsv(sheetOf(week), week.days))
          $.ui.toast(`Saved ${path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path}`)
        } catch (error) {
          $.ui.log(`worklog: save failed: ${String(error)}`, { to: 'debug' })
          $.ui.toast(`Couldn't save to ${ctx.settings.csvFolder}.`)
        }
      })(),
  }
}

export const register: Register = (on, options) => {
  const ctx: Ctx = { settings: settingsFrom(options), paths: null, root: '' }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    ctx.root = $.plugin.root
    ctx.paths = pathsFrom(
      await $.env.get('HOME'),
      await $.env.get('CLAUDE_CONFIG_DIR'),
      await $.env.get('XDG_CACHE_HOME'),
      await $.env.get('XDG_DATA_HOME'),
    )
    await $.command.register({
      name: 'standup',
      description: 'What you worked on since your last work day, or this week, by repo, PR and branch, with time spent',
      argumentHint: '[today|yesterday|YYYY-MM-DD|week|last week] [full] [copy]',
    })
    await $.command.register({
      name: 'worklog',
      description: "Your work day by day in a pane, or a week's timesheet: repos, PRs and branches, with time spent",
      argumentHint: '[today|yesterday|YYYY-MM-DD|week|last week]',
    })
    return started
  })

  on('command.run', { command: 'standup' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(Boolean)
    const wantsCopy = words.some(w => w.toLowerCase() === 'copy')
    const back = weekArg(words)
    if (back !== null) {
      const today = await todayOf($, ctx)
      const start = today ? addDays(weekStartOf(today, ctx.settings.weekStartsOn), -7 * back) : null
      const week = start ? await readWeek($, ctx, start) : null
      if (!week) return { text: (await read($, scanAtom)).error ?? failure('') }
      return answer($, weekStandup(week), wantsCopy)
    }
    const flag = (w: string) => ['copy', 'full'].includes(w.toLowerCase())
    const full = words.some(w => w.toLowerCase() === 'full')
    const rest = words.filter(w => !flag(w))
    const day = rest.length === 1 ? dayArg(rest[0] ?? '') : null
    if (rest.length > 1 || (rest.length === 1 && day === null)) return { text: HELP_STANDUP }

    const found = day === null ? await scan($, ctx, `-${STANDUP_BACK}`, '0') : await scan($, ctx, day, day)
    if (!found) return { text: (await read($, scanAtom)).error ?? failure('') }
    const date = day === null ? null : DATE.test(day) ? day : addDays(found.today, Number(day))
    const ask: Ask = date === null ? { kind: 'standup' } : { kind: 'day', date }
    return answer($, standupFor(found, ask, workDaysFrom(ctx.settings.workDays), full), wantsCopy)
  })

  on('command.run', { command: 'worklog' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(Boolean)
    const back = weekArg(words)
    const day = back !== null ? null : words.length === 1 ? dayArg(words[0] ?? '') : words.length === 0 ? '0' : null
    if (back === null && day === null) return { text: HELP_WORKLOG }

    const opened = await $.ui.open({ id: PANE, title: TITLE })
    // Where nothing draws (a bare `claude -p`) or no surface places panes, the answer comes as text.
    const isDrawn = opened.isPlaced && (await $.session.surfaces()).length > 0

    if (back !== null) {
      const today = await todayOf($, ctx)
      const start = today ? addDays(weekStartOf(today, ctx.settings.weekStartsOn), -7 * back) : null
      const week = start ? await showWeek($, ctx, start) : null
      if (isDrawn) return { text: 'Opened your timesheet.' }
      if (!week) return { text: (await read($, scanAtom)).error ?? failure('') }
      return reply($, weekStandup(week))
    }

    const today = await read($, todayAtom)
    const date = day !== null && DATE.test(day) ? day : today ? addDays(today, Number(day)) : null
    let found: ScanResult | null
    if (date !== null || day === '0') {
      found = await show($, ctx, date)
    } else {
      // Today isn't known before the first scan: read, then point at the day.
      await update($, tabAtom, () => 'day')
      found = await scan($, ctx, String(Number(day) - 6), day ?? '0')
      const shownDate = found ? addDays(found.today, Number(day)) : null
      if (shownDate) await update($, dateAtom, () => shownDate)
    }
    if (isDrawn) return { text: 'Opened your worklog.' }
    if (!found) return { text: (await read($, scanAtom)).error ?? failure('') }
    const shown = (await read($, dateAtom)) ?? found.today
    const isToday = shown === found.today
    const heading = isToday ? todayHeading(shown) : dayLabel(shown)
    const byDate = found.days.find(d => d.date === shown) ?? emptyDay(shown)
    return reply($, {
      title: null,
      blocks: [{ heading, isToday, day: byDate }],
      note: null,
      lead: null,
      footer: footerFor(false),
      full: false,
      openPrs: [],
      week: null,
    })
  })

  // /standup's reply, and /worklog's where no pane is drawn: drawn from the
  // data it was made of. A row from before a /clear or a resume draws as text.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.props.command !== 'standup' && e.props.command !== 'worklog') return next(e)
    const kept = await read($, standupsAtom)
    // The row's text leads with the plugin's name: "worklog: Standup since …".
    const s = kept[e.props.text] ?? kept[e.props.text.replace(/^worklog: /, '')]
    if (!s) return next(e)
    const columns = e.viewport?.columns ?? 100
    // A week's table needs its seven columns; a day's lines read best narrower.
    const width = s.week ? Math.min(columns - 4, 100) : Math.min(columns - 4, 80)
    return drawStandup(lookFor($.ui.resolve(e), e.surface, width, ctx.settings.dayStartsAt), s)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const tab = await read($, tabAtom)
    const date = await read($, dateAtom)
    const today = await read($, todayAtom)
    const days = await read($, daysAtom)
    const scanState = await read($, scanAtom)
    const open = await read($, openAtom)
    const allOpen = await read($, allOpenAtom)
    const weekStart = await read($, weekAtom)
    const shown = date ?? today
    const start = weekStart ?? (today ? weekStartOf(today, ctx.settings.weekStartsOn) : null)
    return drawPane(
      $.ui.resolve(e),
      e.surface,
      e.props.bodyColumns,
      {
        tab,
        date,
        today,
        day: shown ? days[shown] : undefined,
        week: start && today ? weekFrom(days, start, today, ctx.settings.roundTo) : null,
        isThisWeek: weekStart === null,
        scan: scanState,
        dayStartsAt: ctx.settings.dayStartsAt,
        idleGapMin: ctx.settings.idleGapMin,
        maxUnattendedMin: ctx.settings.maxUnattendedMin,
        parallelSplit: ctx.settings.parallelSplit,
        open,
        allOpen,
      },
      actionsFor($, ctx),
    )
  })
}
