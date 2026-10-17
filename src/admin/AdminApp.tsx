import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, setSignedOutHandler } from './api'
import { DeliveryPage } from './pages/Delivery'
import { KitchenPage } from './pages/Kitchen'
import { MenuPage } from './pages/Menu'
import { OrderDetailPage } from './pages/OrderDetail'
import { OrdersPage } from './pages/Orders'
import { SettingsPage } from './pages/Settings'
import { Button, ErrorBox, go, Toaster, useLoad, useRoute } from './ui'

type Session = { state: 'checking' } | { state: 'out' } | { state: 'in'; name: string }

export function AdminApp() {
  const [session, setSession] = useState<Session>({ state: 'checking' })

  useEffect(() => {
    setSignedOutHandler(() => setSession({ state: 'out' }))
    api.me().then(
      (me) => setSession({ state: 'in', name: me.name }),
      () => setSession({ state: 'out' }),
    )
  }, [])

  if (session.state === 'checking') return <Splash />
  if (session.state === 'out') return <Login onIn={(name) => setSession({ state: 'in', name })} />
  return (
    <>
      <Shell name={session.name} onOut={() => setSession({ state: 'out' })} />
      <Toaster />
    </>
  )
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center bg-forest">
      <img src="/admin/icon-192.png" alt="MJ Kitchen" className="size-24 rounded-3xl" />
    </div>
  )
}

function Login({ onIn }: { onIn: (name: string) => void }) {
  const [name, setName] = useState(() => localStorageGet('mjk.admin.name'))
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const me = await api.login(name, password)
      localStorageSet('mjk.admin.name', me.name)
      onIn(me.name)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-forest px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-3xl bg-cream p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <img src="/admin/icon-192.png" alt="" className="size-12 rounded-xl" />
          <div>
            <p className="font-serif text-2xl leading-tight text-forest">MJ Kitchen</p>
            <p className="caps text-xs">Admin</p>
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-forest">Your name</span>
          <input className="field" autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-forest">Password</span>
          <input className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <ErrorBox error={error} />}
        <Button type="submit" busy={busy} className="w-full py-3">
          Sign in
        </Button>
      </form>
    </div>
  )
}

function Shell({ name, onOut }: { name: string; onOut: () => void }) {
  const route = useRoute()
  const [section = 'orders', arg] = route
  // The "to check" count on the Orders tab, refreshed every minute.
  const summary = useLoad(() => api.summary(), [section, arg], { refreshMs: 60_000 })
  const toCheck = summary.data?.counts.check ?? 0

  useEffect(() => {
    document.title = toCheck ? `(${toCheck}) MJ Kitchen Admin` : 'MJ Kitchen Admin'
  }, [toCheck])

  let page: ReactNode
  if (section === 'order' && arg) page = <OrderDetailPage key={arg} code={arg} />
  else if (section === 'kitchen') page = <KitchenPage date={arg} />
  else if (section === 'menu') page = <MenuPage tab={arg === 'dates' ? 'dates' : arg === 'week' ? 'week' : 'dishes'} />
  else if (section === 'delivery') page = <DeliveryPage />
  else if (section === 'settings') page = <SettingsPage name={name} onSignOut={onOut} />
  else page = <OrdersPage view={arg} counts={summary.data?.counts ?? null} />

  const active = section === 'order' ? 'orders' : section
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 bg-forest text-cream shadow-md" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto flex h-12 max-w-2xl items-center justify-between px-4">
          <button type="button" onClick={() => go('/orders')} className="flex items-center gap-2">
            <img src="/admin/icon-192.png" alt="" className="size-8 rounded-lg" />
            <span className="font-serif text-lg">MJ Kitchen</span>
            <span className="caps text-[10px] text-cream/70">Admin</span>
          </button>
          <span className="text-xs text-cream/80">{name}</span>
        </div>
      </header>
      <main>{page}</main>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-earth/15 bg-cream/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto grid max-w-2xl grid-cols-5">
          <NavItem id="orders" active={active} label="Orders" badge={toCheck} icon="M4 6h16M4 12h16M4 18h10" />
          <NavItem id="kitchen" active={active} label="Kitchen" icon="M6 3v8a3 3 0 0 0 6 0V3M9 3v18M17 3c-2 2-2 6 0 8v10" />
          <NavItem id="menu" active={active} label="Menu" icon="M5 4h14v16H5zM9 8h6M9 12h6M9 16h4" />
          <NavItem id="delivery" active={active} label="Delivery" icon="M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-.1M17 19a2 2 0 1 0 0-.1" />
          <NavItem id="settings" active={active} label="Settings" icon="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-2V4h-4v2L9 8 7 7l-2 4 2 1v0l-2 1 2 4 2-1 2 2v2h4v-2l2-2 2 1 2-4z" />
        </div>
      </nav>
    </div>
  )
}

function NavItem({ id, active, label, icon, badge = 0 }: { id: string; active: string; label: string; icon: string; badge?: number }) {
  const on = active === id
  return (
    <button
      type="button"
      onClick={() => go('/' + id)}
      className={'relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ' + (on ? 'text-forest' : 'text-earth/70')}
      aria-current={on ? 'page' : undefined}
    >
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={on ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
        <path d={icon} />
      </svg>
      {label}
      {badge > 0 && (
        <span className="absolute top-1 left-1/2 ml-2 grid min-w-5 place-items-center rounded-full bg-spice px-1 text-[11px] font-bold text-cream">{badge}</span>
      )}
    </button>
  )
}

function localStorageGet(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function localStorageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}
