import { useEffect, useState } from 'react'
import { cartStore, useCart } from '../cart'
import { portionsLeft, resolveMealSlot } from '../menu'
import { formatDate } from '../shared/dates'
import { freeDeliveryNote } from '../shared/quote'
import type { Category, MenuResponse, Slot } from '../shared/types'
import { Notice } from './Layout'
import { ProductCard } from './ProductCard'

const TAB_KEY = 'mjk.tab'

function initialTab(): Category {
  try {
    return sessionStorage.getItem(TAB_KEY) === 'meal' ? 'meal' : 'pickle'
  } catch {
    return 'pickle'
  }
}

export function MenuPage({ menu }: { menu: MenuResponse }) {
  const [tab, setTab] = useState<Category>(initialTab)
  const cart = useCart()
  const meal = resolveMealSlot(cart, menu.mealDates)
  const { shop } = menu

  // Keep the cart's meal date/slot pointing at something that is still open.
  useEffect(() => {
    if (meal && (meal.date !== cart.mealDate || meal.slot !== cart.mealSlot)) cartStore.setMealSlot(meal.date, meal.slot)
  }, [meal?.date, meal?.slot, cart.mealDate, cart.mealSlot])

  const choose = (c: Category) => {
    setTab(c)
    try {
      sessionStorage.setItem(TAB_KEY, c)
    } catch {
      /* ignore */
    }
  }

  const products = menu.products.filter((p) => p.category === tab)
  const free = freeDeliveryNote(shop.freeDeliveryAbovePaise)

  return (
    <>
      <section className="relative overflow-hidden px-4 pt-5 pb-3 text-center">
        <img src="/motifs/palm.webp" alt="" aria-hidden="true" className="pointer-events-none absolute -left-2 top-2 w-16 opacity-40 sm:w-28" />
        <img src="/motifs/houseboat.webp" alt="" aria-hidden="true" className="pointer-events-none absolute -right-4 top-4 w-24 opacity-35 sm:w-40" />
        <p className="caps hidden text-[11px] text-earth sm:block">Homemade pickles · Kerala roots · Hyderabad home</p>
        <h1 className="mt-1 font-script text-[2.15rem] leading-[1.15] text-forest sm:text-5xl">
          A taste of Kerala <br className="sm:hidden" />
          in Hyderabad
        </h1>
        <p className="caps mt-1.5 text-[10px] text-earth sm:text-[11px]">Real ingredients · Bold flavours · A taste of home</p>
      </section>

      <div className="mx-auto max-w-3xl px-4">
        {!shop.open && (
          <div className="mb-4">
            <Notice tone="error">{shop.closedMessage}</Notice>
          </div>
        )}

        <div role="tablist" aria-label="Menu" className="sticky top-14 z-20 -mx-4 flex gap-2 bg-cream/95 px-4 py-2 backdrop-blur">
          {(
            [
              ['pickle', 'Pickles', '/icons/hl-jar.webp'],
              ['meal', 'Meals', '/motifs/banana-leaf.webp'],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              onClick={() => choose(id)}
              className={
                'flex flex-1 items-center justify-center gap-2 rounded-full border py-2 font-serif text-lg ' +
                (tab === id ? 'border-forest bg-forest text-cream' : 'border-earth/30 bg-paper text-forest')
              }
            >
              <img src={icon} alt="" className={'size-7 rounded-full object-contain ' + (tab === id ? '' : 'mix-blend-multiply')} />
              {label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-3 space-y-3">
          {tab === 'pickle' ? (
            <div className="flex items-center gap-3 rounded-xl bg-paper/70 px-3 py-2 text-sm">
              <img src="/icons/hl-truck.webp" alt="" className="size-10" />
              <p>
                <strong className="text-forest">Shipped the same day your payment is confirmed.</strong> Delivery in Hyderabad only; delivery charge
                is added at checkout.{free && ` ${free}.`}
              </p>
            </div>
          ) : (
            <MealPicker menu={menu} date={meal?.date ?? null} slot={meal?.slot ?? null} />
          )}

          {products.length === 0 && <p className="py-8 text-center">Nothing here right now. Please check back soon.</p>}

          {products.map((p, i) => {
            const left = p.category === 'meal' ? portionsLeft(menu.mealDates, meal?.date ?? null, meal?.slot ?? null, p.id) : undefined
            if (p.category === 'meal' && left === undefined) return null
            return <ProductCard key={p.id} product={p} portionsLeft={left} disabled={!shop.open} index={i} />
          })}

          {tab === 'meal' && meal && products.every((p) => portionsLeft(menu.mealDates, meal.date, meal.slot, p.id) === undefined) && (
            <p className="py-6 text-center">No meals for this slot. Try another date or slot.</p>
          )}
        </div>
      </div>
    </>
  )
}

function MealPicker({ menu, date, slot }: { menu: MenuResponse; date: string | null; slot: Slot | null }) {
  const { shop, mealDates } = menu
  const day = mealDates.find((d) => d.date === date)
  if (mealDates.length === 0) {
    return <Notice>Meal pre-orders are closed for now. Please check back soon.</Notice>
  }
  return (
    <div className="space-y-2 rounded-xl bg-paper/70 p-3">
      <p className="text-sm">
        <strong className="text-forest">Pre-order at least a day ahead.</strong> Orders for a date close at {formatTime(shop.mealCutoffTime)}
        {shop.mealMinDaysAhead === 1 ? ' the day before' : ` ${shop.mealMinDaysAhead} days before`}. Delivery charge is added at checkout.
      </p>
      <div>
        <p id="date-label" className="caps mb-1 text-[11px]">
          Delivery date
        </p>
        <div role="radiogroup" aria-labelledby="date-label" className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
          {mealDates.map((d) => {
            const [wd, rest] = formatDate(d.date).split(', ')
            const on = d.date === date
            return (
              <button
                key={d.date}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => cartStore.setMealSlot(d.date, d.slots[slot ?? 'lunch'] ? slot : d.slots.lunch ? 'lunch' : 'dinner')}
                className={
                  'flex shrink-0 flex-col items-center rounded-xl border px-3 py-1.5 leading-tight ' +
                  (on ? 'border-forest bg-forest text-cream' : 'border-earth/30 bg-paper text-earth')
                }
              >
                <span className="text-[11px] font-semibold uppercase">{wd}</span>
                <span className="text-sm font-bold">{rest}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div role="radiogroup" aria-label="Slot" className="flex gap-2">
        {(['lunch', 'dinner'] as Slot[]).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === slot}
            disabled={!day?.slots[s]}
            onClick={() => cartStore.setMealSlot(date, s)}
            className={
              'flex-1 rounded-full border py-1.5 text-sm font-semibold capitalize disabled:opacity-40 ' +
              (s === slot ? 'border-forest bg-forest text-cream' : 'border-earth/30 bg-paper text-earth')
            }
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`
}
