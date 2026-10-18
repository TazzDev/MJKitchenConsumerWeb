import { useState } from 'react'
import { cartStore, useCart } from '../cart'
import { productImage } from '../menu'
import { rupees } from '../shared/money'
import { MAX_QTY } from '../shared/quote'
import type { Product } from '../shared/types'
import { FoodMark, Spice } from './icons'

export function ProductCard({
  product,
  portionsLeft,
  disabled,
  index = 0,
}: {
  product: Product
  portionsLeft?: number
  disabled?: boolean
  /** Position in the list, to stagger the entrance a little. */
  index?: number
}) {
  const cart = useCart()
  const [variantId, setVariantId] = useState(product.variants.find((v) => v.stock !== 0)?.id ?? product.variants[0].id)
  const variant = product.variants.find((v) => v.id === variantId) ?? product.variants[0]
  const qty = cart.items.find((i) => i.variantId === variant.id)?.qty ?? 0
  const isMeal = product.category === 'meal'
  const soldOut = variant.stock === 0 || (isMeal && portionsLeft === 0)
  const cap = Math.min(MAX_QTY, variant.stock ?? MAX_QTY, isMeal ? (portionsLeft ?? 0) : MAX_QTY)

  return (
    <article
      className={'lift flex animate-rise gap-3 rounded-2xl border border-earth/15 bg-paper p-3 shadow-sm ' + (soldOut ? 'opacity-70' : '')}
      style={{ animationDelay: `${Math.min(index, 6) * 50}ms` }}
    >
      <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-xl bg-cream">
        <img src={productImage(product)} alt="" width="96" height="96" loading="lazy" className={'size-20 object-contain mix-blend-multiply ' + (soldOut ? 'grayscale' : '')} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-1.5">
          <span className="mt-1">
            <FoodMark veg={product.isVeg} />
          </span>
          <h3 className="font-serif text-lg leading-snug text-forest">{product.name}</h3>
        </div>
        <p className="mt-0.5 text-sm leading-snug">{product.description}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Spice level={product.spiceLevel} />
          {isMeal && <span className="rounded-full bg-earth px-2 py-0.5 text-[11px] font-semibold text-cream">Pre-order</span>}
          {isMeal && portionsLeft !== undefined && portionsLeft > 0 && portionsLeft <= 10 && (
            <span className="rounded-full border border-gold bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-earth">
              {portionsLeft} left
            </span>
          )}
        </div>

        {product.variants.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Size">
            {product.variants.map((v) => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={v.id === variant.id}
                onClick={() => setVariantId(v.id)}
                className={
                  'rounded-full border px-2.5 py-1 text-xs font-semibold ' +
                  (v.id === variant.id ? 'border-forest bg-forest text-cream' : 'border-earth/40 text-earth') +
                  (v.stock === 0 ? ' line-through' : '')
                }
              >
                {v.label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <p>
            <span className="text-lg font-bold text-spice">{rupees(variant.pricePaise)}</span>
            {product.variants.length === 1 && <span className="ml-1.5 text-xs">{variant.label}</span>}
          </p>
          {soldOut ? (
            <span className="caps rounded-full border border-spice/50 px-3 py-1.5 text-xs text-spice">Sold out</span>
          ) : qty === 0 ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => cartStore.setQty(variant.id, 1)}
              className="caps rounded-full bg-forest px-5 py-2 text-xs text-cream shadow-sm active:bg-forest-dark disabled:opacity-40"
            >
              Add
            </button>
          ) : (
            <Stepper qty={qty} max={cap} label={product.name} onChange={(n) => cartStore.setQty(variant.id, n)} />
          )}
        </div>
      </div>
    </article>
  )
}

export function Stepper({ qty, max, label, onChange }: { qty: number; max: number; label: string; onChange: (n: number) => void }) {
  return (
    <div className="flex animate-pop items-center rounded-full bg-forest text-cream shadow-sm">
      <button type="button" className="grid size-9 place-items-center text-lg" aria-label={`One less ${label}`} onClick={() => onChange(qty - 1)}>
        −
      </button>
      <span key={qty} className="min-w-6 animate-bump text-center text-sm font-bold" aria-live="polite">
        {qty}
      </span>
      <button
        type="button"
        className="grid size-9 place-items-center text-lg disabled:opacity-40"
        aria-label={`One more ${label}`}
        disabled={qty >= max}
        onClick={() => onChange(qty + 1)}
      >
        +
      </button>
    </div>
  )
}
