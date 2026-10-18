-- Phones and browsers that turned on order alerts in the admin app (Web Push).
-- One row per browser; a person can have several. Rows the push service reports
-- as gone (uninstalled app, cleared data) are deleted when an alert is sent.
CREATE TABLE push_subscriptions (
  endpoint    TEXT PRIMARY KEY,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user        TEXT NOT NULL,
  device      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
