import { describe, expect, it } from 'vitest'
import { canChangeDate, planDateMove, type MoveCheck } from '../src/shared/admin'
import { closesAt } from '../src/shared/dates'
import { dateMoveNote, movedExpiresAt, parseDateMove } from '../src/shared/orders'

// Sat 24 Oct lunch → Sun 25 Oct dinner, decided on Tue 20 Oct.
const base: MoveCheck = {
  status: 'confirmed',
  hasMeals: true,
  current: { date: '2026-10-24', slot: 'lunch' },
  target: { date: '2026-10-25', slot: 'dinner' },
  today: '2026-10-20',
  dishes: [
    { productId: 'chicken', name: 'Chicken Pothichoru', qty: 2, max: 15, booked: 5 },
    { productId: 'veg', name: 'Veg Pothichoru', qty: 1, max: 15, booked: 0 },
  ],
  mealSlot: true,
  openForCustomers: true,
  shopOpen: true,
  kitchenSheetLastDate: '2026-10-20',
}
const plan = (c: Partial<MoveCheck>) => planDateMove({ ...base, ...c })

describe('changing an order date', () => {
  it('moves a normal order with no warnings and books its dishes', () => {
    expect(plan({})).toEqual({ error: null, warnings: [], short: [], track: ['chicken', 'veg'] })
  })

  it('only allows open meal orders', () => {
    expect(canChangeDate('preparing', true)).toBe(true)
    expect(canChangeDate('expired', true)).toBe(true)
    expect(canChangeDate('out_for_delivery', true)).toBe(false)
    expect(canChangeDate('delivered', true)).toBe(false)
    expect(canChangeDate('cancelled', true)).toBe(false)
    expect(canChangeDate('confirmed', false)).toBe(false)
    expect(plan({ status: 'delivered' }).error).toMatch(/can’t be moved/)
    expect(plan({ hasMeals: false }).error).toMatch(/Pickle-only/)
  })

  it('blocks past dates and the same date and slot', () => {
    expect(plan({ target: { date: '2026-10-19', slot: 'lunch' } }).error).toBe('That date has passed.')
    expect(plan({ target: base.current }).error).toMatch(/already/)
    // Same day, other slot is fine.
    expect(plan({ target: { date: '2026-10-24', slot: 'dinner' } }).error).toBeNull()
  })

  it('reports a full slot so the admin has to choose to go over the limit', () => {
    const p = plan({ dishes: [{ productId: 'chicken', name: 'Chicken Pothichoru', qty: 3, max: 15, booked: 13 }] })
    expect(p.error).toBeNull()
    expect(p.short).toEqual([{ name: 'Chicken Pothichoru', need: 3, left: 2 }])
    expect(p.track).toEqual(['chicken'])
  })

  it('warns on a non-meal day and leaves its portions uncounted', () => {
    const p = plan({
      target: { date: '2026-10-27', slot: 'lunch' },
      mealSlot: false,
      dishes: [{ productId: 'chicken', name: 'Chicken Pothichoru', qty: 2, max: 0, booked: 0 }],
    })
    expect(p.error).toBeNull()
    expect(p.warnings[0]).toMatch(/Tue lunch isn’t a meal slot/)
    expect(p.track).toEqual([])
    expect(p.short).toEqual([])
  })

  it('warns when one dish is not cooked that day', () => {
    const p = plan({ dishes: [{ productId: 'biriyani', name: 'Chicken Biriyani', qty: 1, max: 0, booked: 0 }] })
    expect(p.warnings).toEqual(['Chicken Biriyani isn’t on the menu for Sun, 25 Oct dinner. The kitchen will make it specially.'])
    expect(p.track).toEqual([])
  })

  it('warns about today, closed dates, a closed shop and kitchen sheets already sent', () => {
    expect(plan({ target: { date: '2026-10-20', slot: 'dinner' }, openForCustomers: false }).warnings).toEqual([
      'That’s today. Make sure the kitchen can still make it.',
      'The kitchen sheet email for Tue, 20 Oct has already gone out. The Kitchen screen will show this order.',
    ])
    expect(plan({ openForCustomers: false }).warnings).toEqual(['Customers can no longer order for Sun, 25 Oct. This move is allowed anyway.'])
    expect(plan({ shopOpen: false }).warnings).toEqual(['The shop is set to closed for customers.'])
    // Moving away from a date whose sheet already listed the order.
    expect(plan({ current: { date: '2026-10-21', slot: 'lunch' }, kitchenSheetLastDate: '2026-10-21' }).warnings).toEqual([
      'The kitchen sheet email for Wed, 21 Oct still lists this order. The Kitchen screen is up to date.',
    ])
  })

  it('books nothing for an expired order until it is confirmed', () => {
    const p = plan({ status: 'expired', dishes: [{ productId: 'chicken', name: 'Chicken Pothichoru', qty: 3, max: 15, booked: 15 }] })
    expect(p.track).toEqual([])
    expect(p.short).toEqual([])
  })
})

describe('date change notes', () => {
  it('round-trips the old and new date and the reason', () => {
    const m = { from: base.current, to: base.target, reason: 'Customer called · wants Sunday' }
    const note = dateMoveNote(m)
    expect(note).toBe('Date changed: 2026-10-24 lunch → 2026-10-25 dinner · Customer called · wants Sunday')
    expect(parseDateMove(note)).toEqual(m)
    expect(parseDateMove(dateMoveNote({ ...m, reason: '  ' }))).toEqual({ ...m, reason: '' })
    expect(parseDateMove('Payment not found in UPI app')).toBeNull()
  })
})

describe('movedExpiresAt', () => {
  const rule = { cutoffTime: '20:00', minDaysAhead: 1 }
  const now = new Date('2026-10-20T06:00:00Z')

  it('gives a fresh payment window, cut short by a cutoff still ahead', () => {
    expect(movedExpiresAt(now, 120, '2026-10-25', rule).toISOString()).toBe('2026-10-20T08:00:00.000Z')
    const tight = new Date('2026-10-23T13:45:00Z') // 15 minutes before Sat's cutoff
    expect(movedExpiresAt(tight, 120, '2026-10-24', rule)).toEqual(closesAt('2026-10-24', rule))
  })

  it("doesn't expire straight away when moved inside the cutoff", () => {
    const late = new Date('2026-10-20T15:00:00Z') // 8:30 pm, after ordering for the 21st closed
    expect(movedExpiresAt(late, 120, '2026-10-21', rule).toISOString()).toBe('2026-10-20T17:00:00.000Z')
  })
})
