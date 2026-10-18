// Admin API, used by the admin app at /admin/. Mounted at /api/admin.
// Plain JSON with no assumptions about the web page, so a native owner app
// could use the same endpoints later.

import { Hono } from 'hono'
import {
  canMove,
  EDITABLE_SETTINGS,
  ORDER_VIEWS,
  parsePincodes,
  PINCODE_LIST_RE,
  PRODUCT_ICONS,
  SETTING_RULES,
  type AdminMenu,
  type AdminOrderDetail,
  type AdminOrderSummary,
  type AdminProduct,
  type AdminSummary,
  type AdminZone,
  type DayAvailability,
  type EditableSetting,
  type OrderListView,
  type ScheduleEntry,
} from '../src/shared/admin'
import { addDays, isIsoDate, istToday, weekday } from '../src/shared/dates'
import { rupees } from '../src/shared/money'
import { ORDER_CODE_RE, type OrderStatus, type PaymentProof } from '../src/shared/orders'
import { SLOTS, type Category, type Slot } from '../src/shared/types'
import { clearCookie, createSession, findUser, parseUsers, passwordMatches, readSessionCookie, sessionCookie, verifySession, type AdminUser } from './auth'
import { loadSettings, type Env } from './db'
import { kitchenDay, OrderError, transition } from './orders'
import { parseSubscription, sendPush, vapidKeys } from './push'

type Row = Record<string, unknown>
type AdminEnv = { Bindings: Env; Variables: { user: AdminUser } }

const admin = new Hono<AdminEnv>()

const MAX_LOGIN_FAILURES = 10
const FAILURE_WINDOW_MIN = 15

admin.post('/login', async (c) => {
  const users = parseUsers(c.env.ADMIN_USERS)
  if (users.length === 0) {
    throw new OrderError(503, 'No admin logins are set up yet. Add the ADMIN_USERS secret to the Worker (see docs/cloudflare-setup.md).')
  }
  const db = c.env.DB
  const ip = c.req.header('CF-Connecting-IP') ?? 'local'
  const now = new Date()
  const since = new Date(now.getTime() - FAILURE_WINDOW_MIN * 60_000).toISOString()
  const fails = await db.prepare('SELECT COUNT(*) AS n FROM admin_login_failures WHERE ip = ? AND at > ?').bind(ip, since).first<{ n: number }>()
  if ((fails?.n ?? 0) >= MAX_LOGIN_FAILURES) throw new OrderError(429, `Too many wrong passwords. Try again in ${FAILURE_WINDOW_MIN} minutes.`)

  const b = (await c.req.json().catch(() => ({}))) as { name?: unknown; password?: unknown }
  const name = typeof b.name === 'string' ? b.name.slice(0, 60) : ''
  const password = typeof b.password === 'string' ? b.password.slice(0, 200) : ''
  const user = findUser(users, name)
  // Hash the attempt even for an unknown name, so timing doesn't reveal which names exist.
  const ok = await passwordMatches(user ?? { name: '', password: '\u0000' }, password)
  if (!user || !ok) {
    await db.batch([
      db.prepare('INSERT INTO admin_login_failures (ip, at) VALUES (?, ?)').bind(ip, now.toISOString()),
      db.prepare('DELETE FROM admin_login_failures WHERE at < ?').bind(new Date(now.getTime() - 86_400_000).toISOString()),
    ])
    throw new OrderError(401, 'That name and password don’t match.')
  }
  const { token, maxAge } = await createSession(user, now)
  c.header('Set-Cookie', sessionCookie(token, maxAge))
  return c.json({ name: user.name })
})

admin.post('/logout', (c) => {
  c.header('Set-Cookie', clearCookie)
  return c.json({ ok: true })
})

// Everything below needs a signed-in admin.
admin.use('*', async (c, next) => {
  const user = await verifySession(parseUsers(c.env.ADMIN_USERS), readSessionCookie(c.req.header('Cookie')))
  if (!user) throw new OrderError(401, 'Please sign in again.')
  // Changes must come from the admin app itself (on top of the SameSite cookie).
  if (c.req.method !== 'GET' && c.req.header('X-Requested-With') !== 'mjk-admin') throw new OrderError(403, 'Not allowed.')
  c.set('user', user)
  c.header('Cache-Control', 'no-store')
  await next()
})

admin.get('/me', (c) => c.json({ name: c.get('user').name }))

// ---------------------------------------------------------------------------
// Orders

const VIEW_WHERE: Record<OrderListView, string> = {
  check: `o.status = 'payment_submitted'`,
  unpaid: `(o.status = 'payment_rejected' OR (o.status = 'awaiting_payment' AND o.expires_at > ?1))`,
  ship: `o.has_meals = 0 AND o.status IN ('confirmed', 'preparing')`,
  meals: `o.has_meals = 1 AND o.status IN ('confirmed', 'preparing') AND o.delivery_date >= ?2`,
  out: `o.status = 'out_for_delivery'`,
  all: '1',
}

const VIEW_ORDER: Record<OrderListView, string> = {
  check: 'o.paid_at',
  unpaid: 'o.created_at DESC',
  ship: 'o.created_at',
  meals: `o.delivery_date, o.delivery_slot = 'dinner', o.created_at`,
  out: 'o.updated_at',
  all: 'o.created_at DESC',
}

const SUMMARY_COLS = `o.public_code, o.status, o.payment_proof, o.customer_name, o.phone, o.total_paise, o.utr, o.has_meals,
  o.delivery_date, o.delivery_slot, o.created_at, o.paid_at,
  (SELECT group_concat(i.qty || ' × ' || i.product_name_snapshot, ', ') FROM order_items i WHERE i.order_id = o.id) AS items_summary`

function toSummary(r: Row): AdminOrderSummary {
  return {
    code: String(r.public_code),
    status: r.status as OrderStatus,
    paymentProof: (r.payment_proof as PaymentProof | null) ?? null,
    customerName: String(r.customer_name),
    phone: String(r.phone),
    totalPaise: Number(r.total_paise),
    utr: (r.utr as string | null) ?? null,
    hasMeals: Boolean(r.has_meals),
    deliveryDate: (r.delivery_date as string | null) ?? null,
    deliverySlot: (r.delivery_slot as Slot | null) ?? null,
    createdAt: String(r.created_at),
    paidAt: (r.paid_at as string | null) ?? null,
    itemsSummary: String(r.items_summary ?? ''),
  }
}

admin.get('/summary', async (c) => {
  const now = new Date()
  const cols = ORDER_VIEWS.filter((v) => v !== 'all').map((v) => `SUM(CASE WHEN ${VIEW_WHERE[v]} THEN 1 ELSE 0 END) AS n_${v}`)
  const row = await c.env.DB.prepare(`SELECT ${cols.join(', ')}, COUNT(*) AS n_all FROM orders o`).bind(now.toISOString(), istToday(now)).first<Row>()
  const counts = Object.fromEntries(ORDER_VIEWS.map((v) => [v, Number(row?.[`n_${v}`] ?? 0)])) as AdminSummary['counts']
  return c.json({ counts } satisfies AdminSummary)
})

admin.get('/orders', async (c) => {
  const view = (ORDER_VIEWS as readonly string[]).includes(c.req.query('view') ?? '') ? (c.req.query('view') as OrderListView) : 'check'
  const q = (c.req.query('q') ?? '').trim().slice(0, 40)
  const now = new Date()
  let where = VIEW_WHERE[view]
  const binds: unknown[] = [now.toISOString(), istToday(now)]
  if (q) {
    // Search by order number, phone or name across all orders.
    where = `(o.public_code LIKE ?3 OR o.phone LIKE ?3 OR o.customer_name LIKE ?3 OR o.utr LIKE ?3)`
    binds.push(`%${q.replace(/[%_]/g, '')}%`)
  }
  const sql = `SELECT ${SUMMARY_COLS} FROM orders o WHERE ${where} ORDER BY ${q ? 'o.created_at DESC' : VIEW_ORDER[view]} LIMIT 200`
  // D1 wants exactly as many values as the highest ?N the query uses.
  const used = Math.max(0, ...[...sql.matchAll(/\?(\d)/g)].map((m) => Number(m[1])))
  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds.slice(0, used))
    .all<Row>()
  return c.json({ orders: results.map(toSummary) })
})

async function orderRow(db: D1Database, code: string): Promise<Row> {
  const row = ORDER_CODE_RE.test(code) ? await db.prepare('SELECT * FROM orders WHERE public_code = ?').bind(code).first<Row>() : null
  if (!row) throw new OrderError(404, 'Order not found.')
  return row
}

async function orderDetail(c: { env: Env; req: { url: string } }, row: Row): Promise<AdminOrderDetail> {
  const db = c.env.DB
  const [items, events, zone] = await db.batch<Row>([
    db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid').bind(row.id),
    db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY at, rowid').bind(row.id),
    db.prepare('SELECT name FROM delivery_zones WHERE id = ?').bind(row.zone_id),
  ])
  const summary = toSummary({
    ...row,
    items_summary: items.results.map((i) => `${i.qty} × ${i.product_name_snapshot}`).join(', '),
  })
  return {
    ...summary,
    address: String(row.address),
    landmark: String(row.landmark ?? ''),
    pincode: String(row.pincode),
    zoneName: String(zone.results[0]?.name ?? row.zone_id),
    notes: String(row.notes ?? ''),
    adminNotes: String(row.admin_notes ?? ''),
    source: String(row.source ?? ''),
    subtotalPaise: Number(row.subtotal_paise),
    deliveryFeePaise: Number(row.delivery_fee_paise),
    upiId: String(row.upi_id),
    expiresAt: row.status === 'awaiting_payment' ? ((row.expires_at as string | null) ?? null) : null,
    statusUrl: `${new URL(c.req.url).origin}/order/${row.public_code}?k=${encodeURIComponent(String(row.access_key))}`,
    items: items.results.map((i) => ({
      name: String(i.product_name_snapshot),
      label: String(i.variant_label_snapshot),
      qty: Number(i.qty),
      unitPricePaise: Number(i.unit_price_paise),
      category: i.category as Category,
    })),
    events: events.results.map((e) => ({
      from: (e.from_status as OrderStatus | null) ?? null,
      to: e.to_status as OrderStatus,
      actor: String(e.actor),
      byUser: (e.by_user as string | null) ?? null,
      note: String(e.note ?? ''),
      at: String(e.at),
    })),
  }
}

admin.get('/orders/:code', async (c) => c.json(await orderDetail(c, await orderRow(c.env.DB, c.req.param('code')))))

/**
 * Books an expired order's meal portions and tracked stock again, so it can be
 * confirmed after a late payment. The portion guard aborts it if a slot is full.
 */
function rebook(db: D1Database, row: Row): D1PreparedStatement[] {
  const id = String(row.id)
  const still = `(SELECT status FROM orders WHERE id = ?1) = 'expired'`
  const out: D1PreparedStatement[] = []
  if (row.delivery_date && row.delivery_slot) {
    out.push(
      db
        .prepare(
          `INSERT INTO meal_availability (product_id, date, slot, max_portions, booked_portions)
           SELECT s.product_id, ?2, s.slot, s.max_portions, 0 FROM meal_schedule s
           WHERE s.weekday = ?3 AND s.slot = ?4 AND s.product_id IN (SELECT product_id FROM order_items WHERE order_id = ?1 AND category = 'meal')
           ON CONFLICT DO NOTHING`,
        )
        .bind(id, row.delivery_date, weekday(String(row.delivery_date)), row.delivery_slot),
      db
        .prepare(
          `UPDATE meal_availability
           SET booked_portions = booked_portions + (SELECT SUM(i.qty) FROM order_items i
             WHERE i.order_id = ?1 AND i.category = 'meal' AND i.product_id = meal_availability.product_id)
           WHERE ${still} AND date = ?2 AND slot = ?3
             AND product_id IN (SELECT product_id FROM order_items WHERE order_id = ?1 AND category = 'meal')`,
        )
        .bind(id, row.delivery_date, row.delivery_slot),
    )
  }
  out.push(
    db
      .prepare(
        `UPDATE variants SET stock = stock - (SELECT SUM(i.qty) FROM order_items i WHERE i.order_id = ?1 AND i.variant_id = variants.id)
         WHERE ${still} AND stock IS NOT NULL AND id IN (SELECT variant_id FROM order_items WHERE order_id = ?1)`,
      )
      .bind(id),
  )
  return out
}

admin.post('/orders/:code/status', async (c) => {
  const db = c.env.DB
  const row = await orderRow(db, c.req.param('code'))
  const b = (await c.req.json().catch(() => ({}))) as { to?: unknown; from?: unknown; note?: unknown }
  const from = row.status as OrderStatus
  const to = b.to as OrderStatus
  // `from` is what the admin saw; if someone else changed the order meanwhile, say so instead of acting on a stale screen.
  if (typeof b.from === 'string' && b.from !== from) throw new OrderError(409, 'Someone else just changed this order. Check it again.')
  if (!canMove(from, to)) throw new OrderError(400, 'That change isn’t possible from the order’s current status.')
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 300) : ''
  const user = c.get('user').name
  const now = new Date()
  const release = to === 'cancelled'
  const stmts = [...(from === 'expired' ? rebook(db, row) : []), ...transition(db, String(row.id), from, to, 'owner', note, now, release, user)]
  try {
    await db.batch(stmts)
  } catch (e) {
    const msg = String((e as Error).message ?? e)
    if (msg.includes('not_enough_portions')) {
      throw new OrderError(409, 'That slot is now full. Raise its portion limit under Menu → Dates, then confirm again.')
    }
    if (msg.includes('not_enough_stock')) throw new OrderError(409, 'Not enough stock left. Raise the stock under Menu, then confirm again.')
    throw e
  }
  return c.json(await orderDetail(c, await orderRow(db, String(row.public_code))))
})

admin.post('/orders/:code/notes', async (c) => {
  const db = c.env.DB
  const row = await orderRow(db, c.req.param('code'))
  const b = (await c.req.json().catch(() => ({}))) as { notes?: unknown }
  const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 1000) : ''
  await db.prepare('UPDATE orders SET admin_notes = ? WHERE id = ?').bind(notes, row.id).run()
  return c.json(await orderDetail(c, await orderRow(db, String(row.public_code))))
})

admin.get('/kitchen', async (c) => {
  const date = c.req.query('date')
  return c.json(await kitchenDay(c.env.DB, isIsoDate(date) ? date : addDays(istToday(new Date()), 1)))
})

// ---------------------------------------------------------------------------
// Menu

function logStmt(db: D1Database, user: string, action: string, detail: string): D1PreparedStatement {
  return db.prepare('INSERT INTO admin_log (at, user, action, detail) VALUES (?, ?, ?, ?)').bind(new Date().toISOString(), user, action, detail.slice(0, 500))
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const intOrNull = (v: unknown) => (v === null || v === '' || v === undefined ? null : Number.isInteger(v) && (v as number) >= 0 ? (v as number) : NaN)
const bad = (msg: string) => new OrderError(400, msg)

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item'
}

async function uniqueId(db: D1Database, table: 'products' | 'variants' | 'delivery_zones', base: string): Promise<string> {
  for (let i = 1; ; i++) {
    const id = i === 1 ? base : `${base}-${i}`
    if (!(await db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).bind(id).first())) return id
  }
}

async function loadAdminMenu(db: D1Database): Promise<AdminMenu> {
  const [products, variants, schedule] = await db.batch<Row>([
    db.prepare('SELECT * FROM products ORDER BY sort_order, name'),
    db.prepare('SELECT * FROM variants ORDER BY sort_order, price_paise'),
    db.prepare('SELECT * FROM meal_schedule ORDER BY product_id, weekday, slot'),
  ])
  const out: AdminMenu = {
    products: products.results.map(
      (p): AdminProduct => ({
        id: String(p.id),
        category: p.category as Category,
        name: String(p.name),
        description: String(p.description ?? ''),
        spiceLevel: Number(p.spice_level ?? 0),
        isVeg: Boolean(p.is_veg),
        icon: (p.icon as string | null) ?? null,
        isActive: Boolean(p.is_active),
        sortOrder: Number(p.sort_order ?? 0),
        variants: variants.results
          .filter((v) => v.product_id === p.id)
          .map((v) => ({
            id: String(v.id),
            productId: String(v.product_id),
            label: String(v.label),
            pricePaise: Number(v.price_paise),
            weightG: v.weight_g == null ? null : Number(v.weight_g),
            stock: v.stock == null ? null : Number(v.stock),
            isActive: Boolean(v.is_active),
            sortOrder: Number(v.sort_order ?? 0),
          })),
      }),
    ),
    schedule: {},
  }
  for (const s of schedule.results) {
    ;(out.schedule[String(s.product_id)] ??= []).push({ weekday: Number(s.weekday), slot: s.slot as Slot, maxPortions: Number(s.max_portions) })
  }
  return out
}

admin.get('/menu', async (c) => c.json(await loadAdminMenu(c.env.DB)))

interface ProductInput {
  name: string
  description: string
  spiceLevel: number
  isVeg: boolean
  icon: string | null
  isActive: boolean
  sortOrder: number
}

function parseProduct(b: Row): ProductInput {
  const name = str(b.name, 60)
  if (name.length < 2) throw bad('Give the dish a name.')
  const spiceLevel = Number(b.spiceLevel ?? 0)
  if (!Number.isInteger(spiceLevel) || spiceLevel < 0 || spiceLevel > 3) throw bad('Spice level is 0 to 3.')
  const icon = b.icon == null || b.icon === '' ? null : String(b.icon)
  if (icon && !(PRODUCT_ICONS as readonly string[]).includes(icon)) throw bad('Unknown icon.')
  return {
    name,
    description: str(b.description, 300),
    spiceLevel,
    isVeg: Boolean(b.isVeg),
    icon,
    isActive: b.isActive === undefined ? true : Boolean(b.isActive),
    sortOrder: Number.isInteger(b.sortOrder) ? Number(b.sortOrder) : 0,
  }
}

interface VariantInput {
  label: string
  pricePaise: number
  weightG: number | null
  stock: number | null
  isActive: boolean
  sortOrder: number
}

function parseVariant(b: Row): VariantInput {
  const label = str(b.label, 40)
  if (!label) throw bad('Give the size a label, like "400 g" or "Per meal".')
  const pricePaise = Number(b.pricePaise)
  if (!Number.isInteger(pricePaise) || pricePaise <= 0 || pricePaise > 10_000_000) throw bad('Enter a price.')
  const weightG = intOrNull(b.weightG)
  const stock = intOrNull(b.stock)
  if (Number.isNaN(weightG)) throw bad('Weight is a whole number of grams, or empty.')
  if (Number.isNaN(stock)) throw bad('Stock is a whole number, or empty for not counted.')
  return {
    label,
    pricePaise,
    weightG,
    stock,
    isActive: b.isActive === undefined ? true : Boolean(b.isActive),
    sortOrder: Number.isInteger(b.sortOrder) ? Number(b.sortOrder) : 0,
  }
}

admin.post('/products', async (c) => {
  const db = c.env.DB
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Row
  const category = b.category === 'meal' ? 'meal' : b.category === 'pickle' ? 'pickle' : null
  if (!category) throw bad('Pick pickle or meal.')
  const p = parseProduct(b)
  const v = parseVariant((b.variant ?? {}) as Row)
  const id = await uniqueId(db, 'products', slugify(p.name))
  const vid = await uniqueId(db, 'variants', `${id}-${slugify(v.label)}`)
  const user = c.get('user').name
  await db.batch([
    db
      .prepare(`INSERT INTO products (id, category, name, description, spice_level, is_veg, icon, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, category, p.name, p.description, p.spiceLevel, p.isVeg ? 1 : 0, p.icon, p.isActive ? 1 : 0, p.sortOrder),
    db
      .prepare(`INSERT INTO variants (id, product_id, label, price_paise, weight_g, stock, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, 1, 1)`)
      .bind(vid, id, v.label, v.pricePaise, v.weightG, v.stock),
    logStmt(db, user, 'Added dish', `${p.name} (${v.label}, ${rupees(v.pricePaise)})`),
  ])
  return c.json(await loadAdminMenu(db), 201)
})

admin.put('/products/:id', async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  const before = await db.prepare('SELECT name FROM products WHERE id = ?').bind(id).first<Row>()
  if (!before) throw new OrderError(404, 'Dish not found.')
  const p = parseProduct(((await c.req.json().catch(() => null)) ?? {}) as Row)
  await db.batch([
    db
      .prepare(`UPDATE products SET name = ?, description = ?, spice_level = ?, is_veg = ?, icon = ?, is_active = ?, sort_order = ? WHERE id = ?`)
      .bind(p.name, p.description, p.spiceLevel, p.isVeg ? 1 : 0, p.icon, p.isActive ? 1 : 0, p.sortOrder, id),
    logStmt(db, c.get('user').name, 'Edited dish', `${p.name}${p.isActive ? '' : ' (hidden)'}`),
  ])
  return c.json(await loadAdminMenu(db))
})

admin.post('/products/:id/variants', async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  const product = await db.prepare('SELECT name FROM products WHERE id = ?').bind(id).first<Row>()
  if (!product) throw new OrderError(404, 'Dish not found.')
  const v = parseVariant(((await c.req.json().catch(() => null)) ?? {}) as Row)
  const vid = await uniqueId(db, 'variants', `${id}-${slugify(v.label)}`)
  await db.batch([
    db
      .prepare(`INSERT INTO variants (id, product_id, label, price_paise, weight_g, stock, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(vid, id, v.label, v.pricePaise, v.weightG, v.stock, v.isActive ? 1 : 0, v.sortOrder),
    logStmt(db, c.get('user').name, 'Added size', `${product.name}: ${v.label}, ${rupees(v.pricePaise)}`),
  ])
  return c.json(await loadAdminMenu(db), 201)
})

admin.put('/variants/:id', async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  const before = await db
    .prepare('SELECT v.*, p.name AS product_name FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?')
    .bind(id)
    .first<Row>()
  if (!before) throw new OrderError(404, 'Size not found.')
  const v = parseVariant(((await c.req.json().catch(() => null)) ?? {}) as Row)
  const changes: string[] = []
  if (Number(before.price_paise) !== v.pricePaise) changes.push(`price ${rupees(Number(before.price_paise))} → ${rupees(v.pricePaise)}`)
  if ((before.stock ?? null) !== v.stock) changes.push(`stock ${before.stock ?? 'not counted'} → ${v.stock ?? 'not counted'}`)
  if (Boolean(before.is_active) !== v.isActive) changes.push(v.isActive ? 'shown' : 'hidden')
  if (String(before.label) !== v.label) changes.push(`label → ${v.label}`)
  await db.batch([
    db
      .prepare(`UPDATE variants SET label = ?, price_paise = ?, weight_g = ?, stock = ?, is_active = ?, sort_order = ? WHERE id = ?`)
      .bind(v.label, v.pricePaise, v.weightG, v.stock, v.isActive ? 1 : 0, v.sortOrder, id),
    logStmt(db, c.get('user').name, 'Edited size', `${before.product_name} ${before.label}: ${changes.join(', ') || 'no change'}`),
  ])
  return c.json(await loadAdminMenu(db))
})

/**
 * Replaces a meal's weekly schedule. Upcoming dates that already have bookings
 * follow the new schedule too, unless their limit was set by hand for that date.
 */
admin.put('/schedule/:productId', async (c) => {
  const db = c.env.DB
  const productId = c.req.param('productId')
  const product = await db.prepare(`SELECT name FROM products WHERE id = ? AND category = 'meal'`).bind(productId).first<Row>()
  if (!product) throw new OrderError(404, 'Meal not found.')
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { entries?: unknown }
  if (!Array.isArray(b.entries) || b.entries.length > 14) throw bad('Invalid schedule.')
  const entries: ScheduleEntry[] = []
  for (const e of b.entries as Row[]) {
    const wd = Number(e.weekday)
    const max = Number(e.maxPortions)
    if (!Number.isInteger(wd) || wd < 0 || wd > 6 || !SLOTS.includes(e.slot as Slot) || !Number.isInteger(max) || max < 0 || max > 500) {
      throw bad('Portions are whole numbers from 0 to 500.')
    }
    if (max > 0) entries.push({ weekday: wd, slot: e.slot as Slot, maxPortions: max })
  }
  const today = istToday(new Date())
  await db.batch([
    db.prepare('DELETE FROM meal_schedule WHERE product_id = ?').bind(productId),
    ...entries.map((e) =>
      db.prepare('INSERT INTO meal_schedule (product_id, weekday, slot, max_portions) VALUES (?, ?, ?, ?)').bind(productId, e.weekday, e.slot, e.maxPortions),
    ),
    db
      .prepare(
        `UPDATE meal_availability SET max_portions = COALESCE((SELECT s.max_portions FROM meal_schedule s
           WHERE s.product_id = meal_availability.product_id AND s.slot = meal_availability.slot
             AND s.weekday = CAST(strftime('%w', meal_availability.date) AS INTEGER)), 0)
         WHERE product_id = ? AND is_override = 0 AND date > ?`,
      )
      .bind(productId, today),
    logStmt(db, c.get('user').name, 'Changed meal days', `${product.name}: ${describeSchedule(entries)}`),
  ])
  return c.json(await loadAdminMenu(db))
})

function describeSchedule(entries: ScheduleEntry[]): string {
  if (entries.length === 0) return 'not cooked'
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return entries.map((e) => `${days[e.weekday]} ${e.slot} ${e.maxPortions}`).join(', ')
}

admin.get('/availability', async (c) => {
  const db = c.env.DB
  const days = Math.min(60, Math.max(1, Number(c.req.query('days')) || 21))
  const today = istToday(new Date())
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i + 1))
  const [meals, schedule, rows] = await db.batch<Row>([
    db.prepare(`SELECT id FROM products WHERE category = 'meal' AND is_active = 1 ORDER BY sort_order, name`),
    db.prepare('SELECT * FROM meal_schedule'),
    db.prepare('SELECT * FROM meal_availability WHERE date > ? AND date <= ?').bind(today, dates[dates.length - 1]),
  ])
  const out: DayAvailability[] = dates.map((date) => {
    const wd = weekday(date)
    const list: DayAvailability['meals'] = []
    for (const m of meals.results) {
      for (const slot of SLOTS) {
        const sched = schedule.results.find((s) => s.product_id === m.id && Number(s.weekday) === wd && s.slot === slot)
        const row = rows.results.find((r) => r.product_id === m.id && r.date === date && r.slot === slot)
        const scheduled = sched ? Number(sched.max_portions) : 0
        list.push({
          productId: String(m.id),
          slot,
          scheduled,
          maxPortions: row ? Number(row.max_portions) : scheduled,
          booked: row ? Number(row.booked_portions) : 0,
          isOverride: Boolean(row?.is_override),
        })
      }
    }
    return { date, meals: list }
  })
  return c.json({ days: out })
})

/** Sets one meal's portion limit for one date and slot, or (maxPortions null) puts it back to the weekly schedule. */
admin.put('/availability', async (c) => {
  const db = c.env.DB
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Row
  const productId = str(b.productId, 60)
  const date = b.date
  const slot = b.slot as Slot
  if (!isIsoDate(date) || date <= istToday(new Date()) || !SLOTS.includes(slot)) throw bad('Pick a date from tomorrow on.')
  const product = await db.prepare(`SELECT name FROM products WHERE id = ? AND category = 'meal'`).bind(productId).first<Row>()
  if (!product) throw new OrderError(404, 'Meal not found.')
  const user = c.get('user').name
  if (b.maxPortions === null) {
    await db.batch([
      db
        .prepare(
          `UPDATE meal_availability SET is_override = 0, max_portions = COALESCE((SELECT max_portions FROM meal_schedule
             WHERE product_id = ?1 AND weekday = ?4 AND slot = ?3), 0)
           WHERE product_id = ?1 AND date = ?2 AND slot = ?3`,
        )
        .bind(productId, date, slot, weekday(date)),
      logStmt(db, user, 'Reset date', `${product.name}, ${date} ${slot}: back to weekly schedule`),
    ])
  } else {
    const max = Number(b.maxPortions)
    if (!Number.isInteger(max) || max < 0 || max > 500) throw bad('Portions are whole numbers from 0 to 500.')
    await db.batch([
      db
        .prepare(
          `INSERT INTO meal_availability (product_id, date, slot, max_portions, booked_portions, is_override) VALUES (?, ?, ?, ?, 0, 1)
           ON CONFLICT (product_id, date, slot) DO UPDATE SET max_portions = excluded.max_portions, is_override = 1`,
        )
        .bind(productId, date, slot, max),
      logStmt(db, user, 'Changed date', `${product.name}, ${date} ${slot}: ${max === 0 ? 'off' : `${max} portions`}`),
    ])
  }
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Delivery areas

async function loadAdminZones(db: D1Database): Promise<AdminZone[]> {
  const { results } = await db.prepare('SELECT * FROM delivery_zones ORDER BY fee_paise, name').all<Row>()
  return results.map((z) => ({
    id: String(z.id),
    name: String(z.name),
    pincodes: String(z.pincodes).split(',').map((s) => s.trim()).filter(Boolean),
    feePaise: Number(z.fee_paise),
    allowsMeals: Boolean(z.allows_meals),
    isActive: Boolean(z.is_active),
  }))
}

async function parseZone(db: D1Database, b: Row, selfId: string | null) {
  const name = str(b.name, 60)
  if (name.length < 2) throw bad('Give the area a name.')
  const pincodes = parsePincodes(typeof b.pincodes === 'string' ? b.pincodes : Array.isArray(b.pincodes) ? b.pincodes.join(',') : '')
  const wrong = pincodes.filter((p) => !PINCODE_LIST_RE.test(p))
  if (wrong.length) throw bad(`These aren't 6-digit pincodes: ${wrong.slice(0, 5).join(', ')}`)
  if (pincodes.length === 0) throw bad('Add at least one pincode.')
  if (pincodes.length > 500) throw bad('That’s too many pincodes for one area.')
  const feePaise = Number(b.feePaise)
  if (!Number.isInteger(feePaise) || feePaise < 0 || feePaise > 1_000_000) throw bad('Enter the delivery charge (0 for free).')
  const isActive = b.isActive === undefined ? true : Boolean(b.isActive)
  if (isActive) {
    // A pincode in two areas would make the charge depend on which one is found first.
    const others = (await loadAdminZones(db)).filter((z) => z.isActive && z.id !== selfId)
    const clash = pincodes.filter((p) => others.some((z) => z.pincodes.includes(p)))
    if (clash.length) {
      const where = others.find((z) => z.pincodes.includes(clash[0]))!.name
      throw bad(`${clash.slice(0, 5).join(', ')} ${clash.length === 1 ? 'is' : 'are'} already in ${where}. Remove ${clash.length === 1 ? 'it' : 'them'} there first.`)
    }
  }
  return { name, pincodes, feePaise, allowsMeals: Boolean(b.allowsMeals), isActive }
}

admin.get('/zones', async (c) => c.json({ zones: await loadAdminZones(c.env.DB) }))

admin.post('/zones', async (c) => {
  const db = c.env.DB
  const z = await parseZone(db, ((await c.req.json().catch(() => null)) ?? {}) as Row, null)
  const id = await uniqueId(db, 'delivery_zones', slugify(z.name))
  await db.batch([
    db
      .prepare('INSERT INTO delivery_zones (id, name, pincodes, fee_paise, allows_meals, is_active) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, z.name, z.pincodes.join(','), z.feePaise, z.allowsMeals ? 1 : 0, z.isActive ? 1 : 0),
    logStmt(db, c.get('user').name, 'Added delivery area', `${z.name}: ${rupees(z.feePaise)}, ${z.pincodes.length} pincodes`),
  ])
  return c.json({ zones: await loadAdminZones(db) }, 201)
})

admin.put('/zones/:id', async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  if (!(await db.prepare('SELECT 1 FROM delivery_zones WHERE id = ?').bind(id).first())) throw new OrderError(404, 'Area not found.')
  const z = await parseZone(db, ((await c.req.json().catch(() => null)) ?? {}) as Row, id)
  await db.batch([
    db
      .prepare('UPDATE delivery_zones SET name = ?, pincodes = ?, fee_paise = ?, allows_meals = ?, is_active = ? WHERE id = ?')
      .bind(z.name, z.pincodes.join(','), z.feePaise, z.allowsMeals ? 1 : 0, z.isActive ? 1 : 0, id),
    logStmt(db, c.get('user').name, 'Edited delivery area', `${z.name}: ${rupees(z.feePaise)}, ${z.pincodes.length} pincodes${z.isActive ? '' : ' (off)'}`),
  ])
  return c.json({ zones: await loadAdminZones(db) })
})

// Old orders keep their zone id and fee, so deleting an area never changes them.
admin.delete('/zones/:id', async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  const zone = await db.prepare('SELECT name FROM delivery_zones WHERE id = ?').bind(id).first<Row>()
  if (!zone) throw new OrderError(404, 'Area not found.')
  await db.batch([db.prepare('DELETE FROM delivery_zones WHERE id = ?').bind(id), logStmt(db, c.get('user').name, 'Deleted delivery area', String(zone.name))])
  return c.json({ zones: await loadAdminZones(db) })
})

// ---------------------------------------------------------------------------
// Settings and the change log

function editable(all: Record<string, string>): Record<EditableSetting, string> {
  return Object.fromEntries(EDITABLE_SETTINGS.map((k) => [k, all[k] ?? ''])) as Record<EditableSetting, string>
}

admin.get('/settings', async (c) => c.json({ settings: editable(await loadSettings(c.env.DB)) }))

admin.put('/settings', async (c) => {
  const db = c.env.DB
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { settings?: Record<string, unknown> }
  const before = await loadSettings(db)
  const updates: [EditableSetting, string][] = []
  for (const [key, raw] of Object.entries(b.settings ?? {})) {
    if (!(EDITABLE_SETTINGS as readonly string[]).includes(key)) throw bad(`Unknown setting ${key}.`)
    const value = typeof raw === 'string' ? raw.trim() : String(raw ?? '')
    const problem = SETTING_RULES[key as EditableSetting](value)
    if (problem) throw bad(`${key.replace(/_/g, ' ')} should be ${problem}.`)
    if ((before[key] ?? '') !== value) updates.push([key as EditableSetting, value])
  }
  const minDays = Number(updates.find(([k]) => k === 'meal_min_days_ahead')?.[1] ?? before.meal_min_days_ahead ?? 1)
  const maxDays = Number(updates.find(([k]) => k === 'meal_max_days_ahead')?.[1] ?? before.meal_max_days_ahead ?? 14)
  if (maxDays < minDays) throw bad('How far ahead meals can be booked must be at least the minimum days ahead.')
  if (updates.length) {
    const user = c.get('user').name
    await db.batch(
      updates.flatMap(([k, v]) => [
        db.prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2').bind(k, v),
        logStmt(db, user, 'Changed setting', `${k}: ${before[k] || '(empty)'} → ${v || '(empty)'}`),
      ]),
    )
  }
  return c.json({ settings: editable(await loadSettings(db)) })
})

admin.get('/log', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM admin_log ORDER BY at DESC, rowid DESC LIMIT 50').all<Row>()
  return c.json({ entries: results.map((r) => ({ at: String(r.at), user: String(r.user), action: String(r.action), detail: String(r.detail) })) })
})

// ---------------------------------------------------------------------------
// Order alerts on phones (Web Push, see server/push.ts)

admin.get('/push', async (c) => {
  const db = c.env.DB
  const [vapid, { results }] = await Promise.all([
    vapidKeys(db),
    db.prepare('SELECT endpoint, user, device, created_at FROM push_subscriptions ORDER BY created_at').all<Row>(),
  ])
  return c.json({
    publicKey: vapid.publicKey,
    devices: results.map((r) => ({ endpoint: String(r.endpoint), user: String(r.user), device: String(r.device), since: String(r.created_at) })),
  })
})

admin.post('/push/subscribe', async (c) => {
  const db = c.env.DB
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { subscription?: unknown; device?: unknown; replaces?: unknown }
  const sub = parseSubscription(b.subscription)
  if (!sub) throw bad('This browser sent an alert sign-up we can’t use. Try again, or use Chrome or the home-screen app.')
  const replaces = typeof b.replaces === 'string' && b.replaces !== sub.endpoint ? b.replaces : null
  const old = replaces ? await db.prepare('SELECT device FROM push_subscriptions WHERE endpoint = ?').bind(replaces).first<{ device: string }>() : null
  const device = old?.device ?? (typeof b.device === 'string' ? b.device.slice(0, 60) : '')
  const user = c.get('user').name
  const stmts = [
    db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user, device, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = ?2, auth = ?3, user = ?4, device = ?5`,
      )
      .bind(sub.endpoint, sub.keys.p256dh, sub.keys.auth, user, device, new Date().toISOString()),
  ]
  // The browser renewed its subscription: drop the old one.
  if (replaces) stmts.push(db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(replaces))
  else stmts.push(logStmt(db, user, 'Turned on order alerts', device || 'a phone'))
  await db.batch(stmts)
  return c.json({ ok: true })
})

admin.post('/push/unsubscribe', async (c) => {
  const db = c.env.DB
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { endpoint?: unknown }
  if (typeof b.endpoint !== 'string') throw bad('Missing endpoint.')
  const row = await db.prepare('SELECT device FROM push_subscriptions WHERE endpoint = ?').bind(b.endpoint).first<{ device: string }>()
  if (row) {
    await db.batch([
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(b.endpoint),
      logStmt(db, c.get('user').name, 'Turned off order alerts', row.device || 'a phone'),
    ])
  }
  return c.json({ ok: true })
})

/** A test alert to one phone (the one asking), to check alerts get through. */
admin.post('/push/test', async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { endpoint?: unknown }
  if (typeof b.endpoint !== 'string') throw bad('Missing endpoint.')
  const user = c.get('user').name
  const result = await sendPush(
    c.env,
    await loadSettings(c.env.DB),
    new URL(c.req.url).origin,
    { title: 'Test alert · MJ Kitchen', body: `Alerts work on this phone, ${user}. New orders will show up like this.`, url: '/admin/#/settings', tag: 'test' },
    [b.endpoint],
  )
  if (result.sent === 0) throw new OrderError(503, 'The test alert didn’t go through. Turn alerts off and on again on this phone.')
  return c.json({ ok: true })
})

export default admin
