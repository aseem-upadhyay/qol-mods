/**
 * The pictures, for the surfaces that draw `Svg` (the desktop app, VS Code,
 * mobile): the share of the day by repo, a row of the day's timeline, its
 * hour axis, and a repo's dot.
 *
 * An Svg is drawn as an image, outside the app's theme: prefers-color-scheme
 * inside it follows the operating system. So the pictures carry marks, not
 * words: names and durations stay in Text beside them, in the person's own
 * theme. The marks take the light or the dark steps of one validated
 * categorical palette, and the axis labels a mid-gray that reads on both.
 */

/** The categorical palette, in its validated order (dataviz references/palette.md). */
export const LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
export const DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, Helvetica, Arial, sans-serif"
const MUTED = '#8b8b8b'
const TRACK = 'rgba(128,128,128,0.18)'
const GRID = 'rgba(128,128,128,0.16)'
/** Gap between touching fills, so neighbours never merge. */
const GAP = 2

function css(): string {
  const light = LIGHT.map((c, i) => `.s${i}{fill:${c}}`).join('')
  const dark = DARK.map((c, i) => `.s${i}{fill:${c}}`).join('')
  return `text{font-family:${SANS};font-variant-numeric:tabular-nums;font-size:10px;fill:${MUTED}}${light}@media (prefers-color-scheme: dark){${dark}}`
}

function doc(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${css()}</style>${body}</svg>`
}

function n(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Local "HH:MM" of `minute` minutes after a day that starts at `dayStart` minutes past midnight. */
export function clock(minute: number, dayStart: number): string {
  const m = (((minute + dayStart) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** A repo's dot, in its palette slot. */
export function dotSvg(slot: number, size = 10): string {
  const r = size / 2
  return doc(size, size, `<circle class="s${slot % 8}" cx="${r}" cy="${r}" r="${r - 1}"/>`)
}

/** The day split by repo: one bar, a segment per repo in its slot, 2px apart. */
export function shareSvg(parts: { slot: number; minutes: number; name: string }[], width: number, height = 10): string {
  const total = parts.reduce((a, p) => a + p.minutes, 0)
  if (total <= 0) return doc(width, height, `<rect width="${width}" height="${height}" rx="4" fill="${TRACK}"/>`)
  const shown = parts.filter(p => p.minutes > 0)
  const room = width - GAP * (shown.length - 1)
  let x = 0
  const rects = shown.map(p => {
    const w = Math.max(2, (p.minutes / total) * room)
    const rect = `<rect class="s${p.slot % 8}" x="${n(x)}" width="${n(w)}" height="${height}" rx="3"><title>${esc(p.name)}</title></rect>`
    x += w + GAP
    return rect
  })
  return doc(width, height, rects.join(''))
}

export type Range = { from: number; to: number; dayStart: number }

/** Where the hour ticks go: every hour on a short day, every two or three on a long one. */
export function ticks(range: Range): number[] {
  const hours = (range.to - range.from) / 60
  const step = hours <= 8 ? 60 : hours <= 14 ? 120 : 180
  const out: number[] = []
  for (let m = Math.ceil(range.from / 60) * 60; m <= range.to; m += step) out.push(m)
  return out
}

/** The hour labels over the timeline's rows. */
export function axisSvg(range: Range, width: number, height = 14): string {
  const x = (m: number) => ((m - range.from) / (range.to - range.from)) * width
  const labels = ticks(range).map(m => {
    const at = x(m)
    const anchor = at < 12 ? 'start' : at > width - 12 ? 'end' : 'middle'
    return `<text x="${n(at)}" y="${height - 3}" text-anchor="${anchor}">${clock(m, range.dayStart).slice(0, 2)}</text>`
  })
  return doc(width, height, labels.join(''))
}

/**
 * One group's row of the timeline: a faint track with the hour grid, the
 * stretches Claude worked alone as a pale wash, and the attended stretches
 * solid on top. Each stretch says its times on hover.
 */
export function stripSvg(
  spans: [number, number][],
  alone: [number, number][],
  slot: number,
  range: Range,
  width: number,
  height = 12,
): string {
  const span = range.to - range.from
  const x = (m: number) => ((Math.min(Math.max(m, range.from), range.to) - range.from) / span) * width
  const grid = ticks(range)
    .map(m => `<line x1="${n(x(m))}" x2="${n(x(m))}" y1="0" y2="${height}" stroke="${GRID}" stroke-width="1"/>`)
    .join('')
  const track = `<rect y="${n(height / 2 - 0.5)}" width="${width}" height="1" fill="${TRACK}"/>`
  const bar = (s: [number, number], extra: string, label: string) => {
    const x0 = x(s[0])
    const w = Math.max(2, x(s[1]) - x0)
    const tip = `${clock(s[0], range.dayStart)}–${clock(s[1], range.dayStart)}${label}`
    return `<rect class="s${slot % 8}" x="${n(x0)}" width="${n(w)}" height="${height}" rx="2"${extra}><title>${tip}</title></rect>`
  }
  const washes = alone.map(s => bar(s, ' fill-opacity="0.28"', ', Claude alone')).join('')
  const solids = spans.map(s => bar(s, '', '')).join('')
  return doc(width, height, grid + track + washes + solids)
}
