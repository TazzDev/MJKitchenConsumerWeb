// Shapes shared by the API (server/) and the storefront (src/).

export type Category = 'pickle' | 'meal'
export type Slot = 'lunch' | 'dinner'
export const SLOTS: Slot[] = ['lunch', 'dinner']

export interface Variant {
  id: string
  label: string
  pricePaise: number
  weightG: number | null
  /** null = not tracked */
  stock: number | null
}

export interface Product {
  id: string
  category: Category
  name: string
  description: string
  spiceLevel: number
  isVeg: boolean
  icon: string | null
  imageUrl: string | null
  variants: Variant[]
}

export interface ShopInfo {
  open: boolean
  closedMessage: string
  whatsapp: string
  phone: string
  instagram: string
  fssai: string
  freeDeliveryAbovePaise: number | null
  mealCutoffTime: string
  mealMinDaysAhead: number
  /** False until a UPI ID and payee name are set; checkout then shows a preview notice. */
  orderingOpen: boolean
  /** Cloudflare Turnstile site key; null = bot check off. */
  turnstileSiteKey: string | null
}

/** Portions left per meal product, for one date and slot. */
export type MealPortions = Record<string, number>

export interface MealDate {
  date: string
  /** Order cutoff for this date, ISO timestamp. */
  closesAt: string
  slots: Partial<Record<Slot, MealPortions>>
}

export interface MenuResponse {
  shop: ShopInfo
  products: Product[]
  mealDates: MealDate[]
}

export interface CartItem {
  variantId: string
  qty: number
}

export interface QuoteRequest {
  items: CartItem[]
  pincode?: string
  mealDate?: string
  mealSlot?: Slot
}

export type ProblemCode =
  | 'empty_cart'
  | 'shop_closed'
  | 'unknown_item'
  | 'bad_quantity'
  | 'sold_out'
  | 'not_enough_stock'
  | 'meal_date_required'
  | 'meal_date_closed'
  | 'meal_not_available'
  | 'not_enough_portions'
  | 'pincode_invalid'
  | 'pincode_outside'
  | 'zone_no_meals'

export interface Problem {
  code: ProblemCode
  message: string
  variantId?: string
}

export interface QuoteLine {
  variantId: string
  productId: string
  productName: string
  variantLabel: string
  category: Category
  unitPricePaise: number
  qty: number
  linePaise: number
}

export interface Quote {
  ok: boolean
  lines: QuoteLine[]
  hasMeals: boolean
  subtotalPaise: number
  /** null until a valid Hyderabad pincode is known */
  deliveryFeePaise: number | null
  totalPaise: number
  zone: { id: string; name: string } | null
  problems: Problem[]
}
