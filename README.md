# MJ Kitchen order portal

Mobile-first order site for [MJ Kitchen](https://instagram.com/mjkitchen_hyd), a Hyderabad home kitchen selling Kerala-style pickles and meals. Customers order from the Instagram link and pay by UPI; there is no payment gateway.

Built on Cloudflare's free tier: Pages for the site, Pages Functions (Hono) for `/api`, D1 for data.

## What's here

- **Menu** with Pickles and Meals tabs. Meals are pre-ordered for a date and slot (lunch or dinner), at least a day ahead, with a portion limit per slot. Pickles ship once payment is confirmed.
- **Cart** kept in the browser, so it survives Instagram's in-app browser being closed.
- **Checkout** with name, mobile number, address and a Hyderabad pincode check that sets the delivery charge. Prices are always recalculated by the server.
- Orders and UPI payment come next; until then "Place order" shows a preview notice.

## Layout

| Path | What |
|------|------|
| `src/` | React storefront (Vite, Tailwind) |
| `src/shared/` | Code used by both the storefront and the API: types, IST dates and meal cutoff, pricing |
| `server/` | API routes (`app.ts`) and database reads (`db.ts`) |
| `functions/api/[[route]].ts` | Hands `/api/*` to the API on Cloudflare Pages |
| `migrations/` | D1 schema |
| `seed/menu.sql` | Starting menu and delivery zones |
| `public/` | Brand images, icons, web manifest |
| `docs/cloudflare-setup.md` | One-time Cloudflare setup and local development |

## Commands

```sh
npm install
npm test            # unit tests (pricing, cutoff, dates)
npm run typecheck
npm run preview     # build and serve site + API locally on :8788 (see docs for the local DB)
```

## API

- `GET /api/menu`: shop info, products with variants, and open meal dates with portions left per slot.
- `POST /api/quote` with `{ items: [{ variantId, qty }], pincode?, mealDate?, mealSlot? }`: server-side prices, delivery charge and any problems (sold out, outside Hyderabad, past the cutoff…).

Money is integer paise everywhere. All dates are Hyderabad dates (IST).
