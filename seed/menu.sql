-- Starting menu, meal schedule, delivery zones and contact numbers. Dishes, prices,
-- meal days and portions are real; delivery zones and fees are placeholders until
-- Thomson sends them (or edits them from the admin area once it exists).
-- Run: npm run db:seed:local   (or db:seed:remote for the live database)

DELETE FROM meal_availability;
DELETE FROM meal_schedule;
DELETE FROM variants;
DELETE FROM products;
DELETE FROM delivery_zones;

-- Menu and prices from Thomson (17 Oct 2026). Descriptions are drafts to edit.
INSERT INTO products (id, category, name, description, spice_level, is_veg, icon, sort_order) VALUES
  ('chicken-pickle',    'pickle', 'Chicken Pickle',     'Homemade Kerala-style chicken pickle.', 2, 0, 'chicken', 10),
  ('fish-pickle',       'pickle', 'Fish Pickle',        'Homemade Kerala-style fish pickle.', 2, 0, 'fish', 20),
  ('prawn-pickle',      'pickle', 'Prawns Pickle',      'Homemade Kerala-style prawns pickle.', 2, 0, 'prawn', 30),
  ('pothichoru-veg',    'meal',   'Pothichoru Veg',     'Kerala rice meal packed in banana leaf, with vegetable sides.', 1, 1, 'leaf', 40),
  ('pothichoru-fish',   'meal',   'Pothichoru Fish',    'Kerala rice meal packed in banana leaf, with fish.', 2, 0, 'fish', 50),
  ('pothichoru-chicken','meal',   'Pothichoru Chicken', 'Kerala rice meal packed in banana leaf, with chicken.', 2, 0, 'chicken', 60),
  ('chicken-biriyani',  'meal',   'Chicken Biriyani',   'Chicken biriyani, made to order.', 2, 0, 'chicken', 70);

INSERT INTO variants (id, product_id, label, price_paise, weight_g, stock, sort_order) VALUES
  ('chicken-pickle-400',   'chicken-pickle',     '400 g', 40000, 400, NULL, 1),
  ('fish-pickle-400',      'fish-pickle',        '400 g', 40000, 400, NULL, 1),
  ('prawn-pickle-400',     'prawn-pickle',       '400 g', 40000, 400, NULL, 1),
  ('pothichoru-veg-1',     'pothichoru-veg',     'Per meal', 15000, NULL, NULL, 1),
  ('pothichoru-fish-1',    'pothichoru-fish',    'Per meal', 20000, NULL, NULL, 1),
  ('pothichoru-chicken-1', 'pothichoru-chicken', 'Per meal', 20000, NULL, NULL, 1),
  ('chicken-biriyani-1',   'chicken-biriyani',   'Per meal', 25000, NULL, NULL, 1);

-- Meals Friday to Monday, lunch and dinner, 15 portions each (Thomson, 17 Oct 2026).
-- weekday: 0 = Sunday, 1 = Monday, 5 = Friday, 6 = Saturday.
INSERT INTO meal_schedule (product_id, weekday, slot, max_portions)
  SELECT p.value, d.value, s.value, 15
  FROM json_each('["pothichoru-veg","pothichoru-fish","pothichoru-chicken","chicken-biriyani"]') p,
       json_each('[5,6,0,1]') d, json_each('["lunch","dinner"]') s;

-- PLACEHOLDER zones and fees: pincode groups and fees are made up.
INSERT INTO delivery_zones (id, name, pincodes, fee_paise, allows_meals) VALUES
  ('central', 'Central Hyderabad', '500001,500002,500003,500004,500006,500012,500013,500016,500020,500027,500029,500034,500036,500038,500044,500048,500082', 4000, 1),
  ('west', 'Hitech City, Gachibowli, Kondapur', '500008,500019,500032,500033,500046,500049,500050,500081,500084,500089,500096', 6000, 1),
  ('outer', 'Outer Hyderabad', '500010,500011,500015,500017,500018,500026,500037,500039,500055,500060,500062,500070,500072,500074,500085,500090,500092,500097,500098', 8000, 0);

-- Contact numbers shown in the footer (WhatsApp needs the country code).
UPDATE settings SET value = '917093152285' WHERE key = 'contact_whatsapp';
UPDATE settings SET value = '+917093152285' WHERE key = 'contact_phone';
