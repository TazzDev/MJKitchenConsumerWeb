import { Hono } from 'hono'
import { isDateOpen, isIsoDate } from '../src/shared/dates'
import { buildQuote, MAX_QTY } from '../src/shared/quote'
import { SLOTS, type MenuResponse, type QuoteRequest, type Slot } from '../src/shared/types'
import { ORDER_CODE_RE, normalisePhone, type CreateOrderRequest } from '../src/shared/orders'
import { cutoffRule, loadMealDates, loadMealPortions, loadProducts, loadSettings, loadZones, shopInfo, type Env } from './db'
import admin from './admin'
import { sendOwnerEmail } from './email'
import { createOrder, findOrder, newOrderEmail, OrderError, orderView, paidEmail, submitPayment, verifyTurnstile } from './orders'

const app = new Hono<{ Bindings: Env }>().basePath('/api')

app.onError((err, c) => {
  if (err instanceof OrderError) return c.json({ error: err.message, problems: err.problems }, err.status)
  console.error(err)
  return c.json({ error: 'Something went wrong. Please try again.' }, 500)
})

app.get('/health', (c) => c.json({ ok: true }))

app.route('/admin', admin)

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

app.post('/orders', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Partial<CreateOrderRequest> | null
  const req = parseQuoteRequest(body)
  if (!body || !req) return c.json({ error: 'Invalid order.' }, 400)
  if (!(await verifyTurnstile(c.env, body.turnstileToken, c.req.header('CF-Connecting-IP') ?? null))) {
    return c.json({ error: 'Please wait a moment for the security check, then tap Place order again.', problems: [] }, 403)
  }
  const order = await createOrder(c.env, req.items, req.mealDate, req.mealSlot, body)
  const url = statusUrl(c.req.url, order.code, order.key)
  c.executionCtx.waitUntil(sendOwnerEmail(c.env, order.settings, newOrderEmail(order, url)).catch(console.error))
  return c.json({ code: order.code, key: order.key }, 201)
})

app.get('/orders/:code', async (c) => {
  const row = await orderFromLink(c.env, c.req.param('code'), c.req.query('k'))
  if (!row) return c.json({ error: "We couldn't find that order. Check the link, or find it with your phone number." }, 404)
  c.header('Cache-Control', 'no-store')
  return c.json(await orderView(c.env, row))
})

app.post('/orders/:code/payment', async (c) => {
  const row = await orderFromLink(c.env, c.req.param('code'), c.req.query('k'))
  if (!row) return c.json({ error: "We couldn't find that order." }, 404)
  const form = await c.req.formData().catch(() => null)
  const utr = typeof form?.get('utr') === 'string' ? String(form!.get('utr')).slice(0, 30) : ''
  const shot = form?.get('screenshot')
  const screenshot = shot && typeof shot !== 'string' ? (shot as File) : null
  await submitPayment(c.env, row, { utr, screenshot })
  const fresh = (await findOrder(c.env, String(row.public_code), String(row.access_key)))!
  const settings = await loadSettings(c.env.DB)
  const url = statusUrl(c.req.url, String(row.public_code), String(row.access_key))
  c.executionCtx.waitUntil(sendOwnerEmail(c.env, settings, paidEmail(fresh, String(fresh.utr ?? ''), Boolean(fresh.screenshot_key), url)).catch(console.error))
  return c.json(await orderView(c.env, fresh))
})

// Lost the link? Order number + the phone number used at checkout finds it again.
app.post('/orders/find', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { code?: unknown; phone?: unknown }
  const code = typeof b.code === 'string' ? b.code.trim().toUpperCase() : ''
  const phone = normalisePhone(typeof b.phone === 'string' ? b.phone : '')
  const row = ORDER_CODE_RE.test(code)
    ? await c.env.DB.prepare('SELECT public_code, access_key FROM orders WHERE public_code = ? AND phone = ?').bind(code, phone).first<Record<string, string>>()
    : null
  if (!row) return c.json({ error: "We couldn't find an order with that number and phone. Please check both." }, 404)
  return c.json({ code: row.public_code, key: row.access_key })
})

async function orderFromLink(env: Env, code: string, key: string | undefined) {
  if (!ORDER_CODE_RE.test(code) || !key || key.length > 64) return null
  return findOrder(env, code, key)
}

function statusUrl(requestUrl: string, code: string, key: string): string {
  return `${new URL(requestUrl).origin}/order/${code}?k=${encodeURIComponent(key)}`
}

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
