import { describe, expect, it } from 'vitest'
import { closesAt } from '../src/shared/dates'
import { expiresAt, normalisePhone, normaliseUtr, orderCode, ORDER_CODE_RE, paymentProof, upiLink, UTR_RE } from '../src/shared/orders'

const rule = { cutoffTime: '20:00', minDaysAhead: 1 }

describe('upiLink', () => {
  it('builds a standard upi://pay link with amount and order number', () => {
    expect(upiLink({ upiId: 'thomsonbingo@oksbi', payeeName: 'Thomson Martin' }, 84000, 'MJ-1018-9472')).toBe(
      'upi://pay?pa=thomsonbingo%40oksbi&pn=Thomson%20Martin&am=840.00&cu=INR&tn=MJ%20Kitchen%20MJ-1018-9472',
    )
  })
  it('keeps paise', () => {
    expect(upiLink({ upiId: 'a@b', payeeName: 'A' }, 12550, 'MJ-0101-0001')).toContain('am=125.50')
  })
})

describe('expiresAt', () => {
  const now = new Date('2026-10-17T06:30:00Z') // noon IST
  it('is the timeout for pickle-only orders', () => {
    expect(expiresAt(now, 120, null, rule).toISOString()).toBe('2026-10-17T08:30:00.000Z')
  })
  it('is the meal date cutoff when that comes first', () => {
    const late = new Date('2026-10-17T13:30:00Z') // 7 pm IST, cutoff for the 18th is 8 pm
    expect(expiresAt(late, 120, '2026-10-18', rule).getTime()).toBe(closesAt('2026-10-18', rule).getTime())
  })
  it('never goes below 10 minutes', () => {
    expect(expiresAt(now, 0, null, rule).getTime() - now.getTime()).toBe(10 * 60_000)
  })
})

describe('order helpers', () => {
  it('makes MJ-MMDD-NNNN codes', () => {
    expect(orderCode('2026-10-17', 42)).toBe('MJ-1017-0042')
    expect(ORDER_CODE_RE.test(orderCode('2026-01-05', 9999))).toBe(true)
  })
  it('cleans phone numbers and UTRs', () => {
    expect(normalisePhone('+91 98765 43210')).toBe('9876543210')
    expect(normalisePhone('098765-43210')).toBe('9876543210')
    expect(UTR_RE.test(normaliseUtr('1234 5678-9012'))).toBe(true)
    expect(UTR_RE.test(normaliseUtr('12345'))).toBe(false)
  })
  it('records which proof the customer gave', () => {
    expect(paymentProof('123456789012', true)).toBe('both')
    expect(paymentProof('123456789012', false)).toBe('utr')
    expect(paymentProof(null, true)).toBe('screenshot')
    expect(paymentProof(null, false)).toBe('none')
  })
})
