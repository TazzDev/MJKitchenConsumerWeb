import { useEffect, useRef } from 'react'
import { cartStore, useCart } from '../cart'
import { cartCount, cartLines, indexVariants } from '../menu'
import { navigate } from '../router'
import { formatDate } from '../shared/dates'
import { rupees } from '../shared/money'
import { MAX_QTY } from '../shared/quote'
import type { MenuResponse } from '../shared/types'
import { Stepper } from './ProductCard'

export function CartBar({ menu, onOpen }: { menu: MenuResponse; onOpen: () => void }) {
  const cart = useCart()
  const lines = cartLines(cart, indexVariants(menu), menu.mealDates)
  const count = cartCount(cart)
  if (count === 0) return null
  const subtotal = lines.reduce((s, l) => s + l.variant.pricePaise * l.qty, 0)
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 animate-rise px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <button
        type="button"
        onClick={onOpen}
        className="mx-auto flex w-full max-w-3xl items-center justify-between rounded-2xl bg-forest px-5 py-3.5 text-cream shadow-lg active:bg-forest-dark"
      >
        <span key={subtotal} className="animate-[fade-in_300ms_ease-out] text-sm font-semibold">
          {count} item{count === 1 ? '' : 's'} · {rupees(subtotal)}
        </span>
        <span className="caps text-xs">View cart →</span>
      </button>
    </div>
  )
}

export function CartSheet({ menu, open, onClose }: { menu: MenuResponse; open: boolean; onClose: () => void }) {
  const cart = useCart()
  const ref = useRef<HTMLDialogElement>(null)
  const lines = cartLines(cart, indexVariants(menu), menu.mealDates)
  const subtotal = lines.reduce((s, l) => s + l.variant.pricePaise * l.qty, 0)
  const hasMeals = lines.some((l) => l.product.category === 'meal')
  const hasPickles = lines.some((l) => l.product.category === 'pickle')
  const blocked = lines.some((l) => l.issue)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="cart-title"
      className="m-0 mt-auto max-h-[85dvh] w-full max-w-none rounded-t-3xl bg-cream p-0 text-earth backdrop:bg-forest-dark/50 sm:mx-auto sm:max-w-xl"
    >
      <div className="flex max-h-[85dvh] flex-col">
        <div className="flex items-center justify-between border-b border-earth/15 px-5 py-4">
          <h2 id="cart-title" className="font-serif text-2xl text-forest">
            Your cart
          </h2>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full text-2xl" aria-label="Close cart">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {lines.length === 0 ? (
            <div className="py-10 text-center">
              <img src="/motifs/banana-leaf.webp" alt="" className="mx-auto w-20 mix-blend-multiply" />
              <p className="mt-3">Your cart is empty.</p>
            </div>
          ) : (
            <ul className="divide-y divide-earth/10">
              {lines.map((l) => (
                <li key={l.variantId} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-forest">{l.product.name}</p>
                    <p className="text-xs">
                      {l.variant.label} · {rupees(l.variant.pricePaise)}
                    </p>
                    {l.issue && (
                      <p className="mt-0.5 text-xs font-semibold text-spice">
                        {l.issue}.{' '}
                        <button type="button" className="underline" onClick={() => cartStore.remove([l.variantId])}>
                          Remove
                        </button>
                      </p>
                    )}
                  </div>
                  <Stepper qty={l.qty} max={Math.min(MAX_QTY, l.variant.stock ?? MAX_QTY)} label={l.product.name} onChange={(n) => cartStore.setQty(l.variantId, n)} />
                  <p className="w-16 text-right font-bold text-spice">{rupees(l.variant.pricePaise * l.qty)}</p>
                </li>
              ))}
            </ul>
          )}

          {lines.length > 0 && (
            <div className="mt-3 space-y-1 rounded-xl bg-paper/70 p-3 text-sm">
              {hasMeals && cart.mealDate && cart.mealSlot && (
                <p>
                  <strong className="text-forest">
                    Meals for {formatDate(cart.mealDate)}, {cart.mealSlot}.
                  </strong>{' '}
                  {hasPickles && 'Your pickles come with them in the same delivery.'}
                </p>
              )}
              {!hasMeals && <p>Pickles are shipped the same day your payment is confirmed.</p>}
              <p>Delivery charge is added at checkout once we know your pincode.</p>
            </div>
          )}
        </div>

        {lines.length > 0 && (
          <div className="border-t border-earth/15 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="mb-3 flex justify-between text-base">
              <span>Subtotal</span>
              <span className="font-bold text-spice">{rupees(subtotal)}</span>
            </div>
            <button
              type="button"
              disabled={blocked}
              onClick={() => {
                onClose()
                navigate('/checkout')
              }}
              className="caps w-full rounded-2xl bg-forest py-3.5 text-sm text-cream shadow active:bg-forest-dark disabled:opacity-40"
            >
              Checkout
            </button>
            {blocked && <p className="mt-2 text-center text-xs text-spice">Remove or change the items marked above to continue.</p>}
          </div>
        )}
      </div>
    </dialog>
  )
}
