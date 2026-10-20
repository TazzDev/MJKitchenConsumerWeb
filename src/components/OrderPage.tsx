import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ApiError, findOrder, getOrder, submitPayment } from '../api'
import { rememberOrder } from '../recent'
import { navigate } from '../router'
import { browserName, copyText, inApp, openInBrowserLink } from '../inapp'
import { qrCardPng } from '../qr'
import { formatDate } from '../shared/dates'
import { rupees } from '../shared/money'
import { normaliseUtr, STATUS_LABEL, TIMELINE, upiAppLink, UTR_RE, type OrderView, type UpiApp } from '../shared/orders'
import type { ShopInfo } from '../shared/types'
import { Notice } from './Layout'

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const dayTimeFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

export function OrderPage({ code, shop }: { code: string; shop: ShopInfo | null }) {
  const key = new URLSearchParams(window.location.search).get('k') ?? ''
  const [order, setOrder] = useState<OrderView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () =>
    getOrder(code, key).then(
      (o) => (setOrder(o), setError(null)),
      (e: Error) => setError(e.message),
    )

  useEffect(() => {
    if (!key) return
    rememberOrder(code, key)
    load()
  }, [code, key])

  // While we wait on the owner, check back now and then so the page moves on by itself.
  useEffect(() => {
    if (!order || ['delivered', 'cancelled', 'expired'].includes(order.status)) return
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 30_000)
    return () => clearInterval(t)
  }, [order?.status])

  if (!key) return <FindOrderPage initialCode={code} />
  if (error && !order) {
    return (
      <Page>
        <Notice tone="error">{error}</Notice>
        <button type="button" onClick={() => navigate('/track')} className="mt-4 text-sm font-semibold text-forest underline">
          Find my order
        </button>
      </Page>
    )
  }
  if (!order) return <Page><div className="h-64 animate-pulse rounded-2xl bg-paper" aria-busy="true" /></Page>

  const whatsapp = shop?.whatsapp
    ? `https://wa.me/${shop.whatsapp}?text=${encodeURIComponent(`Hi MJ Kitchen, about my order ${order.code}`)}`
    : null

  return (
    <Page>
      <p className="caps text-xs">Order {order.code}</p>
      <h1 className="mt-1 font-serif text-3xl text-forest">
        {order.payment ? `Pay ${rupees(order.totalPaise)}` : order.status === 'payment_submitted' ? 'Thank you!' : order.statusLabel}
      </h1>

      {order.status === 'payment_rejected' && (
        <div className="mt-3">
          <Notice tone="error">
            We couldn't find your payment for this order yet. Please check the amount and pay again, or message us on WhatsApp if you've
            already paid.
          </Notice>
        </div>
      )}
      {order.status === 'payment_submitted' && (
        <p className="mt-2">We're checking your payment. Your order is confirmed as soon as we see it, and this page updates by itself.</p>
      )}
      {order.status === 'expired' && (
        <div className="mt-3">
          <Notice tone="error">
            This order wasn't paid in time, so we released it. If you've already paid, message us on WhatsApp with your order number and
            we'll sort it out.
          </Notice>
        </div>
      )}

      {order.payment && <PaymentPanel order={order} code={code} accessKey={key} onPaid={setOrder} />}

      {!order.payment && <Timeline order={order} />}

      <Box title="Your order">
        <ul className="space-y-1.5 text-sm">
          {order.items.map((i, n) => (
            <li key={n} className="flex justify-between gap-2">
              <span>
                {i.qty} × {i.name} <span className="text-xs">({i.label})</span>
              </span>
              <span>{rupees(i.qty * i.unitPricePaise)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-1 border-t border-earth/15 pt-3 text-sm">
          <Row label="Subtotal" value={rupees(order.subtotalPaise)} />
          <Row label="Delivery" value={order.deliveryFeePaise === 0 ? 'Free' : rupees(order.deliveryFeePaise)} />
          <div className="flex justify-between pt-1 text-lg font-bold">
            <span className="text-forest">Total</span>
            <span className="text-spice">{rupees(order.totalPaise)}</span>
          </div>
        </div>
      </Box>

      <Box title="Delivery">
        <p className="text-sm">
          {order.deliveryDate && order.deliverySlot
            ? `${formatDate(order.deliveryDate)}, ${order.deliverySlot === 'lunch' ? 'lunch' : 'dinner'}`
            : 'Pickles are shipped the same day your payment is confirmed.'}
        </p>
        {order.dateChanged && order.deliveryDate && (
          <p className="mt-1 text-xs text-forest">Date changed to {formatDate(order.deliveryDate)}, as agreed with MJ Kitchen.</p>
        )}
        <p className="mt-2 text-sm">
          {order.customerName}, {order.phone}
          <br />
          {order.address}
          {order.landmark && `, near ${order.landmark}`}, {order.pincode}
        </p>
      </Box>

      <div className="mt-5 grid gap-3">
        {whatsapp && (
          <a href={whatsapp} target="_blank" rel="noopener" className="caps rounded-2xl border border-forest py-3 text-center text-xs text-forest">
            Message us on WhatsApp
          </a>
        )}
        <ShareLink code={order.code} />
      </div>
    </Page>
  )
}

const APPS: [UpiApp, string][] = [
  ['gpay', 'GPay'],
  ['phonepe', 'PhonePe'],
  ['paytm', 'Paytm'],
]

function PaymentPanel({ order, code, accessKey, onPaid }: { order: OrderView; code: string; accessKey: string; onPaid: (o: OrderView) => void }) {
  const pay = order.payment!
  const amount = rupees(order.totalPaise)
  // For a personal UPI ID, apps treat the buttons and a QR picked from the gallery as risky and may refuse
  // them (PhonePe: "You can pay up to ₹2,000 with QR codes via gallery"), so lead with paying by UPI ID.
  const idFirst = pay.linkLimitPaise !== null
  const buttons = !idFirst || order.totalPaise <= pay.linkLimitPaise!
  const [qr, setQr] = useState<string | null>(null)
  const [utr, setUtr] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [qrTip, setQrTip] = useState(false)
  const [appStuck, setAppStuck] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    qrCardPng({ link: pay.link, amount, code: order.code, payeeName: pay.payeeName, upiId: pay.upiId }).then(setQr, () => setQr(null))
  }, [pay.link])

  const copy = async (label: string, text: string) => {
    if (await copyText(text)) {
      setCopied(label)
      setTimeout(() => setCopied(null), 2000)
    } else {
      window.prompt('Copy this:', text)
    }
  }

  // Instagram's browser can't download files. Offer the share sheet where it
  // has one (Save image), otherwise ask for a screenshot.
  const saveQr = async (e: MouseEvent) => {
    if (!inApp || !qr) return
    e.preventDefault()
    try {
      const blob = await (await fetch(qr)).blob()
      const file = new File([blob], `MJ-Kitchen-${order.code}.png`, { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] })
        return
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
    }
    setQrTip(true)
  }

  // If the payment app didn't open, the page never went to the background.
  // Say so, instead of leaving the customer tapping a dead button.
  const openedApp = () => {
    setAppStuck(false)
    const t = setTimeout(() => document.visibilityState === 'visible' && setAppStuck(true), 2500)
    const gone = () => document.visibilityState === 'hidden' && clearTimeout(t)
    document.addEventListener('visibilitychange', gone, { once: true })
    window.addEventListener('pagehide', () => clearTimeout(t), { once: true })
  }

  const cleanUtr = normaliseUtr(utr)
  const utrError = cleanUtr && !UTR_RE.test(cleanUtr) ? 'The UPI reference number has 12 digits.' : null

  const paid = async () => {
    if (utrError) return
    setBusy(true)
    setError(null)
    const form = new FormData()
    form.set('utr', cleanUtr)
    if (file) form.set('screenshot', file)
    try {
      onPaid(await submitPayment(code, accessKey, form))
      window.scrollTo(0, 0)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const copyRows = (
    <div className="mt-2 space-y-2 text-sm">
      <CopyRow label="UPI ID" value={pay.upiId} copied={copied === 'id'} onCopy={() => copy('id', pay.upiId)} />
      <CopyRow label="Amount" value={amount} copied={copied === 'amt'} onCopy={() => copy('amt', (order.totalPaise / 100).toFixed(2))} />
      <CopyRow label="Note" value={order.code} copied={copied === 'code'} onCopy={() => copy('code', order.code)} />
    </div>
  )

  return (
    <>
      <p className="mt-1">
        to <strong className="text-forest">{pay.payeeName}</strong> by UPI.
        {order.expiresAt && ` Please pay by ${timeFmt.format(new Date(order.expiresAt))}, or the order is released.`}
      </p>

      <Box title="1 · Pay">
        {idFirst && (
          <>
            <p className="text-sm">
              Open any UPI app, choose <b>Pay to UPI ID</b>, paste our UPI ID and pay {amount}. Please put the order number in the note so we can
              match it.
            </p>
            {copyRows}
          </>
        )}

        {buttons && (
          <>
            <p className={'text-sm font-semibold text-forest' + (idFirst ? ' mt-2' : '')}>{idFirst ? 'Or open your app' : `Pay ${amount} with`}</p>
            <div className="grid grid-cols-3 gap-2">
              {APPS.map(([app, label]) => (
                <a
                  key={app}
                  href={upiAppLink(pay.link, app)}
                  onClick={openedApp}
                  className={
                    'rounded-2xl px-2 py-3.5 text-center text-sm font-semibold shadow ' +
                    (idFirst ? 'border border-forest text-forest' : 'bg-forest text-cream active:bg-forest-dark')
                  }
                >
                  {label}
                </a>
              ))}
            </div>
            <a href={pay.link} onClick={openedApp} className="block rounded-2xl border border-forest py-3 text-center text-sm font-semibold text-forest">
              Other UPI app
            </a>
            <p className="text-xs">
              Opens the app with the amount and order number filled in.{' '}
              {idFirst ? 'If the app refuses the payment, pay by UPI ID above.' : 'If nothing opens, use the QR below.'}
            </p>
            {appStuck && (
              <Notice>
                Didn't open? {inApp ? `Instagram's browser sometimes blocks payment apps. Open this page in ${browserName} and try again, or ` : ''}
                {inApp ? 'pay' : 'Pay'} with the {idFirst ? 'UPI ID above' : 'QR or UPI ID below'}.
                {inApp && <OpenInBrowser />}
              </Notice>
            )}
          </>
        )}

        <div className="mt-2 rounded-2xl border border-earth/15 bg-white/60 p-3 text-center">
          {qr ? (
            <img src={qr} alt={`UPI QR code to pay ${amount} for order ${order.code}`} className="mx-auto w-full max-w-64" />
          ) : (
            <div className="mx-auto aspect-[640/900] w-full max-w-64 animate-pulse rounded-xl bg-paper" />
          )}
          {idFirst ? (
            <p className="mt-2 text-xs">Paying from another phone? Scan this QR with its UPI app.</p>
          ) : (
            <>
              {qr && (
                <a href={qr} download={`MJ-Kitchen-${order.code}.png`} onClick={saveQr} className="caps mt-3 inline-block rounded-full bg-earth px-5 py-2 text-xs text-cream">
                  Save QR to gallery
                </a>
              )}
              {qrTip ? (
                <p className="mt-2 text-sm font-semibold text-forest">
                  Instagram's browser can't save images. Take a screenshot of this QR instead, then open your UPI app → Scan → pick the
                  screenshot from your gallery.
                </p>
              ) : (
                <p className="mt-2 text-xs">
                  Paying from this phone? Save the QR {inApp ? '(or take a screenshot)' : '(or press and hold it)'}, then open your UPI app →
                  Scan → pick it from the gallery.
                </p>
              )}
            </>
          )}
        </div>

        {!idFirst && (
          <>
            {copyRows}
            <p className="text-xs">Paying by UPI ID? Please put the order number in the payment note so we can match it.</p>
          </>
        )}
        {inApp && !appStuck && (
          <p className="text-xs">
            Trouble paying inside Instagram? <OpenInBrowser inline />
          </p>
        )}
      </Box>

      <Box title="2 · Tell us you've paid">
        <label className="block text-sm font-semibold text-forest" htmlFor="utr">
          UPI reference number (optional)
        </label>
        <p className="text-xs" id="utr-hint">
          12 digits, shown after payment. GPay: "UPI transaction ID". PhonePe: "UTR". Paytm: "UPI Ref No".
        </p>
        <input
          id="utr"
          className={'field mt-1 ' + (utrError ? 'border-spice' : '')}
          inputMode="numeric"
          autoComplete="off"
          maxLength={20}
          value={utr}
          onChange={(e) => setUtr(e.target.value)}
          aria-invalid={utrError ? 'true' : undefined}
          aria-describedby="utr-hint"
          placeholder="123456789012"
        />
        {utrError && <p className="text-xs font-semibold text-spice">{utrError}</p>}

        {order.screenshotUpload && (
          <div>
            <p className="mt-2 text-sm font-semibold text-forest">Payment screenshot (optional)</p>
            <input ref={fileInput} type="file" accept="image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => fileInput.current?.click()} className="mt-1 rounded-xl border border-earth/30 px-4 py-2 text-sm">
              {file ? `✓ ${file.name.slice(0, 30)}` : 'Add screenshot'}
            </button>
          </div>
        )}

        {error && <Notice tone="error">{error}</Notice>}
        <button
          type="button"
          onClick={paid}
          disabled={busy || !!utrError}
          className="caps mt-2 w-full rounded-2xl bg-forest py-4 text-sm text-cream shadow active:bg-forest-dark disabled:opacity-40"
        >
          {busy ? 'Sending…' : "I've paid"}
        </button>
        <p className="text-center text-xs">No reference number? Tap I've paid anyway and we'll match your payment by amount and time.</p>
      </Box>
    </>
  )
}

function Timeline({ order }: { order: OrderView }) {
  if (['cancelled', 'expired'].includes(order.status)) return null
  const reached = new Map(order.history.map((h) => [h.status, h.at]))
  const current = TIMELINE.indexOf(order.status === 'payment_rejected' ? 'awaiting_payment' : order.status)
  return (
    <Box title="Status">
      <ol className="space-y-2.5">
        {TIMELINE.map((s, i) => {
          const done = i <= current
          const at = reached.get(s)
          return (
            <li key={s} className="flex items-center gap-3 text-sm">
              <span className={'grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ' + (done ? 'bg-forest text-cream' : 'border border-earth/30')}>
                {done ? '✓' : i + 1}
              </span>
              <span className={i === current ? 'font-semibold text-forest' : done ? '' : 'opacity-60'}>
                {s === 'payment_submitted' ? 'Payment sent' : STATUS_LABEL[s]}
              </span>
              {at && done && <span className="ml-auto text-xs">{dayTimeFmt.format(new Date(at))}</span>}
            </li>
          )
        })}
      </ol>
    </Box>
  )
}

function ShareLink({ code }: { code: string }) {
  const [done, setDone] = useState(false)
  const url = window.location.href
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `MJ Kitchen order ${code}`, url })
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
      }
    }
    if (await copyText(url)) setDone(true)
    else window.prompt('Copy this link to check your order later:', url)
  }
  return (
    <button type="button" onClick={share} className="text-sm font-semibold text-forest underline underline-offset-4">
      {done ? 'Link copied. Keep it to check your order.' : 'Save or share this order link'}
    </button>
  )
}

export function FindOrderPage({ initialCode = '' }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode)
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      const o = await findOrder(code, phone)
      navigate(`/order/${o.code}?k=${encodeURIComponent(o.key)}`, { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Page>
      <h1 className="font-serif text-3xl text-forest">Find my order</h1>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          go()
        }}
      >
        <label className="block text-sm font-semibold text-forest">
          Order number
          <input className="field mt-1" value={code} onChange={(e) => setCode(e.target.value)} placeholder="MJ-1017-4821" autoCapitalize="characters" />
        </label>
        <label className="block text-sm font-semibold text-forest">
          Mobile number used for the order
          <input className="field mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" placeholder="98765 43210" />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" disabled={busy} className="caps w-full rounded-2xl bg-forest py-3.5 text-sm text-cream disabled:opacity-40">
          Find order
        </button>
      </form>
    </Page>
  )
}

/** Leaves Instagram's browser for Chrome or Safari, keeping this order's link. */
function OpenInBrowser({ inline = false }: { inline?: boolean }) {
  const link = openInBrowserLink()
  const tip = `tap ••• at the top right and choose Open in ${browserName === 'Safari' ? 'external browser' : 'Chrome'}`
  if (!link) return <span> To open it, {tip}.</span>
  return (
    <>
      <a href={link} className={inline ? 'font-semibold underline' : 'caps mt-2 block rounded-full bg-forest px-4 py-2 text-center text-xs text-cream'}>
        Open in {browserName}
      </a>
      <span className="mt-1 block text-xs">If that doesn't work, {tip}.</span>
    </>
  )
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-xl px-4 pt-5">{children}</div>
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 space-y-3 rounded-2xl border border-earth/15 bg-paper p-4">
      <h2 className="caps text-xs text-forest">{title}</h2>
      {children}
    </section>
  )
}

function CopyRow({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-earth/15 bg-white/60 px-3 py-2">
      <span className="min-w-0">
        <span className="block text-xs">{label}</span>
        <span className="block truncate font-semibold text-forest">{value}</span>
      </span>
      <button type="button" onClick={onCopy} className="shrink-0 rounded-full border border-forest/40 px-3 py-1 text-xs font-semibold text-forest">
        {copied ? 'Copied' : 'Copy'}
      </button>
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
