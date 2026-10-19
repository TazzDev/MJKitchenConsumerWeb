// Shapes and rules shared by the admin API (server/admin.ts) and the admin app (src/admin/).

import type { OrderStatus, PaymentProof } from './orders'
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
}

export interface AdminSummary {
  counts: Record<OrderListView, number>
}

export interface KitchenDay {
  date: string
  slots: { slot: Slot; dishes: { name: string; category: Category; qty: number; unverified: number }[] }[]
  orders: { code: string; slot: Slot | null; customerName: string; phone: string; totalPaise: number; status: OrderStatus; hasMeals: boolean }[]
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
