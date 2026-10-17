import { closesAt, openDates, weekday, type CutoffRule } from '../src/shared/dates'
import type { Zone } from '../src/shared/quote'
import type { MealDate, MealPortions, Product, ShopInfo, Slot } from '../src/shared/types'

export interface Env {
  DB: D1Database
  /** Optional R2 bucket for payment screenshots (see docs/cloudflare-setup.md). */
  SCREENSHOTS?: R2Bucket
  /** Worker secrets, set in the Cloudflare dashboard. All optional. */
  RESEND_API_KEY?: string
  TURNSTILE_SECRET?: string
}

type Row = Record<string, unknown>

export async function loadSettings(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()
  return Object.fromEntries(results.map((r) => [r.key, r.value]))
}

export function shopInfo(s: Record<string, string>): ShopInfo {
  const free = s.free_delivery_above_paise
  return {
    open: s.shop_open !== '0',
    closedMessage: s.shop_closed_message || 'We are closed right now.',
    whatsapp: s.contact_whatsapp ?? '',
    phone: s.contact_phone ?? '',
    instagram: s.instagram_handle ?? '',
    fssai: s.fssai_number ?? '',
    freeDeliveryAbovePaise: free ? Number(free) : null,
    mealCutoffTime: s.meal_cutoff_time || '20:00',
    mealMinDaysAhead: Math.max(1, Number(s.meal_min_days_ahead) || 1),
    orderingOpen: Boolean(s.upi_id?.trim() && s.upi_payee_name?.trim()),
    turnstileSiteKey: s.turnstile_site_key?.trim() || null,
  }
}

export function cutoffRule(shop: ShopInfo): CutoffRule {
  return { cutoffTime: shop.mealCutoffTime, minDaysAhead: shop.mealMinDaysAhead }
}

export function maxDaysAhead(s: Record<string, string>): number {
  return Math.min(60, Math.max(1, Number(s.meal_max_days_ahead) || 14))
}

export async function loadProducts(db: D1Database): Promise<Product[]> {
  const [products, variants] = await db.batch<Row>([
    db.prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY sort_order, name'),
    db.prepare('SELECT * FROM variants WHERE is_active = 1 ORDER BY sort_order, price_paise'),
  ])
  return products.results.map((p) => ({
    id: String(p.id),
    category: p.category as Product['category'],
    name: String(p.name),
    description: String(p.description ?? ''),
    spiceLevel: Number(p.spice_level ?? 0),
    isVeg: Boolean(p.is_veg),
    icon: (p.icon as string | null) ?? null,
    imageUrl: (p.image_key as string | null) ?? null,
    variants: variants.results
      .filter((v) => v.product_id === p.id)
      .map((v) => ({
        id: String(v.id),
        label: String(v.label),
        pricePaise: Number(v.price_paise),
        weightG: v.weight_g == null ? null : Number(v.weight_g),
        stock: v.stock == null ? null : Number(v.stock),
      })),
  })).filter((p) => p.variants.length > 0)
}

export async function loadZones(db: D1Database): Promise<Zone[]> {
  const { results } = await db.prepare('SELECT * FROM delivery_zones WHERE is_active = 1').all<Row>()
  return results.map((z) => ({
    id: String(z.id),
    name: String(z.name),
    pincodes: String(z.pincodes).split(',').map((s) => s.trim()).filter(Boolean),
    feePaise: Number(z.fee_paise),
    allowsMeals: Boolean(z.allows_meals),
  }))
}

/**
 * Portions left per meal for each date and slot. The weekly schedule gives the
 * default; a meal_availability row for a date overrides it and records bookings.
 */
export async function loadMealPortions(db: D1Database, dates: string[]): Promise<Map<string, Partial<Record<Slot, MealPortions>>>> {
  const out = new Map<string, Partial<Record<Slot, MealPortions>>>()
  if (dates.length === 0) return out
  const [schedule, overrides] = await db.batch<Row>([
    db.prepare(`SELECT s.product_id, s.weekday, s.slot, s.max_portions FROM meal_schedule s
                JOIN products p ON p.id = s.product_id WHERE p.is_active = 1 AND p.category = 'meal'`),
    db.prepare(`SELECT product_id, date, slot, max_portions, booked_portions FROM meal_availability
                WHERE date IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(dates)),
  ])
  for (const date of dates) {
    const wd = weekday(date)
    const slots: Partial<Record<Slot, MealPortions>> = {}
    // key "slot|productId" → [max, booked]
    const cap = new Map<string, [number, number]>()
    for (const r of schedule.results) {
      if (Number(r.weekday) === wd) cap.set(`${r.slot}|${r.product_id}`, [Number(r.max_portions), 0])
    }
    for (const r of overrides.results) {
      if (r.date === date) cap.set(`${r.slot}|${r.product_id}`, [Number(r.max_portions), Number(r.booked_portions)])
    }
    for (const [key, [max, booked]] of cap) {
      if (max <= 0) continue // not cooked that day
      const [slot, productId] = key.split('|') as [Slot, string]
      ;(slots[slot] ??= {})[productId] = Math.max(0, max - booked)
    }
    out.set(date, slots)
  }
  return out
}

export async function loadMealDates(db: D1Database, now: Date, settings: Record<string, string>): Promise<MealDate[]> {
  const rule = cutoffRule(shopInfo(settings))
  const dates = openDates(now, rule, maxDaysAhead(settings))
  const portions = await loadMealPortions(db, dates)
  return dates
    .map((date) => ({ date, closesAt: closesAt(date, rule).toISOString(), slots: portions.get(date) ?? {} }))
    .filter((d) => Object.keys(d.slots).length > 0)
}
