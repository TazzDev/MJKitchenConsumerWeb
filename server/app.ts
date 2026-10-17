import { Hono } from 'hono'
import { isDateOpen, isIsoDate } from '../src/shared/dates'
import { buildQuote, MAX_QTY } from '../src/shared/quote'
import { SLOTS, type MenuResponse, type QuoteRequest, type Slot } from '../src/shared/types'
import { cutoffRule, loadMealDates, loadMealPortions, loadProducts, loadSettings, loadZones, shopInfo, type Env } from './db'

const app = new Hono<{ Bindings: Env }>().basePath('/api')

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Something went wrong. Please try again.' }, 500)
})

app.get('/health', (c) => c.json({ ok: true }))

app.get('/menu', async (c) => {
  const db = c.env.DB
  const now = new Date()
  const settings = await loadSettings(db)
  const [products, mealDates] = await Promise.all([loadProducts(db), loadMealDates(db, now, settings)])
  const body: MenuResponse = { shop: shopInfo(settings), products, mealDates }
  c.header('Cache-Control', 'no-store')
  return c.json(body)
})

app.post('/quote', async (c) => {
  const req = parseQuoteRequest(await c.req.json().catch(() => null))
  if (!req) return c.json({ error: 'Invalid cart.' }, 400)
  const db = c.env.DB
  const settings = await loadSettings(db)
  const shop = shopInfo(settings)
  const [products, zones] = await Promise.all([loadProducts(db), loadZones(db)])
  let mealDateOpen = false
  let mealPortions = {}
  if (req.mealDate && req.mealSlot) {
    mealDateOpen = isDateOpen(req.mealDate, new Date(), cutoffRule(shop))
    if (mealDateOpen) mealPortions = (await loadMealPortions(db, [req.mealDate])).get(req.mealDate)?.[req.mealSlot] ?? {}
  }
  return c.json(buildQuote(req, { shop, products, zones, mealDateOpen, mealPortions }))
})

export function parseQuoteRequest(body: unknown): QuoteRequest | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (!Array.isArray(b.items) || b.items.length > 50) return null
  const items = []
  for (const it of b.items) {
    if (!it || typeof it !== 'object') return null
    const { variantId, qty } = it as Record<string, unknown>
    if (typeof variantId !== 'string' || variantId.length > 100 || typeof qty !== 'number') return null
    items.push({ variantId, qty: Math.min(qty, MAX_QTY + 1) })
  }
  const pincode = typeof b.pincode === 'string' ? b.pincode.slice(0, 10) : undefined
  const mealDate = isIsoDate(b.mealDate) ? b.mealDate : undefined
  const mealSlot = SLOTS.includes(b.mealSlot as Slot) ? (b.mealSlot as Slot) : undefined
  return { items, pincode, mealDate, mealSlot }
}

export default app
