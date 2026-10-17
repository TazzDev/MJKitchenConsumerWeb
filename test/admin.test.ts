import { describe, expect, it } from 'vitest'
import { createSession, findUser, parseUsers, passwordMatches, readSessionCookie, verifySession } from '../server/auth'
import { canMove, parsePincodes, SETTING_RULES } from '../src/shared/admin'

describe('admin logins', () => {
  const users = parseUsers('Thomson:long-password-1, Mary:another-pass\nshort:1234, broken')

  it('reads name:password pairs and skips short passwords', () => {
    expect(users.map((u) => u.name)).toEqual(['Thomson', 'Mary'])
    expect(findUser(users, ' thomson ')?.name).toBe('Thomson')
  })

  it('checks passwords', async () => {
    expect(await passwordMatches(users[0], 'long-password-1')).toBe(true)
    expect(await passwordMatches(users[0], 'long-password-2')).toBe(false)
  })

  it('accepts its own session and rejects tampered, expired or revoked ones', async () => {
    const now = new Date('2026-10-17T10:00:00Z')
    const { token } = await createSession(users[1], now)
    expect((await verifySession(users, token, now))?.name).toBe('Mary')
    expect(await verifySession(users, token.slice(0, -2) + 'xx', now)).toBeNull()
    expect(await verifySession(users, token, new Date('2026-12-01T00:00:00Z'))).toBeNull()
    // Changing Mary's password signs her out; Thomson is unaffected.
    expect(await verifySession(parseUsers('Thomson:long-password-1, Mary:new-password'), token, now)).toBeNull()
    expect(readSessionCookie(`a=1; mjk_admin=${token}; b=2`)).toBe(token)
  })
})

describe('order status changes', () => {
  it('allows the owner flow and blocks skipping payment checks backwards', () => {
    expect(canMove('payment_submitted', 'confirmed')).toBe(true)
    expect(canMove('confirmed', 'out_for_delivery')).toBe(true)
    expect(canMove('expired', 'confirmed')).toBe(true)
    expect(canMove('delivered', 'cancelled')).toBe(false)
    expect(canMove('payment_submitted', 'delivered')).toBe(false)
  })
})

describe('settings and pincodes', () => {
  it('validates values', () => {
    expect(SETTING_RULES.fssai_number('')).toBeNull()
    expect(SETTING_RULES.fssai_number('12345678901234')).toBeNull()
    expect(SETTING_RULES.fssai_number('1234')).not.toBeNull()
    expect(SETTING_RULES.upi_id('thomsonbingo@oksbi')).toBeNull()
    expect(SETTING_RULES.upi_id('not an id')).not.toBeNull()
    expect(SETTING_RULES.meal_min_days_ahead('0')).not.toBeNull()
    expect(SETTING_RULES.meal_cutoff_time('20:00')).toBeNull()
    expect(SETTING_RULES.alert_email('a@b.com, c@d.in')).toBeNull()
  })

  it('splits pincode lists', () => {
    expect(parsePincodes('500001, 500002\n500003 500001')).toEqual(['500001', '500002', '500003'])
  })
})
