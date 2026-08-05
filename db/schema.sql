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
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS template TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_template_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_template_check
  CHECK (template IN ('classic', 'bold', 'minimal'));

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
