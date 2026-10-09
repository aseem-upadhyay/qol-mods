/**
 * The report's pictures, for the surfaces that draw `Svg` (the desktop app,
 * VS Code, mobile): the week's hero card, the habit ring, the progress cards
 * and the toolkit. Each returns markup; the words to read, select or press
 * stay in Text and Button, and every picture says itself in its `alt`.
 *
 * An Svg is drawn as an image, outside the person's theme: prefers-color-scheme
 * inside it follows the operating system, not the app. So its words sit on a
 * fill of their own (the hero), or in mid-tone colors that read on light and
 * dark alike.
 */

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, Helvetica, Arial, sans-serif"

/** What a change means, as a color: better, worse, or no news. */
export type Tone = 'good' | 'bad' | 'flat' | 'claude'

export const TONE: Record<Tone, string> = {
  good: '#3a9c58',
  bad: '#d68a24',
  flat: '#8b8b8b',
  claude: '#d97757',
}

const MUTED = '#8b8b8b'
const TRACK = 'rgba(128,128,128,0.22)'
const CARD_FILL = 'rgba(128,128,128,0.07)'
const CARD_EDGE = 'rgba(128,128,128,0.24)'

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** About how wide `text` sets in the system sans at `size` px: enough to lay out chips and cut labels. */
export function textWidth(text: string, size: number, bold = false): number {
  let em = 0
  for (const ch of text) {
    if (" .,:;'!|ijlIft()[]".includes(ch)) em += 0.3
    else if ('mwMW@%'.includes(ch)) em += 0.86
    else if (/[A-Z]/.test(ch)) em += 0.66
    else if (/[0-9$]/.test(ch)) em += 0.6
    else if (ch.charCodeAt(0) > 0x2000) em += 0.92
    else em += 0.54
  }
  return em * size * (bold ? 1.07 : 1)
}

/** `text`, cut with an ellipsis to fit `room` px. */
export function fit(text: string, size: number, room: number, bold = false): string {
  if (textWidth(text, size, bold) <= room) return text
  let cut = text
  while (cut.length > 1 && textWidth(`${cut}…`, size, bold) > room) cut = cut.slice(0, -1)
  return `${cut.trimEnd()}…`
}

/** The picture's width in px for a body `columns` wide, never under `min`. */
export function pixels(columns: number, min = 280): number {
  return Math.max(min, Math.min(820, Math.round(columns * 8)))
}

function doc(width: number, height: number, body: string): string {
  const style = `text{font-family:${SANS};font-variant-numeric:tabular-nums}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${style}</style>${body}</svg>`
}

function n(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

type TextOpts = { size: number; fill?: string; weight?: number; anchor?: 'start' | 'middle' | 'end'; opacity?: number; spacing?: number }

function text(x: number, y: number, body: string, o: TextOpts): string {
  const attrs = [
    `x="${n(x)}"`,
    `y="${n(y)}"`,
    `font-size="${o.size}"`,
    `fill="${o.fill ?? MUTED}"`,
    o.weight ? `font-weight="${o.weight}"` : '',
    o.anchor && o.anchor !== 'start' ? `text-anchor="${o.anchor}"` : '',
    o.opacity !== undefined ? `fill-opacity="${o.opacity}"` : '',
    o.spacing ? `letter-spacing="${o.spacing}"` : '',
  ].filter(Boolean)
  return `<text ${attrs.join(' ')}>${esc(body)}</text>`
}

// -- the hero: the week on a card of its own

export type HeroStat = { label: string; value: string; delta: string | null; tone: Tone }
export type HeroDay = { letter: string; usd: number; label: string }
export type Hero = {
  /** The small line over the title: "COACH · WEEK 2". */
  kicker: string
  title: string
  subline: string
  stats: HeroStat[]
  /** The week's days, first to last, for the spend chart; null for none. */
  days: HeroDay[] | null
  daysTitle: string
  caption: string | null
}

const PILL: Record<Tone, { fill: string; ink: string }> = {
  good: { fill: '#2f8a4c', ink: '#ffffff' },
  bad: { fill: '#ffd88a', ink: '#5b3300' },
  flat: { fill: 'rgba(255,255,255,0.2)', ink: '#ffffff' },
  claude: { fill: 'rgba(255,255,255,0.2)', ink: '#ffffff' },
}

/** Seven bars, the costliest day labelled; set against the right edge, or the left one with `atStart`. */
function dayChart(days: HeroDay[], x0: number, top: number, width: number, base: number, atStart = false): string {
  const out: string[] = []
  const gap = atStart ? 10 : width >= 150 ? 8 : 5
  const bw = Math.max(6, Math.min(atStart ? 28 : 16, (width - gap * (days.length - 1)) / days.length))
  const span = bw * days.length + gap * (days.length - 1)
  const start = atStart ? x0 : x0 + (width - span)
  const max = Math.max(0, ...days.map(d => d.usd))
  const room = base - top - 16
  const peak = max > 0 ? days.findIndex(d => d.usd === max) : -1
  days.forEach((d, i) => {
    const x = start + i * (bw + gap)
    const cx = x + bw / 2
    if (d.usd > 0 && max > 0) {
      const h = Math.max(3, (d.usd / max) * room)
      out.push(
        `<rect x="${n(x)}" y="${n(base - h)}" width="${n(bw)}" height="${n(h)}" rx="${n(Math.min(4, bw / 2))}" fill="#fff" fill-opacity="${i === peak ? 0.95 : 0.5}"/>`,
      )
    } else {
      out.push(`<circle cx="${n(cx)}" cy="${n(base - 2)}" r="2" fill="#fff" fill-opacity="0.4"/>`)
    }
    out.push(text(cx, base + 14, d.letter, { size: 10, fill: '#fff', opacity: i === peak ? 0.95 : 0.7, anchor: 'middle', weight: 600 }))
  })
  if (peak >= 0) {
    const d = days[peak] as HeroDay
    const h = Math.max(3, (d.usd / max) * room)
    const half = textWidth(d.label, 10.5, true) / 2
    const cx = Math.min(x0 + width - half, Math.max(x0 + half, start + peak * (bw + gap) + bw / 2))
    out.push(text(cx, base - h - 6, d.label, { size: 10.5, fill: '#fff', weight: 700, anchor: 'middle' }))
  }
  return out.join('')
}

function ray(cx: number, cy: number, length: number, thick: number, angle: number): string {
  return `<rect x="${n(cx - thick / 2)}" y="${n(cy - length)}" width="${n(thick)}" height="${n(length)}" rx="${n(thick / 2)}" transform="rotate(${angle} ${n(cx)} ${n(cy)})"/>`
}

export function heroSvg(hero: Hero, width: number): { source: string; height: number } {
  const W = Math.round(width)
  const wide = W >= 560
  const P = W < 420 ? 18 : 26
  const titleSize = W < 420 ? 21 : 26
  const out: string[] = []

  const yKicker = P + 12
  const yTitle = yKicker + titleSize + 10
  const ySub = yTitle + 24
  const chartW = wide ? Math.min(176, Math.round(W * 0.26)) : W - 2 * P
  let y = ySub

  // the words over the title, and the day chart beside or below them
  const textRoom = wide && hero.days ? W - 2 * P - chartW - 28 : W - 2 * P
  out.push(text(P, yKicker, fit(hero.kicker, 11, textRoom, true), { size: 11, fill: '#fff', opacity: 0.8, weight: 700, spacing: 1.2 }))
  out.push(text(P, yTitle, fit(hero.title, titleSize, textRoom, true), { size: titleSize, fill: '#fff', weight: 700 }))
  out.push(text(P, ySub, fit(hero.subline, 13, textRoom), { size: 13, fill: '#fff', opacity: 0.88 }))
  if (hero.days?.length) {
    if (wide) {
      const x0 = W - P - chartW
      out.push(text(W - P, yKicker, hero.daysTitle, { size: 11, fill: '#fff', opacity: 0.8, weight: 700, spacing: 1.2, anchor: 'end' }))
      out.push(dayChart(hero.days, x0, yKicker + 6, chartW, ySub - 4))
    } else {
      const top = ySub + 26
      out.push(text(P, top, hero.daysTitle, { size: 11, fill: '#fff', opacity: 0.8, weight: 700, spacing: 1.2 }))
      out.push(dayChart(hero.days, P, top + 10, chartW, top + 72, true))
      y = top + 72 + 14
    }
  }

  // the numbers
  const rule = y + 22
  out.push(`<rect x="${P}" y="${rule}" width="${W - 2 * P}" height="1" fill="#fff" fill-opacity="0.22"/>`)
  const cols = wide ? Math.max(1, hero.stats.length) : 2
  const colW = (W - 2 * P) / cols
  const rowH = 84
  const valueSize = wide ? 28 : 24
  hero.stats.forEach((s, i) => {
    const x = P + (i % cols) * colW
    const y0 = rule + 16 + Math.floor(i / cols) * rowH
    out.push(text(x, y0 + valueSize, fit(s.value, valueSize, colW - 10, true), { size: valueSize, fill: '#fff', weight: 700 }))
    out.push(text(x, y0 + valueSize + 19, fit(s.label, 12, colW - 10), { size: 12, fill: '#fff', opacity: 0.82 }))
    if (s.delta) {
      const pill = PILL[s.tone]
      const pw = textWidth(s.delta, 11, true) + 16
      const py = y0 + valueSize + 29
      out.push(`<rect x="${n(x)}" y="${n(py)}" width="${n(pw)}" height="20" rx="10" fill="${pill.fill}"/>`)
      out.push(text(x + pw / 2, py + 14, s.delta, { size: 11, fill: pill.ink, weight: 700, anchor: 'middle' }))
    }
  })
  const rows = Math.ceil(hero.stats.length / cols)
  let H = rule + 16 + rows * rowH - 6
  if (hero.caption) {
    H += 14
    out.push(text(P, H, fit(hero.caption, 11, W - 2 * P), { size: 11, fill: '#fff', opacity: 0.7 }))
  }
  H += P - 6

  const defs =
    '<defs>' +
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#e3976f"/><stop offset="0.48" stop-color="#cf6a4c"/><stop offset="1" stop-color="#8f3d5d"/>' +
    '</linearGradient>' +
    '<radialGradient id="glow" cx="0.08" cy="0" r="0.75">' +
    '<stop offset="0" stop-color="#fff" stop-opacity="0.3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>' +
    '</radialGradient>' +
    `<clipPath id="card"><rect width="${W}" height="${H}" rx="18"/></clipPath>` +
    '</defs>'
  const sx = W - 34
  const sy = H + 18
  const spark = Array.from({ length: 12 }, (_, i) => ray(sx, sy, i % 2 ? 92 : 128, 15, i * 30)).join('')
  const backdrop =
    `<rect width="${W}" height="${H}" fill="url(#bg)"/>` +
    `<rect width="${W}" height="${H}" fill="url(#glow)"/>` +
    `<g fill="#fff" fill-opacity="0.07">${spark}</g>`
  const body = `${defs}<g clip-path="url(#card)">${backdrop}${out.join('')}</g>`
  return { source: doc(W, H, body), height: H }
}

// -- the habit ring: this week's share against its goal

export function ringSvg(value: number | null, target: number, valueText: string, goalText: string, met: boolean, size = 96): string {
  const c = size / 2
  const stroke = 9
  const r = c - stroke / 2 - 4
  const C = 2 * Math.PI * r
  const color = met ? TONE.good : TONE.claude
  const v = value === null ? 0 : Math.max(0, Math.min(1, value))
  const parts = [`<circle cx="${c}" cy="${c}" r="${n(r)}" fill="none" stroke="${TRACK}" stroke-width="${stroke}"/>`]
  if (v > 0) {
    parts.push(
      `<circle cx="${c}" cy="${c}" r="${n(r)}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" ` +
        `stroke-dasharray="${(v * C).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`,
    )
  }
  const a = ((Math.max(0, Math.min(1, target)) * 360 - 90) * Math.PI) / 180
  const inner = r - stroke / 2 - 3
  const outer = r + stroke / 2 + 3
  parts.push(
    `<line x1="${n(c + inner * Math.cos(a))}" y1="${n(c + inner * Math.sin(a))}" x2="${n(c + outer * Math.cos(a))}" y2="${n(c + outer * Math.sin(a))}" ` +
      `stroke="${TONE.flat}" stroke-width="2.5" stroke-linecap="round"/>`,
  )
  parts.push(text(c, c + 4, valueText, { size: 21, fill: color, weight: 700, anchor: 'middle' }))
  parts.push(text(c, c + 20, goalText, { size: 10, anchor: 'middle', weight: 600 }))
  return doc(size, size, parts.join(''))
}

/** One dot per item, done ones filled: "4 of 13 this week". */
export function dotsSvg(done: number, total: number, tone: Tone = 'claude'): string {
  const count = Math.max(1, Math.min(total, 16))
  const filled = Math.round((Math.min(done, total) / Math.max(total, 1)) * count)
  const r = 5
  const gap = 4
  const width = count * (2 * r + gap) - gap
  const dots = Array.from({ length: count }, (_, i) => {
    const cx = r + i * (2 * r + gap)
    return i < filled
      ? `<circle cx="${cx}" cy="${r + 1}" r="${r}" fill="${TONE[tone]}"/>`
      : `<circle cx="${cx}" cy="${r + 1}" r="${r - 0.75}" fill="none" stroke="${TRACK}" stroke-width="1.5"/>`
  })
  return doc(width, 2 * r + 2, dots.join(''))
}

/** A slim bar, `done` of `total` full: the first scan's progress. */
export function meterSvg(done: number, total: number, width: number): string {
  const W = Math.round(width)
  const share = total > 0 ? Math.max(0.02, Math.min(1, done / total)) : 0.02
  return doc(
    W,
    8,
    `<rect width="${W}" height="8" rx="4" fill="${TRACK}"/><rect width="${n(W * share)}" height="8" rx="4" fill="${TONE.claude}"/>`,
  )
}

// -- progress: one small card per measure, a line over the weeks

export type Trend = {
  label: string
  values: (number | null)[]
  value: string
  delta: string | null
  tone: Tone
  first: string
  last: string
}

function linePaths(values: (number | null)[], x0: number, y0: number, w: number, h: number): { line: string[]; area: string[]; end: [number, number] | null } {
  const known = values.filter((v): v is number => v !== null)
  const lo = known.length ? Math.min(...known) : 0
  const hi = known.length ? Math.max(...known) : 1
  const step = values.length > 1 ? w / (values.length - 1) : 0
  const yOf = (v: number) => (hi === lo ? y0 + h / 2 : y0 + h - ((v - lo) / (hi - lo)) * h)
  const runs: [number, number][][] = []
  let run: [number, number][] = []
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run)
      run = []
      return
    }
    run.push([values.length > 1 ? x0 + i * step : x0 + w / 2, yOf(v)])
  })
  if (run.length) runs.push(run)
  const line: string[] = []
  const area: string[] = []
  for (const r of runs) {
    const first = r[0] as [number, number]
    const last = r[r.length - 1] as [number, number]
    if (r.length === 1) continue
    const d = r.map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)} ${n(y)}`).join(' ')
    line.push(d)
    area.push(`${d} L${n(last[0])} ${n(y0 + h)} L${n(first[0])} ${n(y0 + h)} Z`)
  }
  const tail = runs[runs.length - 1]
  const end = tail ? (tail[tail.length - 1] as [number, number]) : null
  return { line, area, end }
}

export function trendsSvg(trends: Trend[], width: number): { source: string; height: number } {
  const W = Math.round(width)
  const cols = W >= 520 ? 2 : 1
  const gap = 12
  const cardW = (W - gap * (cols - 1)) / cols
  const cardH = 118
  const rows = Math.ceil(trends.length / cols)
  const H = rows * cardH + (rows - 1) * gap + 2
  const out: string[] = []
  const defs: string[] = []
  trends.forEach((t, i) => {
    const x0 = 1 + (i % cols) * (cardW + gap)
    const y0 = 1 + Math.floor(i / cols) * (cardH + gap)
    const w = cardW - 2
    const color = TONE[t.tone]
    out.push(`<rect x="${n(x0)}" y="${n(y0)}" width="${n(w)}" height="${cardH - 2}" rx="12" fill="${CARD_FILL}" stroke="${CARD_EDGE}"/>`)
    const valueW = textWidth(t.value, 20, true)
    out.push(text(x0 + 16, y0 + 26, fit(t.label, 12.5, w - 44 - valueW, true), { size: 12.5, weight: 600 }))
    out.push(text(x0 + w - 16, y0 + 29, t.value, { size: 20, fill: color, weight: 700, anchor: 'end' }))
    if (t.delta) out.push(text(x0 + w - 16, y0 + 47, t.delta, { size: 11, fill: color, weight: 600, anchor: 'end' }))
    const cx = x0 + 18
    const cy = y0 + 56
    const cw = w - 36
    const ch = 34
    const { line, area, end } = linePaths(t.values, cx, cy, cw, ch)
    defs.push(
      `<linearGradient id="t${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.3"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`,
    )
    out.push(`<line x1="${n(cx)}" y1="${n(cy + ch)}" x2="${n(cx + cw)}" y2="${n(cy + ch)}" stroke="${TRACK}" stroke-width="1"/>`)
    for (const d of area) out.push(`<path d="${d}" fill="url(#t${i})"/>`)
    for (const d of line) out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`)
    if (end) {
      out.push(`<circle cx="${n(end[0])}" cy="${n(end[1])}" r="6.5" fill="${color}" fill-opacity="0.2"/>`)
      out.push(`<circle cx="${n(end[0])}" cy="${n(end[1])}" r="3.4" fill="${color}"/>`)
    }
    out.push(text(cx, y0 + cardH - 12, t.first, { size: 10 }))
    out.push(text(cx + cw, y0 + cardH - 12, t.last, { size: 10, anchor: 'end' }))
  })
  return { source: doc(W, H, `<defs>${defs.join('')}</defs>${out.join('')}`), height: H }
}

// -- the toolkit: the features used, level by level

export type Chip = { text: string; state: 'used' | 'next' | 'open' }
export type ToolkitLevel = { name: string; count: string; used: number; total: number; chips: Chip[] }

const CHIP: Record<Chip['state'], { fill: string; stroke: string; ink: string | null; mark: string; dash?: string; weight: number }> = {
  used: { fill: 'rgba(58,156,88,0.13)', stroke: 'rgba(58,156,88,0.5)', ink: TONE.good, mark: '✓ ', weight: 600 },
  next: { fill: 'rgba(217,119,87,0.15)', stroke: TONE.claude, ink: TONE.claude, mark: '→ ', weight: 700 },
  open: { fill: 'none', stroke: 'rgba(128,128,128,0.45)', ink: null, mark: '', dash: '3 3', weight: 500 },
}

export function toolkitSvg(levels: ToolkitLevel[], width: number): { source: string; height: number } {
  const W = Math.round(width)
  const out: string[] = []
  const chipH = 26
  const padX = 11
  const size = 12
  let y = 0
  levels.forEach((level, li) => {
    if (li) y += 18
    const meterW = Math.min(150, Math.round(W * 0.28))
    const meterX = W - meterW - 1
    const name = level.name.toUpperCase()
    out.push(text(1, y + 14, fit(name, 11.5, W - meterW - 90, true), { size: 11.5, fill: TONE.claude, weight: 700, spacing: 1.1 }))
    out.push(text(meterX - 10, y + 14, level.count, { size: 12, anchor: 'end', weight: 600 }))
    const share = level.total ? level.used / level.total : 0
    out.push(`<rect x="${meterX}" y="${y + 6}" width="${meterW}" height="7" rx="3.5" fill="${TRACK}"/>`)
    if (share > 0) {
      out.push(
        `<rect x="${meterX}" y="${y + 6}" width="${n(Math.max(7, meterW * share))}" height="7" rx="3.5" fill="${share >= 1 ? TONE.good : TONE.claude}"/>`,
      )
    }
    y += 28
    let x = 1
    for (const chip of level.chips) {
      const look = CHIP[chip.state]
      const label = fit(`${look.mark}${chip.text}`, size, W - 2 - 2 * padX, look.weight >= 600)
      const cw = textWidth(label, size, look.weight >= 600) + 2 * padX
      if (x > 1 && x + cw > W - 1) {
        x = 1
        y += chipH + 8
      }
      out.push(
        `<rect x="${n(x + 0.5)}" y="${n(y + 0.5)}" width="${n(cw - 1)}" height="${chipH - 1}" rx="${chipH / 2}" fill="${look.fill}" stroke="${look.stroke}"${look.dash ? ` stroke-dasharray="${look.dash}"` : ''}/>`,
      )
      out.push(
        text(x + cw / 2, y + 17, label, {
          size,
          anchor: 'middle',
          weight: look.weight,
          ...(look.ink ? { fill: look.ink } : {}),
        }),
      )
      x += cw + 8
    }
    y += chipH
  })
  const H = Math.max(1, Math.ceil(y + 2))
  return { source: doc(W, H, out.join('')), height: H }
}
