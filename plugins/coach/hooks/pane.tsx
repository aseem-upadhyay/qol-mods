/**
 * The weekly report, drawn in a pane (SPEC.md §4.3, §11.2): headline, habit of
 * the week, a prompt worth a look, CLAUDE.md lines and a skill worth making,
 * progress, features, tips and notices; plus the detail, glossary and
 * see-all pages. Nothing here writes a file; the one request it prepares,
 * "Make it a skill", and the week question wait in the prompt box.
 */
import type { Color, ElementTable, RenderElement, RenderSurface, UiPressArgument } from 'claude-code'

import type {
  Choices,
  ClaudeMdCard,
  Evidence,
  HabitId,
  Report,
  ScanState,
  SkillCard,
  Tip,
  View,
  WeekRow,
  WeekSummary,
} from '../types'
import * as C from './copy'
import * as Sel from './select'

export const PANE = 'coach-report'

export type PaneContext = {
  report: Report | null
  scan: ScanState
  view: View
  choices: Choices
  wins: { id: string; text: string }[]
  now: number
  grading: boolean
}

/** What the pane's buttons do: each one the hooks module's own, where `$` is. */
export type PaneActions = {
  setView: (next: Partial<View>) => void
  copy: (text: string, press: UiPressArgument) => void
  flag: (ids: string[], evidence: Record<string, Evidence>) => void
  dismiss: (id: string) => void
  fill: (text: string, toast: string) => void
  pickAnother: (habit: HabitId, row: WeekRow) => void
  rescan: () => void
}

const DAY = 24 * 60 * 60 * 1000
const GLYPHS = '▁▂▃▄▅▆▇█'

type Better = 'up' | 'down' | null
type Series = { label: string; values: (number | null)[]; better: Better; format: (n: number) => string }

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function trend(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null)
  if (known.length < 2) return null
  const first = known[0] ?? 0
  const last = known[known.length - 1] ?? 0
  return last - first
}

function glyphs(values: (number | null)[]): string {
  const known = values.filter((v): v is number => v !== null)
  if (!known.length) return ''
  const lo = Math.min(...known)
  const hi = Math.max(...known)
  return values
    .map(v => {
      if (v === null) return ' '
      const i = hi === lo ? 3 : Math.round(((v - lo) / (hi - lo)) * (GLYPHS.length - 1))
      return GLYPHS[i] ?? '▁'
    })
    .join('')
}

function sparkSvg(values: (number | null)[], color: string): string {
  const width = 120
  const height = 22
  const known = values.filter((v): v is number => v !== null)
  const lo = known.length ? Math.min(...known) : 0
  const hi = known.length ? Math.max(...known) : 1
  const step = values.length > 1 ? width / (values.length - 1) : width
  const segments: string[] = []
  let points: string[] = []
  values.forEach((v, i) => {
    if (v === null) {
      if (points.length) segments.push(points.join(' '))
      points = []
      return
    }
    const y = hi === lo ? height / 2 : height - 2 - ((v - lo) / (hi - lo)) * (height - 4)
    points.push(`${(i * step).toFixed(1)},${y.toFixed(1)}`)
  })
  if (points.length) segments.push(points.join(' '))
  const lines = segments
    .map(p =>
      p.includes(' ')
        ? `<polyline points="${p}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
        : `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="2" fill="${color}"/>`,
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${lines}</svg>`
}

/** Weeks whose definitions changed, or that were partial, break the line. */
function seriesOf(history: WeekSummary[], pick: (w: WeekSummary) => number | null): (number | null)[] {
  const out: (number | null)[] = []
  let version: number | null = null
  for (const week of history) {
    if (version !== null && week.metricsVersion !== version) out.push(null)
    version = week.metricsVersion
    out.push(week.partial ? null : pick(week))
  }
  return out
}

function weeksBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / (7 * DAY))
}

export function drawPane(
  els: ElementTable,
  surface: RenderSurface,
  bodyColumns: number,
  ctx: PaneContext,
  actions: PaneActions,
): RenderElement {
  const { Box, Text, Button } = els
  const Code = 'Code' in els ? els.Code : null
  const columns = bodyColumns > 0 ? bodyColumns : 80
  const narrow = columns < 60
  const { report, view, choices, now } = ctx

  const setView = actions.setView
  const block = (source: string, language: string, path?: string) =>
    Code ? (
      <Code source={source} language={language} {...(path ? { path } : {})} />
    ) : (
      <Text>{source}</Text>
    )
  const section = (title: string, ...children: (RenderElement | null | false)[]) => (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="claude">
        {title}
      </Text>
      {children}
    </Box>
  )
  const buttons = (...items: (RenderElement | null | false)[]) => (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
      {items}
    </Box>
  )
  const back = () => (
    <Button key="back" label="Back to the report" hotkey="b" onPress={() => setView({ page: 'report', detail: null })} />
  )
  const copy = actions.copy
  const flag = actions.flag
  const dismiss = actions.dismiss
  const spark = (values: (number | null)[], color: Color, hex: string) => {
    if (surface !== 'terminal' && 'Svg' in els) {
      const { Svg } = els
      return <Svg source={sparkSvg(values, hex)} alt="Weekly trend" height={22} />
    }
    return <Text color={color}>{glyphs(values)}</Text>
  }

  // -- before there's a report
  if (!report) {
    const s = ctx.scan
    if (s.status === 'failed') {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text bold>Coach</Text>
          <Text>{s.error === 'python3 not found' ? C.COMMAND.python : `Couldn't read your sessions: ${s.error ?? 'unknown error'}.`}</Text>
          {buttons(<Button key="rescan" label="Rescan" onPress={() => actions.rescan()} />)}
        </Box>
      )
    }
    const p = s.progress
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>Coach</Text>
        <Text>{p ? `Reading your sessions… ${p[0]} of ${p[1]} files` : 'Reading your sessions…'}</Text>
      </Box>
    )
  }

  const row = Sel.shownRow(report, view.week)
  if (!row || (report.coverage.logsSince !== null && now - report.coverage.logsSince < 3 * DAY && row.volume.prompts === 0)) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>Coach</Text>
        <Text>Come back in a few days. coach needs a little history first.</Text>
      </Box>
    )
  }
  const evidence: Record<string, Evidence> = { ...report.evidence, ...row.evidence }

  // -- an evidence or glossary detail
  if (view.detail) {
    if (view.detail.startsWith('glossary:')) {
      const term = view.detail.slice('glossary:'.length)
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text bold>{`What is ${term}?`}</Text>
          <Text>{C.GLOSSARY[term] ?? ''}</Text>
          {buttons(<Button key="back" label="Back" hotkey="b" onPress={() => setView({ detail: null })} />)}
        </Box>
      )
    }
    const ev = evidence[view.detail]
    if (ev) {
      const resume = `cd ${ev.root} && claude --resume ${ev.session}`
      const facts = Object.entries(ev.numbers)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ')
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text bold>{ev.title}</Text>
          <Text dimColor>{`${C.dayName(ev.at)} ${C.shortDate(ev.at)} · ${ev.project}${ev.usd ? ` · about ${C.money(ev.usd)}` : ''}`}</Text>
          {ev.excerpt ? <Text>{`"${ev.excerpt}"`}</Text> : null}
          {facts ? <Text dimColor>{facts}</Text> : null}
          <Text dimColor>{`To open it again: ${resume}`}</Text>
          {buttons(
            <Button key="copy-resume" label="Copy resume command" onPress={press => copy(resume, press)} />,
            <Button key="back" label="Back" hotkey="b" onPress={() => setView({ detail: null })} />,
          )}
        </Box>
      )
    }
  }

  const choice = Sel.chooseHabit(report, row, choices, now)
  const habit = choice.habit

  // -- the see-all pages
  if (view.page === 'tips') {
    const tips = Sel.allTips(report, row, choices, habit, now)
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>Tips for you</Text>
        {tips.length ? tips.map(t => tipBlock(t)) : <Text>No tips right now. You're doing the things they'd suggest.</Text>}
        {buttons(back())}
      </Box>
    )
  }
  if (view.page === 'claude-md') {
    const cards = Sel.claudeMdCards(report, choices, now)
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>CLAUDE.md suggestions</Text>
        <Text dimColor>Suggestions only: coach never changes your CLAUDE.md. Copy what helps and add it yourself.</Text>
        {cards.length ? cards.map(card => claudeMdBlock(card, true)) : <Text>Nothing to suggest right now.</Text>}
        {buttons(back())}
      </Box>
    )
  }
  if (view.page === 'skills') {
    const cards = Sel.skillCards(report, choices, now)
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>Skills worth making</Text>
        {cards.length ? cards.map(card => skillBlock(card)) : <Text>No repeated prompts right now.</Text>}
        {buttons(back())}
      </Box>
    )
  }

  // -- the report
  const all = Sel.rows(report)
  const at = all.findIndex(r => r.week === row.week)
  const older = row.week === 'recent' ? report.previous : at > 0 ? all[at - 1] : null
  const newer = row.week === 'recent' ? report.current : at >= 0 && at < all.length - 1 ? all[at + 1] : null
  const isCurrent = report.current !== null && row.week === report.current.week
  const title = Sel.isEarlyRead(row) ? 'Your last 7 days with Claude' : isCurrent ? 'Your week so far' : 'Your week with Claude'
  const range = Sel.isEarlyRead(row) ? `${C.shortDate(row.start)} to ${C.shortDate(row.end - 1)}` : C.weekRange(row.week)
  const weekNo =
    choices.firstReportWeek && !Sel.isEarlyRead(row) && row.week >= choices.firstReportWeek
      ? weeksBetween(choices.firstReportWeek, row.week) + 1
      : null
  const notes = [
    Sel.isEarlyRead(row) ? 'early read' : null,
    row.coverage.partial ? 'partial week: your logs start partway through it' : null,
  ].filter(Boolean)

  const header = (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap">
        <Text bold>{title}</Text>
        <Text dimColor>{[range, weekNo ? `week ${weekNo}` : null].filter(Boolean).join(' · ')}</Text>
      </Box>
      {notes.length ? <Text dimColor>{notes.join(' · ')}</Text> : null}
      {buttons(
        older ? <Button key="prev" label="Previous week" hotkey="p" onPress={() => setView({ week: older.week, detail: null })} /> : null,
        newer ? <Button key="next" label="Next week" hotkey="n" onPress={() => setView({ week: newer.week, detail: null })} /> : null,
        report.current && !isCurrent ? (
          <Button key="this-week" label="This week so far" hotkey="w" onPress={() => setView({ week: report.current?.week ?? null, detail: null })} />
        ) : null,
        <Button
          key="ask"
          label="Ask Claude about this week"
          hotkey="a"
          onPress={() => actions.fill(C.weekQuestion(row), 'Your question is in the prompt box. Edit it or send it as it is.')}
        />,
      )}
    </Box>
  )

  // headline
  const before = report.history.filter(w => w.start < row.start && !w.partial).slice(-4)
  const avg = (pick: (w: WeekSummary) => number) => mean(before.map(pick))
  const tiles: { label: string; value: string; now: number; avg: number | null; better: Better }[] = [
    { label: 'Sessions', value: String(row.volume.sessions), now: row.volume.sessions, avg: avg(w => w.sessions), better: null },
    { label: 'Prompts', value: String(row.volume.prompts), now: row.volume.prompts, avg: avg(w => w.prompts), better: null },
    { label: 'Spent', value: C.money(row.cost.usd), now: row.cost.usd, avg: avg(w => w.usd), better: 'down' },
    {
      label: 'Typical cost per prompt',
      value: C.money(row.cost.perPrompt.median),
      now: row.cost.perPrompt.median,
      avg: avg(w => w.costPerPrompt),
      better: 'down',
    },
  ]
  const change = (t: (typeof tiles)[number]) => {
    if (t.avg === null || t.avg <= 0) return null
    const pct = (t.now - t.avg) / t.avg
    const text = `${pct >= 0 ? '+' : '−'}${Math.round(Math.abs(pct) * 100)}%`
    if (Math.abs(pct) < 0.1 || t.better === null) return <Text dimColor>{text}</Text>
    const good = (t.better === 'down' && pct < 0) || (t.better === 'up' && pct > 0)
    return <Text color={good ? 'success' : 'warning'}>{text}</Text>
  }
  const headline = narrow ? (
    <Box flexDirection="column" marginTop={1}>
      {tiles.map(t => (
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>{`${t.label}:`}</Text>
          <Text bold>{t.value}</Text>
          {change(t)}
        </Box>
      ))}
    </Box>
  ) : (
    <Box flexDirection="row" marginTop={1} columnGap={2}>
      {tiles.map(t => (
        <Box flexDirection="column" width={Math.max(14, Math.floor((columns - 8) / 4))}>
          <Text dimColor>{t.label}</Text>
          <Box flexDirection="row" columnGap={1}>
            <Text bold>{t.value}</Text>
            {change(t)}
          </Box>
        </Box>
      ))}
    </Box>
  )

  // habit of the week
  let habitBlock: RenderElement
  if (habit) {
    const status = row.habits[habit]
    const evId = status?.evidence.find(id => !Sel.isNotRight(choices, id))
    const ev = evId ? evidence[evId] : undefined
    const live = report.current?.habits[habit]
    const words = C.HABIT[habit]
    habitBlock = section(
      'Habit of the week',
      choice.learned ? <Text color="success">{C.learned(choice.learned)}</Text> : null,
      <Text bold>{words.title}</Text>,
      ev ? <Text>{C.habitEvidence(habit, ev)}</Text> : null,
      <Text>{`Try this: ${words.tryThis}`}</Text>,
      live && live.total > 0 ? (
        <Text dimColor>{`This week so far: ${live.done} of ${live.total} ${words.unit}.`}</Text>
      ) : null,
      buttons(
        ev ? <Button key="habit-session" label="See the session" onPress={() => setView({ detail: ev.id })} /> : null,
        <Button key="habit-glossary" label={`What is ${words.glossary}?`} onPress={() => setView({ detail: `glossary:${words.glossary}` })} />,
        <Button key="habit-other" label="Pick another habit" onPress={() => actions.pickAnother(habit, row)} />,
        ev ? <Button key="habit-not-right" label="Not right?" onPress={() => flag([ev.id], evidence)} /> : null,
      ),
    )
  } else {
    habitBlock = section(
      'Habit of the week',
      choice.learned ? <Text color="success">{C.learned(choice.learned)}</Text> : null,
      <Text>Nothing to fix this week. The tips below are the next step.</Text>,
    )
  }

  const winsBlock = ctx.wins.length ? section('Since last time', ...ctx.wins.map(w => <Text color="success">{w.text}</Text>)) : null

  // a prompt worth a look
  const graded = choices.grading[row.week]
  let promptBlock: RenderElement | null = null
  if (graded?.rewrite) {
    promptBlock = section(
      'Your prompt, rewritten',
      <Text dimColor>You wrote</Text>,
      <Text>{graded.rewrite.before}</Text>,
      <Text dimColor>Clearer</Text>,
      <Text color="success">{graded.rewrite.after}</Text>,
      <Text dimColor>{`The first version took ${graded.rewrite.followUps} follow-up${graded.rewrite.followUps === 1 ? '' : 's'}. ${Math.round(graded.shareAtLeast7 * 100)}% of ${graded.n} graded prompts scored 7 or more out of 10.`}</Text>,
    )
  } else if (row.best && evidence[row.best]?.excerpt && !Sel.isNotRight(choices, row.best)) {
    const best = evidence[row.best] as Evidence
    promptBlock = section(
      'Your best prompt this week',
      <Text>{`"${best.excerpt}"`}</Text>,
      <Text dimColor>
        {best.numbers.followUps
          ? 'You named the file and said what done looks like.'
          : 'You named the file and said what done looks like. Claude finished it in one go.'}
      </Text>,
    )
  }

  // CLAUDE.md and skills
  const mdCards = Sel.claudeMdCards(report, choices, now)
  const skCards = Sel.skillCards(report, choices, now)
  const mdBlock = mdCards[0] ? claudeMdBlock(mdCards[0], false, mdCards.length > 1) : null
  const skBlock = skCards[0] ? skillBlock(skCards[0], skCards.length > 1) : null

  // progress
  const history = report.history.filter(w => w.start <= row.start).slice(-12)
  const series: Series[] = [
    ...(habit
      ? [{ label: C.HABIT[habit].title, values: seriesOf(history, w => w.habits[habit] ?? null), better: 'up' as Better, format: C.percent }]
      : []),
    { label: 'Typical cost per prompt', values: seriesOf(history, w => w.costPerPrompt), better: 'down', format: C.money },
    { label: 'Corrections per 10 prompts', values: seriesOf(history, w => w.correctionsPer10), better: 'down', format: n => n.toFixed(1) },
    { label: 'Oversized sessions', values: seriesOf(history, w => w.oversized), better: 'down', format: n => String(n) },
    {
      label: 'Steps spent rediscovering projects',
      values: seriesOf(history, w => w.discoverySteps),
      better: 'down',
      format: n => String(n),
    },
  ]
  const progressBlock =
    history.length >= 2
      ? section(
          `Progress, last ${history.length} weeks`,
          ...series
            .filter(s => s.values.some(v => v !== null))
            .map(s => {
              const d = trend(s.values)
              const good = d !== null && d !== 0 && ((s.better === 'down' && d < 0) || (s.better === 'up' && d > 0))
              const color: Color = d === null || d === 0 ? 'inactive' : good ? 'success' : 'warning'
              const hex = d === null || d === 0 ? '#8a8a8a' : good ? '#4eba65' : '#e2a33a'
              const last = [...s.values].reverse().find((v): v is number => v !== null)
              return (
                <Box flexDirection="row" columnGap={2}>
                  <Box width={narrow ? 22 : 36}>
                    <Text wrap="truncate-end">{s.label}</Text>
                  </Box>
                  {spark(s.values, color, hex)}
                  <Text dimColor>{last === undefined ? '' : s.format(last)}</Text>
                </Box>
              )
            }),
        )
      : null

  // features
  const reach = Math.min(3, report.level + 1)
  const shownFeatures = Object.keys(C.FEATURE_NAME).filter(name => (FEATURE_LEVEL[name] ?? 3) <= Math.max(1, reach))
  const up = report.upNext
  const featuresBlock = section(
    "Features you've used",
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {shownFeatures.map(name =>
        report.features[name] ? (
          <Text color="success">{`✓ ${C.FEATURE_NAME[name]}`}</Text>
        ) : (
          <Text dimColor>{`· ${C.FEATURE_NAME[name]}`}</Text>
        ),
      )}
    </Box>,
    up ? (
      <Text>{`Up next: ${C.FEATURE_NAME[up.feature] ?? up.feature}.${up.reason && C.UP_NEXT_REASON[up.reason] ? ` ${C.UP_NEXT_REASON[up.reason]?.(row)}` : ''}`}</Text>
    ) : null,
  )

  // tips
  const tips = Sel.chooseTips(report, row, choices, habit, now)
  const tipsBlock = tips.length
    ? section(
        'Level up',
        ...tips.map(t => tipBlock(t)),
        buttons(<Button key="tips-all" label="See all tips" hotkey="t" onPress={() => setView({ page: 'tips', detail: null })} />),
      )
    : null

  // notices
  const noticesBlock = row.notices.length
    ? section('Also noticed', ...row.notices.slice(0, 3).map(n => <Text color={n.id === 'bypass' ? 'warning' : undefined}>{C.noticeText(n)}</Text>))
    : null

  // footer
  const since = report.coverage.logsSince
  const footer = (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>Estimated at API list prices. On Pro or Max, this is what your usage would have cost on the API.</Text>
      {since ? <Text dimColor>{`Based on your session logs from ${C.shortDate(since)} on.${report.restored ? ' Some older weeks were restored from a backup.' : ''}`}</Text> : null}
      <Text dimColor>
        {ctx.grading
          ? 'Prompt grading is on: once a week, sampled prompts are sent to Anthropic to be scored.'
          : 'Nothing in this report left your computer.'}
      </Text>
      <Text dimColor>Settings: /config, under coach. Read everything again: /coach rescan.</Text>
    </Box>
  )

  return (
    <Box flexDirection="column" paddingX={1}>
      {header}
      {headline}
      {habitBlock}
      {winsBlock}
      {promptBlock}
      {mdBlock}
      {skBlock}
      {progressBlock}
      {featuresBlock}
      {tipsBlock}
      {noticesBlock}
      {footer}
    </Box>
  )

  // -- pieces

  function tipBlock(t: Tip): RenderElement {
    const words = C.tipText(t)
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{words.title}</Text>
        <Text>{words.body}</Text>
        {buttons(
          t.evidence[0] ? <Button key={`tip-session:${t.id}`} label="See the session" onPress={() => setView({ detail: t.evidence[0] ?? null })} /> : null,
          t.evidence.length ? <Button key={`tip-not-right:${t.id}`} label="Not right?" onPress={() => flag(t.evidence, evidence)} /> : null,
          <Button key={`tip-dismiss:${t.id}`} label="Dismiss" onPress={() => dismiss(t.id)} />,
        )}
      </Box>
    )
  }

  function claudeMdBlock(card: ClaudeMdCard, full: boolean, more = false): RenderElement {
    const text = Sel.claudeMdText(card)
    const ids = card.lines.flatMap(l => l.evidence)
    const target = card.project === 'All projects' ? '~/.claude/CLAUDE.md' : `${card.project}/CLAUDE.md`
    return section(
      card.project === 'All projects' ? 'Teach Claude, in every project' : `Teach Claude this project · ${card.project}`,
      card.lines.length ? <Text>{C.claudeMdLead(card)}</Text> : null,
      card.lines.length ? block(text, 'markdown', target) : null,
      ...card.lines.slice(0, full ? 10 : 3).map(l => (
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>{C.claudeMdWhy(l)}</Text>
          {full ? <Button key={`line-dismiss:${l.id}`} label="Dismiss" plain dimColor onPress={() => dismiss(l.id)} /> : null}
        </Box>
      )),
      card.pointers.files.length ? <Text>{C.pointerFiles(card.pointers.files)}</Text> : null,
      ...card.pointers.tasks.map(task => <Text>{C.pointerTask(task)}</Text>),
      ...card.notes.filter(n => n.id === 'covered-but-corrected').map(n => <Text dimColor>{C.noteText(n)}</Text>),
      buttons(
        text ? <Button key={`md-copy:${card.id}`} label="Copy" onPress={press => copy(text, press)} /> : null,
        ids.length ? <Button key={`md-not-right:${card.id}`} label="Not right?" onPress={() => flag(ids, evidence)} /> : null,
        <Button key={`md-dismiss:${card.id}`} label="Dismiss" onPress={() => dismiss(card.id)} />,
        more ? <Button key="md-all" label="See all" hotkey="c" onPress={() => setView({ page: 'claude-md', detail: null })} /> : null,
      ),
    )
  }

  function skillBlock(card: SkillCard, more = false): RenderElement {
    const follow = card.followUps.find(f => f.text)
    const canMake = !card.existing && !!card.template
    return section(
      'Could be a skill',
      <Text>{C.skillLead(card)}</Text>,
      card.template ? (
        block(card.template, 'text')
      ) : (
        <Text dimColor>Turn on prompt excerpts in settings to see it.</Text>
      ),
      follow ? <Text dimColor>{`You usually follow up with "${follow.text}" (${follow.count} of ${card.count}).`}</Text> : null,
      canMake ? <Text dimColor>{C.skillUsage(card)}</Text> : null,
      buttons(
        canMake ? (
          <Button
            key={`skill-make:${card.id}`}
            label="Make it a skill"
            variant="primary"
            onPress={() => actions.fill(C.skillRequest(card), 'The request is in the prompt box. Read it, and send it if you want the skill.')}
          />
        ) : null,
        card.template ? <Button key={`skill-copy:${card.id}`} label="Copy template" onPress={press => copy(card.template ?? '', press)} /> : null,
        card.evidence.length ? <Button key={`skill-not-right:${card.id}`} label="Not right?" onPress={() => flag(card.evidence, evidence)} /> : null,
        <Button key={`skill-dismiss:${card.id}`} label="Dismiss" onPress={() => dismiss(card.id)} />,
        more ? <Button key="skill-all" label="See all" hotkey="s" onPress={() => setView({ page: 'skills', detail: null })} /> : null,
      ),
    )
  }
}

const FEATURE_LEVEL: Record<string, number> = {
  'claude-md': 1,
  'at-mention': 1,
  image: 1,
  interrupt: 1,
  'fresh-start': 1,
  'ask-checks': 1,
  'plan-mode': 2,
  rewind: 2,
  'model-choice': 2,
  subagents: 2,
  'commands-skills': 2,
  mcp: 2,
  'allow-rules': 2,
  compact: 2,
  hooks: 3,
  parallel: 3,
  worktrees: 3,
  headless: 3,
  automation: 3,
  plugins: 3,
  workflows: 3,
}
