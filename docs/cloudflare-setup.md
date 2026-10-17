# Cloudflare setup

Everything runs on Cloudflare's free tier: one **Worker** serves the site (as static assets) and the `/api` routes, and **D1** holds the menu, delivery zones and settings. You do this once; after that every push to `main` deploys by itself.

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

## 2. Create the Worker (in the dashboard, once)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**.
2. Pick **TazzDev/MJKitchenConsumerWeb**.
3. Project name: `mjkitchen`. It must match `name` in `wrangler.toml`; if you pick another name, change `wrangler.toml` to match.
4. Build command: `npm run build`.
5. Deploy command: `npx wrangler deploy` (not `wrangler pages deploy`).
6. Root directory: `/`. No build variables are needed.
7. **Create and deploy.**

The D1 binding (`DB`) comes from `wrangler.toml`, so there is nothing to set under Bindings. After the first deploy, the Worker's **Settings → Bindings** lists `DB → mjkitchen` and `ASSETS`.

Already created it with `npx wrangler pages deploy` as the deploy command? Open the Worker → **Settings → Build → Deploy command**, change it to `npx wrangler deploy`, and retry the build.

## 3. Check it works

- `https://mjkitchen.<your-subdomain>.workers.dev/api/health` shows `{"ok":true}` (the exact address is on the Worker's overview page).
- `/api/menu` shows the menu. If it shows "Something went wrong", the database tables are missing: run step 1's `db:migrate:remote` and `db:seed:remote`.
- The home page shows the menu. Open it on your phone, add items, and go to checkout. Placing an order shows a "preview" message until the payment stage is built.

Every push to `main` deploys. Pull requests get a preview build too (Settings → Build → Branch control turns on non-production branch builds). Previews use the same database as the live site for now.

## Running it on your computer

```sh
npm run db:migrate:local && npm run db:seed:local   # local test database, once
npm run preview                                     # builds, then serves site + API on http://localhost:8787
```

For front-end work with instant reload, run `npx wrangler dev` in one terminal (API on port 8787) and `npm run dev` in another (site on port 5173, proxying `/api`).

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
