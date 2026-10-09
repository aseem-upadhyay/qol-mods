/**
 * The weekly report, drawn in a pane (SPEC.md §4.3, §11.2): headline, habit of
 * the week, a prompt worth a look, CLAUDE.md lines and a skill worth making,
 * progress, features, tips and notices; plus the detail, glossary and
 * see-all pages. Nothing here writes a file; the one request it prepares,
 * "Make it a skill", and the week question wait in the prompt box.
 *
 * Where the surface draws Svg (the desktop app, VS Code, mobile) the report is
 * set as cards: art.ts draws the week's hero, the habit ring, the progress
 * lines and the toolkit, and Markdown sets the headings. The terminal draws
 * the same report in text, with glyph sparklines.
 */
import type { Color, ElementTable, RenderElement, RenderSurface, UiPressArgument } from 'claude-code'

import type { Choices, ClaudeMdCard, Evidence, HabitId, Report, ScanState, SkillCard, Tip, View, WeekRow } from '../types'
import * as A from './art'
import * as C from './copy'
import * as F from './figures'
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

/** A tone in the person's theme, for Text. */
const TONE_COLOR: Record<A.Tone, Color | undefined> = { good: 'success', bad: 'warning', flat: undefined, claude: 'claude' }

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

/** "███░░░░" for a share of `cells`. */
function meter(share: number, cells: number): [string, string] {
  const full = Math.round(Math.max(0, Math.min(1, share)) * cells)
  return ['█'.repeat(full), '░'.repeat(cells - full)]
}

/** The characters Markdown would read as markup inside a heading, escaped. */
function mdEscape(text: string): string {
  return text.replace(/([\\`*_[\]<>~|#])/g, '\\$1')
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
  const Markdown = 'Markdown' in els ? els.Markdown : null
  const Svg = surface !== 'terminal' && 'Svg' in els ? els.Svg : null
  const rich = Svg !== null
  const columns = bodyColumns > 0 ? bodyColumns : 80
  const narrow = columns < 60
  /** Too tight for four framed tiles in a row. */
  const tight = columns < 76
  const width = A.pixels(columns - 2)
  const { report, view, choices, now } = ctx
  const { setView, copy, flag, dismiss } = actions

  // -- pieces every page uses

  const block = (source: string, language: string, path?: string) =>
    Code ? <Code source={source} language={language} {...(path ? { path } : {})} /> : <Text>{source}</Text>
  const picture = (source: string, alt: string) => (Svg ? <Svg source={source} alt={alt} /> : null)
  const heading = (title: string, level: 2 | 3 = 3): RenderElement => {
    if (rich && Markdown) return <Markdown text={`${'#'.repeat(level)} ${mdEscape(title)}`} />
    if (level === 2) return <Text bold>{title}</Text>
    return (
      <Box flexDirection="row">
        <Text color="claude">{'◆ '}</Text>
        <Text bold color="claude">
          {title}
        </Text>
      </Box>
    )
  }
  /** A framed card: every card where the surface draws Svg, only an accented one on the terminal. */
  const card = (accent: Color | null, ...children: (RenderElement | null | false)[]) =>
    rich ? (
      <Box flexDirection="column" borderStyle="round" borderColor={accent ?? 'subtle'} paddingX={2} paddingY={1} marginTop={1}>
        {children}
      </Box>
    ) : accent ? (
      <Box flexDirection="column" borderStyle="round" borderColor={accent} paddingX={1} marginTop={1}>
        {children}
      </Box>
    ) : (
      <Box flexDirection="column" marginTop={1}>
        {children}
      </Box>
    )
  const section = (title: string, ...children: (RenderElement | null | false)[]) => card(null, heading(title), ...children)
  /** A heading and what follows, never framed: for pictures that carry their own cards. */
  const open = (title: string, ...children: (RenderElement | null | false)[]) => (
    <Box flexDirection="column" marginTop={1}>
      {heading(title)}
      {children}
    </Box>
  )
  const buttons = (...items: (RenderElement | null | false)[]) => (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
      {items}
    </Box>
  )
  const page = (...children: (RenderElement | null | false)[]) => (
    <Box flexDirection="column" paddingX={1}>
      {children}
    </Box>
  )
  const back = () => (
    <Button key="back" label="Back to the report" hotkey="b" onPress={() => setView({ page: 'report', detail: null })} />
  )

  // -- before there's a report
  if (!report) {
    const s = ctx.scan
    if (s.status === 'failed') {
      return page(
        heading('Coach', 2),
        <Text>{s.error === 'python3 not found' ? C.COMMAND.python : `Couldn't read your sessions: ${s.error ?? 'unknown error'}.`}</Text>,
        buttons(<Button key="rescan" label="Rescan" onPress={() => actions.rescan()} />),
      )
    }
    const p = s.progress
    return page(
      heading('Coach', 2),
      <Text>{p ? `Reading your sessions… ${p[0]} of ${p[1]} files` : 'Reading your sessions…'}</Text>,
      p && rich ? <Box marginTop={1}>{picture(A.meterSvg(p[0], p[1], Math.min(width, 360)), C.ART.scanAlt(p[0], p[1]))}</Box> : null,
    )
  }

  const row = Sel.shownRow(report, view.week)
  if (!row || (report.coverage.logsSince !== null && now - report.coverage.logsSince < 3 * DAY && row.volume.prompts === 0)) {
    return page(heading('Coach', 2), <Text>Come back in a few days. coach needs a little history first.</Text>)
  }
  const evidence: Record<string, Evidence> = { ...report.evidence, ...row.evidence }

  // -- an evidence or glossary detail
  if (view.detail) {
    if (view.detail.startsWith('glossary:')) {
      const term = view.detail.slice('glossary:'.length)
      return page(
        card(
          null,
          heading(`What is ${term}?`),
          <Text>{C.GLOSSARY[term] ?? ''}</Text>,
          buttons(<Button key="back" label="Back" hotkey="b" onPress={() => setView({ detail: null })} />),
        ),
      )
    }
    const ev = evidence[view.detail]
    if (ev) {
      const resume = `cd ${ev.root} && claude --resume ${ev.session}`
      const facts = Object.entries(ev.numbers)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ')
      return page(
        card(
          null,
          heading(ev.title),
          <Text dimColor>{`${C.dayName(ev.at)} ${C.shortDate(ev.at)} · ${ev.project}${ev.usd ? ` · about ${C.money(ev.usd)}` : ''}`}</Text>,
          ev.excerpt ? (
            <Box marginTop={1}>
              <Text italic={rich}>{`"${ev.excerpt}"`}</Text>
            </Box>
          ) : null,
          facts ? <Text dimColor>{facts}</Text> : null,
          rich && Code ? (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>To open it again:</Text>
              {block(resume, 'bash')}
            </Box>
          ) : (
            <Text dimColor>{`To open it again: ${resume}`}</Text>
          ),
          buttons(
            <Button key="copy-resume" label="Copy resume command" onPress={press => copy(resume, press)} />,
            <Button key="back" label="Back" hotkey="b" onPress={() => setView({ detail: null })} />,
          ),
        ),
      )
    }
  }

  const choice = Sel.chooseHabit(report, row, choices, now)
  const habit = choice.habit

  // -- the see-all pages
  if (view.page === 'tips') {
    const tips = Sel.allTips(report, row, choices, habit, now)
    return page(
      heading('Tips for you', 2),
      ...(tips.length ? tips.map(t => tipBlock(t)) : [<Text>No tips right now. You're doing the things they'd suggest.</Text>]),
      buttons(back()),
    )
  }
  if (view.page === 'claude-md') {
    const cards = Sel.claudeMdCards(report, choices, now)
    return page(
      heading('CLAUDE.md suggestions', 2),
      <Text dimColor>Suggestions only: coach never changes your CLAUDE.md. Copy what helps and add it yourself.</Text>,
      ...(cards.length ? cards.map(c => claudeMdBlock(c, true)) : [<Text>Nothing to suggest right now.</Text>]),
      buttons(back()),
    )
  }
  if (view.page === 'skills') {
    const cards = Sel.skillCards(report, choices, now)
    return page(
      heading('Skills worth making', 2),
      ...(cards.length ? cards.map(c => skillBlock(c)) : [<Text>No repeated prompts right now.</Text>]),
      buttons(back()),
    )
  }

  // -- the report
  const all = Sel.rows(report)
  const at = all.findIndex(r => r.week === row.week)
  const older = row.week === 'recent' ? report.previous : at > 0 ? all[at - 1] : null
  const newer = row.week === 'recent' ? report.current : at >= 0 && at < all.length - 1 ? all[at + 1] : null
  const isCurrent = report.current !== null && row.week === report.current.week
  const head = F.header(row, choices.firstReportWeek, isCurrent)
  const when = [head.range, head.weekNo ? `week ${head.weekNo}` : null].filter(Boolean).join(' · ')

  const nav = buttons(
    older ? (
      <Button key="prev" label={rich ? '← Previous week' : 'Previous week'} hotkey="p" onPress={() => setView({ week: older.week, detail: null })} />
    ) : null,
    newer ? (
      <Button key="next" label={rich ? 'Next week →' : 'Next week'} hotkey="n" onPress={() => setView({ week: newer.week, detail: null })} />
    ) : null,
    report.current && !isCurrent ? (
      <Button key="this-week" label="This week so far" hotkey="w" onPress={() => setView({ week: report.current?.week ?? null, detail: null })} />
    ) : null,
    <Button
      key="ask"
      label="Ask Claude about this week"
      hotkey="a"
      {...(rich ? { variant: 'primary' as const } : {})}
      onPress={() => actions.fill(C.weekQuestion(row), 'Your question is in the prompt box. Edit it or send it as it is.')}
    />,
  )

  // header and headline: one card where Svg draws, lines and tiles on the terminal
  let top: RenderElement
  if (rich) {
    const hero = F.heroOf(report, row, head)
    top = (
      <Box flexDirection="column">
        {picture(A.heroSvg(hero, width).source, C.ART.heroAlt(head.title, when, hero.stats))}
        {nav}
      </Box>
    )
  } else {
    const tiles = F.tiles(report, row)
    const change = (t: F.Tile) => {
      const c = F.change(t)
      if (!c) return null
      const color = TONE_COLOR[c.tone]
      return color ? <Text color={color}>{C.ART.change(c.pct)}</Text> : <Text dimColor>{C.ART.change(c.pct)}</Text>
    }
    const headline = tight ? (
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
      <Box flexDirection="row" marginTop={1} columnGap={1}>
        {tiles.map(t => (
          <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} width={Math.floor((columns - 5) / 4)}>
            <Text dimColor wrap="truncate-end">
              {t.label}
            </Text>
            <Box flexDirection="row" columnGap={1}>
              <Text bold>{t.value}</Text>
              {change(t)}
            </Box>
          </Box>
        ))}
      </Box>
    )
    top = (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap">
          <Text bold>{head.title}</Text>
          <Text dimColor>{when}</Text>
        </Box>
        {head.notes.length ? <Text dimColor>{head.notes.join(' · ')}</Text> : null}
        {nav}
        {headline}
      </Box>
    )
  }

  // habit of the week
  let habitBlock: RenderElement
  if (habit) {
    const status = row.habits[habit]
    const evId = status?.evidence.find(id => !Sel.isNotRight(choices, id))
    const ev = evId ? evidence[evId] : undefined
    const live = report.current?.habits[habit]
    const words = C.HABIT[habit]
    const met = !!status && status.value !== null && status.value >= status.target
    const score = status && status.total > 0 ? C.ART.score(status.done, status.total, words.unit, status.target) : null
    const liveLine =
      live && live.total > 0 ? (
        <Box flexDirection="row" columnGap={1} alignItems="center" marginTop={1}>
          {rich ? (
            picture(A.dotsSvg(live.done, live.total), C.ART.dotsAlt(live.done, live.total, words.unit))
          ) : (
            <Text>
              <Text color="claude">{'●'.repeat(Math.round((Math.min(live.done, live.total) / live.total) * Math.min(live.total, 8)))}</Text>
              <Text dimColor>
                {'○'.repeat(Math.min(live.total, 8) - Math.round((Math.min(live.done, live.total) / live.total) * Math.min(live.total, 8)))}
              </Text>
            </Text>
          )}
          <Text dimColor>{`This week so far: ${live.done} of ${live.total} ${words.unit}.`}</Text>
        </Box>
      ) : null
    let gauge: RenderElement | null = null
    if (status && score) {
      if (rich) {
        gauge = picture(
          A.ringSvg(status.value, status.target, status.value === null ? '—' : C.percent(status.value), C.ART.goal(status.target), met),
          C.ART.ringAlt(status.value, status.target, words.unit),
        )
      } else {
        const [full, empty] = meter(status.value ?? 0, 10)
        gauge = (
          <Text>
            <Text color={met ? 'success' : 'claude'}>{full}</Text>
            <Text dimColor>{empty}</Text>
          </Text>
        )
      }
    }
    habitBlock = card(
      'claude',
      heading('Habit of the week'),
      choice.learned ? <Text color="success">{C.learned(choice.learned)}</Text> : null,
      rich ? (
        <Box flexDirection="row" columnGap={2} alignItems="center" marginTop={1}>
          {gauge}
          <Box flexDirection="column" flexShrink={1}>
            <Text bold>{words.title}</Text>
            {score ? <Text dimColor>{score}</Text> : null}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          <Text bold>{words.title}</Text>
          {gauge}
          {score ? <Text dimColor>{score}</Text> : null}
        </Box>
      ),
      ev ? (
        <Box marginTop={rich ? 1 : 0}>
          <Text>{C.habitEvidence(habit, ev)}</Text>
        </Box>
      ) : null,
      <Box marginTop={rich ? 1 : 0}>
        <Text>{`Try this: ${words.tryThis}`}</Text>
      </Box>,
      liveLine,
      buttons(
        ev ? <Button key="habit-session" label="See the session" onPress={() => setView({ detail: ev.id })} /> : null,
        <Button key="habit-glossary" label={`What is ${words.glossary}?`} onPress={() => setView({ detail: `glossary:${words.glossary}` })} />,
        <Button key="habit-other" label="Pick another habit" onPress={() => actions.pickAnother(habit, row)} />,
        ev ? <Button key="habit-not-right" label="Not right?" onPress={() => flag([ev.id], evidence)} /> : null,
      ),
    )
  } else {
    habitBlock = card(
      'claude',
      heading('Habit of the week'),
      choice.learned ? <Text color="success">{C.learned(choice.learned)}</Text> : null,
      <Text>Nothing to fix this week. The tips below are the next step.</Text>,
    )
  }

  const winsBlock = ctx.wins.length
    ? card(
        'success',
        heading('Since last time'),
        ...ctx.wins.map(w => (
          <Box flexDirection="row">
            <Text color="success">{'✓ '}</Text>
            <Text color="success">{w.text}</Text>
          </Box>
        )),
      )
    : null

  // a prompt worth a look
  const graded = choices.grading[row.week]
  let promptBlock: RenderElement | null = null
  if (graded?.rewrite) {
    promptBlock = section(
      'Your prompt, rewritten',
      <Text dimColor>You wrote</Text>,
      <Text italic={rich}>{graded.rewrite.before}</Text>,
      <Box marginTop={rich ? 1 : 0}>
        <Text dimColor>Clearer</Text>
      </Box>,
      <Text color="success">{graded.rewrite.after}</Text>,
      <Box marginTop={rich ? 1 : 0}>
        <Text dimColor>{`The first version took ${graded.rewrite.followUps} follow-up${graded.rewrite.followUps === 1 ? '' : 's'}. ${Math.round(graded.shareAtLeast7 * 100)}% of ${graded.n} graded prompts scored 7 or more out of 10.`}</Text>
      </Box>,
    )
  } else if (row.best && evidence[row.best]?.excerpt && !Sel.isNotRight(choices, row.best)) {
    const best = evidence[row.best] as Evidence
    promptBlock = section(
      'Your best prompt this week',
      <Text italic={rich}>{`"${best.excerpt}"`}</Text>,
      <Box marginTop={rich ? 1 : 0}>
        <Text dimColor>
          {best.numbers.followUps
            ? 'You named the file and said what done looks like.'
            : 'You named the file and said what done looks like. Claude finished it in one go.'}
        </Text>
      </Box>,
    )
  }

  // CLAUDE.md and skills
  const mdCards = Sel.claudeMdCards(report, choices, now)
  const skCards = Sel.skillCards(report, choices, now)
  const mdBlock = mdCards[0] ? claudeMdBlock(mdCards[0], false, mdCards.length > 1) : null
  const skBlock = skCards[0] ? skillBlock(skCards[0], skCards.length > 1) : null

  // progress
  const history = F.progressWeeks(report, row)
  const series = F.progressSeries(history, habit)
  let progressBlock: RenderElement | null = null
  if (history.length >= 2 && series.length) {
    const title = `Progress, last ${history.length} weeks`
    if (rich) {
      const trends = F.trendsOf(series, history)
      progressBlock = open(title, <Box marginTop={1}>{picture(A.trendsSvg(trends, width).source, C.ART.trendsAlt(trends, history.length))}</Box>)
    } else {
      progressBlock = section(
        title,
        ...series.map(s => {
          const { tone } = F.direction(s)
          const color = TONE_COLOR[tone] ?? 'inactive'
          const last = [...s.values].reverse().find((v): v is number => v !== null)
          return (
            <Box flexDirection="row" columnGap={2}>
              <Box width={narrow ? 22 : 36}>
                <Text wrap="truncate-end">{s.label}</Text>
              </Box>
              <Text color={color}>{glyphs(s.values)}</Text>
              <Text dimColor>{last === undefined ? '' : s.format(last)}</Text>
            </Box>
          )
        }),
      )
    }
  }

  // features
  const up = report.upNext
  const upNext = up ? (
    <Box flexDirection="row" marginTop={rich ? 1 : 0}>
      <Text color="claude" bold>{'Up next: '}</Text>
      <Text>{`${C.FEATURE_NAME[up.feature] ?? up.feature}.${up.reason && C.UP_NEXT_REASON[up.reason] ? ` ${C.UP_NEXT_REASON[up.reason]?.(row)}` : ''}`}</Text>
    </Box>
  ) : null
  let featuresBlock: RenderElement
  if (rich) {
    const levels = F.toolkitOf(report)
    featuresBlock = open(
      "Features you've used",
      <Box marginTop={1}>{picture(A.toolkitSvg(levels, width).source, C.ART.toolkitAlt(levels))}</Box>,
      upNext,
    )
  } else {
    featuresBlock = section(
      "Features you've used",
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {F.shownFeatures(report).map(name =>
          report.features[name] ? (
            <Text color="success">{`✓ ${C.FEATURE_NAME[name]}`}</Text>
          ) : (
            <Text dimColor>{`· ${C.FEATURE_NAME[name]}`}</Text>
          ),
        )}
      </Box>,
      upNext,
    )
  }

  // tips
  const tips = Sel.chooseTips(report, row, choices, habit, now)
  const tipsBlock = tips.length
    ? open(
        'Level up',
        ...tips.map(t => tipBlock(t)),
        buttons(<Button key="tips-all" label="See all tips" hotkey="t" onPress={() => setView({ page: 'tips', detail: null })} />),
      )
    : null

  // notices
  const noticesBlock = row.notices.length
    ? section(
        'Also noticed',
        ...row.notices.slice(0, 3).map(n => (
          <Box flexDirection="row">
            <Text color={n.id === 'bypass' ? 'warning' : 'claude'}>{`${C.NOTICE_MARK[n.id] ?? '·'} `}</Text>
            <Text color={n.id === 'bypass' ? 'warning' : undefined}>{C.noticeText(n)}</Text>
          </Box>
        )),
      )
    : null

  // footer
  const since = report.coverage.logsSince
  const footer = (
    <Box flexDirection="column" marginTop={rich ? 2 : 1}>
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

  return page(top, habitBlock, winsBlock, promptBlock, mdBlock, skBlock, progressBlock, featuresBlock, tipsBlock, noticesBlock, footer)

  // -- pieces

  function tipBlock(t: Tip): RenderElement {
    const words = C.tipText(t)
    const kind = C.TIP_KIND[t.category]
    return card(
      null,
      rich && kind ? (
        <Text color="claude" bold>
          {kind}
        </Text>
      ) : null,
      <Text bold>{words.title}</Text>,
      <Text>{words.body}</Text>,
      buttons(
        t.evidence[0] ? <Button key={`tip-session:${t.id}`} label="See the session" onPress={() => setView({ detail: t.evidence[0] ?? null })} /> : null,
        t.evidence.length ? <Button key={`tip-not-right:${t.id}`} label="Not right?" onPress={() => flag(t.evidence, evidence)} /> : null,
        <Button key={`tip-dismiss:${t.id}`} label="Dismiss" onPress={() => dismiss(t.id)} />,
      ),
    )
  }

  function claudeMdBlock(c: ClaudeMdCard, full: boolean, more = false): RenderElement {
    const text = Sel.claudeMdText(c)
    const ids = c.lines.flatMap(l => l.evidence)
    const target = c.project === 'All projects' ? '~/.claude/CLAUDE.md' : `${c.project}/CLAUDE.md`
    return section(
      c.project === 'All projects' ? 'Teach Claude, in every project' : `Teach Claude this project · ${c.project}`,
      c.lines.length ? <Text>{C.claudeMdLead(c)}</Text> : null,
      c.lines.length ? <Box marginTop={rich ? 1 : 0}>{block(text, 'markdown', target)}</Box> : null,
      ...c.lines.slice(0, full ? 10 : 3).map(l => (
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>{C.claudeMdWhy(l)}</Text>
          {full ? <Button key={`line-dismiss:${l.id}`} label="Dismiss" plain dimColor onPress={() => dismiss(l.id)} /> : null}
        </Box>
      )),
      c.pointers.files.length ? <Text>{C.pointerFiles(c.pointers.files)}</Text> : null,
      ...c.pointers.tasks.map(task => <Text>{C.pointerTask(task)}</Text>),
      ...c.notes.filter(n => n.id === 'covered-but-corrected').map(n => <Text dimColor>{C.noteText(n)}</Text>),
      buttons(
        text ? <Button key={`md-copy:${c.id}`} label="Copy" {...(rich ? { variant: 'primary' as const } : {})} onPress={press => copy(text, press)} /> : null,
        ids.length ? <Button key={`md-not-right:${c.id}`} label="Not right?" onPress={() => flag(ids, evidence)} /> : null,
        <Button key={`md-dismiss:${c.id}`} label="Dismiss" onPress={() => dismiss(c.id)} />,
        more ? <Button key="md-all" label="See all" hotkey="c" onPress={() => setView({ page: 'claude-md', detail: null })} /> : null,
      ),
    )
  }

  function skillBlock(c: SkillCard, more = false): RenderElement {
    const follow = c.followUps.find(f => f.text)
    const canMake = !c.existing && !!c.template
    return section(
      'Could be a skill',
      <Text>{C.skillLead(c)}</Text>,
      c.template ? (
        <Box marginTop={rich ? 1 : 0}>{block(c.template, 'text')}</Box>
      ) : (
        <Text dimColor>Turn on prompt excerpts in settings to see it.</Text>
      ),
      follow ? <Text dimColor>{`You usually follow up with "${follow.text}" (${follow.count} of ${c.count}).`}</Text> : null,
      canMake ? <Text dimColor>{C.skillUsage(c)}</Text> : null,
      buttons(
        canMake ? (
          <Button
            key={`skill-make:${c.id}`}
            label="Make it a skill"
            variant="primary"
            onPress={() => actions.fill(C.skillRequest(c), 'The request is in the prompt box. Read it, and send it if you want the skill.')}
          />
        ) : null,
        c.template ? <Button key={`skill-copy:${c.id}`} label="Copy template" onPress={press => copy(c.template ?? '', press)} /> : null,
        c.evidence.length ? <Button key={`skill-not-right:${c.id}`} label="Not right?" onPress={() => flag(c.evidence, evidence)} /> : null,
        <Button key={`skill-dismiss:${c.id}`} label="Dismiss" onPress={() => dismiss(c.id)} />,
        more ? <Button key="skill-all" label="See all" hotkey="s" onPress={() => setView({ page: 'skills', detail: null })} /> : null,
      ),
    )
  }
}
