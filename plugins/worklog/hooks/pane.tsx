/**
 * The worklog pane (SPEC.md §4.2), two views. Day: buttons to move between
 * days, show details and copy, then the day as view.tsx draws it, with its
 * timeline; each branch shows its headline and counts, its details open on
 * a press of its name, or every branch's with Show details. Week: the
 * timesheet, a row per branch and a column per day, with buttons to move
 * between weeks, copy it as a table or CSV, and save the CSV. Drawn from
 * plain data; the buttons are the hooks module's.
 */
import type { ElementTable, RenderElement, RenderSurface, UiPressArgument } from 'claude-code'

import type { Day, ScanState, Week } from '../types'
import { dayLabel } from './days'
import { hasWork } from './standup'
import { footnote, lookFor, repoList, reviewList, summary, weekView } from './view'

export const PANE = 'worklog'
export const TITLE = 'Worklog'

export type PaneContext = {
  tab: 'day' | 'week'
  /** The day shown; null for today. */
  date: string | null
  today: string | null
  day: Day | undefined
  /** The week shown, as far as it has been read; null before today is known. */
  week: Week | null
  /** Whether the week shown is this one. */
  isThisWeek: boolean
  scan: ScanState
  dayStartsAt: string
  idleGapMin: number
  maxUnattendedMin: number
  /** Branches opened or closed by hand, by groupKey; the rest follow allOpen. */
  open: Record<string, boolean>
  allOpen: boolean
}

export type PaneActions = {
  setTab: (tab: 'day' | 'week') => void
  go: (days: number) => void
  toToday: () => void
  copy: (press: UiPressArgument) => void
  refresh: () => void
  /** Opens or closes one branch's details. */
  toggle: (key: string) => void
  /** Shows or hides every branch's details. */
  toggleAll: () => void
  goWeek: (weeks: number) => void
  toThisWeek: () => void
  copyWeek: (press: UiPressArgument, as: 'table' | 'csv') => void
  saveCsv: () => void
}

export function drawPane(
  els: ElementTable,
  surface: RenderSurface,
  bodyColumns: number,
  ctx: PaneContext,
  actions: PaneActions,
): RenderElement {
  const { Box, Text, Button } = els
  const look = lookFor(els, surface, bodyColumns - 2, ctx.dayStartsAt)
  const { scan } = ctx
  const status =
    scan.status === 'running' ? (
      <Text dimColor>Reading your logs…</Text>
    ) : scan.status === 'failed' ? (
      <Text color="warning">{scan.error ?? 'Could not read your logs.'}</Text>
    ) : null
  const tabs = (
    <Box flexDirection="row" columnGap={2}>
      <Button key="tab-day" label="Day" hotkey="1" {...(ctx.tab === 'day' ? { variant: 'primary' as const } : {})} onPress={() => actions.setTab('day')} />
      <Button key="tab-week" label="Week" hotkey="2" {...(ctx.tab === 'week' ? { variant: 'primary' as const } : {})} onPress={() => actions.setTab('week')} />
    </Box>
  )
  const page = (...children: (RenderElement | null)[]) => (
    <Box flexDirection="column" paddingX={1} rowGap={1}>
      {tabs}
      {children}
      {footnote(look, ctx.idleGapMin, ctx.maxUnattendedMin)}
    </Box>
  )

  if (ctx.tab === 'week') {
    const week = ctx.week
    const filled = !!week && week.days.some(hasWork)
    const buttons = (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Button key="prev-week" label="← Week before" hotkey="p" onPress={() => actions.goWeek(-1)} />
        {ctx.isThisWeek ? null : <Button key="next-week" label="Week after →" hotkey="n" onPress={() => actions.goWeek(1)} />}
        {ctx.isThisWeek ? null : <Button key="this-week" label="This week" hotkey="t" onPress={() => actions.toThisWeek()} />}
        {filled ? <Button key="copy-week" label="Copy" hotkey="c" onPress={press => actions.copyWeek(press, 'table')} /> : null}
        {filled ? <Button key="copy-csv" label="Copy CSV" hotkey="v" onPress={press => actions.copyWeek(press, 'csv')} /> : null}
        {filled ? <Button key="save-csv" label="Save CSV" hotkey="s" onPress={() => actions.saveCsv()} /> : null}
        <Button key="refresh" label="Refresh" hotkey="r" onPress={() => actions.refresh()} />
      </Box>
    )
    return page(buttons, status, week ? weekView(look, week) : status ? null : <Text dimColor>Reading your logs…</Text>)
  }

  const date = ctx.date ?? ctx.today
  const isToday = date !== null && date === ctx.today
  if (date === null) return page(status ?? <Text dimColor>Reading your logs…</Text>)
  const { day } = ctx

  const buttons = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Button key="prev" label="← Day before" hotkey="p" onPress={() => actions.go(-1)} />
      {isToday ? null : <Button key="next" label="Day after →" hotkey="n" onPress={() => actions.go(1)} />}
      {isToday ? null : <Button key="today" label="Today" hotkey="t" onPress={() => actions.toToday()} />}
      {hasWork(day) ? (
        <Button key="details" label={ctx.allOpen ? 'Hide details' : 'Show details'} hotkey="d" onPress={() => actions.toggleAll()} />
      ) : null}
      {hasWork(day) ? <Button key="copy" label="Copy" hotkey="c" onPress={press => actions.copy(press)} /> : null}
      <Button key="refresh" label="Refresh" hotkey="r" onPress={() => actions.refresh()} />
    </Box>
  )

  const heading = isToday ? `Today, ${dayLabel(date, true)}` : dayLabel(date, true)
  let body: RenderElement
  if (!day) {
    body = <Box flexDirection="column">{[<Text bold>{heading}</Text>, status ? null : <Text dimColor>Nothing read for this day yet. Press Refresh.</Text>]}</Box>
  } else if (!hasWork(day)) {
    body = (
      <Box flexDirection="column">
        {summary(look, day, heading, isToday)}
        <Text dimColor>Claude Code keeps logs for 30 days unless you've changed it; older days come from worklog's archive.</Text>
      </Box>
    )
  } else {
    body = (
      <Box flexDirection="column">
        {summary(look, day, heading, isToday)}
        {repoList(look, day, {
          timeline: true,
          detail: 'toggle',
          withTime: true,
          foldMinor: false,
          isOpen: key => ctx.open[key] ?? ctx.allOpen,
          onToggle: key => actions.toggle(key),
        })}
        {reviewList(look, day)}
      </Box>
    )
  }
  return page(buttons, status, body)
}
