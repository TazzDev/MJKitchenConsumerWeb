// Search engine details that depend on the page or on the live menu.
// The static parts (link previews, canonical URL, base business details) are in index.html.
import type { MenuResponse } from './shared/types'

const SITE = 'https://mjkitchen.site'
const HOME_TITLE = document.title

const PAGES: Record<string, string> = {
  '/checkout': 'Checkout',
  '/track': 'Find my order',
}

/** Page title, and keep order, checkout and tracking pages out of search results. */
export function setPageMeta(path: string) {
  const name = path.startsWith('/order/') ? 'Your order' : PAGES[path]
  document.title = name ? `${name} · MJ Kitchen` : HOME_TITLE
  let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
  if (name) {
    if (!robots) {
      robots = document.createElement('meta')
      robots.name = 'robots'
      document.head.append(robots)
    }
    robots.content = 'noindex'
  } else robots?.remove()
}

/** Fill the business details in index.html with the menu, prices and contacts from the database. */
export function setMenuData(menu: MenuResponse) {
  const el = document.getElementById('ld-kitchen')
  if (!el) return
  let data: Record<string, unknown>
  try {
    data = JSON.parse(el.textContent ?? '')
  } catch {
    return
  }
  const { shop, products } = menu
  const sameAs = [shop.instagram && `https://www.instagram.com/${shop.instagram}`].filter(Boolean)
  const phone = shop.phone || shop.whatsapp
  const prices = products.flatMap((p) => p.variants.map((v) => v.pricePaise / 100))
  const section = (category: string, name: string) => ({
    '@type': 'MenuSection',
    name,
    hasMenuItem: products
      .filter((p) => p.category === category)
      .map((p) => ({
        '@type': 'MenuItem',
        name: p.name,
        description: p.description || undefined,
        suitableForDiet: p.isVeg ? 'https://schema.org/VegetarianDiet' : undefined,
        offers: p.variants.map((v) => ({
          '@type': 'Offer',
          name: v.label || undefined,
          price: (v.pricePaise / 100).toFixed(2),
          priceCurrency: 'INR',
          availability: `https://schema.org/${v.stock === 0 ? 'OutOfStock' : 'InStock'}`,
        })),
      })),
  })
  Object.assign(data, {
    telephone: phone ? '+' + phone.replace(/\D/g, '').replace(/^(?=\d{10}$)/, '91') : undefined,
    sameAs: sameAs.length ? sameAs : undefined,
    priceRange: prices.length ? `₹${Math.min(...prices)}–₹${Math.max(...prices)}` : undefined,
    hasMenu: {
      '@type': 'Menu',
      url: `${SITE}/`,
      hasMenuSection: [section('pickle', 'Pickles'), section('meal', 'Meals')].filter((s) => s.hasMenuItem.length),
    },
  })
  el.textContent = JSON.stringify(data)
}
