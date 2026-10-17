import { describe, expect, it } from 'vitest'
import { addDays, closesAt, isDateOpen, istToday, openDates, weekday } from '../src/shared/dates'

const rule = { cutoffTime: '20:00', minDaysAhead: 1 }
// 17 Oct 2026 19:59 IST = 14:29 UTC
const at = (iso: string) => new Date(iso)

describe('IST dates', () => {
  it('uses the Hyderabad calendar date', () => {
    expect(istToday(at('2026-10-17T18:29:00Z'))).toBe('2026-10-17') // 23:59 IST
    expect(istToday(at('2026-10-17T18:31:00Z'))).toBe('2026-10-18') // 00:01 IST next day
  })
  it('adds days and finds weekdays', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(weekday('2026-10-18')).toBe(0) // Sunday
  })
})

describe('meal cutoff', () => {
  it('closes tomorrow at 8 pm IST today', () => {
    expect(closesAt('2026-10-18', rule).toISOString()).toBe('2026-10-17T14:30:00.000Z')
    expect(isDateOpen('2026-10-18', at('2026-10-17T14:29:00Z'), rule)).toBe(true)
    expect(isDateOpen('2026-10-18', at('2026-10-17T14:30:00Z'), rule)).toBe(false)
  })
  it('never allows today, even with a zero or negative minimum', () => {
    const now = at('2026-10-17T03:00:00Z')
    expect(isDateOpen('2026-10-17', now, { cutoffTime: '23:59', minDaysAhead: 0 })).toBe(false)
    expect(closesAt('2026-10-18', { cutoffTime: '20:00', minDaysAhead: -3 }).toISOString()).toBe('2026-10-17T14:30:00.000Z')
  })
  it('supports a longer lead time', () => {
    const two = { cutoffTime: '18:00', minDaysAhead: 2 }
    const now = at('2026-10-17T10:00:00Z') // 15:30 IST
    expect(openDates(now, two, 4)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21'])
  })
  it('lists open dates from tomorrow after the cutoff drops it', () => {
    expect(openDates(at('2026-10-17T15:00:00Z'), rule, 3)).toEqual(['2026-10-19', '2026-10-20'])
  })
})
