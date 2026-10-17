import { useEffect, useState } from 'react'
import { getMenu } from './api'
import { useCart } from './cart'
import { CartBar, CartSheet } from './components/CartSheet'
import { CheckoutPage } from './components/CheckoutPage'
import { Footer, Header, Notice } from './components/Layout'
import { MenuPage } from './components/MenuPage'
import { FindOrderPage, OrderPage } from './components/OrderPage'
import { cartCount } from './menu'
import { usePath } from './router'
import type { MenuResponse } from './shared/types'

export function App() {
  const path = usePath()
  const cart = useCart()
  const [menu, setMenu] = useState<MenuResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  // Order pages work even if the menu can't load.
  const orderCode = path.startsWith('/order/') ? decodeURIComponent(path.slice('/order/'.length)) : null
  const shopping = !orderCode && path !== '/track' && path !== '/checkout'

  const load = () => {
    setError(null)
    getMenu().then(setMenu, (e: Error) => setError(e.message))
  }
  useEffect(load, [])

  // Remember where the visitor came from (?src=ig) for the order record.
  useEffect(() => {
    const src = new URLSearchParams(window.location.search).get('src')
    if (src) {
      try {
        sessionStorage.setItem('mjk.src', src.slice(0, 20))
      } catch {
        /* ignore */
      }
    }
  }, [])

  return (
    <div className="flex min-h-dvh flex-col">
      <Header count={cartCount(cart)} onCart={() => setCartOpen(true)} />
      <main className="flex-1">
        {orderCode ? (
          <OrderPage key={orderCode} code={orderCode} shop={menu?.shop ?? null} />
        ) : path === '/track' ? (
          <FindOrderPage />
        ) : error ? (
          <div className="mx-auto max-w-xl px-4 py-10">
            <Notice tone="error">
              {error}{' '}
              <button type="button" className="font-semibold underline" onClick={load}>
                Try again
              </button>
            </Notice>
          </div>
        ) : !menu ? (
          <MenuSkeleton />
        ) : path === '/checkout' ? (
          <CheckoutPage menu={menu} />
        ) : (
          <MenuPage menu={menu} />
        )}
      </main>
      <Footer shop={menu?.shop ?? null} />
      {menu && shopping && <CartBar menu={menu} onOpen={() => setCartOpen(true)} />}
      {menu && <CartSheet menu={menu} open={cartOpen} onClose={() => setCartOpen(false)} />}
    </div>
  )
}

function MenuSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-3 px-4 pt-24" aria-busy="true" aria-label="Loading the menu">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-32 animate-pulse rounded-2xl bg-paper" />
      ))}
    </div>
  )
}
