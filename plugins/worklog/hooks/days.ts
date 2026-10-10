/**
 * Calendar dates as YYYY-MM-DD strings, and durations. Dates are worked on as
 * UTC calendar days: scan.py says which day today is in the user's own zone,
 * so nothing here needs to know it.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_MS = 24 * 60 * 60 * 1000

export const DATE = /^\d{4}-\d{2}-\d{2}$/

function parts(date: string): Date {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function addDays(date: string, n: number): string {
  return new Date(parts(date).getTime() + n * DAY_MS).toISOString().slice(0, 10)
}

/** Sunday 0. */
export function weekday(date: string): number {
  return parts(date).getUTCDay()
}

/** "Fri 9 Oct", or "Friday 9 October 2026" when `long`. */
export function dayLabel(date: string, long = false): string {
  const d = parts(date)
  const w = WEEKDAYS[d.getUTCDay()] ?? ''
  const m = MONTHS[d.getUTCMonth()] ?? ''
  return long ? `${w} ${d.getUTCDate()} ${m} ${d.getUTCFullYear()}` : `${w.slice(0, 3)} ${d.getUTCDate()} ${m.slice(0, 3)}`
}

/** "2h 5m", "2h", "45m". */
export function duration(min: number): string {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60)
  if (!h) return `${m}m`
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}

/**
 * The days a standup covers: from the last work day before `today` up to
 * yesterday, so Monday's covers Friday and anything done at the weekend.
 * At most a week back.
 */
export function standupDays(today: string, workDays: Set<number>): string[] {
  const out: string[] = []
  for (let back = 1; back <= 7; back++) {
    const date = addDays(today, -back)
    out.unshift(date)
    if (workDays.has(weekday(date)) || workDays.size === 0) break
  }
  return out
}
