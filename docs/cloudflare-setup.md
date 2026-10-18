# Cloudflare setup

Everything runs on Cloudflare's free tier: one **Worker** serves the site (as static assets) and the `/api` routes, and **D1** holds the menu, delivery zones and settings. You do this once; after that every push to `main` deploys by itself.

Secrets (the email API key and the Turnstile secret) go in the Cloudflare dashboard, never in this public repo. The UPI ID and payee name are not secrets, since every customer sees them, and live in the database as settings you can change at any time.

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

`db:seed:remote` replaces the whole menu and zone list, so only run it to reset. Edit the menu in the admin app (section 5) instead.

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
- The home page shows the menu. Open it on your phone, add items, and go to checkout. Until the UPI ID is set (section 4), placing an order shows a "preview" message.

Every push to `main` deploys. Pull requests get a preview build too (Settings → Build → Branch control turns on non-production branch builds). Previews use the same database as the live site for now.

## 4. Turn on orders and UPI payment

Run these on your computer, in the repo, after pulling the latest `main`:

```sh
npm run db:migrate:remote    # adds the order tables (safe to re-run)
npm run db:payment:remote    # sets the UPI ID, payee name and alert email from seed/payment.sql
```

Ordering switches on as soon as both `upi_id` and `upi_payee_name` are set. Place a small real order from your phone and pay it with the **Pay with UPI app** button, the saved QR and the copied UPI ID, to check all three work with your UPI ID.

**Order expiry and the kitchen sheet** run by themselves every 15 minutes (the Cron Trigger in `wrangler.toml`; it shows under the Worker's **Settings → Trigger events** after deploying). Unpaid orders expire after `unpaid_timeout_minutes` (default 2 hours) or at the meal date's cutoff, and their portions go back on sale. Just after the cutoff each day you get an email listing what to cook for the next meal date.

### Email alerts (Resend, free)

1. Sign up at [resend.com](https://resend.com) **with mjkitchen698@gmail.com** (the alert address). Without your own domain, Resend only delivers to the address the account was made with.
2. Resend → **API Keys** → **Create API key** (permission: Sending access). Copy it.
3. Cloudflare → the `mjkitchen` Worker → **Settings → Variables and Secrets → Add** → type **Secret**, name `RESEND_API_KEY`, paste the key → **Deploy**.

You then get an email for every new order and every "I've paid". The first ones may land in Spam; mark them "Not spam". If the key isn't set, orders still work and the emails are just skipped.

### Bot check (Turnstile, free, optional but recommended)

1. Cloudflare dashboard → **Turnstile** → **Add widget**. Hostnames: `mjkitchen.site`, `www.mjkitchen.site` and your `workers.dev` address. Widget mode: **Managed**.
2. Add the **secret key** as a Worker secret named `TURNSTILE_SECRET` (same place as above).
3. Put the **site key** in the settings: `npx wrangler d1 execute mjkitchen --remote --command "UPDATE settings SET value='<site key>' WHERE key='turnstile_site_key'"`.

Set both, or neither: with only the secret set, every order is refused.

### Payment screenshots (optional)

Customers can always give the 12-digit UPI reference number. To also let them attach a screenshot, turn on R2 in the dashboard (**R2 → Get started**; the free tier is 10 GB), then run `npx wrangler r2 bucket create mjkitchen-screenshots`, uncomment the `[[r2_buckets]]` block at the end of `wrangler.toml`, and push. The screenshot picker appears by itself once the bucket is connected.

## Changing the UPI ID, payee name or alert email

These are read on every page load, so a change shows up straight away, with no code change or redeploy. Open orders that are still waiting for payment show the new details too.

```sh
npx wrangler d1 execute mjkitchen --remote --command "UPDATE settings SET value='newid@okaxis' WHERE key='upi_id'"
npx wrangler d1 execute mjkitchen --remote --command "UPDATE settings SET value='Name As Shown In UPI App' WHERE key='upi_payee_name'"
npx wrangler d1 execute mjkitchen --remote --command "UPDATE settings SET value='you@example.com' WHERE key='alert_email'"
```

You can also do it without a terminal: Cloudflare dashboard → **Storage & Databases → D1 → mjkitchen → Console**, and paste just the `UPDATE …` part. The QR code is drawn from the UPI ID, payee name, amount and order number for each order, so there is no QR image to swap. A business UPI ID (PhonePe Business, Paytm for Business, BharatPe) is changed the same way. Setting `upi_id` to empty switches online ordering off.

The admin app's **Settings** page (section 5) changes these too, without a terminal.

If every order fails with "Please wait a moment for the security check", the site key in the settings and the `TURNSTILE_SECRET` secret are from different widgets (or the site key is empty). Copy both again from the same widget in **Turnstile**: run the `UPDATE settings` command above with the site key, and `npx wrangler secret put TURNSTILE_SECRET` with the secret key. Workers Logs shows the reason as a `turnstile:` line.

### Own domain (mjkitchen.site)

The shop's public address is `https://mjkitchen.site`. It is attached in Cloudflare → **Workers & Pages → mjkitchen → Settings → Domains & Routes** as a **Custom domain** (`mjkitchen.site` and `www.mjkitchen.site`), which also creates the DNS record and certificate. The `workers.dev` address keeps working. Each hostname must also be listed on the Turnstile widget, or orders on it fail the security check.

## 5. Admin app

The admin app is at **`/admin/`** on the same address (`https://mjkitchen.site/admin/`). In it you see new orders, confirm or reject payments, mark orders shipped or delivered, see what to cook, and change the menu, meal days, delivery areas and charges, UPI details, alert email and FSSAI number.

### Turn it on (once)

1. Update the database, **before** merging the admin app to `main`:

   ```sh
   git pull
   npm run db:migrate:remote    # applies 0003_admin.sql (safe to re-run)
   ```

2. Add the logins: Cloudflare → the `mjkitchen` Worker → **Settings → Variables and Secrets → Add** → type **Secret**, name `ADMIN_USERS`, value like this, then **Deploy**:

   ```
   Thomson:a-long-password, Mary:another-long-password
   ```

   One `name:password` pair per person, separated by commas. Passwords need at least 8 characters and can't contain commas. Names are what people type to sign in (capitals don't matter) and what the app shows next to every payment they confirm and every change they make.

3. Open `/admin/` on your phone and sign in.

### Put it on your phone's home screen

- **Android (Chrome):** open `/admin/`, tap ⋮, then **Add to Home screen** (or **Install app**).
- **iPhone (Safari):** open `/admin/`, tap Share, then **Add to Home Screen**.

It opens full screen with the green MJ icon. You stay signed in for 30 days on that phone.

### Add or remove a person

Edit the `ADMIN_USERS` secret (Worker → **Settings → Variables and Secrets** → the pencil next to `ADMIN_USERS`), add or delete their `name:password` pair, and **Deploy**. Removing someone, or changing their password, signs them out straight away; everyone else stays signed in. The passwords never go in the code, because this repo is public.

Ten wrong passwords from one network within 15 minutes pause sign-in from there for 15 minutes.

### The FSSAI number

Settings → Contact and legal → **FSSAI number**. The website footer shows "FSSAI Reg. No." only once it is filled in.

### Confirming a payment without the app

If you ever need to, the same change from a terminal:

```sh
npx wrangler d1 execute mjkitchen --remote --command "UPDATE orders SET status='confirmed', updated_at=datetime('now') WHERE public_code='MJ-1017-4821' AND status='payment_submitted'"
```

## Running it on your computer

```sh
echo 'ADMIN_USERS="Test:test-password"' > .dev.vars   # a local admin login (this file is not committed)
npm run db:migrate:local && npm run db:seed:local && npm run db:payment:local   # local test database, once
npm run preview                                     # builds, then serves site + API on http://localhost:8787
```

For front-end work with instant reload, run `npx wrangler dev` in one terminal (API on port 8787) and `npm run dev` in another (site on port 5173, proxying `/api`).

## Settings reference

Shop settings live in the `settings` table, and most of them are on the admin app's Settings page. From a terminal, for example, to set the WhatsApp contact number shown in the footer:

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
| `upi_id` | UPI ID customers pay to; empty = ordering off | empty |
| `upi_payee_name` | Payee name exactly as the UPI app shows it | empty |
| `alert_email` | Where order emails go (comma-separate for more than one) | empty |
| `alert_from` | Sender for order emails | `MJ Kitchen <onboarding@resend.dev>` |
| `unpaid_timeout_minutes` | Unpaid orders expire after this (or at the meal cutoff, if sooner) | `120` |
| `max_open_orders_per_phone` | Unpaid orders one phone number can have at once | `3` |
| `turnstile_site_key` | Turnstile site key; empty = bot check off | empty |
