# MJ Kitchen order portal

Mobile-first order site for [MJ Kitchen](https://instagram.com/mjkitchen_hyd), a Hyderabad home kitchen selling Kerala-style pickles and meals. Customers order from the Instagram link and pay by UPI; there is no payment gateway.

Built on Cloudflare's free tier: one Worker serves the site as static assets and the `/api` routes (Hono), with D1 for data.

## What's here

- **Menu** with Pickles and Meals tabs. Meals are pre-ordered for a date and slot (lunch or dinner), at least a day ahead, with a portion limit per slot. Pickles ship once payment is confirmed.
- **Cart** kept in the browser, so it survives Instagram's in-app browser being closed.
- **Checkout** with name, mobile number, address and a Hyderabad pincode check that sets the delivery charge. Prices are always recalculated by the server.
- **Orders**: the server re-prices the cart, reserves meal portions and stock, and gives the order a number like `MJ-1018-4821` and a private status link.
- **UPI payment** without a gateway: a "Pay with UPI app" button (`upi://pay` link), a QR card the customer can save to the gallery, and copy buttons for the UPI ID, amount and order number. "I've paid" takes an optional 12-digit UPI reference and, if R2 is set up, a screenshot.
- **Order status page** that updates by itself, plus "Find my order" by order number and phone.
- **Owner emails** for every new order and every "I've paid" (Resend), and a kitchen sheet after each day's cutoff.
- **Every 15 minutes** (Cron Trigger), unpaid orders past their time expire and release their portions.

## Order states

`awaiting_payment` → (customer taps "I've paid") → `payment_submitted` → (owner checks) → `confirmed` → `preparing` → `out_for_delivery` → `delivered`. Unpaid orders become `expired`; the owner can mark a payment `payment_rejected`, after which the customer can try again, or `cancelled`. Every change is logged in `order_events`.

## Layout

| Path | What |
|------|------|
| `src/` | React storefront (Vite, Tailwind) |
| `src/shared/` | Code used by both the storefront and the API: types, IST dates and meal cutoff, pricing |
| `server/` | API routes (`app.ts`) and database reads (`db.ts`) |
| `server/worker.ts` | Worker entry; `/api/*` runs here, everything else is served from `dist/` |
| `migrations/` | D1 schema |
| `seed/menu.sql` | Starting menu and delivery zones |
| `seed/payment.sql` | UPI ID, payee name and alert email (settings; change any time) |
| `public/` | Brand images, icons, web manifest |
| `docs/cloudflare-setup.md` | One-time Cloudflare setup and local development |

## Commands

```sh
npm install
npm test            # unit tests (pricing, cutoff, dates)
npm run typecheck
npm run preview     # build and serve site + API locally on :8787 (see docs for the local DB)
```

## API

- `GET /api/menu`: shop info, products with variants, and open meal dates with portions left per slot.
- `POST /api/quote` with `{ items: [{ variantId, qty }], pincode?, mealDate?, mealSlot? }`: server-side prices, delivery charge and any problems (sold out, outside Hyderabad, past the cutoff…).

- `POST /api/orders` with the quote fields plus `name, phone, address, landmark?, pincode, notes?, source?, turnstileToken?`: places the order, returns `{ code, key }`.
- `GET /api/orders/:code?k=key`: the order, its history, and the UPI details while it can be paid.
- `POST /api/orders/:code/payment?k=key` (form data: `utr?`, `screenshot?`): "I've paid".
- `POST /api/orders/find` with `{ code, phone }`: returns `{ code, key }` for a lost link.

Money is integer paise everywhere. All dates are Hyderabad dates (IST).
