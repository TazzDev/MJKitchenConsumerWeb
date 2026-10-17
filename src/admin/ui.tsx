// Small building blocks for the admin app: hash routing, data loading, buttons, fields and badges.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ownerStatusLabel } from '../shared/admin'
import type { OrderStatus } from '../shared/orders'

// --- Routing: #/orders/check, #/order/MJ-1017-4821, #/menu … (hash routes need no server setup)

const subscribe = (l: () => void) => {
  window.addEventListener('hashchange', l)
  return () => window.removeEventListener('hashchange', l)
}

export function useRoute(): string[] {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
}

export function go(path: string) {
  window.location.hash = path
}

// --- Data loading

export function useLoad<T>(load: () => Promise<T>, deps: unknown[], { refreshMs = 0 } = {}) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const loadRef = useRef(load)
  loadRef.current = load

  const reload = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      setData(await loadRef.current())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setData(null)
    void reload()
  }, deps)

  // Keep lists fresh while the app is open and on screen.
  useEffect(() => {
    if (!refreshMs) return
    const tick = () => document.visibilityState === 'visible' && void reload(true)
    const t = window.setInterval(tick, refreshMs)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [refreshMs, reload])

  return { data, setData, error, loading, reload }
}

// --- Toast

let showToast: (msg: string, tone?: 'ok' | 'error') => void = () => {}
export const toast = (msg: string, tone: 'ok' | 'error' = 'ok') => showToast(msg, tone)

export function Toaster() {
  const [t, setT] = useState<{ msg: string; tone: 'ok' | 'error'; id: number } | null>(null)
  useEffect(() => {
    showToast = (msg, tone = 'ok') => setT({ msg, tone, id: Date.now() })
  }, [])
  useEffect(() => {
    if (!t) return
    const h = window.setTimeout(() => setT(null), t.tone === 'error' ? 6000 : 2500)
    return () => window.clearTimeout(h)
  }, [t])
  if (!t) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
      <div
        role={t.tone === 'error' ? 'alert' : 'status'}
        className={'rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ' + (t.tone === 'error' ? 'bg-spice text-cream' : 'bg-forest-dark text-cream')}
      >
        {t.msg}
      </div>
    </div>
  )
}

/** Runs an action with a busy flag and shows its error as a toast. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null)
  const run = async <T,>(key: string, fn: () => Promise<T>, done?: string): Promise<T | undefined> => {
    setBusy(key)
    try {
      const out = await fn()
      if (done) toast(done)
      return out
    } catch (e) {
      toast((e as Error).message, 'error')
      return undefined
    } finally {
      setBusy(null)
    }
  }
  return { busy, run }
}

// --- Pieces

export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-4 pt-4 pb-28">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl text-forest">{title}</h1>
        {actions}
      </div>
      {children}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={'rounded-2xl border border-earth/15 bg-paper p-4 shadow-sm ' + className}>{children}</div>
}

type BtnTone = 'primary' | 'danger' | 'plain' | 'gold'
const btnTone: Record<BtnTone, string> = {
  primary: 'bg-forest text-cream',
  danger: 'border border-spice/50 text-spice bg-transparent',
  plain: 'border border-earth/30 text-earth bg-transparent',
  gold: 'bg-gold text-forest-dark',
}

export function Button({
  tone = 'primary',
  busy,
  className = '',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: BtnTone; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={'rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-50 ' + btnTone[tone] + ' ' + className}
    >
      {busy ? 'Saving…' : children}
    </button>
  )
}

export function Label({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-forest">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-earth/80">{hint}</span>}
    </label>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 text-left text-sm font-semibold text-forest"
    >
      <span className={'relative h-6 w-11 shrink-0 rounded-full transition ' + (checked ? 'bg-forest' : 'bg-earth/30')}>
        <span className={'absolute top-0.5 size-5 rounded-full bg-cream shadow transition ' + (checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
      {label}
    </button>
  )
}

const STATUS_TONE: Record<OrderStatus, string> = {
  awaiting_payment: 'bg-earth/10 text-earth',
  payment_submitted: 'bg-gold/25 text-forest-dark',
  payment_rejected: 'bg-spice/12 text-spice',
  confirmed: 'bg-forest/12 text-forest',
  preparing: 'bg-forest/12 text-forest',
  out_for_delivery: 'bg-forest text-cream',
  delivered: 'bg-forest-dark/80 text-cream',
  cancelled: 'bg-earth/10 text-earth/70 line-through',
  expired: 'bg-earth/10 text-earth/70',
}

export function StatusBadge({ status, hasMeals }: { status: OrderStatus; hasMeals: boolean }) {
  return <span className={'inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ' + STATUS_TONE[status]}>{ownerStatusLabel(status, hasMeals)}</span>
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-spice/40 bg-spice/8 px-4 py-3 text-sm text-spice">
      {error}{' '}
      {onRetry && (
        <button type="button" className="font-semibold underline" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Loading() {
  return (
    <div className="space-y-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl bg-paper" />
      ))}
    </div>
  )
}

// --- Formatting

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const dayTimeFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

/** "4:05 pm" today, "17 Oct, 4:05 pm" otherwise. */
export function when(iso: string): string {
  const d = new Date(iso)
  const sameDay = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) === d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
  return sameDay ? timeFmt.format(d) : dayTimeFmt.format(d)
}

export function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

/** Rupee text input → paise, or null when it isn't a valid amount. */
export function toPaise(rupeesText: string): number | null {
  const t = rupeesText.trim().replace(/[₹,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100)
}

export const paiseToText = (p: number) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2))

export const slotName = (slot: 'lunch' | 'dinner') => (slot === 'lunch' ? 'Lunch' : 'Dinner')
