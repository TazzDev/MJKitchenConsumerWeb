// Order creation, payment submission, expiry and the daily kitchen sheet.

import { addDays, formatDate, isDateOpen, istToday, weekday } from '../src/shared/dates'
import { rupees } from '../src/shared/money'
import {
  expiresAt,
  normalisePhone,
  normaliseUtr,
  orderCode,
  PAYABLE,
  paymentProof,
  PHONE_RE,
  STATUS_LABEL,
  upiLink,
  UTR_RE,
  type CreateOrderRequest,
  type OrderStatus,
  type OrderView,
} from '../src/shared/orders'
import { buildQuote, PINCODE_RE, slotLabel } from '../src/shared/quote'
import type { KitchenDay } from '../src/shared/admin'
import type { Category, Problem, Quote, Slot } from '../src/shared/types'
import { cutoffRule, loadMealPortions, loadProducts, loadSettings, loadZones, shopInfo, type Env } from './db'
import { esc, linesToHtml, sendOwnerEmail } from './email'

type Row = Record<string, unknown>

export class OrderError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 429 | 503,
    message: string,
    public problems: Problem[] = [],
  ) {
    super(message)
  }
}

const nowIso = (now: Date) => now.toISOString()

function randomKey(bytes = 18): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function random4(): number {
  return crypto.getRandomValues(new Uint16Array(1))[0] % 10000
}

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

/** Validates the customer's details; quote-level checks happen in buildQuote. */
export function parseCustomer(b: Partial<CreateOrderRequest>) {
  const name = clean(b.name, 80)
  const phone = normalisePhone(typeof b.phone === 'string' ? b.phone : '')
  const address = typeof b.address === 'string' ? b.address.trim().slice(0, 300) : ''
  const pincode = clean(b.pincode, 6)
  if (name.length < 2) throw new OrderError(400, 'Please enter your name.')
  if (!PHONE_RE.test(phone)) throw new OrderError(400, 'Enter a 10-digit Indian mobile number.')
  if (address.length < 10) throw new OrderError(400, 'Please enter your full address: house, street and area.')
  if (!PINCODE_RE.test(pincode)) throw new OrderError(400, 'Enter a 6-digit pincode.')
  return {
    name,
    phone,
    address,
    pincode,
    landmark: clean(b.landmark, 100),
    notes: typeof b.notes === 'string' ? b.notes.trim().slice(0, 300) : '',
    source: clean(b.source, 20).replace(/[^\w-]/g, ''),
  }
}

export async function verifyTurnstile(env: Env, token: string | undefined, ip: string | null): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true
  // Reasons go to Workers Logs, so a rejected order can be traced to a key mix-up.
  if (!token) {
    console.warn('turnstile: no token sent (is turnstile_site_key set in settings?)')
    return false
  }
  const form = new FormData()
  form.append('secret', env.TURNSTILE_SECRET)
  form.append('response', token)
  if (ip) form.append('remoteip', ip)
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
  const out = (await res.json().catch(() => ({}))) as { success?: boolean; 'error-codes'?: string[]; hostname?: string }
  if (out.success !== true) console.warn(`turnstile: rejected (${(out['error-codes'] ?? []).join(', ') || `HTTP ${res.status}`})`)
  return out.success === true
}

export interface CreatedOrder {
  id: string
  code: string
  key: string
  quote: Quote
  customer: ReturnType<typeof parseCustomer>
  mealDate: string | null
  mealSlot: Slot | null
  settings: Record<string, string>
}

export async function createOrder(
  env: Env,
  items: CreateOrderRequest['items'],
  mealDate: string | undefined,
  mealSlot: Slot | undefined,
  body: Partial<CreateOrderRequest>,
  now = new Date(),
): Promise<CreatedOrder> {
  const db = env.DB
  const settings = await loadSettings(db)
  const shop = shopInfo(settings)
  if (!shop.orderingOpen) throw new OrderError(503, "Online ordering isn't open yet. Please message us on WhatsApp to order.")
  const customer = parseCustomer(body)

  const limit = Math.max(1, Number(settings.max_open_orders_per_phone) || 3)
  const open = await db
    .prepare(`SELECT COUNT(*) AS n FROM orders WHERE phone = ? AND status = 'awaiting_payment' AND expires_at > ?`)
    .bind(customer.phone, nowIso(now))
    .first<{ n: number }>()
  if ((open?.n ?? 0) >= limit) {
    throw new OrderError(429, 'You already have unpaid orders waiting. Please pay for one of them, or message us on WhatsApp.')
  }

  // Price everything again on the server, exactly as /api/quote does.
  const rule = cutoffRule(shop)
  const [products, zones] = await Promise.all([loadProducts(db), loadZones(db)])
  let mealDateOpen = false
  let mealPortions = {}
  if (mealDate && mealSlot) {
    mealDateOpen = isDateOpen(mealDate, now, rule)
    if (mealDateOpen) mealPortions = (await loadMealPortions(db, [mealDate])).get(mealDate)?.[mealSlot] ?? {}
  }
  const quote = buildQuote({ items, pincode: customer.pincode, mealDate, mealSlot }, { shop, products, zones, mealDateOpen, mealPortions })
  if (!quote.ok || quote.deliveryFeePaise === null || !quote.zone) {
    throw new OrderError(409, quote.problems[0]?.message ?? 'Please check your order and try again.', quote.problems)
  }

  const date = quote.hasMeals ? mealDate! : null
  const slot = quote.hasMeals ? mealSlot! : null
  const id = crypto.randomUUID()
  const key = randomKey()
  const at = nowIso(now)
  const expires = expiresAt(now, Number(settings.unpaid_timeout_minutes) || 120, date, rule).toISOString()

  const reserve: D1PreparedStatement[] = []
  if (date && slot) {
    const mealQty = new Map<string, number>()
    for (const l of quote.lines) if (l.category === 'meal') mealQty.set(l.productId, (mealQty.get(l.productId) ?? 0) + l.qty)
    for (const [productId, qty] of mealQty) {
      // First booking for this date: copy the weekly default into meal_availability.
      reserve.push(
        db
          .prepare(
            `INSERT INTO meal_availability (product_id, date, slot, max_portions, booked_portions)
             SELECT product_id, ?2, slot, max_portions, 0 FROM meal_schedule WHERE product_id = ?1 AND weekday = ?3 AND slot = ?4
             ON CONFLICT DO NOTHING`,
          )
          .bind(productId, date, weekday(date), slot),
        // The meal_portions_guard trigger aborts the batch if this oversells.
        db
          .prepare(`UPDATE meal_availability SET booked_portions = booked_portions + ?4 WHERE product_id = ?1 AND date = ?2 AND slot = ?3`)
          .bind(productId, date, slot, qty),
      )
    }
  }
  for (const l of quote.lines) {
    reserve.push(db.prepare('UPDATE variants SET stock = stock - ?2 WHERE id = ?1 AND stock IS NOT NULL').bind(l.variantId, l.qty))
  }

  for (let attempt = 0; ; attempt++) {
    const code = orderCode(istToday(now), random4())
    try {
      await db.batch([
        ...reserve,
        db
          .prepare(
            `INSERT INTO orders (id, public_code, access_key, status, customer_name, phone, address, landmark, pincode, zone_id,
               has_meals, delivery_date, delivery_slot, subtotal_paise, delivery_fee_paise, total_paise, upi_id, notes, source,
               created_at, updated_at, expires_at)
             VALUES (?, ?, ?, 'awaiting_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id, code, key, customer.name, customer.phone, customer.address, customer.landmark, customer.pincode, quote.zone.id,
            quote.hasMeals ? 1 : 0, date, slot, quote.subtotalPaise, quote.deliveryFeePaise, quote.totalPaise,
            settings.upi_id.trim(), customer.notes, customer.source, at, at, expires,
          ),
        ...quote.lines.map((l) =>
          db
            .prepare(
              `INSERT INTO order_items (order_id, variant_id, product_id, category, product_name_snapshot, variant_label_snapshot, unit_price_paise, qty)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(id, l.variantId, l.productId, l.category, l.productName, l.variantLabel, l.unitPricePaise, l.qty),
        ),
        db.prepare(`INSERT INTO order_events (order_id, from_status, to_status, actor, at) VALUES (?, NULL, 'awaiting_payment', 'customer', ?)`).bind(id, at),
      ])
      return { id, code, key, quote, customer, mealDate: date, mealSlot: slot, settings }
    } catch (e) {
      const msg = String((e as Error).message ?? e)
      if (msg.includes('not_enough_portions')) {
        throw new OrderError(409, 'Sorry, those meals just sold out for that slot. Please pick another date or slot.')
      }
      if (msg.includes('not_enough_stock')) throw new OrderError(409, 'Sorry, an item in your cart just sold out.')
      if (msg.includes('public_code') && attempt < 4) continue
      throw e
    }
  }
}

export function newOrderEmail(o: CreatedOrder, statusUrl: string) {
  const q = o.quote
  const c = o.customer
  const when = o.mealDate && o.mealSlot ? `${formatDate(o.mealDate)}, ${slotLabel(o.mealSlot)}` : 'Pickles only: ship once paid'
  const lines = [
    `New order ${o.code}: ${rupees(q.totalPaise)}, waiting for payment.`,
    '',
    ...q.lines.map((l) => `${l.qty} × ${l.productName} (${l.variantLabel}): ${rupees(l.linePaise)}`),
    `Delivery (${q.zone?.name}): ${rupees(q.deliveryFeePaise ?? 0)}`,
    `Total: ${rupees(q.totalPaise)}`,
    '',
    `Delivery: ${when}`,
    `${c.name}, ${c.phone}`,
    `${c.address}${c.landmark ? ` (near ${c.landmark})` : ''}, ${c.pincode}`,
    ...(c.notes ? [`Notes: ${c.notes}`] : []),
    '',
    `WhatsApp the customer: https://wa.me/91${c.phone}`,
    `Order page: ${statusUrl}`,
    '',
    `You'll get another email when the customer says they've paid to ${o.settings.upi_id}.`,
  ]
  return { subject: `New order ${o.code} · ${rupees(q.totalPaise)} · ${c.name}`, text: lines.join('\n'), html: linesToHtml(lines) }
}

// ---------------------------------------------------------------------------
// Reading an order

async function loadOrderRow(db: D1Database, code: string): Promise<Row | null> {
  return db.prepare('SELECT * FROM orders WHERE public_code = ?').bind(code).first<Row>()
}

function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/** The order for its status link, or null when the code or key is wrong. Lapsed unpaid orders are expired on the spot. */
export async function findOrder(env: Env, code: string, key: string, now = new Date()): Promise<Row | null> {
  let row = await loadOrderRow(env.DB, code)
  if (!row || !sameKey(String(row.access_key), key)) return null
  if (row.status === 'awaiting_payment' && row.expires_at && String(row.expires_at) <= nowIso(now)) {
    await env.DB.batch(transition(env.DB, String(row.id), 'awaiting_payment', 'expired', 'system', 'Not paid in time', now, true))
    row = await loadOrderRow(env.DB, code)
  }
  return row
}

export async function orderView(env: Env, row: Row): Promise<OrderView> {
  const db = env.DB
  const [items, events, settings] = await Promise.all([
    db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid').bind(row.id).all<Row>(),
    db.prepare('SELECT from_status, to_status, at FROM order_events WHERE order_id = ? ORDER BY at, rowid').bind(row.id).all<Row>(),
    loadSettings(db),
  ])
  const status = row.status as OrderStatus
  const code = String(row.public_code)
  const total = Number(row.total_paise)
  const payee = { upiId: settings.upi_id?.trim() ?? '', payeeName: settings.upi_payee_name?.trim() ?? '' }
  const lastMove = events.results.filter(isDateMoveEvent).at(-1)
  return {
    code,
    status,
    statusLabel: STATUS_LABEL[status],
    createdAt: String(row.created_at),
    expiresAt: status === 'awaiting_payment' ? ((row.expires_at as string | null) ?? null) : null,
    customerName: String(row.customer_name),
    phone: String(row.phone),
    address: String(row.address),
    landmark: String(row.landmark ?? ''),
    pincode: String(row.pincode),
    deliveryDate: (row.delivery_date as string | null) ?? null,
    deliverySlot: (row.delivery_slot as Slot | null) ?? null,
    items: items.results.map((i) => ({
      name: String(i.product_name_snapshot),
      label: String(i.variant_label_snapshot),
      qty: Number(i.qty),
      unitPricePaise: Number(i.unit_price_paise),
    })),
    subtotalPaise: Number(row.subtotal_paise),
    deliveryFeePaise: Number(row.delivery_fee_paise),
    totalPaise: total,
    utr: (row.utr as string | null) ?? null,
    hasScreenshot: Boolean(row.screenshot_key),
    // Always the current settings, so a changed UPI ID shows up on open orders too.
    payment: PAYABLE.includes(status) && payee.upiId && payee.payeeName ? { ...payee, link: upiLink(payee, total, code) } : null,
    screenshotUpload: Boolean(env.SCREENSHOTS),
    // Date changes keep the status, so they stay out of the status timeline.
    history: events.results.filter((e) => !isDateMoveEvent(e)).map((e) => ({ status: e.to_status as OrderStatus, at: String(e.at) })),
    dateChanged: lastMove ? { at: String(lastMove.at) } : null,
  }
}

/** A date change by the owner: logged as an event that keeps the status. */
export const isDateMoveEvent = (e: Row) => e.from_status !== null && e.from_status === e.to_status

/** SQL for "this order has been moved to another date", on orders aliased `o`. */
export const DATE_CHANGED_SQL = `EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.from_status = e.to_status)`

// ---------------------------------------------------------------------------
// Status changes

/**
 * Statements that move an order from `from` to `to`, logging the change. They
 * only take effect if the order is still in `from`, so running them twice, or
 * racing another change, is harmless. With `release`, booked meal portions and
 * tracked stock go back on sale (for expiry and cancellation). `byUser` names
 * the admin who made an owner change.
 */
export function transition(
  db: D1Database,
  orderId: string,
  from: OrderStatus,
  to: OrderStatus,
  actor: 'customer' | 'owner' | 'system',
  note: string,
  now: Date,
  release = false,
  byUser: string | null = null,
): D1PreparedStatement[] {
  const at = nowIso(now)
  const still = `(SELECT status FROM orders WHERE id = ?1) = ?2`
  const out: D1PreparedStatement[] = []
  if (release) {
    out.push(
      db
        .prepare(
          `UPDATE meal_availability
           SET booked_portions = MAX(0, booked_portions - (SELECT SUM(i.qty) FROM order_items i
             WHERE i.order_id = ?1 AND i.category = 'meal' AND i.product_id = meal_availability.product_id))
           WHERE ${still}
             AND date = (SELECT delivery_date FROM orders WHERE id = ?1)
             AND slot = (SELECT delivery_slot FROM orders WHERE id = ?1)
             AND product_id IN (SELECT product_id FROM order_items WHERE order_id = ?1 AND category = 'meal')`,
        )
        .bind(orderId, from),
      db
        .prepare(
          `UPDATE variants SET stock = stock + (SELECT SUM(i.qty) FROM order_items i WHERE i.order_id = ?1 AND i.variant_id = variants.id)
           WHERE ${still} AND stock IS NOT NULL AND id IN (SELECT variant_id FROM order_items WHERE order_id = ?1)`,
        )
        .bind(orderId, from),
    )
  }
  // by_user only exists once migration 0003 has run, so customer and system
  // changes leave it out and keep working on an older database.
  out.push(
    byUser
      ? db
          .prepare(`INSERT INTO order_events (order_id, from_status, to_status, actor, note, at, by_user) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE ${still}`)
          .bind(orderId, from, to, actor, note, at, byUser)
      : db
          .prepare(`INSERT INTO order_events (order_id, from_status, to_status, actor, note, at) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE ${still}`)
          .bind(orderId, from, to, actor, note, at),
    db.prepare(`UPDATE orders SET status = ?3, updated_at = ?4 WHERE id = ?1 AND status = ?2`).bind(orderId, from, to, at),
  )
  return out
}

export interface PaymentInput {
  utr: string
  screenshot: File | null
}

/** The customer taps "I've paid", with a UTR, a screenshot, both or neither. */
export async function submitPayment(env: Env, row: Row, input: PaymentInput, now = new Date()): Promise<void> {
  const db = env.DB
  const status = row.status as OrderStatus
  if (status === 'expired') {
    throw new OrderError(409, "This order expired before payment. If you've already paid, please message us on WhatsApp with your order number.")
  }
  if (!PAYABLE.includes(status)) throw new OrderError(409, "We've already got your payment details for this order.")

  const utr = input.utr ? normaliseUtr(input.utr) : ''
  if (utr && !UTR_RE.test(utr)) throw new OrderError(400, 'The UPI reference number has 12 digits. Leave it empty if you can’t find it.')
  if (utr) {
    const used = await db.prepare('SELECT 1 FROM orders WHERE utr = ? AND id != ?').bind(utr, row.id).first()
    if (used) throw new OrderError(409, 'That UPI reference number is already used on another order. Please check it.')
  }

  let screenshotKey: string | null = (row.screenshot_key as string | null) ?? null
  const file = input.screenshot
  if (file && file.size > 0) {
    if (!env.SCREENSHOTS) throw new OrderError(400, "Screenshots can't be uploaded yet. Just tap I've paid.")
    if (file.size > 6 * 1024 * 1024) throw new OrderError(400, 'That screenshot is too big. Please pick one under 6 MB.')
    if (!/^image\/(png|jpeg|webp|heic|heif)$/.test(file.type)) throw new OrderError(400, 'Please pick a screenshot image (PNG or JPG).')
    screenshotKey = `screenshots/${row.public_code}/${now.getTime()}.${file.type.split('/')[1]}`
    await env.SCREENSHOTS.put(screenshotKey, file.stream(), { httpMetadata: { contentType: file.type } })
  }

  const at = nowIso(now)
  const proof = paymentProof(utr || (row.utr as string | null), Boolean(screenshotKey))
  const note = proof === 'none' ? 'No reference given: match manually' : ''
  try {
    await db.batch([
      db
        .prepare(`UPDATE orders SET utr = COALESCE(?2, utr), screenshot_key = ?3, payment_proof = ?4, paid_at = ?5 WHERE id = ?1 AND status = ?6`)
        .bind(row.id, utr || null, screenshotKey, proof, at, status),
      ...transition(db, String(row.id), status, 'payment_submitted', 'customer', note, now),
    ])
  } catch (e) {
    if (String((e as Error).message).includes('UNIQUE')) {
      throw new OrderError(409, 'That UPI reference number is already used on another order. Please check it.')
    }
    throw e
  }
}

export function paidEmail(row: Row, utr: string, screenshot: boolean, statusUrl: string) {
  const code = String(row.public_code)
  const total = rupees(Number(row.total_paise))
  const proof = utr ? `UPI reference: ${utr}` : screenshot ? 'Screenshot attached on the order (no reference number).' : 'No reference number or screenshot: match it by amount and time.'
  const lines = [
    `${row.customer_name} says they've paid ${total} for order ${code}.`,
    '',
    proof,
    `Check your UPI app for ${total} with "${code}" in the note, then confirm the payment.`,
    '',
    `Customer: ${row.customer_name}, ${row.phone} (https://wa.me/91${row.phone})`,
    `Order page: ${statusUrl}`,
  ]
  return { subject: `Paid? ${code} · ${total} · ${utr ? 'UTR ' + utr : 'match manually'}`, text: lines.join('\n'), html: linesToHtml(lines) }
}

// ---------------------------------------------------------------------------
// Scheduled jobs (Cron Trigger, every 15 minutes)

/** Expire unpaid orders past expires_at and put their portions back on sale. */
export async function expireOrders(env: Env, now = new Date()): Promise<number> {
  const { results } = await env.DB
    .prepare(`SELECT id FROM orders WHERE status = 'awaiting_payment' AND expires_at <= ? LIMIT 100`)
    .bind(nowIso(now))
    .all<{ id: string }>()
  for (const r of results) {
    await env.DB.batch(transition(env.DB, r.id, 'awaiting_payment', 'expired', 'system', 'Not paid in time', now, true))
  }
  return results.length
}

/** Statuses that count towards cooking: paid, or said to be paid. */
const COOKING: OrderStatus[] = ['payment_submitted', 'confirmed', 'preparing', 'out_for_delivery', 'delivered']

/**
 * Once ordering closes for a date, email the owner what to cook. Runs from the
 * 15-minute cron and remembers the last date sent, so a changed cutoff time
 * needs no cron change.
 */
export async function maybeSendKitchenSheet(env: Env, now = new Date()): Promise<string | null> {
  const db = env.DB
  const settings = await loadSettings(db)
  const shop = shopInfo(settings)
  const date = addDays(istToday(now), shop.mealMinDaysAhead)
  if (isDateOpen(date, now, cutoffRule(shop))) return null // ordering for that date hasn't closed yet
  if ((settings.kitchen_sheet_last_date ?? '') >= date) return null

  const sheet = await kitchenSheet(db, date)
  const sent = sheet ? await sendOwnerEmail(env, settings, sheet) : true
  if (sent) {
    await db.prepare(`INSERT INTO settings (key, value) VALUES ('kitchen_sheet_last_date', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1`).bind(date).run()
  }
  return sent ? date : null
}

/** What to cook for a date: dish totals per slot, and the orders behind them. */
export async function kitchenDay(db: D1Database, date: string): Promise<KitchenDay> {
  const [orders, items] = await db.batch<Row>([
    db.prepare(`SELECT o.*, ${DATE_CHANGED_SQL} AS date_changed FROM orders o
                WHERE o.delivery_date = ?1 AND o.status IN (SELECT value FROM json_each(?2)) ORDER BY o.delivery_slot, o.created_at`)
      .bind(date, JSON.stringify(COOKING)),
    db.prepare(
      `SELECT o.delivery_slot AS slot, i.product_name_snapshot AS name, i.category, SUM(i.qty) AS qty,
              SUM(CASE WHEN o.status = 'payment_submitted' THEN i.qty ELSE 0 END) AS unverified
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.delivery_date = ?1 AND o.status IN (SELECT value FROM json_each(?2))
       GROUP BY o.delivery_slot, i.product_name_snapshot, i.category ORDER BY o.delivery_slot, i.category DESC, name`,
    ).bind(date, JSON.stringify(COOKING)),
  ])
  return {
    date,
    slots: (['lunch', 'dinner'] as Slot[])
      .map((slot) => ({
        slot,
        dishes: items.results
          .filter((r) => r.slot === slot)
          .map((r) => ({ name: String(r.name), category: r.category as Category, qty: Number(r.qty), unverified: Number(r.unverified) })),
      }))
      .filter((s) => s.dishes.length > 0),
    orders: orders.results.map((o) => ({
      code: String(o.public_code),
      slot: (o.delivery_slot as Slot | null) ?? null,
      customerName: String(o.customer_name),
      phone: String(o.phone),
      totalPaise: Number(o.total_paise),
      status: o.status as OrderStatus,
      hasMeals: Boolean(o.has_meals),
      dateChanged: Boolean(o.date_changed),
    })),
  }
}

export async function kitchenSheet(db: D1Database, date: string) {
  const [day, waiting] = await Promise.all([
    kitchenDay(db, date),
    db.prepare(`SELECT public_code, customer_name, total_paise, utr FROM orders WHERE status = 'payment_submitted' ORDER BY created_at`).all<Row>(),
  ])
  if (day.orders.length === 0 && waiting.results.length === 0) return null

  const lines: string[] = [`Kitchen sheet for ${formatDate(date)}`, '']
  for (const { slot, dishes } of day.slots) {
    lines.push(slot === 'lunch' ? 'LUNCH' : 'DINNER')
    for (const r of dishes) lines.push(`  ${r.qty} × ${r.name}${r.unverified ? ` (${r.unverified} not yet verified)` : ''}`)
    lines.push('')
  }
  if (day.orders.length) {
    lines.push('Orders')
    for (const o of day.orders) {
      lines.push(`  ${o.code} · ${o.slot} · ${o.customerName} · ${o.phone} · ${rupees(o.totalPaise)} · ${STATUS_LABEL[o.status]}${o.dateChanged ? ' · date changed' : ''}`)
    }
    lines.push('')
  }
  if (waiting.results.length) {
    lines.push(`Payments waiting for you to check (${waiting.results.length})`)
    for (const w of waiting.results) {
      lines.push(`  ${w.public_code} · ${w.customer_name} · ${rupees(Number(w.total_paise))} · ${w.utr ? 'UTR ' + w.utr : 'match manually'}`)
    }
  }
  return { subject: `Kitchen sheet · ${formatDate(date)}`, text: lines.join('\n'), html: `<pre style="font-family:ui-monospace,monospace;font-size:14px">${esc(lines.join('\n'))}</pre>` }
}
