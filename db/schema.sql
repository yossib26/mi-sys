-- Users: two roles. 'admin' manages users and archives campaigns;
-- 'user' creates/edits campaigns and views their stats/registrants.
-- Passwords are bcrypt hashes, never plaintext.
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Brands
CREATE TABLE IF NOT EXISTS brands (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- English-only URL segment for the brand (e.g. /c/nova-cosmetics-4/...).
-- Nullable so it can be backfilled on existing rows; partial index
-- keeps it unique once set.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_slug ON brands (slug) WHERE slug IS NOT NULL;

-- Which brands a 'user'-role account can see/manage. Irrelevant for
-- 'admin' accounts (they're unrestricted regardless of rows here).
-- No rows for a user = sees nothing, until an admin assigns some.
CREATE TABLE IF NOT EXISTS user_brands (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, brand_id)
);

-- Campaigns, each belonging to a brand
CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  budget NUMERIC(12, 2),
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_brand_id ON campaigns (brand_id);

-- 'archived' added: "deleting" a campaign from the admin UI archives
-- it in place rather than removing the row (and its registrations),
-- so the check constraint needs to allow that value too.
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled', 'archived'));

-- Public shareable URL slug — combined with the brand's own slug to
-- form /c/:brandSlug/:campaignSlug (e.g. /c/nova-cosmetics-4/summer-sale-9).
-- Nullable so it can be backfilled on existing rows; partial index
-- keeps it unique once set.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_slug ON campaigns (slug) WHERE slug IS NOT NULL;

-- Marketing banner image, stored inline (kept out of SELECT * lists —
-- see lib/handlers.js — so listing campaigns stays cheap).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS banner BYTEA;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS banner_mime TEXT;

-- Public-page funnel counters. "Completed" isn't stored here — it's
-- COUNT(registrations) for the campaign, computed on read, so it can
-- never drift out of sync with the actual rows.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS views_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS form_starts_count INTEGER NOT NULL DEFAULT 0;

-- Visual template for the public /c/:slug page — one of a fixed set
-- defined in lib/campaign-page.js. 'classic' is the default for new
-- campaigns and for any pre-existing row.
--
-- One consolidated DROP+ADD with every value ever added, not a fresh
-- narrower pair per addition — a narrower intermediate constraint
-- re-executing here would reject rows that already use a value added
-- after it (hit this exact bug earlier with campaign_fields_type_check
-- and campaigns_gift_mode_check).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS template TEXT NOT NULL DEFAULT 'classic';

-- 'bold' and 'minimal' were removed as selectable templates — reassign
-- any campaign still using either to the default 'classic' before the
-- constraint below stops allowing them (a no-op once no rows match).
UPDATE campaigns SET template = 'classic' WHERE template IN ('bold', 'minimal');

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_template_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_template_check
  CHECK (template IN ('classic', 'dark'));

-- Superseded by the registrations table below: contact info + invoice
-- are per-registrant (many per campaign), not a single field on the
-- campaign itself.
ALTER TABLE campaigns DROP COLUMN IF EXISTS contact_first_name;
ALTER TABLE campaigns DROP COLUMN IF EXISTS contact_last_name;
ALTER TABLE campaigns DROP COLUMN IF EXISTS contact_email;
ALTER TABLE campaigns DROP COLUMN IF EXISTS marketing_consent;
ALTER TABLE campaigns DROP COLUMN IF EXISTS invoice;
ALTER TABLE campaigns DROP COLUMN IF EXISTS invoice_mime;
ALTER TABLE campaigns DROP COLUMN IF EXISTS invoice_filename;

-- Self-service registrations submitted by visitors on the public
-- campaign page (/c/:slug): name, proof-of-purchase invoice, and
-- marketing consent. Many per campaign.
CREATE TABLE IF NOT EXISTS registrations (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  marketing_consent BOOLEAN NOT NULL DEFAULT false,
  invoice BYTEA NOT NULL,
  invoice_mime TEXT NOT NULL,
  invoice_filename TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_registrations_campaign_id ON registrations (campaign_id);

-- Per-campaign custom form fields: lets each campaign's public
-- registration form carry extra questions beyond the fixed set above
-- (name/email/invoice/consent), defined dynamically by whoever edits
-- the campaign. 'options' holds type-specific config:
--   - select:             { "values": ["a", "b", ...] }
--   - text/date/checkbox/file: unused (null) — a date field always
--     renders/stores as dd/mm/yy, a checkbox's adjacent label text is
--     just its own `label` column, text has no extra config, and a
--     file field's 1MB size cap is a fixed rule (see lib/handlers.js),
--     not a per-field setting.
CREATE TABLE IF NOT EXISTS campaign_fields (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('text', 'date', 'select', 'checkbox')),
  label TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  options JSONB,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_fields_campaign_id ON campaign_fields (campaign_id);

-- Field types grown over time: 'file' (a per-registration upload,
-- capped at 1MB — see lib/handlers.js, stored separately rather than
-- inline in custom_fields), then 'email'/'phone' (validated in
-- lib/handlers.js — EMAIL_PATTERN / isValidPhone — not at the DB
-- level). Kept as a single DROP+ADD rather than one pair per addition:
-- with real rows already using the newer types, an intermediate
-- ADD CONSTRAINT that doesn't yet include them would itself fail.
ALTER TABLE campaign_fields DROP CONSTRAINT IF EXISTS campaign_fields_type_check;
ALTER TABLE campaign_fields ADD CONSTRAINT campaign_fields_type_check
  CHECK (type IN ('text', 'email', 'phone', 'date', 'select', 'checkbox', 'file'));

-- A 'text' field's character limit (default 200, see
-- DEFAULT_TEXT_FIELD_MAX_LENGTH in lib/handlers.js) now lives in
-- `options`, same slot 'select' uses for its value list. Backfill it
-- onto existing text fields predating this so every text field's
-- `options` is consistently non-null and callers never need a
-- fallback for old rows.
UPDATE campaign_fields SET options = '{"max_length": 200}'::jsonb
  WHERE type = 'text' AND options IS NULL;

-- Answers to a campaign's dynamic fields, keyed by campaign_fields.id
-- (as a string, since JSON object keys are always strings): { "3":
-- "some value", "5": true, ... }. Kept separate from the fixed
-- columns above so existing registrants/queries are unaffected. For a
-- 'file' field this holds only the original filename — the bytes
-- live in registration_field_files below (kept out of this JSONB
-- blob, same reason the invoice/banner blobs get their own columns).
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;

-- One uploaded file per (registration, file-type field). Excluded
-- from ordinary registration SELECTs — fetched only via its own
-- route, same pattern as registrations.invoice.
CREATE TABLE IF NOT EXISTS registration_field_files (
  id SERIAL PRIMARY KEY,
  registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  field_id INTEGER NOT NULL REFERENCES campaign_fields(id) ON DELETE CASCADE,
  file BYTEA NOT NULL,
  file_mime TEXT NOT NULL,
  file_filename TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (registration_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_registration_field_files_registration_id ON registration_field_files (registration_id);

-- The public form no longer always shows first/last name + invoice —
-- a campaign's registration form is now driven entirely by its own
-- campaign_fields, and those four were forcing themselves onto every
-- campaign even when the admin defined their own equivalents (see
-- lib/campaign-page.js). Old rows keep whatever they already have;
-- new registrations for a campaign with no matching dynamic fields
-- just won't populate these.
ALTER TABLE registrations ALTER COLUMN first_name DROP NOT NULL;
ALTER TABLE registrations ALTER COLUMN last_name DROP NOT NULL;
ALTER TABLE registrations ALTER COLUMN invoice DROP NOT NULL;
ALTER TABLE registrations ALTER COLUMN invoice_mime DROP NOT NULL;

-- 'fixed_key' marks a campaign_field as one of a small set of built-in
-- fields that exist on every campaign automatically (see
-- ensureMarketingConsentField in lib/handlers.js), rather than being
-- freely added/removed by whoever edits the campaign. Only its label
-- (the text next to the checkbox) is editable — type/required/deletion/
-- reordering are all pinned in code — and it always renders last on
-- the public page regardless of `position` (see the "fixed_key IS NOT
-- NULL" ordering wherever campaign_fields is queried for display).
ALTER TABLE campaign_fields ADD COLUMN IF NOT EXISTS fixed_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_fields_fixed_key
  ON campaign_fields (campaign_id, fixed_key) WHERE fixed_key IS NOT NULL;

-- Backfill: every existing campaign gets the marketing-consent
-- checkbox if it doesn't already have one (new campaigns get it at
-- creation time instead — see createCampaign).
INSERT INTO campaign_fields (campaign_id, type, label, required, options, position, fixed_key)
SELECT c.id, 'checkbox', 'אני מאשר דיוור וקבלת חומר פרסומי', false, NULL, 0, 'marketing_consent'
FROM campaigns c
WHERE NOT EXISTS (
  SELECT 1 FROM campaign_fields cf WHERE cf.campaign_id = c.id AND cf.fixed_key = 'marketing_consent'
);

-- Second fixed field: a required "I've read and agree to the
-- promotion's terms" checkbox, shown above marketing consent on the
-- public page. Same fixed_key mechanism, same backfill pattern (new
-- campaigns get it at creation time — see createCampaign) — position 0
-- sorts it before marketing consent's position 1 among fixed fields
-- (both still always sort after every regular dynamic field; see the
-- "fixed_key IS NOT NULL" ordering above). Re-pointing marketing
-- consent to position 1 is safe to always re-run — it's structural
-- ordering, not a per-campaign admin preference being overwritten.
INSERT INTO campaign_fields (campaign_id, type, label, required, options, position, fixed_key)
SELECT c.id, 'checkbox', 'ראיתי ואני מסכים לתקנון המבצע', true, NULL, 0, 'terms_agreement'
FROM campaigns c
WHERE NOT EXISTS (
  SELECT 1 FROM campaign_fields cf WHERE cf.campaign_id = c.id AND cf.fixed_key = 'terms_agreement'
);
UPDATE campaign_fields SET position = 1 WHERE fixed_key = 'marketing_consent';

-- Optional ActiveTrail (email marketing) sync, configured entirely per
-- campaign (not a shared server-wide credential): activetrail_token is
-- that campaign's own ActiveTrail API token, activetrail_group_id is
-- which of their groups new registrants get added to, and
-- activetrail_email_field_id is which of the campaign's own dynamic
-- fields supplies the contact's email address. All three unset (the
-- default) = sync disabled for this campaign — see
-- maybeSyncRegistrationToActiveTrail in lib/handlers.js.
-- activetrail_token is a secret: never returned by the API (see
-- has_activetrail_token in CAMPAIGN_COLUMNS), only ever written.
-- ON DELETE SET NULL: deleting the designated field just turns sync
-- off for the campaign rather than erroring.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS activetrail_token TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS activetrail_group_id TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS activetrail_email_field_id INTEGER
  REFERENCES campaign_fields(id) ON DELETE SET NULL;

-- Gift-choice campaigns: alongside its dynamic campaign_fields, a
-- campaign can offer an unlimited list of gifts (SKU + name + image)
-- for the registrant to pick one from. 'none' (the default) is every
-- campaign that predates this and every campaign that doesn't use it —
-- unchanged behavior. Defined per campaign, same as campaign_fields,
-- not a shared catalog.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS gift_mode TEXT NOT NULL DEFAULT 'none';
-- The gift_mode check constraint is defined once, further down (after
-- all its values have been introduced) — see the note there on why
-- it's a single DROP+ADD rather than one pair per value added over
-- time: with real rows already using a newer value, an intermediate
-- ADD CONSTRAINT that doesn't yet include it would itself fail (hit
-- this exact bug with campaign_fields_type_check earlier — see git
-- history — and designed around it here from the start).

CREATE TABLE IF NOT EXISTS campaign_gifts (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT NOT NULL,
  image BYTEA,
  image_mime TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_gifts_campaign_id ON campaign_gifts (campaign_id);

-- Which gift a registrant picked. name/sku are a snapshot taken at
-- registration time (not a live join) so editing or deleting a gift
-- later never rewrites what was actually promised to a past
-- registrant — ON DELETE SET NULL, not CASCADE, for the same reason.
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS selected_gift_id INTEGER
  REFERENCES campaign_gifts(id) ON DELETE SET NULL;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS selected_gift_name TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS selected_gift_sku TEXT;

-- 'product_and_gift' added as a third gift_mode: the registrant picks
-- which product they bought (campaign_products — SKU+name+image, same
-- shape as campaign_gifts) *and*, independently/unrelated to that
-- choice, a gift from the campaign's gift list (the same
-- campaign_gifts used by 'simple_choice' — no filtering by product).

CREATE TABLE IF NOT EXISTS campaign_products (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT NOT NULL,
  image BYTEA,
  image_mime TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_products_campaign_id ON campaign_products (campaign_id);

-- Which product a registrant picked — same snapshot rationale as the
-- gift columns above.
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS selected_product_id INTEGER
  REFERENCES campaign_products(id) ON DELETE SET NULL;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS selected_product_name TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS selected_product_sku TEXT;

-- 'product_then_gift' added as a 4th gift_mode: like 'product_and_gift',
-- the registrant picks a product and a gift, but here the gift list is
-- *filtered* to whichever gifts were assigned to that specific product
-- (campaign_gifts.product_id) — unlike 'product_and_gift', where the
-- two picks are unrelated. ON DELETE CASCADE (not SET NULL, unlike the
-- registrations.selected_*_id columns): a gift assigned to a product
-- only makes sense in that product's context, so deleting the product
-- takes its gifts with it — this is config-time cleanup, not a
-- historical record like a registration's snapshot.
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_gift_mode_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_gift_mode_check
  CHECK (gift_mode IN ('none', 'simple_choice', 'product_and_gift', 'product_then_gift'));

ALTER TABLE campaign_gifts ADD COLUMN IF NOT EXISTS product_id INTEGER
  REFERENCES campaign_products(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_campaign_gifts_product_id ON campaign_gifts (product_id);

-- Keep updated_at current on every campaign update
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_campaigns_updated_at ON campaigns;
CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Audit trail for edits made to an *existing* campaign through the
-- admin editor (details/banner/template/fields/gifts/products/
-- ActiveTrail settings) — see logCampaignActivity in lib/handlers.js,
-- called from each of those mutating handlers. Deliberately NOT
-- written to by createCampaign or duplicateCampaign: those aren't
-- "editing an existing campaign" (duplication's internal copy of
-- fields/gifts/products onto the new campaign is a creation-time
-- bulk-insert, not a series of user edits, and goes through raw SQL
-- rather than the logged CRUD functions).
-- user_id -> SET NULL (not CASCADE) so a log entry survives its
-- author's account being deleted later; username is denormalized
-- alongside it for the same reason getSelectedGift/Product snapshot
-- their name — the log stays meaningful even after that.
CREATE TABLE IF NOT EXISTS campaign_activity_log (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username TEXT,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaign_activity_log_campaign_id ON campaign_activity_log (campaign_id, created_at DESC);

-- General footer note — a summarized standard promotional-terms
-- notice (validity dates, stock/unit limits, no combining with other
-- offers, exclusions, cancellation per consumer-protection law, and
-- the company's right to change/end the promotion) shown at the
-- bottom of every campaign's public page, next to the brand's logo —
-- see renderCampaignPage in lib/campaign-page.js. NOT NULL DEFAULT
-- backfills every pre-existing campaign with the same text (Postgres
-- applies a column default to existing rows without a full table
-- rewrite); editable per campaign afterwards from edit.html, same as
-- any other campaign detail — this is a starting value, not a
-- fixed/shared global.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS footer_note TEXT NOT NULL DEFAULT
  'המבצע בתוקף בין התאריכים שצוינו בעמוד זה בלבד, בכפוף למלאי הקיים ולהגבלת יחידות ללקוח ככל שנקבעה. לא ניתן לשלב את ההטבה עם הנחות, קופונים או הטבות מועדון נוספות, אלא אם צוין אחרת. המבצע אינו כולל פריטים, קטגוריות או סניפים שהוחרגו במפורש. ביטול והחזרת מוצרים שנרכשו במסגרת המבצע כפופים להוראות חוק הגנת הצרכן. החברה שומרת לעצמה את הזכות לשנות את תנאי המבצע או להפסיקו בכל עת וללא הודעה מוקדמת.';

-- Brand logo, shown at 60x60 next to the footer note above on every
-- one of that brand's public campaign pages. Same BYTEA+mime shape as
-- a campaign banner (see campaigns.banner) — excluded from ordinary
-- brand list/get responses (has_logo rides along instead, see
-- BRAND_COLUMNS in lib/handlers.js), served from its own route.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS logo BYTEA;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS logo_mime TEXT;

-- Explicit opt-in/opt-out for ActiveTrail sync, next to the token/
-- group/email-field settings in edit.html — see
-- maybeSyncRegistrationToActiveTrail in lib/handlers.js, which now
-- checks this before syncing, instead of inferring "on" purely from
-- whether a token happens to be set. Wrapped in a one-time DO block
-- (not a bare UPDATE that would run on every migrate.js execution):
-- campaigns that already had a working integration configured keep
-- syncing the first time this column appears, but that backfill must
-- never re-run afterwards — otherwise it would silently re-enable
-- sync for a campaign an admin later, deliberately, turned back off.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'activetrail_sync_enabled'
  ) THEN
    ALTER TABLE campaigns ADD COLUMN activetrail_sync_enabled BOOLEAN NOT NULL DEFAULT false;
    UPDATE campaigns SET activetrail_sync_enabled = true WHERE activetrail_token IS NOT NULL;
  END IF;
END $$;

-- Editable headings for the public page's product-picker and
-- gift-picker sections (see renderCampaignPage in
-- lib/campaign-page.js) — previously hardcoded text ("איזה מוצר
-- רכשת?" / "בחר מתנה"). NOT NULL DEFAULT backfills every existing
-- campaign with exactly that same wording, so this is purely additive
-- (nothing changes on the public page until an admin edits it) —
-- same pattern as footer_note above.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS products_section_title TEXT NOT NULL DEFAULT 'איזה מוצר רכשת?';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS gifts_section_title TEXT NOT NULL DEFAULT 'בחר מתנה';
