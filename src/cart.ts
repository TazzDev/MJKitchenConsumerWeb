// The cart lives in localStorage so it survives Instagram's in-app browser being closed.
import { useSyncExternalStore } from 'react'
import type { CartItem, Slot } from './shared/types'

export interface Cart {
  items: CartItem[]
  /** Delivery date and slot for meals; the whole order comes together on it. */
  mealDate: string | null
  mealSlot: Slot | null
}

export interface CheckoutDraft {
  name: string
  phone: string
  address: string
  landmark: string
  pincode: string
  notes: string
}

const CART_KEY = 'mjk.cart.v1'
const DRAFT_KEY = 'mjk.checkout.v1'
const empty: Cart = { items: [], mealDate: null, mealSlot: null }

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode: the cart just won't persist */
  }
}

let cart: Cart = read(CART_KEY, empty)
const listeners = new Set<() => void>()

function set(next: Cart) {
  cart = next
  write(CART_KEY, cart)
  listeners.forEach((l) => l())
}

export const cartStore = {
  get: () => cart,
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  setQty(variantId: string, qty: number) {
    const items = cart.items.filter((i) => i.variantId !== variantId)
    if (qty > 0) {
      const at = cart.items.findIndex((i) => i.variantId === variantId)
      items.splice(at < 0 ? items.length : at, 0, { variantId, qty })
    }
    set({ ...cart, items })
  },
  remove(variantIds: string[]) {
    set({ ...cart, items: cart.items.filter((i) => !variantIds.includes(i.variantId)) })
  },
  setMealSlot(mealDate: string | null, mealSlot: Slot | null) {
    set({ ...cart, mealDate, mealSlot })
  },
  clear() {
    set(empty)
  },
}

export function useCart(): Cart {
  return useSyncExternalStore(cartStore.subscribe, cartStore.get)
}

export const draftStore = {
  get: (): CheckoutDraft => read(DRAFT_KEY, { name: '', phone: '', address: '', landmark: '', pincode: '', notes: '' }),
  save: (d: CheckoutDraft) => write(DRAFT_KEY, d),
}
