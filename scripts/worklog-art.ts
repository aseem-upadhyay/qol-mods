/**
 * What worklog shows for the README's made-up week, as JSON on stdout, for
 * scripts/worklog-assets.py to set in its images: the desktop pictures from
 * the plugin's own art.ts, and the words, counts and layout its view.tsx,
 * standup.ts and timesheet.ts give them.
 *
 * Run by that script: bun scripts/worklog-art.ts <pane width in px>
 *
 * The week is Mon 19 to Fri 23 October 2026, three repos. Thursday is the
 * day the pane shows, with one branch's details open; the standup is Friday
 * afternoon's, covering Thursday and today so far.
 */
import * as A from '../plugins/worklog/hooks/art'
import { dayLabel, duration } from '../plugins/worklog/hooks/days'
import {
  alsoLine,
  counts,
  groupLabel,
  hasWork,
  headline,
  isShown,
  metaOf,
  NOTICEABLE_ALONE,
  prLine,
  sectionsOf,
  splitMinor,
  standupFor,
  WEEK_FOOTER,
} from '../plugins/worklog/hooks/standup'
import { clockHours, columnLabel, roundingNote, sheetOf, weekTitle } from '../plugins/worklog/hooks/timesheet'
import { axisText, cellsOf, rangeOf, slotsFor } from '../plugins/worklog/hooks/view'
import type { Day, Group, Pr, Repo, ScanResult } from '../plugins/worklog/types'

const WIDTH = Number(process.argv[2] ?? 700)
/** Columns the pane's body has at that width, as view.tsx counts them. */
const COLUMNS = Math.floor(WIDTH / 8) - 2
const DAY_START = 240 // 04:00

/** "HH:MM" as minutes after the day's start. */
const at = (clock: string) => {
  const [h = 0, m = 0] = clock.split(':').map(Number)
  return h * 60 + m - DAY_START
}

function group(branch: string, spans: [string, string][], extra: Partial<Group> = {}): Group {
  const mins = spans.map(([a, b]) => [at(a), at(b)] as [number, number])
  const minutes = mins.reduce((s, [a, b]) => s + b - a, 0)
  return {
    branch,
    isDefault: branch === 'main',
    pr: null,
    minutes,
    rawMin: minutes,
    unattendedMin: 0,
    first: spans[0]?.[0] ?? '09:00',
    last: spans.at(-1)?.[1] ?? '17:00',
    what: [],
    asks: [],
    commits: [],
    commitCount: 0,
    handCommits: [],
    files: [],
    fileCount: 0,
    dirs: [],
    dirCount: 0,
    tests: 0,
    spans: mins,
    aloneSpans: [],
    sessions: [],
    ...extra,
  }
}

const pr = (repo: string, number: number, title: string, state: Pr['state'], isDraft = false): Pr => ({
  number,
  url: `https://github.com/${repo}/pull/${number}`,
  repo,
  title,
  state,
  isDraft,
})

function repo(name: string, groups: Group[]): Repo {
  return {
    name,
    slug: `acme/${name}`,
    root: `/work/${name}`,
    minutes: groups.reduce((s, g) => s + g.minutes, 0),
    hours: Array(24).fill(0),
    groups,
  }
}

function day(date: string, repos: Repo[], extra: Partial<Day> = {}): Day {
  const groups = repos.flatMap(r => r.groups)
  return {
    date,
    totalMin: repos.reduce((s, r) => s + r.minutes, 0),
    unattendedMin: groups.reduce((s, g) => s + g.unattendedMin, 0),
    hours: Array(24).fill(0),
    repos,
    reviews: [],
    source: 'logs',
    ...extra,
  }
}

const CHECKOUT = pr('acme/my-app', 42, 'Redesign the checkout page', 'open')
const RATE = pr('acme/api', 118, 'Rate limit the search endpoint', 'merged')

const THURSDAY = day(
  '2026-10-22',
  [
    repo('my-app', [
      group('checkout-redesign', [['09:12', '10:10'], ['10:25', '11:20'], ['11:35', '12:40']], {
        pr: CHECKOUT,
        what: ['Checkout page redesign', 'Address form validation'],
        asks: [
          'the checkout page should be one step, with the address and payment side by side',
          'validate the postcode as they type, not on submit',
          'the order summary jumps when the coupon field opens',
        ],
        commits: ['Checkout on one page', 'Validate the postcode as it is typed', 'Keep the summary still when the coupon opens'],
        commitCount: 3,
        files: [['src/checkout/Checkout.tsx', 9], ['src/checkout/Address.tsx', 5]],
        fileCount: 14,
        dirs: [['src/checkout', 9], ['src/forms', 3], ['tests/checkout', 2]],
        dirCount: 3,
        tests: 18,
        unattendedMin: 22,
        aloneSpans: [[at('12:40'), at('13:02')]],
        sessions: [],
      }),
      group('main', [['14:05', '15:20']], {
        what: ['Fix the flaky cart test'],
        commits: ['Wait for the cart to settle before asserting'],
        commitCount: 1,
        fileCount: 2,
        dirs: [['tests/cart', 2]],
        dirCount: 1,
        tests: 9,
      }),
      group('tidy-imports', [['13:50', '13:56']]),
    ]),
    repo('api', [
      group('rate-limit', [['15:30', '17:02']], {
        pr: RATE,
        what: ['Rate limiting'],
        commits: ['Rate limit /search per key', 'Return Retry-After with 429s'],
        commitCount: 2,
        fileCount: 5,
        dirs: [['internal/ratelimit', 3], ['internal/search', 2]],
        dirCount: 2,
        tests: 7,
      }),
    ]),
    repo('docs', [
      group('main', [['17:10', '17:38']], {
        what: ['Update the API reference'],
        commits: ['Document the search rate limit'],
        commitCount: 1,
        handCommits: ['Document the search rate limit'],
        fileCount: 1,
        dirs: [['reference', 1]],
        dirCount: 1,
      }),
    ]),
  ],
  { reviews: [{ repo: 'acme/api', number: 121, title: 'Add request IDs to logs', url: 'https://github.com/acme/api/pull/121', at: '13:40' }] },
)

const FRIDAY = day('2026-10-23', [
  repo('my-app', [
    group('checkout-redesign', [['09:20', '10:45'], ['11:05', '12:30']], {
      pr: CHECKOUT,
      what: ['Checkout page redesign'],
      commits: ['Apple Pay on the checkout page'],
      commitCount: 2,
      fileCount: 6,
      tests: 11,
    }),
  ]),
  repo('api', [group('main', [['13:30', '14:05']], { what: ['Bump the Go toolchain'], commitCount: 1, commits: ['Go 1.25'], fileCount: 2 })]),
])

// Earlier in the week, for the timesheet.
const MONDAY = day('2026-10-19', [
  repo('my-app', [group('checkout-redesign', [['09:30', '12:15'], ['13:30', '16:10']], { pr: CHECKOUT })]),
  repo('docs', [group('main', [['16:20', '17:05']])]),
])
const TUESDAY = day('2026-10-20', [
  repo('my-app', [group('checkout-redesign', [['09:05', '11:40']], { pr: CHECKOUT }), group('main', [['15:50', '16:35']])]),
  repo('api', [group('rate-limit', [['12:30', '15:40']], { pr: RATE })]),
])
const WEDNESDAY = day('2026-10-21', [
  repo('my-app', [group('checkout-redesign', [['10:00', '12:20'], ['14:00', '16:00']], { pr: CHECKOUT })]),
  repo('api', [group('rate-limit', [['16:10', '17:40']], { pr: RATE })]),
])

const empty = (date: string) => day(date, [])
const FOUND: ScanResult = {
  today: '2026-10-23',
  days: [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY],
  openPrs: [
    { repo: 'acme/my-app', number: 42, title: 'Redesign the checkout page', url: CHECKOUT.url, isDraft: false },
    { repo: 'acme/my-app', number: 45, title: 'Saved cards', url: 'https://github.com/acme/my-app/pull/45', isDraft: true },
  ],
  github: 'ok',
  warnings: [],
}

// -- a day, laid out as view.tsx lays it out

type Shown = {
  name: string
  slot: number
  dur: string
  groups: {
    pr: number | null
    branch: string
    dur: string
    head: string | null
    meta: string
    strip: string
    cells: string[]
    sections: ReturnType<typeof sectionsOf>
  }[]
  also: string | null
}

function laidOut(d: Day, columns: number, timeline: boolean, fold: boolean, open: Set<string>) {
  const slots = slotsFor(d.repos)
  const repos = d.repos.filter(r => r.groups.some(isShown))
  const longest = Math.max(0, ...repos.flatMap(r => r.groups.filter(isShown).map(g => groupLabel(g).length)))
  const labelCols = Math.min(30, Math.max(12, longest + (open.size ? 6 : 4)))
  const stripCols = columns - labelCols - 8 - 2
  const range = timeline ? rangeOf(d, DAY_START) : null
  const stripPx = stripCols * 8
  const shown: Shown[] = repos.map(r => {
    const slot = slots.get(r.root) ?? 0
    const { listed, folded } = splitMinor(r, fold)
    return {
      name: r.name,
      slot,
      dur: duration(r.minutes),
      groups: listed.map(g => ({
        pr: g.pr?.number ?? null,
        branch: g.branch,
        dur: duration(g.minutes),
        head: headline(g),
        meta: metaOf(g),
        strip: range ? A.stripSvg(g.spans, g.aloneSpans, slot, range, stripPx) : '',
        cells: range ? cellsOf(g, range, stripCols) : [],
        sections: open.has(`${r.root}|${g.branch}`) ? sectionsOf(g, true) : [],
      })),
      also: folded.length ? alsoLine(folded) : null,
    }
  })
  return {
    columns,
    labelCols,
    stripCols,
    stripPx,
    total: duration(d.totalMin),
    counts: counts(d) + (d.unattendedMin >= NOTICEABLE_ALONE ? ` · Claude alone another ${duration(d.unattendedMin)}` : ''),
    shares: repos.map(r => ({ slot: slots.get(r.root) ?? 0, minutes: r.minutes, name: r.name, dur: duration(r.minutes) })),
    share: A.shareSvg(
      repos.map(r => ({ slot: slots.get(r.root) ?? 0, minutes: r.minutes, name: r.name })),
      (columns - 2) * 8,
    ),
    dots: Object.fromEntries(repos.map(r => [r.name, A.dotSvg(slots.get(r.root) ?? 0)])),
    axis: range ? A.axisSvg(range, stripPx) : '',
    axisText: range ? axisText(range, stripCols) : '',
    repos: shown,
    reviews: d.reviews.map(r => ({ line: prLine(r), at: r.at })),
  }
}

const standup = standupFor(FOUND, { kind: 'standup' }, new Set([1, 2, 3, 4, 5]))
const week = sheetOf({ start: '2026-10-19', days: [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, empty('2026-10-24'), empty('2026-10-25')], roundTo: 15 })
const weekSlots = slotsFor(
  [...new Map(week.rows.map(r => [r.root, { name: r.repo, slug: r.slug, root: r.root, minutes: 0, hours: [], groups: [] } as Repo])).values()].map(
    r => ({ ...r, minutes: week.rows.filter(x => x.root === r.root).reduce((s, x) => s + x.total, 0) }),
  ),
)

process.stdout.write(
  JSON.stringify({
    width: WIDTH,
    palette: { light: A.LIGHT, dark: A.DARK },
    // view.tsx's footnote, with the default settings.
    footnote:
      'Estimated from your Claude Code sessions and git. A 15-minute gap ends a stretch of work, Claude working alone counts for 30 minutes after your last message, and a minute parallel sessions share goes mostly to the one you last typed in.',
    pane: {
      heading: dayLabel(THURSDAY.date, true),
      ...laidOut(THURSDAY, COLUMNS, true, false, new Set(['/work/my-app|checkout-redesign'])),
    },
    standup: {
      title: standup.title,
      blocks: standup.blocks.filter(b => hasWork(b.day)).map(b => ({
        heading: b.heading,
        isToday: b.isToday,
        ...laidOut(b.day, 84, false, true, new Set()),
      })),
      openPrs: standup.openPrs.map(p => ({ repo: p.repo.split('/').pop(), number: p.number, title: p.title, isDraft: p.isDraft })),
      footer: standup.footer,
    },
    week: {
      title: weekTitle(week),
      total: duration(week.total),
      dates: week.dates.map(columnLabel),
      rows: week.rows.map(r => ({
        repo: r.repo,
        slot: weekSlots.get(r.root) ?? 0,
        pr: r.pr?.number ?? null,
        branch: r.branch,
        cells: r.cells.map(c => clockHours(c) || '·'),
        total: clockHours(r.total),
      })),
      dayTotals: week.dayTotals.map(t => clockHours(t) || '·'),
      sum: clockHours(week.total),
      note: roundingNote(week.roundTo),
      footer: WEEK_FOOTER,
    },
  }),
)
