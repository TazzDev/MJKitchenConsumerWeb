-- Payment and alert settings (Thomson, 17 Oct 2026). These are shown to every
-- customer on the payment page, so they are not secrets.
-- Run once: npm run db:payment:remote   (or db:payment:local)
-- To change one later, see "Changing the UPI ID" in docs/cloudflare-setup.md.

UPDATE settings SET value = 'thomsonbingo@oksbi' WHERE key = 'upi_id';
UPDATE settings SET value = 'Thomson Martin' WHERE key = 'upi_payee_name';
UPDATE settings SET value = 'mjkitchen698@gmail.com' WHERE key = 'alert_email';
