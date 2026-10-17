import type { ReactNode } from 'react'
import { navigate } from '../router'
import type { ShopInfo } from '../shared/types'
import { CartIcon, InstagramIcon, PhoneIcon, WhatsAppIcon } from './icons'

export function Header({ count, onCart }: { count: number; onCart: () => void }) {
  return (
    <header className="sticky top-0 z-30 bg-forest text-cream shadow-md">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault()
            navigate('/')
          }}
          className="flex items-center gap-2"
        >
          <span className="grid size-9 place-items-center rounded-full bg-cream">
            <img src="/brand/monogram.webp" alt="" className="h-6 w-auto" width="22" height="24" />
          </span>
          <span className="font-serif text-xl leading-none">
            MJ <span className="caps ml-0.5 font-sans text-xs font-semibold tracking-[0.3em]">Kitchen</span>
          </span>
        </a>
        <button
          type="button"
          onClick={onCart}
          className="relative flex items-center gap-1.5 rounded-full border border-cream/40 px-3 py-1.5 text-sm font-semibold"
          aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
        >
          <CartIcon className="size-5" />
          Cart
          {count > 0 && (
            <span className="absolute -top-1.5 -right-1.5 grid min-w-5 place-items-center rounded-full bg-gold px-1 text-xs font-bold text-forest-dark">
              {count}
            </span>
          )}
        </button>
      </div>
    </header>
  )
}

export function Footer({ shop }: { shop: ShopInfo | null }) {
  return (
    <footer className="mt-12 border-t border-earth/20 bg-paper/60 pb-28">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-8 text-center">
        <img src="/brand/badge-round.webp" alt="MJ Kitchen, homemade pickles" width="120" height="123" loading="lazy" className="size-28 object-contain" />
        <p className="caps text-xs text-earth">Let's stay connected</p>
        <div className="flex gap-4">
          {shop?.instagram && (
            <a href={`https://instagram.com/${shop.instagram}`} target="_blank" rel="noopener">
              <InstagramIcon />
            </a>
          )}
          {shop?.whatsapp && (
            <a href={`https://wa.me/${shop.whatsapp}`} target="_blank" rel="noopener">
              <WhatsAppIcon />
            </a>
          )}
          {shop?.phone && (
            <a href={`tel:${shop.phone}`}>
              <PhoneIcon />
            </a>
          )}
        </div>
        <a
          href="/track"
          onClick={(e) => {
            e.preventDefault()
            navigate('/track')
          }}
          className="text-sm font-semibold text-forest underline underline-offset-4"
        >
          Find my order
        </a>
        <p className="font-script text-2xl text-forest">Real ingredients. Happier days.</p>
        <div className="space-y-1 text-xs leading-relaxed">
          <p>Homemade Kerala-style pickles and meals, delivered in Hyderabad.</p>
          {shop?.fssai && <p>FSSAI Reg. No. {shop.fssai}</p>}
          <p>
            We only use your name, phone number and address to deliver your order, and never share them.
          </p>
        </div>
      </div>
    </footer>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={
        'rounded-xl border px-4 py-3 text-sm ' +
        (tone === 'error' ? 'border-spice/40 bg-spice/8 text-spice' : 'border-forest/25 bg-forest/6 text-forest')
      }
    >
      {children}
    </div>
  )
}
