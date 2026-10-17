import { describe, expect, it } from 'vitest'
import { buildQuote, type QuoteContext } from '../src/shared/quote'
import type { Product } from '../src/shared/types'

const products: Product[] = [
  { id: 'chicken-pickle', category: 'pickle', name: 'Chicken Pickle', description: '', spiceLevel: 2, isVeg: false, icon: null, imageUrl: null,
    variants: [{ id: 'cp-400', label: '400 g', pricePaise: 40000, weightG: 400, stock: null }] },
  { id: 'prawn-pickle', category: 'pickle', name: 'Prawns Pickle', description: '', spiceLevel: 2, isVeg: false, icon: null, imageUrl: null,
    variants: [{ id: 'pp-400', label: '400 g', pricePaise: 40000, weightG: 400, stock: 2 }] },
  { id: 'biriyani', category: 'meal', name: 'Chicken Biriyani', description: '', spiceLevel: 2, isVeg: false, icon: null, imageUrl: null,
    variants: [{ id: 'bir-1', label: 'Per meal', pricePaise: 25000, weightG: null, stock: null }] },
]

const ctx = (over: Partial<QuoteContext> = {}): QuoteContext => ({
  shop: { open: true, closedMessage: 'Closed', freeDeliveryAbovePaise: null },
  products,
  zones: [
    { id: 'central', name: 'Central', pincodes: ['500001'], feePaise: 4000, allowsMeals: true },
    { id: 'outer', name: 'Outer', pincodes: ['500097'], feePaise: 8000, allowsMeals: false },
  ],
  mealDateOpen: true,
  mealPortions: { biriyani: 5 },
  ...over,
})

const codes = (q: ReturnType<typeof buildQuote>) => q.problems.map((p) => p.code)

describe('buildQuote', () => {
  it('prices a pickle order with the zone delivery fee', () => {
    const q = buildQuote({ items: [{ variantId: 'cp-400', qty: 2 }], pincode: '500001' }, ctx())
    expect(q).toMatchObject({ ok: true, subtotalPaise: 80000, deliveryFeePaise: 4000, totalPaise: 84000, hasMeals: false })
  })
  it('is not ok without a pincode, but still prices the cart', () => {
    const q = buildQuote({ items: [{ variantId: 'cp-400', qty: 1 }] }, ctx())
    expect(q.ok).toBe(false)
    expect(q.deliveryFeePaise).toBeNull()
    expect(q.problems).toEqual([])
  })
  it('rejects pincodes outside the zones', () => {
    expect(codes(buildQuote({ items: [{ variantId: 'cp-400', qty: 1 }], pincode: '600001' }, ctx()))).toEqual(['pincode_outside'])
    expect(codes(buildQuote({ items: [{ variantId: 'cp-400', qty: 1 }], pincode: '5000' }, ctx()))).toEqual(['pincode_invalid'])
  })
  it('checks stock and unknown items', () => {
    const q = buildQuote({ items: [{ variantId: 'pp-400', qty: 3 }, { variantId: 'gone', qty: 1 }], pincode: '500001' }, ctx())
    expect(codes(q)).toEqual(['not_enough_stock', 'unknown_item'])
  })
  it('rejects bad quantities', () => {
    expect(codes(buildQuote({ items: [{ variantId: 'cp-400', qty: 0 }] }, ctx()))).toContain('bad_quantity')
    expect(codes(buildQuote({ items: [{ variantId: 'cp-400', qty: 1.5 }] }, ctx()))).toContain('bad_quantity')
    expect(codes(buildQuote({ items: [{ variantId: 'cp-400', qty: 21 }] }, ctx()))).toContain('bad_quantity')
  })
  it('needs a date and slot for meals, and respects portions and cutoff', () => {
    const items = [{ variantId: 'bir-1', qty: 2 }]
    expect(codes(buildQuote({ items, pincode: '500001' }, ctx()))).toEqual(['meal_date_required'])
    const base = { items, pincode: '500001', mealDate: '2026-10-18', mealSlot: 'lunch' as const }
    expect(buildQuote(base, ctx()).ok).toBe(true)
    expect(codes(buildQuote(base, ctx({ mealDateOpen: false })))).toEqual(['meal_date_closed'])
    expect(codes(buildQuote(base, ctx({ mealPortions: {} })))).toEqual(['meal_not_available'])
    expect(codes(buildQuote(base, ctx({ mealPortions: { biriyani: 1 } })))).toEqual(['not_enough_portions'])
  })
  it('blocks meals to zones that only take pickles', () => {
    const q = buildQuote({ items: [{ variantId: 'bir-1', qty: 1 }], pincode: '500097', mealDate: '2026-10-18', mealSlot: 'dinner' }, ctx())
    expect(codes(q)).toEqual(['zone_no_meals'])
  })
  it('applies free delivery above the threshold when switched on', () => {
    const q = buildQuote({ items: [{ variantId: 'cp-400', qty: 3 }], pincode: '500001' }, ctx({ shop: { open: true, closedMessage: '', freeDeliveryAbovePaise: 100000 } }))
    expect(q.deliveryFeePaise).toBe(0)
    expect(q.totalPaise).toBe(120000)
  })
  it('refuses orders while the shop is closed', () => {
    expect(codes(buildQuote({ items: [{ variantId: 'cp-400', qty: 1 }], pincode: '500001' }, ctx({ shop: { open: false, closedMessage: 'Back Monday', freeDeliveryAbovePaise: null } })))).toEqual(['shop_closed'])
  })
})
