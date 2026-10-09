/**
 * What coach draws for the README's made-up month, as JSON on stdout, for
 * scripts/coach-assets.py to set in its images: the desktop pictures from the
 * plugin's own art.ts, and the words and numbers the report shows beside them.
 *
 * Run by that script: bun scripts/coach-art.ts <picture width in px>
 *
 * The month is the tests' beginner (tests/fixtures/report.ts), given eight
 * weeks of made-up history so the progress lines go somewhere, a few more
 * features, and two of three topic switches started fresh so far this week.
 */
import * as A from '../plugins/coach/hooks/art'
import * as C from '../plugins/coach/hooks/copy'
import * as F from '../plugins/coach/hooks/figures'
import * as Sel from '../plugins/coach/hooks/select'
import { REPORT } from '../plugins/coach/tests/fixtures/report'
import type { HabitWeek, Report, WeekRow, WeekSummary } from '../plugins/coach/types'

const WIDTH = Number(process.argv[2] ?? 700)
const NOW = 1791385200000 // Wednesday 7 October 2026, as the tests have it
const HABIT = 'fresh-start' as const

// Eight weeks to 28 Sep. The four before it average 8 sessions, 15 prompts,
// $4.37 and $0.30 a prompt, so the week shown reads +25%, +20%, +40%, −15%.
const WEEKS = ['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']
const SESSIONS = [5, 6, 7, 7, 9, 8, 8, 10]
const PROMPTS = [9, 11, 12, 14, 16, 15, 15, 18]
const USD = [3.6, 4.4, 4.0, 4.1, 4.65, 4.2, 4.5388, 6.14]
const PER_PROMPT = [0.41, 0.38, 0.36, 0.33, 0.31, 0.29, 0.26, 0.2524]
const CORRECTIONS = [3.2, 2.9, 3.1, 2.6, 2.4, 2.2, 2.0, 1.7]
const OVERSIZED = [1, 1, 2, 1, 2, 2, 1, 2]
const DISCOVERY = [14, 12, 15, 11, 9, 8, 6, 3]
const FRESH = [0.12, 0.18, 0.15, 0.25, 0.22, 0.3, 0.28, 0.333]

function month(): Report {
  // Week starts as the fixture has them, a week apart back from the week shown.
  const shown = (REPORT.previous as WeekRow).start
  const history: WeekSummary[] = WEEKS.map((week, i) => ({
    week,
    start: shown - (WEEKS.length - 1 - i) * 7 * 24 * 3600 * 1000,
    partial: false,
    metricsVersion: REPORT.metricsVersion,
    usd: USD[i] ?? 0,
    prompts: PROMPTS[i] ?? 0,
    sessions: SESSIONS[i] ?? 0,
    costPerPrompt: PER_PROMPT[i] ?? 0,
    correctionsPer10: CORRECTIONS[i] ?? null,
    interruptsPer10: 0.5,
    oversized: OVERSIZED[i] ?? 0,
    discoverySteps: DISCOVERY[i] ?? 0,
    repeatedPrompts: 1,
    habits: { [HABIT]: FRESH[i] ?? null },
  }))
  const current = REPORT.current as WeekRow
  const live = current.habits[HABIT] as HabitWeek
  const seen = { firstSeen: NOW, lastSeen: NOW, count: 3 }
  return {
    ...REPORT,
    history: [...history, ...REPORT.history.filter(w => w.week > '2026-09-28')],
    current: { ...current, habits: { ...current.habits, [HABIT]: { ...live, done: 2, total: 3, value: 0.667 } } },
    features: Object.fromEntries(
      ['at-mention', 'image', 'interrupt', 'ask-checks', 'plan-mode', 'model-choice', 'subagents'].map(f => [f, seen]),
    ),
    level: 1,
  }
}

const report = month()
const choices = { ...Sel.EMPTY_CHOICES, firstReportWeek: '2026-09-07' }
const row = Sel.shownRow(report, null) as WeekRow
const head = F.header(row, choices.firstReportWeek, false)
const when = [head.range, head.weekNo ? `week ${head.weekNo}` : null].filter(Boolean).join(' · ')
const hero = F.heroOf(report, row, head)
const status = row.habits[HABIT] as HabitWeek
const live = report.current?.habits[HABIT] as HabitWeek
const words = C.HABIT[HABIT]
const evidence = { ...report.evidence, ...row.evidence }
const ev = evidence[status.evidence[0] ?? '']
const history = F.progressWeeks(report, row)
const trends = F.trendsOf(F.progressSeries(history, HABIT), history)
const levels = F.toolkitOf(report)
const md = Sel.claudeMdCards(report, choices, NOW).find(c => c.project !== 'All projects')
const skill = Sel.skillCards(report, choices, NOW)[0]
const met = status.value !== null && status.value >= status.target

process.stdout.write(
  JSON.stringify({
    width: WIDTH,
    when,
    title: head.title,
    hero: { ...A.heroSvg(hero, WIDTH), alt: C.ART.heroAlt(head.title, when, hero.stats) },
    tiles: F.tiles(report, row).map(t => {
      const c = F.change(t)
      return { label: t.label, value: t.value, delta: c ? C.ART.change(c.pct) : null, tone: c?.tone ?? 'flat' }
    }),
    habit: {
      title: words.title,
      tryThis: `Try this: ${words.tryThis}`,
      score: C.ART.score(status.done, status.total, words.unit, status.target),
      share: status.value ?? 0,
      met,
      evidence: ev ? C.habitEvidence(HABIT, ev) : '',
      live: `This week so far: ${live.done} of ${live.total} ${words.unit}.`,
      liveDone: live.done,
      liveTotal: live.total,
      glossary: words.glossary,
      ring: A.ringSvg(status.value, status.target, status.value === null ? '—' : C.percent(status.value), C.ART.goal(status.target), met),
      dots: A.dotsSvg(live.done, live.total),
    },
    progress: { title: `Progress, last ${history.length} weeks`, ...A.trendsSvg(trends, WIDTH) },
    features: { ...A.toolkitSvg(levels, WIDTH) },
    md: md && {
      title: `Teach Claude this project · ${md.project}`,
      lead: C.claudeMdLead(md),
      text: Sel.claudeMdText(md),
      why: md.lines.map(l => C.claudeMdWhy(l)),
    },
    skill: skill && { lead: C.skillLead(skill), template: skill.template ?? '' },
    bar: C.HABIT[HABIT].bar,
  }),
)
