/**
 * coach: a weekly coach for how you use Claude Code (SPEC.md).
 *
 * Everything that talks to the engine is here: the engine follows `$` only
 * into this file's own functions. The rest is plain: what to show
 * (select.ts), the words (copy.ts), the drawings (pane.tsx, bar.tsx), live
 * hints (hints.ts), grading (grading.ts) and scan.py's argv (scanner.ts).
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, UiPressArgument } from 'claude-code'

import type { Choices, Evidence, Grading, GradingInput, HabitId, Report, ScanState, View, WeekRow } from '../types'
import { drawBar } from './bar'
import * as C from './copy'
import * as G from './grading'
import * as H from './hints'
import { drawPane, PANE } from './pane'
import type { PaneActions } from './pane'
import { argvFor, lineReader, pathsFrom, reasonOf, settingsFrom } from './scanner'
import type { Paths, ScanExtra, Settings } from './scanner'
import * as Sel from './select'
import { capped, choicesFrom, STORE_KEYS } from './state'
import { summaryText, toolResult } from './summary'

// The values drawings read: written here, read while drawing, so a change redraws them.
const reportAtom = atom({ plugin: 'coach', key: 'report' } as const, null)
const scanAtom = atom({ plugin: 'coach', key: 'scan' } as const, { status: 'idle' })
const viewAtom = atom({ plugin: 'coach', key: 'view' } as const, { page: 'report', week: null, detail: null })
const choicesAtom = atom({ plugin: 'coach', key: 'choices' } as const, Sel.EMPTY_CHOICES)
const nudgeAtom = atom({ plugin: 'coach', key: 'nudge' } as const, null)
const tickAtom = atom({ plugin: 'coach', key: 'tick' } as const, 0)
const winsAtom = atom({ plugin: 'coach', key: 'wins' } as const, [])

const RESCAN_MS = 10 * 60 * 1000
const TICK_MS = 60 * 1000
const STALE_MS = 2 * 60 * 1000
const TOOL = 'mcp__coach__report'
const TOOL_DESCRIPTION =
  "The person's coach report: their weekly Claude Code usage, the habit they're working on, tips, CLAUDE.md lines and skills coach suggests, and the evidence behind each. Use it to answer questions about their usage, costs and habits."

type ScanResult = { report: Report | null; grading: GradingInput | null; error: string | null }

// -- choices: $.store for keeps, $.state for drawing

async function loadChoices($: EngineInterface): Promise<Choices> {
  const stored: Partial<Record<keyof Choices, unknown>> = {}
  for (const key of STORE_KEYS) {
    try {
      stored[key] = await $.store.get(key)
    } catch {
      // A store that can't be read leaves the default.
    }
  }
  const choices = choicesFrom(stored)
  await update($, choicesAtom, () => choices)
  return choices
}

/** Applies `fn` to the choices, redraws what shows them, stores what changed. */
async function changeChoices($: EngineInterface, fn: (c: Choices) => Choices): Promise<Choices> {
  let before: Choices = Sel.EMPTY_CHOICES
  let after: Choices = Sel.EMPTY_CHOICES
  await update($, choicesAtom, current => {
    before = current
    after = fn(current)
    return after
  })
  for (const key of STORE_KEYS) {
    if (before[key] === after[key]) continue
    try {
      await $.store.set(key, capped(key, after[key]))
    } catch (error) {
      $.ui.log(`coach: could not save ${key}: ${String(error)}`, { to: 'debug' })
    }
  }
  return after
}

// -- scanning

/** Runs scan.py once, reading its progress and report as they come. */
async function runScan($: EngineInterface, argv: string[]): Promise<ScanResult> {
  const at = await $.clock.now()
  await update($, scanAtom, (s): ScanState => ({ ...s, status: 'scanning', at }))
  let report: Report | null = null
  let grading: GradingInput | null = null
  let stderr = ''
  const reader = lineReader()
  const take = async (messages: ReturnType<typeof reader.push>) => {
    for (const msg of messages) {
      if (msg.progress) {
        const progress = msg.progress
        await update($, scanAtom, (s): ScanState => ({ ...s, status: 'scanning', progress }))
      }
      if (msg.grading) grading = msg.grading
      if (msg.report) report = msg.report
    }
  }
  try {
    const stream = $.process.spawn({ argv })
    for await (const chunk of stream) {
      if (chunk.stream === 'stderr') stderr = (stderr + chunk.text).slice(-4000)
      else await take(reader.push(chunk.text))
    }
    await take(reader.end())
    const ended = await stream.result
    if (ended.code !== 0 && !report) throw new Error(stderr || `scan.py exited ${ended.code ?? ended.signal}`)
  } catch (error) {
    const text = String(error)
    $.ui.log(`coach: scan failed: ${text.slice(0, 300)}`, { to: 'debug' })
    const reason = reasonOf(`${text} ${stderr}`)
    await update($, scanAtom, (s): ScanState => ({ ...s, status: 'failed', error: reason, at }))
    return { report: null, grading: null, error: reason }
  }
  const got: Report | null = report
  if (got) await update($, reportAtom, () => got)
  await update($, scanAtom, (): ScanState => ({ status: 'idle', at }))
  return { report: got, grading, error: null }
}

// -- grading (opt-in)

async function gradeWeek($: EngineInterface, input: GradingInput, settings: Settings): Promise<Grading | null> {
  if (!input.prompts.length) return null
  if (G.estimate(input, settings.gradingModel) > settings.gradingCapUsd) {
    $.ui.log(`coach: grading skipped, the estimate is over ${settings.gradingCapUsd} USD`, { to: 'debug' })
    return null
  }
  let spent = 0
  const scores: G.Score[] = []
  for (const prompt of G.batches(input)) {
    const r = await $.model.complete({
      model: settings.gradingModel,
      system: [{ text: G.RUBRIC, cache: true }],
      prompt,
      maxTokens: 1500,
      effort: 'low',
      timeoutMs: 60_000,
    })
    spent += G.cost(settings.gradingModel, r.usage)
    if (r.isAnswered) scores.push(...G.parseScores(r.text))
    else if (r.reason === 'aborted') break
  }
  let rewritten: { source: GradingInput['prompts'][number]; text: string } | null = null
  const source = G.rewriteSource(scores, input)
  if (source) {
    const r = await $.model.complete({
      model: settings.gradingModel,
      system: G.REWRITE,
      prompt: G.rewritePrompt(source),
      maxTokens: 400,
      effort: 'low',
      timeoutMs: 60_000,
    })
    spent += G.cost(settings.gradingModel, r.usage)
    if (r.isAnswered) rewritten = { source, text: r.text }
  }
  return G.summarize(input, settings.gradingModel, scores, rewritten, spent)
}

// -- the pane's buttons

function actionsFor($: EngineInterface, now: number, rescan: () => void): PaneActions {
  return {
    setView: (next: Partial<View>) => void update($, viewAtom, v => ({ ...v, ...next })),
    copy: (text: string, press: UiPressArgument) =>
      void (async () => {
        const done = await $.ui.copy({ text, surface: press.surface })
        $.ui.toast(done.isCopied ? 'Copied.' : "Couldn't copy here. Select the text above instead.")
      })(),
    flag: (ids: string[], evidence: Record<string, Evidence>) =>
      void changeChoices($, c => ({
        ...c,
        notRight: [
          ...c.notRight,
          ...ids.map(id => ({ detector: evidence[id]?.detector ?? id.split(':')[0] ?? id, evidenceId: id, at: now })),
        ],
      })),
    dismiss: (id: string) =>
      void changeChoices($, c => ({
        ...c,
        tips: { ...c.tips, [id]: { ...(c.tips[id] ?? { shownWeeks: [] }), dismissedAt: now } },
      })),
    fill: (text: string, toast: string) =>
      void (async () => {
        let mode: 'replace' | 'append' = 'replace'
        try {
          const box = await $.prompt.read()
          if (box.text.trim()) mode = 'append'
        } catch {
          // Nothing to read: replace.
        }
        await $.prompt.fill({ text: mode === 'append' ? `\n\n${text}` : text, mode })
        $.ui.toast(toast)
      })(),
    pickAnother: (habit: HabitId, row: WeekRow) =>
      void changeChoices($, c => {
        const next = Sel.nextHabit(row, habit, c)
        return {
          ...c,
          habitLog: [
            ...c.habitLog.filter(l => !(l.week === row.week && (l.habit === habit || l.status === 'active'))),
            { week: row.week, habit, status: 'skipped' as const },
            ...(next ? [{ week: row.week, habit: next, status: 'active' as const }] : []),
          ],
        }
      }),
    rescan,
  }
}

/**
 * Opening the report marks its week as seen: the habit of the week is logged,
 * the tips shown are counted (so ones nothing is done about can rest), and
 * CLAUDE.md lines taken up since last time are noticed.
 */
async function markSeen($: EngineInterface, report: Report) {
  const now = await $.clock.now()
  const row = Sel.shownRow(report, null)
  if (!row) return
  const value = await read($, choicesAtom)
  const current = value ?? Sel.EMPTY_CHOICES
  const suggestedBefore = new Set(
    Object.entries(current.tips)
      .filter(([, t]) => t.shownWeeks.length > 0)
      .map(([id]) => id),
  )
  let next: Choices = { ...current, tips: { ...current.tips } }
  if (!next.firstReportWeek) next.firstReportWeek = row.week === 'recent' ? (report.current?.week ?? row.week) : row.week
  next.lastSeenWeek = row.week
  const choice = Sel.chooseHabit(report, row, next, now)
  let log = next.habitLog
  if (choice.learned && !log.some(l => l.week === row.week && l.habit === choice.learned && l.status === 'learned')) {
    log = [...log, { week: row.week, habit: choice.learned, status: 'learned' }]
  }
  if (choice.habit && !log.some(l => l.week === row.week && l.habit === choice.habit && l.status === 'active')) {
    log = [
      ...log.filter(l => !(l.week === row.week && l.status === 'active')),
      { week: row.week, habit: choice.habit, status: 'active' },
    ]
  }
  next.habitLog = log
  const tips = Sel.chooseTips(report, row, next, choice.habit, now)
  const before = report.history.filter(w => w.start < row.start).map(w => w.week)
  next = Sel.recordShown(next, tips, row.week, before, now)
  for (const card of Sel.claudeMdCards(report, next, now)) {
    for (const line of card.lines) {
      const mine = next.tips[line.id] ?? { shownWeeks: [] }
      if (!mine.shownWeeks.includes(row.week)) {
        next.tips[line.id] = { ...mine, shownWeeks: [...mine.shownWeeks, row.week].slice(-8) }
      }
    }
  }
  const [withWins, wins] = Sel.wins(report, next, suggestedBefore, now)
  await changeChoices($, () => withWins)
  if (wins.length) await update($, winsAtom, () => wins)
}

/** What the hooks share for the life of the module: settings, paths, the scan underway. */
type Ctx = {
  settings: Settings
  paths: Paths | null
  root: string
  timers: Timer[]
  running: Promise<ScanResult> | null
  memory: H.SessionMemory
  gradingTried: Set<string>
}

async function hintsOn($: EngineInterface, ctx: Ctx): Promise<boolean> {
  const value = await read($, choicesAtom)
  return value?.hints.enabled ?? ctx.settings.liveHints
}

/** One scan at a time in this session; a full or grading scan runs on its own. */
function scan($: EngineInterface, ctx: Ctx, extra: ScanExtra = {}): Promise<ScanResult | null> {
  if (!ctx.paths) return Promise.resolve(null)
  if (ctx.running && !extra.full && !extra.gradeWeek) return ctx.running
  const job = runScan($, argvFor(ctx.root, ctx.paths, ctx.settings, extra)).then(async got => {
    if (got.report && !extra.gradeWeek) await afterScan($, ctx, got.report)
    return got
  })
  if (!extra.full && !extra.gradeWeek) {
    ctx.running = job
    void job.finally(() => {
      if (ctx.running === job) ctx.running = null
    })
  }
  return job
}

async function afterScan($: EngineInterface, ctx: Ctx, report: Report) {
  const choices = await read($, choicesAtom)
  if (choices && choices.firstReportWeek === null && (report.previous || report.recent)) {
    const told = await $.store.get('firstToast').catch(() => true)
    if (!told) {
      const since = report.coverage.logsSince ?? report.generatedAt
      const days = Math.max(1, Math.round((report.generatedAt - since) / (24 * 3600 * 1000)))
      $.ui.toast(`${C.BAR.first(days)}. Type /coach.`, { timeoutMs: 10_000 })
      await $.store.set('firstToast', true).catch(() => undefined)
    }
  }
  if (ctx.settings.promptGrading) void maybeGrade($, ctx, report)
}

/** Grades last week's sample once, when grading is on and it isn't graded yet. */
async function maybeGrade($: EngineInterface, ctx: Ctx, report: Report) {
  const week = report.previous?.week
  if (!week || ctx.gradingTried.has(week)) return
  const choices = await read($, choicesAtom)
  if (choices?.grading[week]) return
  ctx.gradingTried.add(week)
  const got = await scan($, ctx, { gradeWeek: week })
  if (!got?.grading?.prompts.length) return
  const result = await gradeWeek($, got.grading, ctx.settings)
  if (result) await changeChoices($, c => ({ ...c, grading: { ...c.grading, [week]: result } }))
}

async function showHint($: EngineInterface, ctx: Ctx, hint: H.Hint | null) {
  if (!hint) return
  const now = await $.clock.now()
  const choices = await read($, choicesAtom)
  if (!H.allowed(choices ?? Sel.EMPTY_CHOICES, hint.kind, now, await hintsOn($, ctx))) return
  if (hint.kind === 'topic-switch') await update($, nudgeAtom, () => ({ kind: hint.kind, text: hint.text, at: now }))
  else $.ui.toast(hint.text, { timeoutMs: 8000 })
  await changeChoices($, c => H.markShown(c, hint.kind, now))
}

/** The hint a submitted prompt calls for, worked out after it has gone on. */
async function promptHint($: EngineInterface, ctx: Ctx, text: string) {
  const now = await $.clock.now()
  await update($, nudgeAtom, () => null)
  let tokens = 0
  try {
    tokens = (await $.session.usage()).context.tokens ?? 0
  } catch {
    tokens = 0
  }
  const report = await read($, reportAtom)
  const hint = H.hintFor(text, report ?? null, ctx.memory, tokens, ctx.settings.contextThresholdK, now)
  H.remember(ctx.memory, text, now)
  await showHint($, ctx, hint)
}

/** Turns a kind of live hint off, from the nudge's own button. */
async function nudgeOff($: EngineInterface, kind: string) {
  await changeChoices($, c => ({ ...c, hints: { ...c.hints, off: [...new Set([...c.hints.off, kind])] } }))
  await update($, nudgeAtom, () => null)
}

export const register: Register = (on, options) => {
  const ctx: Ctx = {
    settings: settingsFrom(options),
    paths: null,
    root: '',
    timers: [],
    running: null,
    memory: { prompts: [], lastAt: null },
    gradingTried: new Set(),
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    ctx.paths = pathsFrom(await $.env.get('HOME'), await $.env.get('CLAUDE_CONFIG_DIR'))
    ctx.root = $.plugin.root
    await loadChoices($)
    await $.command.register({
      name: 'coach',
      description: 'Your weekly coach: open the report, tips, CLAUDE.md and skill suggestions',
      argumentHint: '[tips|claude-md|skills|bar|hints|rescan|help]',
    })
    try {
      await $.tool.register({
        name: 'report',
        description: TOOL_DESCRIPTION,
        inputSchema: {
          type: 'object',
          properties: {
            week: { type: 'string', description: "'current', 'previous', or a week's start date as YYYY-MM-DD" },
            part: { type: 'string', enum: ['summary', 'habits', 'tips', 'claude-md', 'skills', 'cost', 'all'] },
          },
        },
        isDeferred: true,
      })
    } catch (error) {
      $.ui.log(`coach: tool not registered: ${String(error)}`, { to: 'debug' })
    }
    void (async () => {
      const got = await scan($, ctx)
      if (got?.report) await showHint($, ctx, H.resumeHint(got.report, await $.session.id(), await $.clock.now()))
    })()
    for (const timer of ctx.timers) timer.cancel()
    ctx.timers = [
      $.clock.every(RESCAN_MS, () => void scan($, ctx)),
      $.clock.every(TICK_MS, () => void update($, tickAtom, n => n + 1)),
    ]
    return started
  })

  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear') {
      ctx.memory.prompts = []
      ctx.memory.lastAt = null
      await update($, nudgeAtom, () => null)
      void scan($, ctx)
    }
    return ended
  })

  on('command.run', { command: 'coach' }, async ($, e) => {
    const arg = (e.args.trim().split(/\s+/)[0] ?? '').toLowerCase()
    if (arg === 'help' || !['', 'report', 'tips', 'claude-md', 'skills', 'bar', 'hints', 'rescan'].includes(arg)) {
      return { text: C.COMMAND.help }
    }
    if (arg === 'bar') {
      const after = await changeChoices($, c => ({ ...c, barHidden: !c.barHidden }))
      return { text: after.barHidden ? C.COMMAND.barHidden : C.COMMAND.barShown }
    }
    if (arg === 'hints') {
      const enable = !(await hintsOn($, ctx))
      await changeChoices($, c => ({ ...c, hints: { ...c.hints, enabled: enable } }))
      return { text: enable ? C.COMMAND.hintsOn : C.COMMAND.hintsOff }
    }
    if (arg === 'rescan') {
      void scan($, ctx, { full: true })
      return { text: C.COMMAND.rescan }
    }
    const page: View['page'] = arg === 'tips' || arg === 'claude-md' || arg === 'skills' ? arg : 'report'
    const report = await read($, reportAtom)
    const scanState = await read($, scanAtom)
    const now = await $.clock.now()
    if (!report || (scanState?.at !== undefined && now - scanState.at > STALE_MS)) void scan($, ctx)
    await update($, viewAtom, v => ({ ...v, page, detail: null, week: page === 'report' ? null : v.week }))
    if (report && page === 'report') await markSeen($, report)
    const opened = await $.ui.open({ id: PANE, title: 'Coach' })
    if (!opened.isPlaced && !/width|columns|narrow|wide/i.test(opened.reason)) {
      const choices = await read($, choicesAtom)
      return { text: summaryText(report ?? null, choices ?? Sel.EMPTY_CHOICES, now) }
    }
    const replies = { report: C.COMMAND.opened, tips: C.COMMAND.tips, 'claude-md': C.COMMAND.claudeMd, skills: C.COMMAND.skills }
    return { text: replies[page] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const report = await read($, reportAtom)
    const scanState = await read($, scanAtom)
    const view = await read($, viewAtom)
    const choices = await read($, choicesAtom)
    const wins = await read($, winsAtom)
    const now = await $.clock.now()
    const pane = { report, scan: scanState, view, choices, wins, now, grading: ctx.settings.promptGrading }
    return drawPane($.ui.resolve(e), e.surface, e.props.bodyColumns, pane, actionsFor($, now, () => void scan($, ctx, { full: true })))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const beneath = await next(e)
    if (e.props.hasSurvey) return beneath
    const report = await read($, reportAtom)
    const choices = await read($, choicesAtom)
    const nudge = await read($, nudgeAtom)
    await read($, tickAtom)
    const state = Sel.barState(report, choices, nudge, await $.clock.now())
    if (state.kind === 'hidden') return beneath
    // Other mods draw here too: keep a plugin's band beneath, stacked under
    // this line. The engine's own drawing is left out, as a band always has.
    const below = beneath.type === 'engine' ? null : beneath
    if (below && e.props.maxRows < 2) return beneath
    const kind = nudge?.kind ?? null
    const onNudgeOff = kind ? () => void nudgeOff($, kind) : null
    const els = $.ui.resolve(e)
    const line = drawBar(els, e.surface, e.props.bodyColumns, state, onNudgeOff)
    if (!line) return beneath
    const { Box } = els
    return (
      <Box flexDirection="column" width="100%">
        {line}
        {below}
      </Box>
    )
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const report = await read($, reportAtom)
    const args = e as unknown as Record<string, unknown>
    const week = typeof args.week === 'string' ? args.week : 'previous'
    const part = typeof args.part === 'string' ? args.part : 'summary'
    return { result: toolResult(report ?? null, week, part) }
  }).catch(() => ({ result: { error: 'The coach report could not be read just now.' } }))

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    if (!('drop' in result && result.drop) && e.origin.kind === 'composer') {
      void promptHint($, ctx, e.text).catch(error => $.ui.log(`coach: hint skipped: ${String(error)}`, { to: 'debug' }))
    }
    return result
  }).catch(($, e, next) => next(e)) // a hint is never worth holding up a prompt
}
