import { cloneElement, useEffect, useId, useState, type ReactElement, type ReactNode } from 'react'
import { getQuote } from '../api'
import { cartStore, draftStore, useCart, type CheckoutDraft } from '../cart'
import { cartLines, indexVariants } from '../menu'
import { navigate } from '../router'
import { formatDate } from '../shared/dates'
import { rupees } from '../shared/money'
import { PINCODE_RE } from '../shared/quote'
import type { MenuResponse, Quote, Slot } from '../shared/types'
import { Notice } from './Layout'

export const PHONE_RE = /^[6-9]\d{9}$/

/** "+91 98765 43210", "098765-43210" → "9876543210" */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.length > 10 ? digits.replace(/^(91|0)/, '') : digits
}

type Errors = Partial<Record<keyof CheckoutDraft, string>>

function validate(d: CheckoutDraft): Errors {
  const e: Errors = {}
  if (d.name.trim().length < 2) e.name = 'Please enter your name.'
  if (!PHONE_RE.test(normalisePhone(d.phone))) e.phone = 'Enter a 10-digit Indian mobile number.'
  if (d.address.trim().length < 10) e.address = 'Please enter your full address: house, street and area.'
  if (!PINCODE_RE.test(d.pincode.trim())) e.pincode = 'Enter a 6-digit pincode.'
  return e
}

export function CheckoutPage({ menu }: { menu: MenuResponse }) {
  const cart = useCart()
  const [draft, setDraft] = useState<CheckoutDraft>(draftStore.get)
  const [errors, setErrors] = useState<Errors>({})
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const lines = cartLines(cart, indexVariants(menu), menu.mealDates)
  const hasMeals = lines.some((l) => l.product.category === 'meal')
  const pin = draft.pincode.trim()

  useEffect(() => draftStore.save(draft), [draft])

  // Ask the server for prices and the delivery charge whenever the cart, date or pincode changes.
  const key = JSON.stringify([cart, PINCODE_RE.test(pin) ? pin : ''])
  useEffect(() => {
    if (cart.items.length === 0) return
    let live = true
    const t = setTimeout(() => {
      getQuote({
        items: cart.items,
        pincode: PINCODE_RE.test(pin) ? pin : undefined,
        mealDate: cart.mealDate ?? undefined,
        mealSlot: cart.mealSlot ?? undefined,
      })
        .then((q) => live && (setQuote(q), setQuoteError(null)))
        .catch((e: Error) => live && setQuoteError(e.message))
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [key])

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center">
        <img src="/motifs/banana-leaf.webp" alt="" className="mx-auto w-24 mix-blend-multiply" />
        <p className="mt-4">Your cart is empty.</p>
        <button type="button" onClick={() => navigate('/')} className="caps mt-4 rounded-full bg-forest px-6 py-2.5 text-xs text-cream">
          See the menu
        </button>
      </div>
    )
  }

  const update = (k: keyof CheckoutDraft) => (e: { target: { value: string } }) => {
    setDraft((d) => ({ ...d, [k]: e.target.value }))
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }))
  }

  const day = menu.mealDates.find((d) => d.date === cart.mealDate)
  const problems = quote?.problems ?? []
  const pinProblem = problems.find((p) => p.code === 'pincode_outside' || p.code === 'pincode_invalid' || p.code === 'zone_no_meals')
  const otherProblems = problems.filter((p) => p !== pinProblem)

  const placeOrder = () => {
    const e = validate(draft)
    setErrors(e)
    if (Object.keys(e).length > 0) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      return
    }
    if (!quote?.ok) return
    setSubmitted(true)
  }

  return (
    <div className="mx-auto max-w-xl px-4 pt-4">
      <button type="button" onClick={() => navigate('/')} className="text-sm font-semibold text-forest underline underline-offset-4">
        ← Back to menu
      </button>
      <h1 className="mt-2 font-serif text-3xl text-forest">Checkout</h1>

      <form
        className="mt-4 space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          placeOrder()
        }}
      >
        <Section title="Your details">
          <Field label="Name" error={errors.name}>
            <input value={draft.name} onChange={update('name')} autoComplete="name" maxLength={80} />
          </Field>
          <Field label="Mobile number" hint="Your WhatsApp number if you have one. We'll contact you on it about this order." error={errors.phone}>
            <input value={draft.phone} onChange={update('phone')} type="tel" inputMode="tel" autoComplete="tel-national" maxLength={16} placeholder="98765 43210" />
          </Field>
        </Section>

        <Section title="Delivery address" note="We deliver in Hyderabad only.">
          <Field label="House, street and area" error={errors.address}>
            <textarea value={draft.address} onChange={update('address')} autoComplete="street-address" rows={3} maxLength={300} />
          </Field>
          <Field label="Landmark (optional)">
            <input value={draft.landmark} onChange={update('landmark')} maxLength={100} />
          </Field>
          <Field label="Pincode" error={errors.pincode ?? pinProblem?.message} ok={quote?.zone && PINCODE_RE.test(pin) && !pinProblem ? `Delivering to ${quote.zone.name}` : undefined}>
            <input value={draft.pincode} onChange={update('pincode')} inputMode="numeric" autoComplete="postal-code" maxLength={6} placeholder="500001" className="max-w-40" />
          </Field>
        </Section>

        {hasMeals && (
          <Section title="Meal delivery" note="Your whole order is delivered together on this date and slot.">
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-semibold text-forest">
                Date
                <select
                  className="field mt-1"
                  value={cart.mealDate ?? ''}
                  onChange={(e) => {
                    const d = menu.mealDates.find((x) => x.date === e.target.value)
                    cartStore.setMealSlot(e.target.value, d?.slots[cart.mealSlot ?? 'lunch'] ? cart.mealSlot : d?.slots.lunch ? 'lunch' : 'dinner')
                  }}
                >
                  {menu.mealDates.map((d) => (
                    <option key={d.date} value={d.date}>
                      {formatDate(d.date)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-semibold text-forest">
                Slot
                <select className="field mt-1" value={cart.mealSlot ?? ''} onChange={(e) => cartStore.setMealSlot(cart.mealDate, e.target.value as Slot)}>
                  {(['lunch', 'dinner'] as Slot[]).map((s) => (
                    <option key={s} value={s} disabled={!day?.slots[s]}>
                      {s === 'lunch' ? 'Lunch' : 'Dinner'}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Section>
        )}

        <Section title="Notes (optional)">
          <Field label="Anything we should know?">
            <textarea value={draft.notes} onChange={update('notes')} rows={2} maxLength={300} placeholder="Less spicy, call before delivery…" />
          </Field>
        </Section>

        <Section title="Order summary">
          <ul className="space-y-1.5 text-sm">
            {(quote?.lines ?? []).map((l) => (
              <li key={l.variantId} className="flex justify-between gap-2">
                <span>
                  {l.qty} × {l.productName} <span className="text-xs">({l.variantLabel})</span>
                </span>
                <span>{rupees(l.linePaise)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 space-y-1 border-t border-earth/15 pt-3 text-sm">
            <Row label="Subtotal" value={quote ? rupees(quote.subtotalPaise) : '…'} />
            <Row
              label="Delivery"
              value={quote?.deliveryFeePaise == null ? 'Enter pincode' : quote.deliveryFeePaise === 0 ? 'Free' : rupees(quote.deliveryFeePaise)}
            />
            <div className="flex justify-between pt-1 text-lg font-bold">
              <span className="text-forest">Total</span>
              <span className="text-spice">{quote ? rupees(quote.totalPaise) : '…'}</span>
            </div>
          </div>
          {!hasMeals && <p className="mt-2 text-xs">Pickles are shipped the same day your payment is confirmed.</p>}
        </Section>

        {quoteError && <Notice tone="error">{quoteError}</Notice>}
        {otherProblems.length > 0 && (
          <Notice tone="error">
            <ul className="space-y-1">
              {otherProblems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          </Notice>
        )}

        {submitted ? (
          <Notice>
            <strong>Thanks! Online ordering opens very soon.</strong> This is a preview, so orders and UPI payment aren't switched on yet.
          </Notice>
        ) : (
          <button
            type="submit"
            disabled={!!quote && !quote.ok && !!PINCODE_RE.test(pin)}
            className="caps w-full rounded-2xl bg-forest py-4 text-sm text-cream shadow active:bg-forest-dark disabled:opacity-40"
          >
            Place order{quote?.ok ? ` · ${rupees(quote.totalPaise)}` : ''}
          </button>
        )}
        <p className="text-center text-xs">You'll pay by UPI on the next step. Your order is confirmed once we see your payment.</p>
      </form>
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-2xl border border-earth/15 bg-paper p-4">
      <legend className="caps px-1 text-xs text-forest">{title}</legend>
      {note && <p className="mb-2 text-xs">{note}</p>}
      <div className="space-y-3">{children}</div>
    </fieldset>
  )
}

function Field({ label, hint, error, ok, children }: { label: string; hint?: string; error?: string; ok?: string; children: ReactElement<{ className?: string }> }) {
  const id = useId()
  const described = [hint && `${id}-hint`, (error || ok) && `${id}-msg`].filter(Boolean).join(' ') || undefined
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-forest">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-xs">
          {hint}
        </p>
      )}
      {cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        'aria-invalid': error ? 'true' : undefined,
        'aria-describedby': described,
        className: 'field mt-1 ' + (children.props.className ?? '') + (error ? ' border-spice' : ''),
      })}
      {error && (
        <p id={`${id}-msg`} className="mt-1 text-xs font-semibold text-spice">
          {error}
        </p>
      )}
      {!error && ok && (
        <p id={`${id}-msg`} className="mt-1 text-xs font-semibold text-forest">
          ✓ {ok}
        </p>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
