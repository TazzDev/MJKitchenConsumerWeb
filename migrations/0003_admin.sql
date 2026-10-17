-- Admin app: who did what, internal notes, login throttling, and per-date meal
-- overrides that the weekly schedule must not overwrite.

-- Login name of the admin who made an owner change (NULL for customer/system).
ALTER TABLE order_events ADD COLUMN by_user TEXT;

-- Notes only the kitchen sees.
ALTER TABLE orders ADD COLUMN admin_notes TEXT NOT NULL DEFAULT '';

-- 1 = set by hand for this date in the admin app; 0 = copied from the weekly
-- schedule when the first order came in, so schedule edits still apply.
ALTER TABLE meal_availability ADD COLUMN is_override INTEGER NOT NULL DEFAULT 0;

-- Menu, delivery and settings changes made in the admin app.
CREATE TABLE admin_log (
  at      TEXT NOT NULL,
  user    TEXT NOT NULL,
  action  TEXT NOT NULL,
  detail  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX admin_log_at ON admin_log(at);

-- Failed admin logins, to slow down password guessing.
CREATE TABLE admin_login_failures (
  ip  TEXT NOT NULL,
  at  TEXT NOT NULL
);
CREATE INDEX admin_login_failures_ip ON admin_login_failures(ip, at);
