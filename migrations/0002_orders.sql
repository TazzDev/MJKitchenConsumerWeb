-- Orders, payment proof and the order history log. See README "Order states".

CREATE TABLE orders (
  id                 TEXT PRIMARY KEY,
  public_code        TEXT NOT NULL UNIQUE,      -- MJ-1017-4821
  access_key         TEXT NOT NULL,             -- secret in the status link (?k=)
  status             TEXT NOT NULL CHECK (status IN (
                       'awaiting_payment', 'payment_submitted', 'payment_rejected', 'confirmed',
                       'preparing', 'out_for_delivery', 'delivered', 'cancelled', 'expired')),
  payment_proof      TEXT CHECK (payment_proof IN ('utr', 'screenshot', 'both', 'none')),
  customer_name      TEXT NOT NULL,
  phone              TEXT NOT NULL,             -- 10 digits, no country code
  address            TEXT NOT NULL,
  landmark           TEXT NOT NULL DEFAULT '',
  pincode            TEXT NOT NULL,
  zone_id            TEXT NOT NULL,
  has_meals          INTEGER NOT NULL DEFAULT 0,
  delivery_date      TEXT,                      -- NULL for pickle-only orders
  delivery_slot      TEXT CHECK (delivery_slot IN ('lunch', 'dinner')),
  subtotal_paise     INTEGER NOT NULL,
  delivery_fee_paise INTEGER NOT NULL,
  total_paise        INTEGER NOT NULL,
  upi_id             TEXT NOT NULL,             -- UPI ID shown when the order was placed
  utr                TEXT,
  screenshot_key     TEXT,
  notes              TEXT NOT NULL DEFAULT '',
  source             TEXT NOT NULL DEFAULT '',  -- e.g. ig
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  paid_at            TEXT,                      -- when the customer tapped "I've paid"
  expires_at         TEXT                       -- unpaid orders expire at this time
);
CREATE INDEX orders_status ON orders(status, expires_at);
CREATE INDEX orders_phone ON orders(phone);
CREATE INDEX orders_delivery ON orders(delivery_date, delivery_slot);
CREATE UNIQUE INDEX orders_utr ON orders(utr) WHERE utr IS NOT NULL;

CREATE TABLE order_items (
  order_id                TEXT NOT NULL REFERENCES orders(id),
  variant_id              TEXT NOT NULL,
  product_id              TEXT NOT NULL,
  category                TEXT NOT NULL,
  product_name_snapshot   TEXT NOT NULL,
  variant_label_snapshot  TEXT NOT NULL,
  unit_price_paise        INTEGER NOT NULL,
  qty                     INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX order_items_order ON order_items(order_id);

CREATE TABLE order_events (
  order_id     TEXT NOT NULL REFERENCES orders(id),
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  actor        TEXT NOT NULL CHECK (actor IN ('customer', 'owner', 'system')),
  note         TEXT NOT NULL DEFAULT '',
  at           TEXT NOT NULL
);
CREATE INDEX order_events_order ON order_events(order_id);

-- Overselling guards. Reservations run in one batch (a transaction), so a
-- failing trigger rolls the whole order back.
CREATE TRIGGER meal_portions_guard BEFORE UPDATE OF booked_portions ON meal_availability
WHEN NEW.booked_portions > OLD.booked_portions AND NEW.booked_portions > NEW.max_portions
BEGIN
  SELECT RAISE(ABORT, 'not_enough_portions');
END;

CREATE TRIGGER variant_stock_guard BEFORE UPDATE OF stock ON variants
WHEN NEW.stock < 0
BEGIN
  SELECT RAISE(ABORT, 'not_enough_stock');
END;

-- Payment and alert settings. Change them any time with
-- `wrangler d1 execute` (see docs/cloudflare-setup.md); no redeploy needed.
INSERT INTO settings (key, value) VALUES
  ('upi_id', ''),                    -- e.g. name@oksbi. Empty = online ordering off
  ('upi_payee_name', ''),            -- exactly as the UPI app shows it
  ('alert_email', ''),               -- where new-order emails go
  ('alert_from', 'MJ Kitchen <onboarding@resend.dev>'),
  ('unpaid_timeout_minutes', '120'), -- unpaid orders expire after this
  ('max_open_orders_per_phone', '3'),
  ('turnstile_site_key', ''),        -- public key; the secret is a Worker secret
  ('kitchen_sheet_last_date', '');   -- internal: last date the kitchen sheet was emailed
