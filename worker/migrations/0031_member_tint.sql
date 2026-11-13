-- Site redesign W2 (docs/site-redesign/PLAN.md §1.2): the member's site colour («لون الموقع»), kept in the account
-- so the site opens in it on any device. Additive: one nullable column; no row changes. NULL = gold.
-- Only the member changes it (POST /v1/account/prefs { prefs: { tint } }), one of the seven ids in src/account/routes.js.
ALTER TABLE participants ADD COLUMN site_tint TEXT;
