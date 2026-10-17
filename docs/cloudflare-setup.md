# Cloudflare setup

Everything runs on Cloudflare's free tier: **Pages** serves the site and the `/api` functions, and **D1** holds the menu, delivery zones and settings. You do this once; after that every push to `main` deploys by itself.

No secrets are needed for this stage. Later stages (UPI ID, email alerts, Turnstile) add secrets in the Cloudflare dashboard, never in this public repo.

## 1. Create the database (on your computer, once)

You need Node 22 and this repo cloned.

```sh
npm install
npx wrangler login                 # opens a browser to sign in to Cloudflare
npx wrangler d1 create mjkitchen   # prints a database_id
```

Copy the printed `database_id` into `wrangler.toml` (replace the `00000000-…` value) and commit it. The id is not a secret: it only works with your Cloudflare login.

Then create the tables and load the starting menu:

```sh
npm run db:migrate:remote   # creates the tables
npm run db:seed:remote      # loads seed/menu.sql (dishes, prices, placeholder zones)
```

`db:seed:remote` replaces the whole menu and zone list, so only run it to reset. Once the admin area exists the menu is edited there instead.

## 2. Create the Pages project (in the dashboard, once)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pick **TazzDev/MJKitchenConsumerWeb**.
3. Project name: `mjkitchen` (gives `mjkitchen.pages.dev`; if it's taken, pick another name and change `name` in `wrangler.toml` to match).
4. Production branch: `main`.
5. Build settings: framework preset **None**, build command `npm run build`, build output directory `dist`.
6. Environment variable: `NODE_VERSION` = `22`.
7. **Save and Deploy.**

The D1 binding (`DB`) comes from `wrangler.toml`, so there is nothing to set under Bindings. Check that **Settings → Bindings** lists `DB → mjkitchen` after the first deploy.

## 3. Check it works

- `https://mjkitchen.pages.dev/api/health` shows `{"ok":true}`.
- `https://mjkitchen.pages.dev` shows the menu. Open it on your phone, add items, and go to checkout. Placing an order shows a "preview" message until the payment stage is built.

Every pull request also gets its own preview link (`https://<branch>.mjkitchen.pages.dev`), shown on the PR. Previews use the same database as the live site for now.

## Running it on your computer

```sh
npm run db:migrate:local && npm run db:seed:local   # local test database, once
npm run preview                                     # builds, then serves site + API on http://localhost:8788
```

For front-end work with instant reload, run `npx wrangler pages dev` in one terminal (API on port 8788) and `npm run dev` in another (site on port 5173, proxying `/api`).

## Changing settings before the admin area exists

Shop settings live in the `settings` table. For example, to set the WhatsApp contact number shown in the footer:

```sh
npx wrangler d1 execute mjkitchen --remote --command "UPDATE settings SET value='919876543210' WHERE key='contact_whatsapp'"
```

| Key | Meaning | Default |
|-----|---------|---------|
| `shop_open` | `1` open, `0` closed | `1` |
| `shop_closed_message` | Shown while closed | "We are taking a short break…" |
| `meal_cutoff_time` | Time meal orders close (IST) | `20:00` |
| `meal_min_days_ahead` | Days before delivery that orders close (minimum 1) | `1` |
| `meal_max_days_ahead` | How far ahead meals can be booked | `14` |
| `free_delivery_above_paise` | Free delivery above this subtotal, in paise; empty = off | empty |
| `contact_whatsapp` | WhatsApp number with country code, digits only | empty |
| `contact_phone` | Phone number for the call button | empty |
| `instagram_handle` | Instagram handle | `mjkitchen_hyd` |
| `fssai_number` | Shown in the footer once set | empty |
