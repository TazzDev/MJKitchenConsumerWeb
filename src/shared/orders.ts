// Order rules shared by the API and the storefront: validation, UPI links,
// expiry and the order states from the plan.

import { closesAt, formatDate, isIsoDate, type CutoffRule } from './dates'
import { SLOTS, type Slot } from './types'

export type OrderStatus =
  | 'awaiting_payment'
  | 'payment_submitted'
  | 'payment_rejected'
  | 'confirmed'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'expired'

export type PaymentProof = 'utr' | 'screenshot' | 'both' | 'none'

/** Statuses where the customer can still pay (or pay again after a rejection). */
export const PAYABLE: OrderStatus[] = ['awaiting_payment', 'payment_rejected']

export const PHONE_RE = /^[6-9]\d{9}$/
export const UTR_RE = /^\d{12}$/

/** "+91 98765 43210", "098765-43210" → "9876543210" */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.length > 10 ? digits.replace(/^(91|0)/, '') : digits
}

/** Spaces and dashes people paste from their UPI app are dropped. */
export function normaliseUtr(raw: string): string {
  return raw.replace(/[\s-]/g, '')
}

/** "MJ-1017-4821": month and day in Hyderabad, then four random digits. */
export function orderCode(istDate: string, random4: number): string {
  return `MJ-${istDate.slice(5, 7)}${istDate.slice(8, 10)}-${String(random4 % 10000).padStart(4, '0')}`
}

export const ORDER_CODE_RE = /^MJ-\d{4}-\d{4}$/

export interface UpiPayee {
  upiId: string
  payeeName: string
}

/**
 * Standard UPI deep link (NPCI "upi://pay"), understood by GPay, PhonePe, Paytm
 * and the rest. The same text is what the QR code encodes.
 */
export function upiLink(payee: UpiPayee, amountPaise: number, code: string): string {
  const q = [
    ['pa', payee.upiId],
    ['pn', payee.payeeName],
    ['am', (amountPaise / 100).toFixed(2)],
    ['cu', 'INR'],
    ['tn', `MJ Kitchen ${code}`],
  ]
  return 'upi://pay?' + q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
}

export type UpiApp = 'gpay' | 'phonepe' | 'paytm'

/**
 * App-specific versions of the upi:// link, so the customer picks the app
 * instead of whatever their phone has set as the default UPI handler (often
 * WhatsApp). These are the schemes each app registers on Android and iPhone.
 */
const APP_SCHEMES: Record<UpiApp, string> = {
  gpay: 'tez://upi/pay',
  phonepe: 'phonepe://pay',
  paytm: 'paytmmp://pay',
}

export function upiAppLink(link: string, app: UpiApp): string {
  return link.replace(/^upi:\/\/pay/, APP_SCHEMES[app])
}

/**
 * When an unpaid order lapses: after the timeout, or when its meal date's
 * ordering closes, whichever is sooner.
 */
export function expiresAt(now: Date, timeoutMinutes: number, mealDate: string | null, rule: CutoffRule): Date {
  const byTimeout = now.getTime() + Math.max(10, timeoutMinutes) * 60_000
  if (!mealDate) return new Date(byTimeout)
  return new Date(Math.min(byTimeout, closesAt(mealDate, rule).getTime()))
}

export function paymentProof(utr: string | null, screenshot: boolean): PaymentProof {
  if (utr && screenshot) return 'both'
  if (utr) return 'utr'
  if (screenshot) return 'screenshot'
  return 'none'
}

/**
 * Unpaid order moved to another date by the owner: a fresh payment window from
 * now, cut short by the new date's ordering cutoff only while that is still
 * ahead (the owner may move an order inside the cutoff on purpose).
 */
export function movedExpiresAt(now: Date, timeoutMinutes: number, mealDate: string, rule: CutoffRule): Date {
  const byTimeout = now.getTime() + Math.max(10, timeoutMinutes) * 60_000
  const closes = closesAt(mealDate, rule).getTime()
  return new Date(closes > now.getTime() ? Math.min(byTimeout, closes) : byTimeout)
}

// A date change is logged as an order event that keeps the status
// (from_status = to_status), with the old and new date in its note.

export interface MealWhen {
  date: string
  slot: Slot
}

export interface DateMove {
  from: MealWhen
  to: MealWhen
  reason: string
}

const MOVE_PREFIX = 'Date changed: '
const MOVE_RE = /^Date changed: (\d{4}-\d{2}-\d{2}) (lunch|dinner) → (\d{4}-\d{2}-\d{2}) (lunch|dinner)(?: · ([\s\S]*))?$/

export function dateMoveNote(m: DateMove): string {
  const reason = m.reason.trim()
  return `${MOVE_PREFIX}${m.from.date} ${m.from.slot} → ${m.to.date} ${m.to.slot}${reason ? ` · ${reason}` : ''}`
}

export function parseDateMove(note: string): DateMove | null {
  const m = MOVE_RE.exec(note)
  if (!m || !isIsoDate(m[1]) || !isIsoDate(m[3])) return null
  return { from: { date: m[1], slot: m[2] as Slot }, to: { date: m[3], slot: m[4] as Slot }, reason: m[5] ?? '' }
}

export const isSlot = (v: unknown): v is Slot => SLOTS.includes(v as Slot)

/** "Sun, 25 Oct dinner" */
export function formatWhen(w: MealWhen): string {
  return `${formatDate(w.date)} ${w.slot}`
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: 'Waiting for payment',
  payment_submitted: 'Checking your payment',
  payment_rejected: 'Payment not found',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

/** The happy path, for the status timeline. */
export const TIMELINE: OrderStatus[] = ['awaiting_payment', 'payment_submitted', 'confirmed', 'preparing', 'out_for_delivery', 'delivered']

// API shapes

export interface CreateOrderRequest {
  items: { variantId: string; qty: number }[]
  mealDate?: string
  mealSlot?: Slot
  name: string
  phone: string
  address: string
  landmark?: string
  pincode: string
  notes?: string
  source?: string
  turnstileToken?: string
}

export interface CreateOrderResponse {
  code: string
  key: string
}

export interface OrderView {
  code: string
  status: OrderStatus
  statusLabel: string
  createdAt: string
  expiresAt: string | null
  customerName: string
  phone: string
  address: string
  landmark: string
  pincode: string
  deliveryDate: string | null
  deliverySlot: Slot | null
  items: { name: string; label: string; qty: number; unitPricePaise: number }[]
  subtotalPaise: number
  deliveryFeePaise: number
  totalPaise: number
  utr: string | null
  hasScreenshot: boolean
  /** Present while the customer can pay. Always the current UPI settings. */
  payment: (UpiPayee & { link: string }) | null
  /** Whether "I've paid" can take a screenshot (needs the R2 bucket). */
  screenshotUpload: boolean
  history: { status: OrderStatus; at: string }[]
  /** Set when MJ Kitchen moved the order to another date (the latest move). */
  dateChanged: { at: string } | null
}
