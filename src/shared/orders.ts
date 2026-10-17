// Order rules shared by the API and the storefront: validation, UPI links,
// expiry and the order states from the plan.

import { closesAt, type CutoffRule } from './dates'
import type { Slot } from './types'

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
}
