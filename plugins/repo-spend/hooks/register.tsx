import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, RenderNode, Timer } from 'claude-code'

import type { History, Sample } from '../types'

const history = atom({ plugin: 'repo-spend', key: 'history' } as const, null)
const samples = atom({ plugin: 'repo-spend', key: 'samples' } as const, [])
const isHidden = atom({ plugin: 'repo-spend', key: 'isHidden' } as const, false)
const scanError = atom({ plugin: 'repo-spend', key: 'scanError' } as const, null)
const tick = atom({ plugin: 'repo-spend', key: 'tick' } as const, 0)

/** How often past sessions are re-read, and how often the band redraws as time passes. */
const RESCAN_MS = 2 * 60 * 1000
const TICK_MS = 60 * 1000

/** The burn rate and the sparkline both cover this window, the sparkline in SPARK_BARS bars. */
const RATE_WINDOW_MS = 30 * 60 * 1000
const SPARK_BARS = 10

/** $/hour at which the burn turns from calm (green) to warm (amber) to hot (red). */
const IDLE_PER_HOUR = 0.5
const WARM_PER_HOUR = 15
const HOT_PER_HOUR = 40

/**
 * The least a full sparkline bar stands for: one slice at the warm pace. Bars
 * scale to the busiest slice above it, so a cent spent while idle stays a
 * stub instead of filling the bar.
 */
const SPARK_FLOOR = (WARM_PER_HOUR * RATE_WINDOW_MS) / SPARK_BARS / 3_600_000

type Level = 'idle' | 'calm' | 'warm' | 'hot'

const LEVEL_COLOR: Record<Level, Color> = {
  idle: 'inactive',
  calm: 'success',
  warm: 'warning',
  hot: 'error',
}

/** The same levels for the desktop's SVG sparkline, which draws outside the theme. */
const LEVEL_HEX: Record<Level, string> = {
  idle: '#8a8a8a',
  calm: '#4eba65',
  warm: '#e2a33a',
  hot: '#e5534b',
}

/** One styled run of text; a layout is a list of them, so its width can be measured. */
type Span = { text: string; color?: Color; bold?: boolean; dim?: boolean }

type Layout = {
  left: Span[]
  /** The live half, split where the sparkline goes. */
  before: Span[]
  after: Span[]
  hasSpark: boolean
}

const span = (text: string, style: Omit<Span, 'text'> = {}): Span => ({ text, ...style })
const widthOf = (spans: Span[]) => spans.reduce((n, s) => n + [...s.text].length, 0)

function money(n: number, isCompact = false): string {
  if (isCompact && n >= 1000) {
    const k = n / 1000
    return `$${k >= 100 ? Math.round(k) : k.toFixed(k >= 10 ? 1 : 2)}k`
  }
  return (
    '$' +
    n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

/** Claude Code's project-folder name for a path: every non-alphanumeric a dash. */
const slugOf = (path: string) => path.replace(/[^A-Za-z0-9]/g, '-')

/** Keeps the window's samples and the newest one before it, the rate's baseline. */
function keepRecent(list: Sample[], at: number): Sample[] {
  const first = list.findIndex(s => s.at > at - 2 * RATE_WINDOW_MS)
  return first === -1 ? list.slice(-1) : list.slice(Math.max(0, first - 1))
}

/**
 * $/hour over the last half hour, or since the session's first sample when it
 * is younger. The cost only moves at a sample, so at the window's start it was
 * the last sample before it: the spend is measured from there, over the window.
 */
function burnRate(list: Sample[], now: number): number | null {
  const latest = list.at(-1)
  const cutoff = now - RATE_WINDOW_MS
  const before = list.filter(s => s.at <= cutoff).at(-1)
  const base = before ?? list[0]
  if (!latest || !base) return null
  const hours = (now - (before ? cutoff : base.at)) / 3_600_000
  if (hours < 1 / 60) return null
  return Math.max(0, latest.usd - base.usd) / hours
}

/** What the session spent in each slice of the window, oldest first. */
function sparkBars(list: Sample[], now: number): number[] {
  const bars: number[] = new Array(SPARK_BARS).fill(0)
  const slice = RATE_WINDOW_MS / SPARK_BARS
  for (let i = 1; i < list.length; i++) {
    const cur = list[i]
    const prev = list[i - 1]
    if (!cur || !prev) continue
    const age = now - cur.at
    if (age < 0 || age >= RATE_WINDOW_MS) continue
    const index = SPARK_BARS - 1 - Math.floor(age / slice)
    bars[index] = (bars[index] ?? 0) + Math.max(0, cur.usd - prev.usd)
  }
  return bars
}

function levelOf(rate: number | null): Level {
  if (rate === null || rate < IDLE_PER_HOUR) return 'idle'
  if (rate < WARM_PER_HOUR) return 'calm'
  if (rate < HOT_PER_HOUR) return 'warm'
  return 'hot'
}

/** The terminal's sparkline: block glyphs, scaled to the busiest slice (SPARK_FLOOR at least). */
function sparkGlyphs(bars: number[], level: Level): Span[] {
  const steps = '▂▃▄▅▆▇█'
  const peak = Math.max(...bars, SPARK_FLOOR)
  const out: Span[] = []
  for (const value of bars) {
    const isSpend = value > 0
    const glyph = isSpend ? (steps[Math.round((value / peak) * (steps.length - 1))] ?? '█') : '▁'
    const style: Omit<Span, 'text'> = isSpend ? { color: LEVEL_COLOR[level] } : { dim: true }
    const last = out.at(-1)
    if (last && last.color === style.color && last.dim === style.dim) last.text += glyph
    else out.push({ text: glyph, ...style })
  }
  return out
}

/** The desktop's sparkline: rounded bars, the empty slices a faint baseline. */
function sparkSvg(bars: number[], level: Level): string {
  const barWidth = 4
  const gap = 2
  const height = 12
  const width = bars.length * (barWidth + gap) - gap
  const peak = Math.max(...bars, SPARK_FLOOR)
  const rects = bars
    .map((value, i) => {
      const isSpend = value > 0
      const h = isSpend ? Math.max(3, Math.round((value / peak) * height)) : 2
      const fill = isSpend ? LEVEL_HEX[level] : LEVEL_HEX.idle
      const opacity = isSpend ? 1 : 0.45
      return `<rect x="${i * (barWidth + gap)}" y="${height - h}" width="${barWidth}" height="${h}" rx="1" fill="${fill}" fill-opacity="${opacity}"/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects}</svg>`
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const MONTH_MS = 30.44 * DAY_MS
const YEAR_MS = 365.25 * DAY_MS

/**
 * How far back the total reaches, rounded UP to a whole unit: every session
 * it counts happened inside the window it names, so the label never claims
 * more than the logs hold ("last 3 months" for history that starts 2 months
 * and 4 days ago). Compact spells the unit short ("last 3mo").
 */
function windowLabel(span: number, isCompact: boolean): string {
  const say = (n: number, long: string, short: string) =>
    isCompact ? `last ${n}${short}` : `last ${n} ${long}`
  if (span <= DAY_MS) return say(24, 'hours', 'h')
  const days = Math.ceil(span / DAY_MS)
  if (days <= 31) return say(days, 'days', 'd')
  const months = Math.ceil(span / MONTH_MS)
  if (months <= 24) return say(months, 'months', 'mo')
  return say(Math.ceil(span / YEAR_MS), 'years', 'y')
}

type View = {
  repo: string
  past: History | null
  failed: string | null
  session: number
  rate: number | null
  level: Level
  /** How far back the total reaches, in ms: oldest counted message to now. */
  span: number
}

/** Every way the band can be drawn, richest first; the richest that fits is used. */
function layouts(v: View): Layout[] {
  const mark = span('◆ ', { color: 'claude' })
  const lead = [mark, span(v.repo, { bold: true }), span('  ')]
  const dot = span('  ·  ', { dim: true })
  const rate =
    v.rate === null
      ? []
      : [span(`${money(v.rate)}/hr`, { color: LEVEL_COLOR[v.level], bold: true })]
  const hasSpark = v.rate !== null
  const live = (label: string, joiner: string): Pick<Layout, 'before' | 'after'> => ({
    before: [span(money(v.session), { bold: true }), span(label, { dim: true })],
    after: rate.length === 0 ? [] : [span(joiner, { dim: true }), ...rate],
  })

  if (v.past === null) {
    const status =
      v.failed === null
        ? span('reading history…', { dim: true })
        : span(`history unavailable: ${v.failed}`, { color: 'warning' })
    return [
      { left: [...lead, status], ...live(' this session', '  ·  '), hasSpark: false },
      { left: [mark, status], ...live('', ' · '), hasSpark: false },
    ]
  }

  const past = v.past
  const total = past.usd + v.session
  const isEstimate = past.estimatedUsd > 0 || past.unpriced.length > 0
  const amount = (isCompact: boolean) => [
    ...(isEstimate ? [span('≈', { dim: true })] : []),
    span(money(total, isCompact), { bold: true, color: 'claude' }),
    ...(past.unpriced.length > 0 ? [span('+', { color: 'warning' })] : []),
  ]
  const reach = (isCompact: boolean) => span(` ${windowLabel(v.span, isCompact)}`, { dim: true })
  // A figure that would only repeat the total is left out.
  const today =
    v.span <= DAY_MS
      ? []
      : [dot, span(money(past.today + v.session)), span(' today', { dim: true })]
  const week =
    v.span <= 7 * DAY_MS
      ? []
      : [dot, span(money(past.week + v.session)), span(' last 7d', { dim: true })]
  const unpriced =
    past.unpriced.length === 0
      ? []
      : [span(`  (no price: ${past.unpriced.join(', ')})`, { color: 'warning' })]

  return [
    {
      left: [...lead, ...amount(false), reach(false), ...today, ...week, ...unpriced],
      ...live(' this session', '  '),
      hasSpark,
    },
    {
      left: [...lead, ...amount(false), reach(false), ...today],
      ...live(' this session', '  '),
      hasSpark,
    },
    {
      left: [...lead, ...amount(true), reach(true), ...today],
      ...live(' session', '  ·  '),
      hasSpark: false,
    },
    { left: [mark, ...amount(true)], ...live('', ' · '), hasSpark: false },
  ]
}

function fits(layout: Layout, columns: number): boolean {
  const spark = layout.hasSpark ? SPARK_BARS + 2 : 0
  const live = widthOf(layout.before) + spark + widthOf(layout.after)
  return widthOf(layout.left) + 2 + live <= columns
}

/** Appends this session's running cost when it moved. */
async function record($: EngineInterface, cost: number) {
  const at = await $.clock.now()
  await update($, samples, list => {
    const last = list.at(-1)
    if (last && last.usd === cost) return list
    return [...keepRecent(list, at), { at, usd: cost }]
  })
}

export const register: Register = on => {
  let repoName = ''
  let scanArgs: string[] | null = null
  let timers: Timer[] = []
  // The session the history leaves out: the live one, whose cost comes from
  // Claude Code itself. A /clear or a resume moves it (see follow).
  let liveId = ''
  // The hide toggle, kept here too: a /clear wipes the session's $.state.
  let isHiddenNow = false
  let follow = async () => {}

  on('session.start', async ($, e, next) => {
    const started = await next(e)

    // The repo's main checkout, so a worktree session counts toward it too.
    const git = await $.process.run(
      ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: e.cwd },
    )
    const root = git.exitCode === 0 ? git.stdout.trim().replace(/\/\.git\/?$/, '') : e.cwd
    repoName = root.split('/').pop() ?? root

    const home = (await $.env.get('HOME')) ?? ''
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
    const slug = slugOf(root)
    scanArgs = [
      '/usr/bin/env',
      'python3',
      `${$.plugin.root}/hooks/scan.py`,
      `${config}/projects`,
      slug,
      `${home}/.cache/claude-repo-spend/${slug}.json`,
    ]
    liveId = await $.session.id()
    isHiddenNow = await read($, isHidden)

    const usage = await $.session.usage()
    await record($, usage.cost?.usd ?? 0)

    const rescan = async () => {
      if (!scanArgs) return
      try {
        const run = await $.process.run([...scanArgs, liveId], { timeoutMs: 120_000 })
        if (run.exitCode !== 0) throw new Error(run.stderr.slice(0, 300))
        const found = JSON.parse(run.stdout) as History
        await update($, history, () => found)
        await update($, scanError, () => null)
      } catch (error) {
        const text = String(error)
        $.ui.log(`repo-spend: scan failed: ${text}`, { to: 'debug' })
        const reason =
          /python3/.test(text) && /No such file|not found/i.test(text)
            ? 'python3 not found'
            : 'scan failed (see claude --debug)'
        await update($, scanError, () => reason)
      }
    }
    // A /clear (or a resume inside the session) carries on under a new session
    // id, with no session.start and a wiped $.state. The session that ended
    // joins the history, the new one becomes the live one, its samples start
    // over as its cost does, and the hide toggle is put back.
    follow = async () => {
      const id = await $.session.id()
      if (id === liveId) return
      liveId = id
      $.ui.log(`repo-spend: now following session ${id}`, { to: 'debug' })
      await update($, isHidden, () => isHiddenNow)
      await update($, samples, () => [])
      await record($, (await $.session.usage()).cost?.usd ?? 0)
      await rescan()
    }

    void rescan()
    for (const timer of timers) timer.cancel()
    timers = [
      $.clock.every(RESCAN_MS, () => void rescan()),
      // The rate and the sparkline slide with the clock, not only when the cost
      // moves; the same minute catches a session change no event announced.
      $.clock.every(TICK_MS, () => void follow().then(() => update($, tick, n => n + 1))),
    ]

    await $.command.register({
      name: 'repo-spend',
      description: 'Show or hide the repo spend band above the prompt',
    })

    return started
  })

  on('command.run', { command: 'repo-spend' }, async $ => {
    isHiddenNow = await update($, isHidden, was => !was)
    return { text: isHiddenNow ? 'Repo spend band hidden.' : 'Repo spend band shown.' }
  })

  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    // The process goes on under another session id; it has one a moment later.
    if (e.reason === 'clear' || e.reason === 'resume') $.clock.after(100, () => void follow())
    return ended
  })

  on('session.measure', async ($, e, next) => {
    await follow()
    if (e.cost) await record($, e.cost.usd)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)

    await read($, tick)
    const list = await read($, samples)
    const now = await $.clock.now()
    const rate = burnRate(list, now)
    const past = await read($, history)
    const oldest = past?.since ?? list[0]?.at ?? now
    const view: View = {
      repo: repoName || 'repo',
      past,
      failed: await read($, scanError),
      session: list.at(-1)?.usd ?? 0,
      rate,
      level: levelOf(rate),
      span: Math.max(0, now - oldest),
    }
    const columns = e.props.bodyColumns > 0 ? e.props.bodyColumns : 120
    const options = layouts(view)
    const chosen = options.find(layout => fits(layout, columns)) ?? options.at(-1)
    if (!chosen) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const texts = (spans: Span[]) =>
      spans.map(s => (
        <Text
          {...(s.color ? { color: s.color } : {})}
          {...(s.bold ? { bold: true } : {})}
          {...(s.dim ? { dimColor: true } : {})}
        >
          {s.text}
        </Text>
      ))

    let spark: RenderNode | null = null
    if (chosen.hasSpark) {
      const bars = sparkBars(list, now)
      if (e.surface === 'desktop') {
        const { Svg } = $.ui.resolve(e)
        const spent = bars.reduce((a, b) => a + b, 0)
        spark = (
          <Svg
            source={sparkSvg(bars, view.level)}
            alt={`Spent ${money(spent)} in the last 30 minutes`}
            height={12}
          />
        )
      } else {
        spark = <Text>{texts(sparkGlyphs(bars, view.level))}</Text>
      }
    }

    // Other mods draw bands here too: keep what a plugin beneath drew, stacked
    // under this line, instead of answering for the whole band. The engine's
    // own drawing is left out, as it always was here.
    const beneath = await next(e)
    const below = beneath.type === 'engine' ? null : beneath
    return (
      <Box flexDirection="column" width="100%">
        <Box width="100%" justifyContent="space-between">
          <Box flexShrink={1}>
            <Text wrap="truncate-end">{texts(chosen.left)}</Text>
          </Box>
          <Box flexShrink={0} alignItems="center">
            <Text>{texts(chosen.before)}</Text>
            {spark === null ? null : <Text>{'  '}</Text>}
            {spark}
            <Text>{texts(chosen.after)}</Text>
          </Box>
        </Box>
        {below}
      </Box>
    )
  })
}
