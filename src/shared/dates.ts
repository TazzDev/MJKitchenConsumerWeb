// All shop dates are Hyderabad dates (IST, UTC+5:30, no daylight saving).

const IST_OFFSET_MIN = 330
const DAY_MS = 86_400_000

/** "YYYY-MM-DD" for the Hyderabad calendar date at `now`. */
export function istToday(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * DAY_MS).toISOString().slice(0, 10)
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay()
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'))
}

export interface CutoffRule {
  /** "HH:MM", Hyderabad time */
  cutoffTime: string
  /** Days before the delivery date that ordering closes. Clamped to at least 1. */
  minDaysAhead: number
}

/** The moment orders close for `date`: cutoffTime on (date − minDaysAhead), IST. */
export function closesAt(date: string, rule: CutoffRule): Date {
  const days = Math.max(1, Math.floor(rule.minDaysAhead))
  const [h, m] = rule.cutoffTime.split(':').map(Number)
  const minutes = (h || 0) * 60 + (m || 0)
  const midnightUtcOfIstDate = Date.parse(date + 'T00:00:00Z') - IST_OFFSET_MIN * 60_000
  return new Date(midnightUtcOfIstDate - days * DAY_MS + minutes * 60_000)
}

export function isDateOpen(date: string, now: Date, rule: CutoffRule): boolean {
  return date > istToday(now) && now.getTime() < closesAt(date, rule).getTime()
}

/** Dates from tomorrow up to `maxDaysAhead` that are still open for orders. */
export function openDates(now: Date, rule: CutoffRule, maxDaysAhead: number): string[] {
  const today = istToday(now)
  const out: string[] = []
  for (let i = 1; i <= maxDaysAhead; i++) {
    const d = addDays(today, i)
    if (isDateOpen(d, now, rule)) out.push(d)
  }
  return out
}

const fmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
/** "2026-10-18" → "Sun, 18 Oct" */
export function formatDate(date: string): string {
  return fmt.format(new Date(date + 'T00:00:00Z'))
}
