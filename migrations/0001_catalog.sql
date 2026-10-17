-- Menu, delivery zones and shop settings. Order tables come in a later migration.
-- Money is stored as integer paise (₹1 = 100 paise).

CREATE TABLE products (
  id           TEXT PRIMARY KEY,
  category     TEXT NOT NULL CHECK (category IN ('pickle', 'meal')),
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  spice_level  INTEGER NOT NULL DEFAULT 0 CHECK (spice_level BETWEEN 0 AND 3),
  is_veg       INTEGER NOT NULL DEFAULT 0,
  icon         TEXT,            -- category chip icon: chicken | prawn | fish | jar
  image_key    TEXT,            -- R2 key or /public path for the product photo
  is_active    INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE variants (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES products(id),
  label        TEXT NOT NULL,   -- "400 g", "Full meal"
  price_paise  INTEGER NOT NULL CHECK (price_paise >= 0),
  weight_g     INTEGER,
  stock        INTEGER,         -- NULL = not tracked; 0 = sold out
  is_active    INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX variants_product ON variants(product_id);

-- Standing weekly meal menu: which meals are cooked on which weekday and slot,
-- and the default portion limit. weekday: 0 = Sunday … 6 = Saturday.
CREATE TABLE meal_schedule (
  product_id    TEXT NOT NULL REFERENCES products(id),
  weekday       INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  slot          TEXT NOT NULL CHECK (slot IN ('lunch', 'dinner')),
  max_portions  INTEGER NOT NULL CHECK (max_portions >= 0),
  PRIMARY KEY (product_id, weekday, slot)
);

-- Per-date availability. A row overrides the weekly schedule for that date
-- (max_portions = 0 turns a meal off) and tracks portions booked.
CREATE TABLE meal_availability (
  product_id       TEXT NOT NULL REFERENCES products(id),
  date             TEXT NOT NULL,   -- YYYY-MM-DD, Hyderabad time
  slot             TEXT NOT NULL CHECK (slot IN ('lunch', 'dinner')),
  max_portions     INTEGER NOT NULL CHECK (max_portions >= 0),
  booked_portions  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, date, slot)
);

CREATE TABLE delivery_zones (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  pincodes     TEXT NOT NULL,       -- comma-separated 6-digit pincodes
  fee_paise    INTEGER NOT NULL CHECK (fee_paise >= 0),
  allows_meals INTEGER NOT NULL DEFAULT 1,
  is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('shop_open', '1'),
  ('shop_closed_message', 'We are taking a short break. Back soon!'),
  ('meal_cutoff_time', '20:00'),        -- orders for a date close at this time (IST)…
  ('meal_min_days_ahead', '1'),         -- …this many days before. Never below 1.
  ('meal_max_days_ahead', '14'),
  ('free_delivery_above_paise', ''),    -- empty = off
  ('contact_whatsapp', ''),             -- digits with country code, e.g. 919876543210
  ('contact_phone', ''),
  ('instagram_handle', 'mjkitchen_hyd'),
  ('fssai_number', '');
