// Shapes and rules shared by the admin API (server/admin.ts) and the admin app (src/admin/).

import { formatDate, weekday } from './dates'
import { formatWhen, type MealWhen, type OrderStatus, type PaymentProof } from './orders'
import type { Category, Slot } from './types'

/** Status changes the owner can make from each status. */
export const OWNER_MOVES: Partial<Record<OrderStatus, OrderStatus[]>> = {
  awaiting_payment: ['confirmed', 'cancelled'],
  payment_submitted: ['confirmed', 'payment_rejected', 'cancelled'],
  payment_rejected: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'out_for_delivery', 'delivered', 'cancelled'],
  preparing: ['out_for_delivery', 'delivered', 'cancelled'],
  out_for_delivery: ['delivered'],
  // Paid after it lapsed: confirming books its portions and stock again.
  expired: ['confirmed'],
}

export function canMove(from: OrderStatus, to: OrderStatus): boolean {
  return OWNER_MOVES[from]?.includes(to) ?? false
}

/**
 * Statuses where the owner can still change a meal order's date. An expired
 * order holds no portions; confirming it later books the new date.
 */
export const DATE_MOVABLE: OrderStatus[] = ['awaiting_payment', 'payment_submitted', 'payment_rejected', 'confirmed', 'preparing', 'expired']

export function canChangeDate(status: OrderStatus, hasMeals: boolean): boolean {
  return hasMeals && DATE_MOVABLE.includes(status)
}

/** One meal in the order, and how its slot looks on the new date. */
export interface MoveDish {
  productId: string
  name: string
  qty: number
  /** Portion limit for the new date and slot; 0 = not cooked then. */
  max: number
  booked: number
}

export interface MoveCheck {
  status: OrderStatus
  hasMeals: boolean
  current: MealWhen
  target: MealWhen
  /** Hyderabad date today. */
  today: string
  dishes: MoveDish[]
  /** Whether any meal is cooked on the new date and slot. */
  mealSlot: boolean
  /** Whether customers could still order for the new date. */
  openForCustomers: boolean
  shopOpen: boolean
  /** The last date whose kitchen sheet email has gone out. */
  kitchenSheetLastDate: string
}

export interface MovePlan {
  /** Why the move can't happen, or null. */
  error: string | null
  /** Things to know before saving; the move is still allowed. */
  warnings: string[]
  /** Dishes the new slot hasn't room for. Saving then needs "go over the limit". */
  short: { name: string; need: number; left: number }[]
  /** Dishes whose portions are counted on the new date (those cooked then). */
  track: string[]
}

/** What changing an order's date would do. Shared by the check screen and the save. */
export function planDateMove(c: MoveCheck): MovePlan {
  const plan: MovePlan = { error: null, warnings: [], short: [], track: [] }
  if (!canChangeDate(c.status, c.hasMeals)) {
    plan.error = c.hasMeals ? 'This order can’t be moved any more.' : 'Pickle-only orders have no date to change.'
  } else if (c.target.date < c.today) {
    plan.error = 'That date has passed.'
  } else if (c.target.date === c.current.date && c.target.slot === c.current.slot) {
    plan.error = 'The order is already for that date and slot.'
  }
  if (plan.error) return plan

  const when = formatWhen(c.target)
  if (c.target.date === c.today) plan.warnings.push('That’s today. Make sure the kitchen can still make it.')
  if (!c.mealSlot) {
    const day = WEEKDAYS[weekday(c.target.date)]
    plan.warnings.push(`${day} ${c.target.slot} isn’t a meal slot. The kitchen will cook this order specially, and customers still can’t order then.`)
  } else {
    for (const d of c.dishes) if (d.max <= 0) plan.warnings.push(`${d.name} isn’t on the menu for ${when}. The kitchen will make it specially.`)
  }
  if (c.target.date !== c.today && !c.openForCustomers) plan.warnings.push(`Customers can no longer order for ${formatDate(c.target.date)}. This move is allowed anyway.`)
  if (!c.shopOpen) plan.warnings.push('The shop is set to closed for customers.')
  if (c.kitchenSheetLastDate && c.target.date <= c.kitchenSheetLastDate) {
    plan.warnings.push(`The kitchen sheet email for ${formatDate(c.target.date)} has already gone out. The Kitchen screen will show this order.`)
  }
  if (c.kitchenSheetLastDate && c.current.date <= c.kitchenSheetLastDate && c.current.date >= c.today && c.current.date !== c.target.date) {
    plan.warnings.push(`The kitchen sheet email for ${formatDate(c.current.date)} still lists this order. The Kitchen screen is up to date.`)
  }

  // An expired order holds no portions, so nothing is booked until it's confirmed.
  if (c.status !== 'expired') {
    for (const d of c.dishes) {
      if (d.max <= 0) continue
      plan.track.push(d.productId)
      const left = Math.max(0, d.max - d.booked)
      if (d.qty > left) plan.short.push({ name: d.name, need: d.qty, left })
    }
  }
  return plan
}

/** Owner-facing status names. "Out for delivery" reads as "Shipped" for pickle-only orders. */
export function ownerStatusLabel(status: OrderStatus, hasMeals: boolean): string {
  switch (status) {
    case 'awaiting_payment':
      return 'Not paid yet'
    case 'payment_submitted':
      return 'Says paid: check'
    case 'payment_rejected':
      return 'Payment not found'
    case 'confirmed':
      return 'Paid'
    case 'preparing':
      return 'Preparing'
    case 'out_for_delivery':
      return hasMeals ? 'Out for delivery' : 'Shipped'
    case 'delivered':
      return 'Delivered'
    case 'cancelled':
      return 'Cancelled'
    case 'expired':
      return 'Expired'
  }
}

export const ORDER_VIEWS = ['check', 'unpaid', 'ship', 'meals', 'out', 'all'] as const
export type OrderListView = (typeof ORDER_VIEWS)[number]

export interface AdminOrderSummary {
  code: string
  status: OrderStatus
  paymentProof: PaymentProof | null
  customerName: string
  phone: string
  totalPaise: number
  utr: string | null
  hasMeals: boolean
  deliveryDate: string | null
  deliverySlot: Slot | null
  createdAt: string
  paidAt: string | null
  itemsSummary: string
  /** MJ Kitchen moved this order to another date. */
  dateChanged: boolean
}

export interface AdminOrderDetail extends AdminOrderSummary {
  address: string
  landmark: string
  pincode: string
  zoneName: string
  notes: string
  adminNotes: string
  source: string
  subtotalPaise: number
  deliveryFeePaise: number
  upiId: string
  expiresAt: string | null
  /** The customer's status page link, to send on WhatsApp. */
  statusUrl: string
  items: { name: string; label: string; qty: number; unitPricePaise: number; category: Category }[]
  events: { from: OrderStatus | null; to: OrderStatus; actor: string; byUser: string | null; note: string; at: string }[]
  /** The date the customer first picked, when the order has been moved since. */
  originalDate: MealWhen | null
  canChangeDate: boolean
}

/** Answer to "what if this order moved to that date and slot?" */
export interface MoveCheckResult {
  plan: MovePlan
  /** Portions left in the new slot for each meal in the order (null = not cooked then). */
  dishes: { name: string; qty: number; left: number | null }[]
}

export interface AdminSummary {
  counts: Record<OrderListView, number>
}

export interface KitchenDay {
  date: string
  slots: { slot: Slot; dishes: { name: string; category: Category; qty: number; unverified: number }[] }[]
  orders: { code: string; slot: Slot | null; customerName: string; phone: string; totalPaise: number; status: OrderStatus; hasMeals: boolean; dateChanged: boolean }[]
}

export interface AdminVariant {
  id: string
  productId: string
  label: string
  pricePaise: number
  weightG: number | null
  stock: number | null
  isActive: boolean
  sortOrder: number
}

export interface AdminProduct {
  id: string
  category: Category
  name: string
  description: string
  spiceLevel: number
  isVeg: boolean
  icon: string | null
  isActive: boolean
  sortOrder: number
  variants: AdminVariant[]
}

export interface ScheduleEntry {
  weekday: number
  slot: Slot
  maxPortions: number
}

export interface AdminMenu {
  products: AdminProduct[]
  /** Weekly meal schedule per product id. */
  schedule: Record<string, ScheduleEntry[]>
}

export interface DayAvailability {
  date: string
  /** One entry per active meal and slot. */
  meals: { productId: string; slot: Slot; maxPortions: number; booked: number; isOverride: boolean; scheduled: number }[]
}

export interface AdminZone {
  id: string
  name: string
  pincodes: string[]
  feePaise: number
  allowsMeals: boolean
  isActive: boolean
}

/** Settings the admin app can read and change. Everything else stays internal. */
export const EDITABLE_SETTINGS = [
  'shop_open',
  'shop_closed_message',
  'upi_id',
  'upi_payee_name',
  'upi_is_business',
  'alert_email',
  'meal_cutoff_time',
  'meal_min_days_ahead',
  'meal_max_days_ahead',
  'unpaid_timeout_minutes',
  'max_open_orders_per_phone',
  'free_delivery_above_paise',
  'contact_whatsapp',
  'contact_phone',
  'instagram_handle',
  'fssai_number',
  'turnstile_site_key',
] as const
export type EditableSetting = (typeof EDITABLE_SETTINGS)[number]

const int = (min: number, max: number) => (v: string) => (/^\d+$/.test(v) && +v >= min && +v <= max ? null : `a whole number from ${min} to ${max}`)

/** Returns a problem description for a bad value, or null when it's fine. */
export const SETTING_RULES: Record<EditableSetting, (v: string) => string | null> = {
  shop_open: (v) => (v === '0' || v === '1' ? null : '0 or 1'),
  shop_closed_message: (v) => (v.length <= 200 ? null : 'at most 200 characters'),
  upi_id: (v) => (v === '' || /^[\w.-]{2,}@[a-zA-Z][\w]{1,}$/.test(v) ? null : 'a UPI ID like name@oksbi'),
  upi_payee_name: (v) => (v.length <= 60 ? null : 'at most 60 characters'),
  upi_is_business: (v) => (v === '' || v === '0' || v === '1' ? null : '0 or 1'),
  alert_email: (v) =>
    v === '' || v.split(',').every((e) => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(e.trim())) ? null : 'email addresses separated by commas',
  meal_cutoff_time: (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? null : 'a time like 20:00'),
  meal_min_days_ahead: int(1, 7),
  meal_max_days_ahead: int(1, 60),
  unpaid_timeout_minutes: int(10, 1440),
  max_open_orders_per_phone: int(1, 20),
  free_delivery_above_paise: (v) => (v === '' || (/^\d+$/.test(v) && +v <= 10_000_000) ? null : 'an amount, or empty for off'),
  contact_whatsapp: (v) => (v === '' || /^91[6-9]\d{9}$/.test(v) ? null : '91 and then the 10-digit number'),
  contact_phone: (v) => (v === '' || /^\+91[6-9]\d{9}$/.test(v) ? null : '+91 and then the 10-digit number'),
  instagram_handle: (v) => (v === '' || /^[\w.]{1,30}$/.test(v) ? null : 'the handle without @'),
  fssai_number: (v) => (v === '' || /^\d{14}$/.test(v) ? null : 'the 14-digit FSSAI number'),
  turnstile_site_key: (v) => (v === '' || /^0x[\w-]{10,60}$/.test(v) ? null : 'the site key from Cloudflare Turnstile, starting with 0x'),
}

export const PINCODE_LIST_RE = /^[1-9]\d{5}$/

/** "500001, 500002\n500003" → ["500001", "500002", "500003"] (deduplicated, in order). */
export function parsePincodes(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))]
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Display order for the week, starting Monday. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

export const PRODUCT_ICONS = ['chicken', 'fish', 'prawn', 'jar', 'leaf'] as const
