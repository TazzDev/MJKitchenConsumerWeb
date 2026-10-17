// Server-side pricing. The storefront shows these numbers but never decides them:
// the API re-runs this on every quote (and, later, on every order).

import { formatDate } from './dates'
import { rupees } from './money'
import type { MealPortions, Problem, Product, Quote, QuoteLine, QuoteRequest, ShopInfo, Slot } from './types'

export interface Zone {
  id: string
  name: string
  pincodes: string[]
  feePaise: number
  allowsMeals: boolean
}

export interface QuoteContext {
  shop: Pick<ShopInfo, 'open' | 'closedMessage' | 'freeDeliveryAbovePaise'>
  /** Active products and variants only. */
  products: Product[]
  zones: Zone[]
  /** Whether req.mealDate is still open for orders (cutoff not passed). */
  mealDateOpen: boolean
  /** Portions left for req.mealDate + req.mealSlot; a meal missing here isn't cooked that day. */
  mealPortions: MealPortions
}

export const MAX_QTY = 20
export const PINCODE_RE = /^[1-9]\d{5}$/

export function findZone(zones: Zone[], pincode: string): Zone | undefined {
  return zones.find((z) => z.pincodes.includes(pincode))
}

export function buildQuote(req: QuoteRequest, ctx: QuoteContext): Quote {
  const problems: Problem[] = []
  const lines: QuoteLine[] = []
  const variants = new Map(ctx.products.flatMap((p) => p.variants.map((v) => [v.id, { p, v }] as const)))
  const mealQty = new Map<string, number>()

  if (!ctx.shop.open) problems.push({ code: 'shop_closed', message: ctx.shop.closedMessage })
  if (req.items.length === 0) problems.push({ code: 'empty_cart', message: 'Your cart is empty.' })

  for (const item of req.items) {
    const found = variants.get(item.variantId)
    if (!found) {
      problems.push({ code: 'unknown_item', message: 'An item in your cart is no longer on the menu.', variantId: item.variantId })
      continue
    }
    const { p, v } = found
    const name = `${p.name} (${v.label})`
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > MAX_QTY) {
      problems.push({ code: 'bad_quantity', message: `Choose between 1 and ${MAX_QTY} of ${name}.`, variantId: v.id })
      continue
    }
    if (v.stock === 0) {
      problems.push({ code: 'sold_out', message: `${name} is sold out.`, variantId: v.id })
    } else if (v.stock !== null && item.qty > v.stock) {
      problems.push({ code: 'not_enough_stock', message: `Only ${v.stock} of ${name} left.`, variantId: v.id })
    }
    if (p.category === 'meal') mealQty.set(p.id, (mealQty.get(p.id) ?? 0) + item.qty)
    lines.push({
      variantId: v.id,
      productId: p.id,
      productName: p.name,
      variantLabel: v.label,
      category: p.category,
      unitPricePaise: v.pricePaise,
      qty: item.qty,
      linePaise: v.pricePaise * item.qty,
    })
  }

  const hasMeals = mealQty.size > 0
  if (hasMeals) {
    if (!req.mealDate || !req.mealSlot) {
      problems.push({ code: 'meal_date_required', message: 'Pick a delivery date and slot for your meals.' })
    } else if (!ctx.mealDateOpen) {
      problems.push({ code: 'meal_date_closed', message: `Orders for ${formatDate(req.mealDate)} have closed. Please pick another date.` })
    } else {
      for (const [productId, qty] of mealQty) {
        const left = ctx.mealPortions[productId]
        const name = ctx.products.find((p) => p.id === productId)!.name
        const when = `${formatDate(req.mealDate)} ${slotLabel(req.mealSlot)}`
        const variantId = lines.find((l) => l.productId === productId)!.variantId
        if (left === undefined || left <= 0) {
          problems.push({ code: 'meal_not_available', message: `${name} isn't available for ${when}.`, variantId })
        } else if (qty > left) {
          problems.push({ code: 'not_enough_portions', message: `Only ${left} portions of ${name} left for ${when}.`, variantId })
        }
      }
    }
  }

  const subtotalPaise = lines.reduce((s, l) => s + l.linePaise, 0)
  let deliveryFeePaise: number | null = null
  let zone: Quote['zone'] = null
  if (req.pincode !== undefined && req.pincode !== '') {
    const pin = req.pincode.trim()
    const z = PINCODE_RE.test(pin) ? findZone(ctx.zones, pin) : undefined
    if (!PINCODE_RE.test(pin)) {
      problems.push({ code: 'pincode_invalid', message: 'Enter a 6-digit pincode.' })
    } else if (!z) {
      problems.push({ code: 'pincode_outside', message: "Sorry, we only deliver in Hyderabad for now and this pincode isn't on our list." })
    } else {
      zone = { id: z.id, name: z.name }
      if (hasMeals && !z.allowsMeals) {
        problems.push({ code: 'zone_no_meals', message: `We can't deliver meals to ${z.name} yet, only pickles.` })
      }
      const free = ctx.shop.freeDeliveryAbovePaise
      deliveryFeePaise = free !== null && subtotalPaise >= free ? 0 : z.feePaise
    }
  }

  return {
    ok: problems.length === 0 && deliveryFeePaise !== null,
    lines,
    hasMeals,
    subtotalPaise,
    deliveryFeePaise,
    totalPaise: subtotalPaise + (deliveryFeePaise ?? 0),
    zone,
    problems,
  }
}

export function slotLabel(slot: Slot): string {
  return slot === 'lunch' ? 'lunch' : 'dinner'
}

export function freeDeliveryNote(freeAbovePaise: number | null): string | null {
  return freeAbovePaise === null ? null : `Free delivery on orders above ${rupees(freeAbovePaise)}`
}
