import type { Cart } from './cart'
import type { MealDate, MenuResponse, Product, Slot, Variant } from './shared/types'

export type VariantIndex = Map<string, { product: Product; variant: Variant }>

export function indexVariants(menu: MenuResponse): VariantIndex {
  return new Map(menu.products.flatMap((p) => p.variants.map((v) => [v.id, { product: p, variant: v }] as const)))
}

export function productImage(p: Product): string {
  if (p.imageUrl) return p.imageUrl
  if (p.icon === 'chicken') return '/icons/chicken.webp'
  if (p.icon === 'prawn') return '/icons/prawn.webp'
  return p.category === 'pickle' ? '/icons/hl-jar.webp' : '/motifs/banana-leaf.webp'
}

/** Portions left for a meal on the cart's date and slot; undefined when it isn't cooked then. */
export function portionsLeft(mealDates: MealDate[], date: string | null, slot: Slot | null, productId: string): number | undefined {
  if (!date || !slot) return undefined
  return mealDates.find((d) => d.date === date)?.slots[slot]?.[productId]
}

/** Keep the cart's meal date and slot valid: fall back to the first open date and slot. */
export function resolveMealSlot(cart: Cart, mealDates: MealDate[]): { date: string; slot: Slot } | null {
  const day = mealDates.find((d) => d.date === cart.mealDate)
  if (day && cart.mealSlot && day.slots[cart.mealSlot]) return { date: day.date, slot: cart.mealSlot }
  const first = mealDates[0]
  if (!first) return null
  const slot = (['lunch', 'dinner'] as Slot[]).find((s) => first.slots[s]) ?? 'lunch'
  return { date: first.date, slot }
}

export function cartCount(cart: Cart): number {
  return cart.items.reduce((n, i) => n + i.qty, 0)
}

export interface CartLine {
  variantId: string
  product: Product
  variant: Variant
  qty: number
  /** Why this line can't be ordered as it stands, if anything. */
  issue: string | null
}

export function cartLines(cart: Cart, index: VariantIndex, mealDates: MealDate[]): CartLine[] {
  return cart.items.flatMap((i) => {
    const hit = index.get(i.variantId)
    if (!hit) return []
    const { product, variant } = hit
    let issue: string | null = null
    if (variant.stock === 0) issue = 'Sold out'
    else if (variant.stock !== null && i.qty > variant.stock) issue = `Only ${variant.stock} left`
    else if (product.category === 'meal') {
      const left = portionsLeft(mealDates, cart.mealDate, cart.mealSlot, product.id)
      if (left === undefined || left === 0) issue = 'Not available for the chosen date and slot'
      else if (i.qty > left) issue = `Only ${left} portions left`
    }
    return [{ variantId: i.variantId, product, variant, qty: i.qty, issue }]
  })
}
