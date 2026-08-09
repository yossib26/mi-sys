// Shared business logic for brands & campaigns, decoupled from any
// particular HTTP framework. Used by both the local dev server
// (server.js, raw Node http) and the Vercel serverless functions
// (api/**), so the two never drift apart.

const { slugify } = require('./slug');
const activetrail = require('./activetrail');

const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'completed', 'cancelled', 'archived'];
const CAMPAIGN_TEMPLATES = ['classic', 'dark'];
// 'simple_choice': the campaign offers an unlimited list of gifts
// (campaign_gifts) and the registrant picks one. 'product_and_gift':
// the registrant *also* picks which product they bought
// (campaign_products) — independently of the gift pick, no filtering
// between the two lists. 'product_then_gift': same two picks, but the
// gift list is filtered to whichever gifts were assigned to the
// chosen product (campaign_gifts.product_id). See createRegistration's
// gift/product handling below.
const CAMPAIGN_GIFT_MODES = ['none', 'simple_choice', 'product_and_gift', 'product_then_gift'];
const UPDATABLE_CAMPAIGN_FIELDS = [
  'brand_id', 'name', 'description', 'budget', 'start_date', 'end_date', 'status', 'template',
  'activetrail_sync_enabled', 'activetrail_token', 'activetrail_group_id', 'activetrail_email_field_id',
  'gift_mode', 'slug', 'footer_note', 'products_section_title', 'gifts_section_title',
];
// Same character set slugify() ever produces (lowercase a-z0-9, single
// hyphens between segments, no leading/trailing hyphen) — enforced here
// too since, unlike the auto-generated slug, an admin-edited one is
// free text and needs to still be a valid URL path segment.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A dynamic date field always renders and stores as dd/mm/yy (two-digit
// year), independent of the browser locale — see lib/campaign-page.js.
const DATE_FIELD_PATTERN = /^([0-3]\d)\/([01]\d)\/(\d{2})$/;
// A dynamic phone field accepts digits plus common formatting
// characters (+, spaces, hyphens, parens); the actual digit count is
// checked separately (7-15, the E.164 range) so formatting style
// doesn't matter as long as there's a plausible number underneath.
const PHONE_FIELD_CHAR_PATTERN = /^[\d\s+\-()]+$/;
const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;
const CAMPAIGN_FIELD_TYPES = ['text', 'email', 'phone', 'date', 'select', 'checkbox', 'file'];
const ALLOWED_CAMPAIGN_FIELD_FILE_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_CAMPAIGN_FIELD_FILE_BYTES = 1 * 1024 * 1024; // 1MB
// A text field's character limit, configurable per field (200 unless
// the campaign editor sets otherwise), capped at a sane upper bound.
const DEFAULT_TEXT_FIELD_MAX_LENGTH = 200;
const MAX_TEXT_FIELD_MAX_LENGTH = 5000;
const ALLOWED_BANNER_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_BANNER_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_INVOICE_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const MAX_INVOICE_BYTES = 3 * 1024 * 1024; // 3MB
// A brand logo is shown small (60x60, see renderCampaignPage) — same
// allowed formats as a banner, but a much smaller size cap.
const ALLOWED_LOGO_MIME_TYPES = ALLOWED_BANNER_MIME_TYPES;
const MAX_LOGO_BYTES = 1 * 1024 * 1024; // 1MB

// Explicit column list for every campaign SELECT/RETURNING: `banner`
// is a (potentially large) BYTEA blob that must never ride along on
// ordinary list/get/update responses — callers get `has_banner`
// instead and fetch the actual image via its own dedicated route.
// activetrail_token is a secret — never selected here, only its
// presence (has_activetrail_token), same pattern as has_banner.
const CAMPAIGN_COLUMNS = `
  c.id, c.brand_id, c.name, c.description, c.budget, c.start_date, c.end_date,
  c.status, c.slug, c.template, c.created_at, c.updated_at, (c.banner IS NOT NULL) AS has_banner,
  c.views_count, c.form_starts_count, c.gift_mode, c.footer_note,
  c.products_section_title, c.gifts_section_title,
  c.activetrail_sync_enabled,
  (c.activetrail_token IS NOT NULL) AS has_activetrail_token,
  c.activetrail_group_id, c.activetrail_email_field_id,
  (SELECT COUNT(*) FROM registrations r WHERE r.campaign_id = c.id) AS registrations_count
`;

// Explicit column list for every brand SELECT/RETURNING, same reason
// as CAMPAIGN_COLUMNS above: `logo` is a BYTEA blob that must never
// ride along on ordinary list/get/update responses (has_logo instead;
// the image itself is fetched via its own route).
const BRAND_COLUMNS = `id, name, slug, created_at, (logo IS NOT NULL) AS has_logo`;

// Same idea for registrations: `invoice` is excluded from list
// responses, fetched only via its own route. `has_invoice` lets a
// caller tell "no invoice was collected" (now common, since it's an
// optional fixed field) apart from "one exists, go fetch it".
const REGISTRATION_COLUMNS = `
  id, campaign_id, first_name, last_name, email, marketing_consent,
  invoice_filename, (invoice IS NOT NULL) AS has_invoice, custom_fields,
  selected_gift_id, selected_gift_name, selected_gift_sku,
  selected_product_id, selected_product_name, selected_product_sku, created_at
`;

// Same idea as campaigns' banner: `image` is a (potentially large)
// BYTEA blob, excluded from ordinary list/get responses — callers get
// `has_image` and fetch the actual image via its own route.
// product_id (only meaningful for 'product_then_gift') is included so
// both the admin UI (grouping gifts under their product) and the
// public page (client-side filtering by chosen product) can use it.
const CAMPAIGN_GIFT_COLUMNS = `
  id, campaign_id, sku, name, (image IS NOT NULL) AS has_image, position, product_id, stock, created_at
`;
const CAMPAIGN_PRODUCT_COLUMNS = `
  id, campaign_id, sku, name, (image IS NOT NULL) AS has_image, position, created_at
`;

const CAMPAIGN_FIELD_COLUMNS = `id, campaign_id, type, label, required, options, position, fixed_key, created_at`;
// A campaign_field with fixed_key set is provisioned automatically for
// every campaign (see ensureFixedFields) rather than added freely —
// only its label is editable. Sorting fixed fields last (not by their
// `position`) is how "always last, regardless of what else gets
// added/reordered" is enforced everywhere fields are listed; `position`
// still controls their order *relative to each other*.
const FIELDS_DISPLAY_ORDER = '(fixed_key IS NOT NULL), position, id';
const TERMS_AGREEMENT_FIXED_KEY = 'terms_agreement';
const TERMS_AGREEMENT_DEFAULT_LABEL = 'ראיתי ואני מסכים לתקנון המבצע';
const MARKETING_CONSENT_FIXED_KEY = 'marketing_consent';
const MARKETING_CONSENT_DEFAULT_LABEL = 'אני מאשר דיוור וקבלת חומר פרסומי';

// Whitelist of columns the campaigns list can be sorted by — never
// interpolate the caller's `sort` value directly into SQL.
const CAMPAIGN_SORT_COLUMNS = {
  name: 'c.name',
  brand_name: 'b.name',
  budget: 'c.budget',
  start_date: 'c.start_date',
  end_date: 'c.end_date',
  status: 'c.status',
  created_at: 'c.created_at',
  views_count: 'c.views_count',
  form_starts_count: 'c.form_starts_count',
  registrations_count: '(SELECT COUNT(*) FROM registrations r WHERE r.campaign_id = c.id)',
};
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

// brandScope: null (admin, unrestricted) or an array of brand ids a
// 'user' account is allowed to touch. Used everywhere a single
// existing campaign is read/modified by id, so a restricted user
// can't reach one outside their assigned brands just by knowing/
// guessing its id.
async function assertCampaignAccess(pool, campaignId, brandScope) {
  if (!brandScope) return;
  const result = await pool.query('SELECT brand_id, status FROM campaigns WHERE id = $1', [campaignId]);
  if (result.rowCount === 0) throw httpError(404, 'הקמפיין לא נמצא');
  if (!brandScope.includes(result.rows[0].brand_id)) {
    throw httpError(403, 'אין לך הרשאת גישה למותג זה');
  }
  // Archived campaigns are admin-only, even ones in a brand the user
  // otherwise has access to — matches the list-view exclusion below.
  if (result.rows[0].status === 'archived') {
    throw httpError(403, 'קמפיינים בארכיון נגישים למנהלים בלבד');
  }
}

async function getStatus(pool) {
  const result = await pool.query('SELECT NOW() AS current_time');
  return { status: 200, body: { status: 'connected', current_time: result.rows[0].current_time } };
}

// ----- Campaign activity log -----
//
// `actor` is the authenticated { id, username } making the change (the
// same `user` every route already resolves via auth.requireAuth) —
// every mutating handler below that edits an *existing* campaign
// through the admin editor takes it as its last parameter and calls
// this right before returning success. Deliberately never called from
// createCampaign or duplicateCampaign — see the comment on the table
// itself in db/schema.sql for why.
//
// Best-effort: a logging failure must never fail the edit it's
// recording (the edit itself already succeeded by the time this
// runs), so this swallows its own errors rather than propagating them.
async function logCampaignActivity(pool, campaignId, actor, action) {
  if (!actor) return;
  try {
    await pool.query(
      'INSERT INTO campaign_activity_log (campaign_id, user_id, username, action) VALUES ($1, $2, $3, $4)',
      [campaignId, actor.id, actor.username, action]
    );
  } catch (error) {
    console.error('Failed to log campaign activity', error);
  }
}

// Whitelist of columns the activity log can be sorted by — the same
// three columns the table actually shows (see the note on
// CAMPAIGN_SORT_COLUMNS above: never interpolate the caller's `sort`
// value directly into SQL).
const ACTIVITY_LOG_SORT_COLUMNS = {
  created_at: 'created_at',
  username: 'username',
  action: 'action',
};

// Paginated + free-text search (over the action description and the
// acting username) — same { rows, total, page, pageSize, totalPages }
// shape as listCampaigns, since this is the log's only caller
// (edit.html's loadActivityLog) and always sends page/pageSize, unlike
// listRegistrations below which still has to stay backward-compatible
// with callers that want the full unpaginated set.
async function listCampaignActivityLog(pool, campaignId, brandScope, query) {
  await assertCampaignAccess(pool, campaignId, brandScope);

  const q = (query && query.q || '').trim();
  const searchPattern = q ? `%${q}%` : null;
  const whereClause = `
    WHERE campaign_id = $1 AND ($2::text IS NULL OR (
      action ILIKE $2 OR COALESCE(username, '') ILIKE $2
    ))
  `;
  const baseParams = [campaignId, searchPattern];
  const page = Math.max(1, parseInt(query && query.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query && query.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const sortColumn = ACTIVITY_LOG_SORT_COLUMNS[query && query.sort] || ACTIVITY_LOG_SORT_COLUMNS.created_at;
  const order = query && query.order === 'asc' ? 'ASC' : 'DESC';

  const [rowsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, user_id, username, action, created_at FROM campaign_activity_log ${whereClause}
       ORDER BY ${sortColumn} ${order} NULLS LAST, id ${order} LIMIT $3 OFFSET $4`,
      [...baseParams, pageSize, (page - 1) * pageSize]
    ),
    pool.query(`SELECT COUNT(*) AS total FROM campaign_activity_log ${whereClause}`, baseParams),
  ]);
  const total = parseInt(countResult.rows[0].total, 10);
  return { status: 200, body: { rows: rowsResult.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

const CAMPAIGN_LOG_FIELD_LABELS = {
  brand_id: 'מותג', name: 'שם קמפיין', description: 'תיאור', budget: 'תקציב',
  start_date: 'תאריך התחלה', end_date: 'תאריך סיום', status: 'סטטוס',
  template: 'תבנית עיצוב', slug: 'כתובת URL', gift_mode: 'סוג הקמפיין',
  activetrail_sync_enabled: 'סנכרון ActiveTrail', activetrail_token: 'טוקן ActiveTrail',
  activetrail_group_id: 'קוד קבוצת ActiveTrail', activetrail_email_field_id: 'שדה אימייל ל-ActiveTrail',
};
const CAMPAIGN_STATUS_LOG_LABELS = {
  draft: 'טיוטה', active: 'פעיל', paused: 'מושהה', completed: 'הושלם', cancelled: 'בוטל', archived: 'בארכיון',
};
const CAMPAIGN_GIFT_MODE_LOG_LABELS = {
  none: 'ללא מתנה', simple_choice: 'בחירת מתנה', product_and_gift: 'בחירת מוצר ומתנה',
  product_then_gift: 'בחירת מוצר עם מתנות משויכות',
};
function describeMove(direction) {
  return direction === 'up' ? 'למעלה' : 'למטה';
}
// Used by updateCampaign to decide which fields to log — a plain
// String(a) === String(b) comparison misfires on 'budget': it's a
// NUMERIC(12,2) column, so pg always returns it as a fixed-2-decimal
// string like "120.00", while the client sends a plain number (120,
// stringifying to "120") — same value, different string, which would
// otherwise log a false "budget changed" on *every* save that has any
// budget set at all, whether or not it actually changed.
function campaignFieldValueChanged(field, oldValue, newValue) {
  if (field === 'budget') {
    const oldNum = oldValue === null || oldValue === undefined || oldValue === '' ? null : parseFloat(oldValue);
    const newNum = newValue === null || newValue === undefined || newValue === '' ? null : parseFloat(newValue);
    return oldNum !== newNum;
  }
  return String(oldValue ?? '') !== String(newValue ?? '');
}
// One log line per individually-changed field on the main campaign
// form (rather than one combined line for the whole save) — see
// updateCampaign, which calls this once per field whose value actually
// changed. Never includes the token's own value (a secret), and
// resolves brand_id to the brand's name rather than logging a raw id.
async function describeCampaignFieldChange(pool, field, value) {
  const label = CAMPAIGN_LOG_FIELD_LABELS[field] || field;
  if (field === 'activetrail_token') return `עודכן ${label}`;
  if (field === 'activetrail_sync_enabled') return `${label} ${value ? 'הופעל' : 'כובה'}`;
  if (field === 'status') return `שונה ${label} ל-"${CAMPAIGN_STATUS_LOG_LABELS[value] || value}"`;
  if (field === 'gift_mode') return `שונה ${label} ל-"${CAMPAIGN_GIFT_MODE_LOG_LABELS[value] || value}"`;
  if (field === 'brand_id') {
    const brandRow = await pool.query('SELECT name FROM brands WHERE id = $1', [value]);
    return `שונה ${label} ל-"${brandRow.rows[0]?.name || value}"`;
  }
  if (value === null || value === undefined || value === '') return `רוקן שדה: ${label}`;
  return `שונה ${label} ל-"${value}"`;
}

// ----- Brands -----

async function listBrands(pool, brandScope) {
  if (brandScope) {
    const result = await pool.query(`SELECT ${BRAND_COLUMNS} FROM brands WHERE id = ANY($1) ORDER BY name`, [brandScope]);
    return { status: 200, body: result.rows };
  }
  const result = await pool.query(`SELECT ${BRAND_COLUMNS} FROM brands ORDER BY name`);
  return { status: 200, body: result.rows };
}

// Just the brand's own name, slugified — no id suffix (brand names are
// already unique, enforced by the DB constraint below, so this is
// almost always collision-free on the first try; -2/-3/... is only a
// fallback for the rare case where two different unique names happen
// to slugify to the same string).
async function generateBrandSlug(pool, name) {
  const base = slugify(name) || 'brand';
  let candidate = base;
  for (let n = 2; ; n++) {
    const { rowCount } = await pool.query('SELECT 1 FROM brands WHERE slug = $1', [candidate]);
    if (rowCount === 0) return candidate;
    candidate = `${base}-${n}`;
  }
}

async function createBrand(pool, body) {
  const name = ((body && body.name) || '').trim();
  if (!name) throw httpError(400, 'שם הוא שדה חובה');

  try {
    const inserted = await pool.query('INSERT INTO brands (name) VALUES ($1) RETURNING id', [name]);
    const brand = inserted.rows[0];
    const slug = await generateBrandSlug(pool, name);
    const result = await pool.query(`UPDATE brands SET slug = $1 WHERE id = $2 RETURNING ${BRAND_COLUMNS}`, [slug, brand.id]);
    return { status: 201, body: result.rows[0] };
  } catch (error) {
    if (error.code === '23505') throw httpError(409, 'שם המותג כבר קיים במערכת');
    throw error;
  }
}

async function updateBrand(pool, id, body) {
  const name = ((body && body.name) || '').trim();
  if (!name) throw httpError(400, 'שם הוא שדה חובה');

  try {
    // Slug is left untouched on rename — it's already out in the
    // wild as part of every campaign's public URL for this brand.
    const result = await pool.query(`UPDATE brands SET name = $1 WHERE id = $2 RETURNING ${BRAND_COLUMNS}`, [name, id]);
    if (result.rowCount === 0) throw httpError(404, 'המותג לא נמצא');
    return { status: 200, body: result.rows[0] };
  } catch (error) {
    if (error.code === '23505') throw httpError(409, 'שם המותג כבר קיים במערכת');
    throw error;
  }
}

async function deleteBrand(pool, id) {
  const result = await pool.query('DELETE FROM brands WHERE id = $1 RETURNING id', [id]);
  if (result.rowCount === 0) throw httpError(404, 'המותג לא נמצא');
  return { status: 204, body: null };
}

// Brand logo — same shape/pattern as a campaign banner
// (setCampaignBanner/getCampaignBanner/deleteCampaignBanner): stored
// as BYTEA, excluded from ordinary brand responses (has_logo instead),
// served unauthenticated since it appears on the public campaign page.
async function setBrandLogo(pool, id, body) {
  const { mime, buffer } = parseFileDataUri(body && body.image, ALLOWED_LOGO_MIME_TYPES, MAX_LOGO_BYTES);
  const result = await pool.query(
    'UPDATE brands SET logo = $1, logo_mime = $2 WHERE id = $3 RETURNING id',
    [buffer, mime, id]
  );
  if (result.rowCount === 0) throw httpError(404, 'המותג לא נמצא');
  return { status: 200, body: { ok: true } };
}

async function getBrandLogo(pool, id) {
  const result = await pool.query('SELECT logo, logo_mime FROM brands WHERE id = $1', [id]);
  if (result.rowCount === 0 || !result.rows[0].logo) throw httpError(404, 'לא נמצא לוגו למותג זה');
  return { mime: result.rows[0].logo_mime, buffer: result.rows[0].logo };
}

async function deleteBrandLogo(pool, id) {
  const result = await pool.query('UPDATE brands SET logo = NULL, logo_mime = NULL WHERE id = $1 RETURNING id', [id]);
  if (result.rowCount === 0) throw httpError(404, 'המותג לא נמצא');
  return { status: 204, body: null };
}

// ----- Campaigns -----

async function listCampaigns(pool, query, brandScope) {
  const sortColumn = CAMPAIGN_SORT_COLUMNS[query && query.sort] || CAMPAIGN_SORT_COLUMNS.created_at;
  const order = query && query.order === 'asc' ? 'ASC' : 'DESC';
  const page = Math.max(1, parseInt(query && query.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query && query.pageSize, 10) || DEFAULT_PAGE_SIZE));

  const whereParts = [];
  const whereParams = [];
  if (query && query.brand_id) {
    whereParams.push(query.brand_id);
    whereParts.push(`c.brand_id = $${whereParams.length}`);
  }
  // A brandScope means a restricted 'user' account — archived campaigns
  // are admin-only territory, so they're excluded outright here rather
  // than merely hidden client-side (closes the same "type the status in
  // the URL/curl" loophole the archive-button gating already closes).
  if (query && query.status && CAMPAIGN_STATUSES.includes(query.status) && !(brandScope && query.status === 'archived')) {
    whereParams.push(query.status);
    whereParts.push(`c.status = $${whereParams.length}`);
  }
  if (brandScope) {
    whereParams.push(brandScope);
    whereParts.push(`c.brand_id = ANY($${whereParams.length})`);
    whereParts.push(`c.status != 'archived'`);
  }
  const whereClause = whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total FROM campaigns c${whereClause}`,
    whereParams
  );
  const total = parseInt(countResult.rows[0].total, 10);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const listParams = [...whereParams, pageSize, (page - 1) * pageSize];
  const sql = `
    SELECT ${CAMPAIGN_COLUMNS}, b.name AS brand_name, b.slug AS brand_slug
    FROM campaigns c
    JOIN brands b ON b.id = c.brand_id
    ${whereClause}
    ORDER BY ${sortColumn} ${order} NULLS LAST, c.id ${order}
    LIMIT $${listParams.length - 1} OFFSET $${listParams.length}
  `;
  const result = await pool.query(sql, listParams);

  return { status: 200, body: { rows: result.rows, total, page, pageSize, totalPages } };
}

async function getCampaign(pool, id, brandScope) {
  await assertCampaignAccess(pool, id, brandScope);
  const result = await pool.query(
    `SELECT ${CAMPAIGN_COLUMNS}, b.name AS brand_name, b.slug AS brand_slug, (b.logo IS NOT NULL) AS brand_has_logo
     FROM campaigns c JOIN brands b ON b.id = c.brand_id WHERE c.id = $1`,
    [id]
  );
  if (result.rowCount === 0) throw httpError(404, 'הקמפיין לא נמצא');
  return { status: 200, body: result.rows[0] };
}

async function createCampaign(pool, body, brandScope) {
  const {
    brand_id,
    name,
    description = null,
    budget = null,
    start_date = null,
    end_date = null,
  } = body || {};
  const status = (body && body.status) || 'draft';

  if (!brand_id || !name) throw httpError(400, 'יש לספק מותג ושם');
  if (!CAMPAIGN_STATUSES.includes(status)) {
    throw httpError(400, `סטטוס חייב להיות אחד מ: ${CAMPAIGN_STATUSES.join(', ')}`);
  }
  if (brandScope && !brandScope.includes(brand_id)) {
    throw httpError(403, 'אין לך הרשאת גישה למותג זה');
  }

  try {
    const inserted = await pool.query(
      `INSERT INTO campaigns (brand_id, name, description, budget, start_date, end_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [brand_id, name, description, budget, start_date, end_date, status]
    );
    const campaign = inserted.rows[0];
    // Slug depends on the generated id (for guaranteed uniqueness), so
    // it's set in a follow-up update rather than the insert itself.
    // URL shape is /c/:brandSlug/:campaignSlug — the brand name is
    // already its own segment right after /c/, so this one is built
    // from the campaign's own name (plus its id, for uniqueness).
    const brandResult = await pool.query('SELECT name, slug FROM brands WHERE id = $1', [campaign.brand_id]);
    const slug = `${slugify(campaign.name)}-${campaign.id}`.replace(/^-+/, '');
    const result = await pool.query(
      `UPDATE campaigns c SET slug = $1 WHERE c.id = $2 RETURNING ${CAMPAIGN_COLUMNS}`,
      [slug, campaign.id]
    );
    await ensureFixedFields(pool, campaign.id);
    return {
      status: 201,
      body: { ...result.rows[0], brand_name: brandResult.rows[0]?.name, brand_slug: brandResult.rows[0]?.slug },
    };
  } catch (error) {
    if (error.code === '23503') throw httpError(400, 'המותג שנבחר אינו קיים');
    throw error;
  }
}

// Copies the campaign's own fields (incl. its banner) into a new
// draft campaign — deliberately NOT its registrations, which belong
// to that specific real-world campaign instance, not to a template.
async function duplicateCampaign(pool, id, brandScope) {
  await assertCampaignAccess(pool, id, brandScope);
  const original = await pool.query(
    `SELECT brand_id, name, description, budget, start_date, end_date, template, banner, banner_mime, gift_mode, footer_note,
            products_section_title, gifts_section_title
     FROM campaigns WHERE id = $1`,
    [id]
  );
  if (original.rowCount === 0) throw httpError(404, 'הקמפיין לא נמצא');
  const o = original.rows[0];
  const newName = `${o.name} (עותק)`;

  const inserted = await pool.query(
    `INSERT INTO campaigns (brand_id, name, description, budget, start_date, end_date, status, template, banner, banner_mime, gift_mode, footer_note, products_section_title, gifts_section_title)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [o.brand_id, newName, o.description, o.budget, o.start_date, o.end_date, o.template, o.banner, o.banner_mime, o.gift_mode, o.footer_note, o.products_section_title, o.gifts_section_title]
  );
  const newId = inserted.rows[0].id;
  // Same scheme as createCampaign above — the campaign's own name plus
  // its id (the brand is already the URL's own separate segment).
  const slug = `${slugify(newName)}-${newId}`.replace(/^-+/, '');
  const result = await pool.query(
    `UPDATE campaigns c SET slug = $1 WHERE c.id = $2 RETURNING ${CAMPAIGN_COLUMNS}`,
    [slug, newId]
  );

  // Copy the original's dynamic form fields too (fixed ones included,
  // so a customized consent-checkbox label carries over) — a
  // duplicated campaign is meant to be a ready-to-tweak starting
  // point, not a blank form.
  await pool.query(
    `INSERT INTO campaign_fields (campaign_id, type, label, required, options, position, fixed_key)
     SELECT $1, type, label, required, options, position, fixed_key FROM campaign_fields WHERE campaign_id = $2`,
    [newId, id]
  );
  // Safety net in case the original predates these fields (shouldn't
  // happen once every campaign is backfilled, but costs nothing).
  await ensureFixedFields(pool, newId);

  // Copy the product list first, keeping a map from each original
  // product's id to its new copy's id — a plain INSERT...SELECT can't
  // do this remapping, but campaign_gifts.product_id needs it: copied
  // verbatim, it would point at the *original* campaign's product,
  // not the new one.
  const originalProducts = await pool.query(
    'SELECT id, sku, name, image, image_mime, position FROM campaign_products WHERE campaign_id = $1',
    [id]
  );
  const productIdMap = {};
  for (const p of originalProducts.rows) {
    const insertedProduct = await pool.query(
      `INSERT INTO campaign_products (campaign_id, sku, name, image, image_mime, position)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [newId, p.sku, p.name, p.image, p.image_mime, p.position]
    );
    productIdMap[p.id] = insertedProduct.rows[0].id;
  }

  // Now the gift list, translating product_id through that map (null
  // stays null — most gifts, for the non-product-linked gift modes,
  // aren't tied to a product at all).
  const originalGifts = await pool.query(
    'SELECT sku, name, image, image_mime, position, product_id FROM campaign_gifts WHERE campaign_id = $1',
    [id]
  );
  for (const g of originalGifts.rows) {
    const newProductId = g.product_id ? productIdMap[g.product_id] : null;
    await pool.query(
      `INSERT INTO campaign_gifts (campaign_id, sku, name, image, image_mime, position, product_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [newId, g.sku, g.name, g.image, g.image_mime, g.position, newProductId]
    );
  }

  return { status: 201, body: result.rows[0] };
}

async function updateCampaign(pool, id, body, brandScope, actor) {
  await assertCampaignAccess(pool, id, brandScope);

  const fields = Object.keys(body || {}).filter((key) => UPDATABLE_CAMPAIGN_FIELDS.includes(key));
  if (fields.length === 0) throw httpError(400, 'לא סופקו שדות לעדכון');
  if (body.status && !CAMPAIGN_STATUSES.includes(body.status)) {
    throw httpError(400, `סטטוס חייב להיות אחד מ: ${CAMPAIGN_STATUSES.join(', ')}`);
  }
  if (body.template && !CAMPAIGN_TEMPLATES.includes(body.template)) {
    throw httpError(400, `תבנית חייבת להיות אחת מ: ${CAMPAIGN_TEMPLATES.join(', ')}`);
  }
  if (body.gift_mode && !CAMPAIGN_GIFT_MODES.includes(body.gift_mode)) {
    throw httpError(400, `סוג הקמפיין חייב להיות אחד מ: ${CAMPAIGN_GIFT_MODES.join(', ')}`);
  }
  if (body.brand_id && brandScope && !brandScope.includes(body.brand_id)) {
    throw httpError(403, 'אין לך הרשאת גישה למותג זה');
  }
  if (fields.includes('slug')) {
    const slug = (body.slug || '').trim().toLowerCase();
    if (!slug) throw httpError(400, 'כתובת ה-URL היא שדה חובה');
    if (!SLUG_PATTERN.test(slug)) {
      throw httpError(400, 'כתובת ה-URL יכולה להכיל רק אותיות אנגליות קטנות, ספרות ומקפים (בלי מקף בהתחלה או בסוף)');
    }
    const conflict = await pool.query('SELECT 1 FROM campaigns WHERE slug = $1 AND id <> $2', [slug, id]);
    if (conflict.rowCount > 0) {
      throw httpError(409, 'כתובת ה-URL הזו כבר תפוסה על ידי קמפיין אחר');
    }
    body.slug = slug;
  }
  // The FK on activetrail_email_field_id only guarantees the id exists
  // somewhere in campaign_fields — it doesn't stop it pointing at some
  // *other* campaign's field, so that's checked explicitly here.
  if (body.activetrail_email_field_id !== undefined && body.activetrail_email_field_id !== null) {
    const fieldCheck = await pool.query(
      'SELECT 1 FROM campaign_fields WHERE id = $1 AND campaign_id = $2',
      [body.activetrail_email_field_id, id]
    );
    if (fieldCheck.rowCount === 0) {
      throw httpError(400, 'שדה האימייל שנבחר עבור ActiveTrail חייב להיות שדה קיים בקמפיין זה');
    }
  }
  // Both are secrets/identifiers, not free text — an empty string sent
  // from the UI (e.g. clearing the token field, or the "no group"
  // option) means "clear it", same as an explicit null.
  if (fields.includes('activetrail_token')) {
    body.activetrail_token = (body.activetrail_token || '').trim() || null;
  }
  if (fields.includes('activetrail_group_id')) {
    body.activetrail_group_id = (body.activetrail_group_id || '').toString().trim() || null;
  }

  // Fetched *before* the update, scoped to just the fields being
  // touched, so the log below can tell which ones actually changed
  // value — the admin editor's main form resubmits every field on
  // every save regardless of what the admin actually edited, so
  // without this every save would log all ~8 fields as "changed" even
  // when only one really was.
  const beforeResult = await pool.query(`SELECT ${fields.join(', ')} FROM campaigns WHERE id = $1`, [id]);
  const before = beforeResult.rows[0] || {};

  const setClause = fields.map((field, i) => `${field} = $${i + 1}`).join(', ');
  const values = fields.map((field) => body[field]);
  values.push(id);

  try {
    const result = await pool.query(
      `UPDATE campaigns c SET ${setClause} WHERE c.id = $${values.length} RETURNING ${CAMPAIGN_COLUMNS}`,
      values
    );
    if (result.rowCount === 0) throw httpError(404, 'הקמפיין לא נמצא');
    // One log entry per field that actually changed value.
    for (const field of fields) {
      if (!campaignFieldValueChanged(field, before[field], body[field])) continue;
      await logCampaignActivity(pool, id, actor, await describeCampaignFieldChange(pool, field, body[field]));
    }
    return { status: 200, body: result.rows[0] };
  } catch (error) {
    if (error.code === '23503') throw httpError(400, 'המותג שנבחר אינו קיים');
    // Belt-and-suspenders alongside the explicit pre-check above — closes
    // the tiny race window between that SELECT and this UPDATE.
    if (error.code === '23505') throw httpError(409, 'כתובת ה-URL הזו כבר תפוסה על ידי קמפיין אחר');
    throw error;
  }
}

// ----- Campaign fields (dynamic registration-form builder) -----

// Validates & normalizes the type-specific `options` payload for a
// field. 'select' carries its list of choices, 'text' carries its
// character limit (defaulting to 200 when unset/invalid); everything
// else is stored as null — a date field's dd/mm/yy format is a fixed
// rendering rule, and a checkbox's adjacent text is just its own
// `label`, not a separate option.
function normalizeFieldOptions(type, options) {
  if (type === 'select') {
    const values = Array.isArray(options && options.values)
      ? options.values.map((v) => String(v).trim()).filter(Boolean)
      : [];
    if (values.length === 0) throw httpError(400, 'שדה מסוג רשימה חייב לכלול לפחות ערך אחד');
    return { values };
  }
  if (type === 'text') {
    const raw = parseInt(options && options.max_length, 10);
    const maxLength = Number.isInteger(raw) && raw >= 1
      ? Math.min(raw, MAX_TEXT_FIELD_MAX_LENGTH)
      : DEFAULT_TEXT_FIELD_MAX_LENGTH;
    return { max_length: maxLength };
  }
  return null;
}

function parseFieldInput(body) {
  const type = body && body.type;
  const label = ((body && body.label) || '').trim();
  const required = !!(body && body.required);
  if (!CAMPAIGN_FIELD_TYPES.includes(type)) {
    throw httpError(400, `סוג השדה חייב להיות אחד מ: ${CAMPAIGN_FIELD_TYPES.join(', ')}`);
  }
  if (!label) throw httpError(400, 'תווית השדה היא שדה חובה');
  const options = normalizeFieldOptions(type, body && body.options);
  return { type, label, required, options };
}

// Provisions this app's built-in fixed checkbox fields for a campaign
// if it doesn't already have them — called on campaign creation/
// duplication. ON CONFLICT DO NOTHING makes each insert safe to call
// speculatively (e.g. as a duplicate's safety net) without an extra
// existence check. position 0/1 puts terms-agreement above marketing
// consent — both still always sort after every regular dynamic field
// (see FIELDS_DISPLAY_ORDER).
async function ensureFixedFields(pool, campaignId) {
  await pool.query(
    `INSERT INTO campaign_fields (campaign_id, type, label, required, options, position, fixed_key)
     VALUES ($1, 'checkbox', $2, true, NULL, 0, $3)
     ON CONFLICT (campaign_id, fixed_key) WHERE fixed_key IS NOT NULL DO NOTHING`,
    [campaignId, TERMS_AGREEMENT_DEFAULT_LABEL, TERMS_AGREEMENT_FIXED_KEY]
  );
  await pool.query(
    `INSERT INTO campaign_fields (campaign_id, type, label, required, options, position, fixed_key)
     VALUES ($1, 'checkbox', $2, false, NULL, 1, $3)
     ON CONFLICT (campaign_id, fixed_key) WHERE fixed_key IS NOT NULL DO NOTHING`,
    [campaignId, MARKETING_CONSENT_DEFAULT_LABEL, MARKETING_CONSENT_FIXED_KEY]
  );
}

async function listCampaignFields(pool, campaignId, brandScope) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const result = await pool.query(
    `SELECT ${CAMPAIGN_FIELD_COLUMNS} FROM campaign_fields WHERE campaign_id = $1 ORDER BY ${FIELDS_DISPLAY_ORDER}`,
    [campaignId]
  );
  return { status: 200, body: result.rows };
}

async function createCampaignField(pool, campaignId, body, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const { type, label, required, options } = parseFieldInput(body);

  const posResult = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM campaign_fields WHERE campaign_id = $1',
    [campaignId]
  );
  const position = posResult.rows[0].next_position;

  try {
    const result = await pool.query(
      `INSERT INTO campaign_fields (campaign_id, type, label, required, options, position)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${CAMPAIGN_FIELD_COLUMNS}`,
      [campaignId, type, label, required, options ? JSON.stringify(options) : null, position]
    );
    await logCampaignActivity(pool, campaignId, actor, `נוסף שדה חדש: "${label}"`);
    return { status: 201, body: result.rows[0] };
  } catch (error) {
    if (error.code === '23503') throw httpError(404, 'הקמפיין לא נמצא');
    throw error;
  }
}

// A fixed field (see ensureFixedFields) only allows editing
// its label — the checkbox's adjacent text. Its type, required-ness
// and position are pinned in code, so any of that in the request body
// is silently ignored rather than rejected (keeps the same PUT the UI
// already sends for ordinary fields usable here too).
async function updateCampaignField(pool, campaignId, fieldId, body, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const existing = await pool.query(
    'SELECT fixed_key FROM campaign_fields WHERE id = $1 AND campaign_id = $2',
    [fieldId, campaignId]
  );
  if (existing.rowCount === 0) throw httpError(404, 'השדה לא נמצא');

  if (existing.rows[0].fixed_key) {
    const label = ((body && body.label) || '').trim();
    if (!label) throw httpError(400, 'תווית השדה היא שדה חובה');
    const result = await pool.query(
      `UPDATE campaign_fields SET label = $1 WHERE id = $2 AND campaign_id = $3 RETURNING ${CAMPAIGN_FIELD_COLUMNS}`,
      [label, fieldId, campaignId]
    );
    await logCampaignActivity(pool, campaignId, actor, `עודכן שדה: "${label}"`);
    return { status: 200, body: result.rows[0] };
  }

  const { type, label, required, options } = parseFieldInput(body);
  const result = await pool.query(
    `UPDATE campaign_fields SET type = $1, label = $2, required = $3, options = $4
     WHERE id = $5 AND campaign_id = $6 RETURNING ${CAMPAIGN_FIELD_COLUMNS}`,
    [type, label, required, options ? JSON.stringify(options) : null, fieldId, campaignId]
  );
  if (result.rowCount === 0) throw httpError(404, 'השדה לא נמצא');
  await logCampaignActivity(pool, campaignId, actor, `עודכן שדה: "${label}"`);
  return { status: 200, body: result.rows[0] };
}

async function deleteCampaignField(pool, campaignId, fieldId, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const existing = await pool.query(
    'SELECT fixed_key, label FROM campaign_fields WHERE id = $1 AND campaign_id = $2',
    [fieldId, campaignId]
  );
  if (existing.rowCount === 0) throw httpError(404, 'השדה לא נמצא');
  if (existing.rows[0].fixed_key) throw httpError(400, 'לא ניתן למחוק שדה קבוע');

  const result = await pool.query(
    'DELETE FROM campaign_fields WHERE id = $1 AND campaign_id = $2 RETURNING id',
    [fieldId, campaignId]
  );
  if (result.rowCount === 0) throw httpError(404, 'השדה לא נמצא');
  await logCampaignActivity(pool, campaignId, actor, `נמחק שדה: "${existing.rows[0].label}"`);
  return { status: 204, body: null };
}

// Swaps a field's position with its neighbor in the given direction,
// among non-fixed fields only — a fixed field never takes part (it's
// always sorted last regardless, see FIELDS_DISPLAY_ORDER). A no-op
// (not an error) at either end of the list, so the UI can always call
// it without checking boundaries itself first.
async function moveCampaignField(pool, campaignId, fieldId, direction, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  if (direction !== 'up' && direction !== 'down') throw httpError(400, 'כיוון ההזזה חייב להיות "up" או "down"');

  const listResult = await pool.query(
    'SELECT id, position FROM campaign_fields WHERE campaign_id = $1 AND fixed_key IS NULL ORDER BY position, id',
    [campaignId]
  );
  const list = listResult.rows;
  const idx = list.findIndex((f) => f.id === Number(fieldId));
  if (idx === -1) throw httpError(404, 'השדה לא נמצא, או שהוא שדה קבוע שלא ניתן להזיז');
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;

  if (swapIdx >= 0 && swapIdx < list.length) {
    const a = list[idx];
    const b = list[swapIdx];
    await pool.query('UPDATE campaign_fields SET position = $1 WHERE id = $2', [b.position, a.id]);
    await pool.query('UPDATE campaign_fields SET position = $1 WHERE id = $2', [a.position, b.id]);
    await logCampaignActivity(pool, campaignId, actor, `הוזז שדה (${describeMove(direction)})`);
  }

  const result = await pool.query(
    `SELECT ${CAMPAIGN_FIELD_COLUMNS} FROM campaign_fields WHERE campaign_id = $1 ORDER BY ${FIELDS_DISPLAY_ORDER}`,
    [campaignId]
  );
  return { status: 200, body: result.rows };
}

// Full reorder in one call — used by the drag-and-drop field list in
// edit.html, which can move an item several places in a single drop
// (moveCampaignField above only ever swaps one step at a time). Same
// restriction as moveCampaignField: only non-fixed fields take part —
// a fixed field (e.g. the marketing-consent checkbox) always sorts
// last regardless (see FIELDS_DISPLAY_ORDER). `fieldIds` must be
// exactly the campaign's current non-fixed field ids, just reordered
// — silently accepting a mismatched set (extras, missing ones, ids
// from a different campaign) could corrupt positions rather than just
// reordering them, so that's rejected outright instead.
async function reorderCampaignFields(pool, campaignId, fieldIds, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  if (!Array.isArray(fieldIds) || fieldIds.length === 0) {
    throw httpError(400, 'רשימת השדות לסידור מחדש חייבת להכיל לפחות שדה אחד');
  }
  const submittedIds = fieldIds.map(Number);
  if (submittedIds.some((n) => !Number.isInteger(n))) {
    throw httpError(400, 'רשימת השדות לסידור מחדש אינה תקינה');
  }

  const existing = await pool.query(
    'SELECT id FROM campaign_fields WHERE campaign_id = $1 AND fixed_key IS NULL',
    [campaignId]
  );
  const existingIds = existing.rows.map((r) => r.id);
  const sameSet = existingIds.length === submittedIds.length
    && existingIds.every((eid) => submittedIds.includes(eid))
    && new Set(submittedIds).size === submittedIds.length;
  if (!sameSet) {
    throw httpError(400, 'רשימת השדות שנשלחה אינה תואמת לשדות הקיימים בקמפיין');
  }

  for (let i = 0; i < submittedIds.length; i++) {
    await pool.query('UPDATE campaign_fields SET position = $1 WHERE id = $2 AND campaign_id = $3', [i, submittedIds[i], campaignId]);
  }
  await logCampaignActivity(pool, campaignId, actor, 'סדר השדות בטופס שונה');

  const result = await pool.query(
    `SELECT ${CAMPAIGN_FIELD_COLUMNS} FROM campaign_fields WHERE campaign_id = $1 ORDER BY ${FIELDS_DISPLAY_ORDER}`,
    [campaignId]
  );
  return { status: 200, body: result.rows };
}

// ----- Campaign gifts (gift-choice campaigns) -----

async function listCampaignGifts(pool, campaignId, brandScope) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const result = await pool.query(
    `SELECT ${CAMPAIGN_GIFT_COLUMNS} FROM campaign_gifts WHERE campaign_id = $1 ORDER BY position, id`,
    [campaignId]
  );
  return { status: 200, body: result.rows };
}

// A brand-new gift (stock key absent entirely from the request body —
// the "+ הוסף מתנה" flow never sends one) defaults to a starting stock
// of 50 rather than unlimited. Editing an *existing* gift always sends
// the field's current value explicitly, including null/'' when the
// admin deliberately clears it to mean "no limit" — that still works
// unchanged, since it's distinguished from "key not sent at all".
const DEFAULT_GIFT_STOCK = 50;
function parseGiftInput(body) {
  const sku = ((body && body.sku) || '').trim() || null;
  const name = ((body && body.name) || '').trim();
  if (!name) throw httpError(400, 'שם הוא שדה חובה');
  let stock = DEFAULT_GIFT_STOCK;
  if (body && (body.stock === null || body.stock === '')) {
    stock = null;
  } else if (body && body.stock !== undefined) {
    stock = Number(body.stock);
    if (!Number.isInteger(stock) || stock < 0) {
      throw httpError(400, 'מלאי חייב להיות מספר שלם, 0 או יותר (או ריק — ללא הגבלה)');
    }
  }
  return { sku, name, stock };
}

// A gift's product_id (only meaningful for 'product_then_gift') is set
// once, at creation, and never reassigned afterwards — updateCampaignGift
// below only ever touches sku/name. Nested "add gift" UI under a product
// row always passes its own product_id; the flat gift managers
// ('simple_choice'/'product_and_gift') never send one, so it stays null.
async function createCampaignGift(pool, campaignId, body, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const { sku, name, stock } = parseGiftInput(body);
  const productId = (body && body.product_id) || null;
  if (productId) {
    const productCheck = await pool.query(
      'SELECT 1 FROM campaign_products WHERE id = $1 AND campaign_id = $2',
      [productId, campaignId]
    );
    if (productCheck.rowCount === 0) throw httpError(400, 'המוצר שנבחר אינו תקין');
  }

  const posResult = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM campaign_gifts WHERE campaign_id = $1',
    [campaignId]
  );
  const position = posResult.rows[0].next_position;

  try {
    const result = await pool.query(
      `INSERT INTO campaign_gifts (campaign_id, sku, name, position, product_id, stock)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${CAMPAIGN_GIFT_COLUMNS}`,
      [campaignId, sku, name, position, productId, stock]
    );
    await logCampaignActivity(pool, campaignId, actor, `נוספה מתנה: "${name}"`);
    return { status: 201, body: result.rows[0] };
  } catch (error) {
    if (error.code === '23503') throw httpError(404, 'הקמפיין לא נמצא');
    throw error;
  }
}

async function updateCampaignGift(pool, campaignId, giftId, body, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const { sku, name, stock } = parseGiftInput(body);
  const result = await pool.query(
    `UPDATE campaign_gifts SET sku = $1, name = $2, stock = $3 WHERE id = $4 AND campaign_id = $5 RETURNING ${CAMPAIGN_GIFT_COLUMNS}`,
    [sku, name, stock, giftId, campaignId]
  );
  if (result.rowCount === 0) throw httpError(404, 'המתנה לא נמצאה');
  await logCampaignActivity(pool, campaignId, actor, `עודכנה מתנה: "${name}"`);
  return { status: 200, body: result.rows[0] };
}

async function deleteCampaignGift(pool, campaignId, giftId, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const result = await pool.query(
    'DELETE FROM campaign_gifts WHERE id = $1 AND campaign_id = $2 RETURNING id, name',
    [giftId, campaignId]
  );
  if (result.rowCount === 0) throw httpError(404, 'המתנה לא נמצאה');
  await logCampaignActivity(pool, campaignId, actor, `נמחקה מתנה: "${result.rows[0].name}"`);
  return { status: 204, body: null };
}

// Copies a gift's own sku/name/image into a new row on the same
// campaign — same "(עותק)" naming convention as
// duplicateCampaignProduct. Preserves product_id, so duplicating a
// nested gift (under a product, in 'product_then_gift' mode) keeps
// the copy nested under that same product; a flat-list gift
// (product_id null) stays flat. Position is computed the same
// campaign-wide way createCampaignGift already does — gift positions
// aren't scoped per product_id, only the up/down move is (see
// moveCampaignGift).
async function duplicateCampaignGift(pool, campaignId, giftId, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const original = await pool.query(
    'SELECT sku, name, image, image_mime, product_id, stock FROM campaign_gifts WHERE id = $1 AND campaign_id = $2',
    [giftId, campaignId]
  );
  if (original.rowCount === 0) throw httpError(404, 'המתנה לא נמצאה');
  const o = original.rows[0];
  const newName = `${o.name} (עותק)`;

  const posResult = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM campaign_gifts WHERE campaign_id = $1',
    [campaignId]
  );
  const position = posResult.rows[0].next_position;

  const result = await pool.query(
    `INSERT INTO campaign_gifts (campaign_id, sku, name, image, image_mime, position, product_id, stock)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${CAMPAIGN_GIFT_COLUMNS}`,
    [campaignId, o.sku, newName, o.image, o.image_mime, position, o.product_id, o.stock]
  );
  await logCampaignActivity(pool, campaignId, actor, `שוכפלה מתנה: "${o.name}"`);
  return { status: 201, body: result.rows[0] };
}

// Swaps a gift's position with its neighbor in the given direction —
// same no-op-at-the-boundary approach as moveCampaignField. Scoped to
// gifts sharing the same product_id (including "no product", i.e. the
// flat gift list): without that, swapping with a *global* neighbor
// that happens to belong to a different product would silently have
// no visible effect on the product-grouped list the admin is looking
// at, since the swap wouldn't change that product's own gifts' order
// relative to each other.
async function moveCampaignGift(pool, campaignId, giftId, direction, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  if (direction !== 'up' && direction !== 'down') throw httpError(400, 'כיוון ההזזה חייב להיות "up" או "down"');

  const giftRow = await pool.query(
    'SELECT product_id FROM campaign_gifts WHERE id = $1 AND campaign_id = $2',
    [giftId, campaignId]
  );
  if (giftRow.rowCount === 0) throw httpError(404, 'המתנה לא נמצאה');
  const productId = giftRow.rows[0].product_id;

  const listResult = await pool.query(
    productId === null
      ? 'SELECT id, position FROM campaign_gifts WHERE campaign_id = $1 AND product_id IS NULL ORDER BY position, id'
      : 'SELECT id, position FROM campaign_gifts WHERE campaign_id = $1 AND product_id = $2 ORDER BY position, id',
    productId === null ? [campaignId] : [campaignId, productId]
  );
  const list = listResult.rows;
  const idx = list.findIndex((g) => g.id === Number(giftId));
  if (idx === -1) throw httpError(404, 'המתנה לא נמצאה');
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;

  if (swapIdx >= 0 && swapIdx < list.length) {
    const a = list[idx];
    const b = list[swapIdx];
    await pool.query('UPDATE campaign_gifts SET position = $1 WHERE id = $2', [b.position, a.id]);
    await pool.query('UPDATE campaign_gifts SET position = $1 WHERE id = $2', [a.position, b.id]);
    await logCampaignActivity(pool, campaignId, actor, `הוזזה מתנה (${describeMove(direction)})`);
  }

  const result = await pool.query(
    `SELECT ${CAMPAIGN_GIFT_COLUMNS} FROM campaign_gifts WHERE campaign_id = $1 ORDER BY position, id`,
    [campaignId]
  );
  return { status: 200, body: result.rows };
}

// Gift photo — same shape as the campaign banner (setCampaignBanner/
// getCampaignBanner/deleteCampaignBanner): stored as BYTEA, excluded
// from ordinary list responses (see CAMPAIGN_GIFT_COLUMNS's has_image),
// served unauthenticated since it appears on the public campaign page.
async function setCampaignGiftImage(pool, campaignId, giftId, body, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const { mime, buffer } = parseFileDataUri(body && body.image, ALLOWED_BANNER_MIME_TYPES, MAX_BANNER_BYTES);
  const result = await pool.query(
    'UPDATE campaign_gifts SET image = $1, image_mime = $2 WHERE id = $3 AND campaign_id = $4 RETURNING id',
    [buffer, mime, giftId, campaignId]
  );
  if (result.rowCount === 0) throw httpError(404, 'המתנה לא נמצאה');
  await logCampaignActivity(pool, campaignId, actor, 'עודכנה תמונת מתנה');
  return { status: 200, body: { ok: true } };
}

async function getCampaignGiftImage(pool, giftId) {
  const result = await pool.query('SELECT image, image_mime FROM campaign_gifts WHERE id = $1', [giftId]);
  if (result.rowCount === 0 || !result.rows[0].image) throw httpError(404, 'לא נמצאה תמונה למתנה זו');
  return { mime: result.rows[0].image_mime, buffer: result.rows[0].image };
}

async function deleteCampaignGiftImage(pool, campaignId, giftId, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const result = await pool.query(
    'UPDATE campaign_gifts SET image = NULL, image_mime = NULL WHERE id = $1 AND campaign_id = $2 RETURNING id',
    [giftId, campaignId]
  );
  if (result.rowCount === 0) throw httpError(404, 'המתנה לא נמצאה');
  await logCampaignActivity(pool, campaignId, actor, 'הוסרה תמונת מתנה');
  return { status: 204, body: null };
}

// ----- Campaign products ('product_and_gift' campaigns: "which product
// did you buy") — same shape and CRUD pattern as campaign gifts above,
// just a separate table/list, independent of the gift pick.

async function listCampaignProducts(pool, campaignId, brandScope) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const result = await pool.query(
    `SELECT ${CAMPAIGN_PRODUCT_COLUMNS} FROM campaign_products WHERE campaign_id = $1 ORDER BY position, id`,
    [campaignId]
  );
  return { status: 200, body: result.rows };
}

function parseProductInput(body) {
  const sku = ((body && body.sku) || '').trim() || null;
  const name = ((body && body.name) || '').trim();
  if (!name) throw httpError(400, 'שם הוא שדה חובה');
  return { sku, name };
}

async function createCampaignProduct(pool, campaignId, body, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const { sku, name } = parseProductInput(body);

  const posResult = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM campaign_products WHERE campaign_id = $1',
    [campaignId]
  );
  const position = posResult.rows[0].next_position;

  try {
    const result = await pool.query(
      `INSERT INTO campaign_products (campaign_id, sku, name, position)
       VALUES ($1, $2, $3, $4) RETURNING ${CAMPAIGN_PRODUCT_COLUMNS}`,
      [campaignId, sku, name, position]
    );
    await logCampaignActivity(pool, campaignId, actor, `נוסף מוצר: "${name}"`);
    return { status: 201, body: result.rows[0] };
  } catch (error) {
    if (error.code === '23503') throw httpError(404, 'הקמפיין לא נמצא');
    throw error;
  }
}

async function updateCampaignProduct(pool, campaignId, productId, body, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const { sku, name } = parseProductInput(body);
  const result = await pool.query(
    `UPDATE campaign_products SET sku = $1, name = $2 WHERE id = $3 AND campaign_id = $4 RETURNING ${CAMPAIGN_PRODUCT_COLUMNS}`,
    [sku, name, productId, campaignId]
  );
  if (result.rowCount === 0) throw httpError(404, 'המוצר לא נמצא');
  await logCampaignActivity(pool, campaignId, actor, `עודכן מוצר: "${name}"`);
  return { status: 200, body: result.rows[0] };
}

async function deleteCampaignProduct(pool, campaignId, productId, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const result = await pool.query(
    'DELETE FROM campaign_products WHERE id = $1 AND campaign_id = $2 RETURNING id, name',
    [productId, campaignId]
  );
  if (result.rowCount === 0) throw httpError(404, 'המוצר לא נמצא');
  await logCampaignActivity(pool, campaignId, actor, `נמחק מוצר: "${result.rows[0].name}"`);
  return { status: 204, body: null };
}

// Copies a product's own sku/name/image into a new row on the same
// campaign, appended at the end of the list — same "(עותק)" naming
// convention as duplicateCampaign. Deliberately doesn't touch any
// campaign_gifts tied to the original via product_id (a
// 'product_then_gift' product's own nested gift list): duplicating the
// product record itself is the ask here, not its associated gifts.
async function duplicateCampaignProduct(pool, campaignId, productId, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const original = await pool.query(
    'SELECT sku, name, image, image_mime FROM campaign_products WHERE id = $1 AND campaign_id = $2',
    [productId, campaignId]
  );
  if (original.rowCount === 0) throw httpError(404, 'המוצר לא נמצא');
  const o = original.rows[0];
  const newName = `${o.name} (עותק)`;

  const posResult = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM campaign_products WHERE campaign_id = $1',
    [campaignId]
  );
  const position = posResult.rows[0].next_position;

  const result = await pool.query(
    `INSERT INTO campaign_products (campaign_id, sku, name, image, image_mime, position)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${CAMPAIGN_PRODUCT_COLUMNS}`,
    [campaignId, o.sku, newName, o.image, o.image_mime, position]
  );
  await logCampaignActivity(pool, campaignId, actor, `שוכפל מוצר: "${o.name}"`);
  return { status: 201, body: result.rows[0] };
}

// Swaps a product's position with its neighbor in the given direction —
// same no-op-at-the-boundary approach as moveCampaignGift.
async function moveCampaignProduct(pool, campaignId, productId, direction, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  if (direction !== 'up' && direction !== 'down') throw httpError(400, 'כיוון ההזזה חייב להיות "up" או "down"');

  const listResult = await pool.query(
    'SELECT id, position FROM campaign_products WHERE campaign_id = $1 ORDER BY position, id',
    [campaignId]
  );
  const list = listResult.rows;
  const idx = list.findIndex((p) => p.id === Number(productId));
  if (idx === -1) throw httpError(404, 'המוצר לא נמצא');
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;

  if (swapIdx >= 0 && swapIdx < list.length) {
    const a = list[idx];
    const b = list[swapIdx];
    await pool.query('UPDATE campaign_products SET position = $1 WHERE id = $2', [b.position, a.id]);
    await pool.query('UPDATE campaign_products SET position = $1 WHERE id = $2', [a.position, b.id]);
    await logCampaignActivity(pool, campaignId, actor, `הוזז מוצר (${describeMove(direction)})`);
  }

  const result = await pool.query(
    `SELECT ${CAMPAIGN_PRODUCT_COLUMNS} FROM campaign_products WHERE campaign_id = $1 ORDER BY position, id`,
    [campaignId]
  );
  return { status: 200, body: result.rows };
}

// Product photo — same shape as a gift's (setCampaignGiftImage/...).
async function setCampaignProductImage(pool, campaignId, productId, body, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const { mime, buffer } = parseFileDataUri(body && body.image, ALLOWED_BANNER_MIME_TYPES, MAX_BANNER_BYTES);
  const result = await pool.query(
    'UPDATE campaign_products SET image = $1, image_mime = $2 WHERE id = $3 AND campaign_id = $4 RETURNING id',
    [buffer, mime, productId, campaignId]
  );
  if (result.rowCount === 0) throw httpError(404, 'המוצר לא נמצא');
  await logCampaignActivity(pool, campaignId, actor, 'עודכנה תמונת מוצר');
  return { status: 200, body: { ok: true } };
}

async function getCampaignProductImage(pool, productId) {
  const result = await pool.query('SELECT image, image_mime FROM campaign_products WHERE id = $1', [productId]);
  if (result.rowCount === 0 || !result.rows[0].image) throw httpError(404, 'לא נמצאה תמונה למוצר זה');
  return { mime: result.rows[0].image_mime, buffer: result.rows[0].image };
}

async function deleteCampaignProductImage(pool, campaignId, productId, brandScope, actor) {
  await assertCampaignAccess(pool, campaignId, brandScope);
  const result = await pool.query(
    'UPDATE campaign_products SET image = NULL, image_mime = NULL WHERE id = $1 AND campaign_id = $2 RETURNING id',
    [productId, campaignId]
  );
  if (result.rowCount === 0) throw httpError(404, 'המוצר לא נמצא');
  await logCampaignActivity(pool, campaignId, actor, 'הוסרה תמונת מוצר');
  return { status: 204, body: null };
}

function isValidPhone(value) {
  if (!PHONE_FIELD_CHAR_PATTERN.test(value)) return false;
  const digitCount = value.replace(/\D/g, '').length;
  return digitCount >= MIN_PHONE_DIGITS && digitCount <= MAX_PHONE_DIGITS;
}

// Checks visitor-submitted answers against a campaign's field
// definitions: enforces `required`, restricts 'select' to its own
// value list, enforces the dd/mm/yy shape for 'date', validates
// 'email'/'phone' shape, and validates/decodes a 'file' field's
// upload (mime + 1MB cap — same data-URI shape as the invoice
// upload). Unknown field ids in the input are silently dropped rather
// than stored verbatim.
//
// Returns { normalized, files, fields }: `normalized` is the
// { [fieldId]: value } object to store in registrations.custom_fields
// (a 'file' field's value there is just its filename); `files` is the
// list of { fieldId, mime, buffer, filename } to insert into
// registration_field_files once the registration row exists; `fields`
// is the campaign's field definitions themselves, handed back so the
// caller (e.g. the ActiveTrail sync) doesn't need to re-fetch them.
async function validateCustomFields(pool, campaignId, input) {
  const fieldsResult = await pool.query(
    `SELECT id, type, label, required, options, fixed_key FROM campaign_fields WHERE campaign_id = $1`,
    [campaignId]
  );
  const submitted = (input && typeof input === 'object') ? input : {};
  const normalized = {};
  const files = [];

  for (const field of fieldsResult.rows) {
    const raw = submitted[field.id];

    if (field.type === 'checkbox') {
      const checked = !!raw;
      if (field.required && !checked) throw httpError(400, `יש לסמן את השדה "${field.label}"`);
      normalized[field.id] = checked;
      continue;
    }

    if (field.type === 'file') {
      const dataUri = raw && typeof raw === 'object' ? raw.file : null;
      if (!dataUri) {
        if (field.required) throw httpError(400, `השדה "${field.label}" הוא שדה חובה`);
        continue;
      }
      let mime, buffer;
      try {
        ({ mime, buffer } = parseFileDataUri(dataUri, ALLOWED_CAMPAIGN_FIELD_FILE_MIME_TYPES, MAX_CAMPAIGN_FIELD_FILE_BYTES));
      } catch (error) {
        throw httpError(error.statusCode || 400, `${field.label}: ${error.message}`);
      }
      const filename = raw.filename ? String(raw.filename).slice(0, 200) : null;
      files.push({ fieldId: field.id, mime, buffer, filename });
      normalized[field.id] = filename;
      continue;
    }

    const value = (raw === undefined || raw === null) ? '' : String(raw).trim();
    if (!value) {
      if (field.required) throw httpError(400, `השדה "${field.label}" הוא שדה חובה`);
      continue;
    }
    if (field.type === 'select') {
      const allowed = (field.options && field.options.values) || [];
      if (!allowed.includes(value)) throw httpError(400, `הערך שנבחר עבור "${field.label}" אינו תקין`);
    }
    if (field.type === 'date' && !DATE_FIELD_PATTERN.test(value)) {
      throw httpError(400, `השדה "${field.label}" חייב להיות בפורמט dd/mm/yy`);
    }
    if (field.type === 'email' && !EMAIL_PATTERN.test(value)) {
      throw httpError(400, `השדה "${field.label}" חייב להכיל כתובת דואר אלקטרוני תקינה`);
    }
    if (field.type === 'phone' && !isValidPhone(value)) {
      throw httpError(400, `השדה "${field.label}" חייב להכיל מספר טלפון תקין`);
    }
    if (field.type === 'text') {
      const maxLength = (field.options && field.options.max_length) || DEFAULT_TEXT_FIELD_MAX_LENGTH;
      if (value.length > maxLength) {
        throw httpError(400, `השדה "${field.label}" יכול להכיל עד ${maxLength} תווים`);
      }
    }
    normalized[field.id] = value;
  }

  return { normalized, files, fields: fieldsResult.rows };
}

// Fire-and-forget: pushes a new registrant into the ActiveTrail group
// the campaign editor configured — entirely per-campaign (its own API
// token, group and "which field is the email"; see activetrail_token /
// activetrail_group_id / activetrail_email_field_id, set via
// updateCampaign) — and only when the registrant actually checked the
// fixed marketing-consent checkbox (fixed_key === 'marketing_consent'
// — see ensureFixedFields). A campaign with sync switched
// off (activetrail_sync_enabled), missing any of the three settings,
// or a registrant who left consent unchecked, has sync skipped — this
// just returns quietly rather than erroring. Every other submitted
// value (bar the email field itself, the consent checkbox, and any
// file uploads, which aren't meaningful as flat text) rides along as
// ActiveTrail customFields, keyed by the field's own label.
//
// Never throws to the caller — a misconfigured/unreachable ActiveTrail
// is logged and otherwise silently skipped, so it can never fail or
// delay the registration itself.
async function maybeSyncRegistrationToActiveTrail(pool, campaignId, fields, customFields) {
  try {
    const { rows } = await pool.query(
      'SELECT activetrail_sync_enabled, activetrail_token, activetrail_group_id, activetrail_email_field_id FROM campaigns WHERE id = $1',
      [campaignId]
    );
    const campaign = rows[0];
    if (!campaign || !campaign.activetrail_sync_enabled) return;
    if (!campaign.activetrail_token || !campaign.activetrail_group_id || !campaign.activetrail_email_field_id) return;

    const consentField = fields.find((f) => f.fixed_key === MARKETING_CONSENT_FIXED_KEY);
    if (!consentField || !customFields[consentField.id]) return;

    const emailField = fields.find((f) => f.id === campaign.activetrail_email_field_id);
    const email = emailField && customFields[emailField.id];
    if (!email || typeof email !== 'string') return;

    const extra = {};
    for (const field of fields) {
      if (field.id === campaign.activetrail_email_field_id || field.id === consentField.id || field.type === 'file') continue;
      const value = customFields[field.id];
      if (value !== undefined) extra[field.label] = value;
    }

    await activetrail.addContactToGroup(campaign.activetrail_token, campaign.activetrail_group_id, { email, customFields: extra });
  } catch (error) {
    console.error(`ActiveTrail sync failed for campaign ${campaignId}:`, error.message);
  }
}

// The public URL is /c/:brandSlug/:campaignSlug — both segments must
// match so a stale/mismatched brand slug 404s instead of silently
// resolving (campaign slugs alone are already globally unique, but
// requiring both keeps the URL honest).
async function getCampaignBySlug(pool, brandSlug, campaignSlug) {
  const result = await pool.query(
    `SELECT ${CAMPAIGN_COLUMNS}, b.name AS brand_name, b.slug AS brand_slug, (b.logo IS NOT NULL) AS brand_has_logo
     FROM campaigns c JOIN brands b ON b.id = c.brand_id WHERE c.slug = $1 AND b.slug = $2`,
    [campaignSlug, brandSlug]
  );
  if (result.rowCount === 0) throw httpError(404, 'הקמפיין לא נמצא');
  const campaign = result.rows[0];
  // The public page only exists for live campaigns — draft/paused/
  // completed/cancelled/archived all 404 exactly like a missing one,
  // no leaking status via a different error.
  if (campaign.status !== 'active') throw httpError(404, 'הקמפיין לא נמצא');
  // Fire-and-forget: a view counter off by one for a moment doesn't
  // matter, and this shouldn't add latency to the public page.
  pool.query('UPDATE campaigns SET views_count = views_count + 1 WHERE id = $1', [campaign.id]).catch(() => {});
  // The public form needs the campaign's dynamic field definitions to
  // render itself — attached here rather than a separate public route.
  // Fixed fields (e.g. the marketing-consent checkbox) always sort last.
  const fieldsResult = await pool.query(
    `SELECT id, type, label, required, options, fixed_key FROM campaign_fields WHERE campaign_id = $1 ORDER BY ${FIELDS_DISPLAY_ORDER}`,
    [campaign.id]
  );
  campaign.fields = fieldsResult.rows;
  // Same idea for a gift-choice campaign's gift list (all three gift
  // modes need one — 'product_then_gift' ships every gift, product_id
  // included, and filters client-side by chosen product), and a
  // product-picking campaign's separate product list.
  if (campaign.gift_mode === 'simple_choice' || campaign.gift_mode === 'product_and_gift' || campaign.gift_mode === 'product_then_gift') {
    const giftsResult = await pool.query(
      `SELECT ${CAMPAIGN_GIFT_COLUMNS} FROM campaign_gifts WHERE campaign_id = $1 ORDER BY position, id`,
      [campaign.id]
    );
    campaign.gifts = giftsResult.rows;
  }
  if (campaign.gift_mode === 'product_and_gift' || campaign.gift_mode === 'product_then_gift') {
    const productsResult = await pool.query(
      `SELECT ${CAMPAIGN_PRODUCT_COLUMNS} FROM campaign_products WHERE campaign_id = $1 ORDER BY position, id`,
      [campaign.id]
    );
    campaign.products = productsResult.rows;
  }
  return { status: 200, body: campaign };
}

async function recordCampaignFormStart(pool, id) {
  const result = await pool.query(
    'UPDATE campaigns SET form_starts_count = form_starts_count + 1 WHERE id = $1 RETURNING id',
    [id]
  );
  if (result.rowCount === 0) throw httpError(404, 'הקמפיין לא נמצא');
  return { status: 204, body: null };
}

// "Deleting" a campaign never removes it (or its registrations/banner)
// — it archives it in place. Real removal isn't exposed over the API.
async function deleteCampaign(pool, id) {
  const result = await pool.query(
    `UPDATE campaigns c SET status = 'archived' WHERE c.id = $1 RETURNING ${CAMPAIGN_COLUMNS}`,
    [id]
  );
  if (result.rowCount === 0) throw httpError(404, 'הקמפיין לא נמצא');
  return { status: 200, body: result.rows[0] };
}

// ----- Inline file blobs -----

function parseFileDataUri(dataUri, allowedMimeTypes, maxBytes) {
  const match = /^data:([\w./+-]+);base64,(.+)$/s.exec(dataUri || '');
  if (!match) throw httpError(400, 'הקובץ שהתקבל אינו בפורמט תקין');
  const [, mime, base64] = match;
  if (!allowedMimeTypes.includes(mime)) {
    throw httpError(400, `סוג הקובץ אינו נתמך (${mime}). סוגים מותרים: ${allowedMimeTypes.join(', ')}`);
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw httpError(400, 'הקובץ ריק');
  if (buffer.length > maxBytes) {
    throw httpError(413, `הקובץ גדול מדי (מקסימום ${maxBytes / (1024 * 1024)}MB)`);
  }
  return { mime, buffer };
}

// ----- Campaign banner (marketing image) -----

async function setCampaignBanner(pool, id, body, brandScope, actor) {
  await assertCampaignAccess(pool, id, brandScope);
  const { mime, buffer } = parseFileDataUri(body && body.image, ALLOWED_BANNER_MIME_TYPES, MAX_BANNER_BYTES);
  const result = await pool.query(
    'UPDATE campaigns SET banner = $1, banner_mime = $2 WHERE id = $3 RETURNING id',
    [buffer, mime, id]
  );
  if (result.rowCount === 0) throw httpError(404, 'הקמפיין לא נמצא');
  await logCampaignActivity(pool, id, actor, 'עודכן הבאנר השיווקי');
  return { status: 200, body: { ok: true } };
}

async function getCampaignBanner(pool, id) {
  const result = await pool.query('SELECT banner, banner_mime FROM campaigns WHERE id = $1', [id]);
  if (result.rowCount === 0 || !result.rows[0].banner) throw httpError(404, 'לא נמצא באנר');
  return { mime: result.rows[0].banner_mime, buffer: result.rows[0].banner };
}

async function deleteCampaignBanner(pool, id, brandScope, actor) {
  await assertCampaignAccess(pool, id, brandScope);
  const result = await pool.query(
    'UPDATE campaigns SET banner = NULL, banner_mime = NULL WHERE id = $1 RETURNING id',
    [id]
  );
  if (result.rowCount === 0) throw httpError(404, 'הקמפיין לא נמצא');
  await logCampaignActivity(pool, id, actor, 'הוסר הבאנר השיווקי');
  return { status: 204, body: null };
}

// Atomically claims one unit of a gift's stock when a registrant picks
// it — a NULL stock (the default, "unlimited") is left untouched, no
// claim needed. The UPDATE's own WHERE clause is what makes this safe
// under concurrent registrations: two simultaneous requests can't both
// succeed once stock is actually down to the last unit, since only one
// UPDATE can still match "stock > 0" at that point. Not wrapped in a
// DB transaction together with the registration INSERT that follows —
// this codebase doesn't use transactions elsewhere either, and the
// window between claiming here and that INSERT is small enough that
// the tradeoff (a claimed unit surviving an INSERT that then fails for
// an unrelated reason) is acceptable.
async function claimGiftStock(pool, giftId) {
  const result = await pool.query(
    `UPDATE campaign_gifts SET stock = stock - 1
     WHERE id = $1 AND stock IS NOT NULL AND stock > 0
     RETURNING stock`,
    [giftId]
  );
  if (result.rowCount > 0) return;
  // The UPDATE matching zero rows is only an error if stock is
  // tracked *and* already at zero — unlimited (NULL) stock has
  // nothing to claim and isn't a failure.
  const check = await pool.query('SELECT stock FROM campaign_gifts WHERE id = $1', [giftId]);
  if (check.rowCount > 0 && check.rows[0].stock === 0) {
    throw httpError(400, 'המתנה שנבחרה אזלה מהמלאי');
  }
}

// ----- Registrations (public sign-up on the campaign page) -----

// The fixed name/email/invoice fields are no longer forced onto every
// campaign's public form — it's driven entirely by that campaign's own
// campaign_fields now (see lib/campaign-page.js) — so all four are
// optional here. They're still accepted for whatever campaigns (or
// API callers) actually send them.
async function createRegistration(pool, campaignId, body) {
  const firstName = ((body && body.first_name) || '').trim() || null;
  const lastName = ((body && body.last_name) || '').trim() || null;
  const email = ((body && body.email) || '').trim() || null;
  const marketingConsent = !!(body && body.marketing_consent);

  if (email && !EMAIL_PATTERN.test(email)) throw httpError(400, 'כתובת הדואר האלקטרוני אינה תקינה');

  let mime = null, buffer = null, filename = null;
  if (body && body.invoice) {
    ({ mime, buffer } = parseFileDataUri(body.invoice, ALLOWED_INVOICE_MIME_TYPES, MAX_INVOICE_BYTES));
    filename = body.invoice_filename ? String(body.invoice_filename).slice(0, 200) : null;
  }
  const { normalized: customFields, files: customFieldFiles, fields } = await validateCustomFields(pool, campaignId, body && body.custom_fields);

  // Gift-choice campaigns require picking one of the campaign's own
  // gifts ('simple_choice', 'product_and_gift' and 'product_then_gift'
  // all need one); 'product_and_gift'/'product_then_gift' additionally
  // require picking one of the campaign's own products.
  // 'product_then_gift' further requires that the chosen gift actually
  // belongs to the chosen product (campaign_gifts.product_id) — unlike
  // 'product_and_gift', where the two picks are unrelated. name/sku
  // for each is snapshotted onto the registration right here (not
  // looked up live later) so editing/deleting a gift/product
  // afterwards never rewrites what this registrant was actually
  // promised.
  const campaignResult = await pool.query('SELECT gift_mode FROM campaigns WHERE id = $1', [campaignId]);
  const giftMode = campaignResult.rows[0] && campaignResult.rows[0].gift_mode;
  let selectedGiftId = null, selectedGiftName = null, selectedGiftSku = null;
  let selectedProductId = null, selectedProductName = null, selectedProductSku = null;

  if (giftMode === 'product_then_gift') {
    const productId = body && body.product_id;
    if (!productId) throw httpError(400, 'יש לבחור מוצר');
    const productResult = await pool.query(
      'SELECT id, name, sku FROM campaign_products WHERE id = $1 AND campaign_id = $2',
      [productId, campaignId]
    );
    if (productResult.rowCount === 0) throw httpError(400, 'המוצר שנבחר אינו תקין');
    selectedProductId = productResult.rows[0].id;
    selectedProductName = productResult.rows[0].name;
    selectedProductSku = productResult.rows[0].sku;

    const giftId = body && body.gift_id;
    if (!giftId) throw httpError(400, 'יש לבחור מתנה');
    const giftResult = await pool.query(
      'SELECT id, name, sku, product_id FROM campaign_gifts WHERE id = $1 AND campaign_id = $2',
      [giftId, campaignId]
    );
    if (giftResult.rowCount === 0) throw httpError(400, 'המתנה שנבחרה אינה תקינה');
    if (giftResult.rows[0].product_id !== selectedProductId) {
      throw httpError(400, 'המתנה שנבחרה אינה שייכת למוצר שנבחר');
    }
    selectedGiftId = giftResult.rows[0].id;
    selectedGiftName = giftResult.rows[0].name;
    selectedGiftSku = giftResult.rows[0].sku;
    await claimGiftStock(pool, selectedGiftId);
  } else {
    if (giftMode === 'simple_choice' || giftMode === 'product_and_gift') {
      const giftId = body && body.gift_id;
      if (!giftId) throw httpError(400, 'יש לבחור מתנה');
      const giftResult = await pool.query(
        'SELECT id, name, sku FROM campaign_gifts WHERE id = $1 AND campaign_id = $2',
        [giftId, campaignId]
      );
      if (giftResult.rowCount === 0) throw httpError(400, 'המתנה שנבחרה אינה תקינה');
      selectedGiftId = giftResult.rows[0].id;
      selectedGiftName = giftResult.rows[0].name;
      selectedGiftSku = giftResult.rows[0].sku;
      await claimGiftStock(pool, selectedGiftId);
    }
    if (giftMode === 'product_and_gift') {
      const productId = body && body.product_id;
      if (!productId) throw httpError(400, 'יש לבחור מוצר');
      const productResult = await pool.query(
        'SELECT id, name, sku FROM campaign_products WHERE id = $1 AND campaign_id = $2',
        [productId, campaignId]
      );
      if (productResult.rowCount === 0) throw httpError(400, 'המוצר שנבחר אינו תקין');
      selectedProductId = productResult.rows[0].id;
      selectedProductName = productResult.rows[0].name;
      selectedProductSku = productResult.rows[0].sku;
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO registrations (
         campaign_id, first_name, last_name, email, marketing_consent, invoice, invoice_mime, invoice_filename,
         custom_fields, selected_gift_id, selected_gift_name, selected_gift_sku,
         selected_product_id, selected_product_name, selected_product_sku
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING ${REGISTRATION_COLUMNS}`,
      [
        campaignId, firstName, lastName, email || null, marketingConsent, buffer, mime, filename,
        JSON.stringify(customFields), selectedGiftId, selectedGiftName, selectedGiftSku,
        selectedProductId, selectedProductName, selectedProductSku,
      ]
    );
    const registration = result.rows[0];
    for (const f of customFieldFiles) {
      await pool.query(
        `INSERT INTO registration_field_files (registration_id, field_id, file, file_mime, file_filename)
         VALUES ($1, $2, $3, $4, $5)`,
        [registration.id, f.fieldId, f.buffer, f.mime, f.filename]
      );
    }
    // Fire-and-forget — deliberately not awaited, so a slow/unreachable
    // ActiveTrail never delays the visitor's registration response.
    // (No-ops on its own if this campaign hasn't configured sync.)
    maybeSyncRegistrationToActiveTrail(pool, campaignId, fields, customFields);
    return { status: 201, body: registration };
  } catch (error) {
    if (error.code === '23503') throw httpError(404, 'הקמפיין לא נמצא');
    throw error;
  }
}

// `query.page` being absent is the signal to return every matching row
// unpaginated, as a plain array — the shape this always returned
// before pagination/search existed. Both the Excel export and the
// campaign dashboard call this same endpoint needing the *complete*
// set regardless of whatever page/filter is currently on screen, and
// neither sends a `page` param, so they're unaffected by any of this.
// Only the registrants table itself (edit.html) sends `page`, and
// gets back the paginated { rows, total, page, pageSize, totalPages }
// shape instead — same convention as listCampaigns.
//
// The free-text search (`query.q`) matches across every dynamic
// field's value at once by searching the custom_fields JSON as text,
// plus the selected gift/product name/sku — deliberately not aware of
// any specific field's type, since the field set differs per
// campaign. Cheap sequential-scan ILIKE, not indexed full-text search
// — appropriate for a self-service admin tool's per-campaign
// registrant counts, not built to scale to huge tables.
// Fixed sortable columns; a dynamic field is sorted via
// resolveRegistrationSortColumn below instead, since which fields
// exist is entirely per-campaign.
const REGISTRATION_SORT_COLUMNS = {
  created_at: 'created_at',
  selected_gift_name: 'selected_gift_name',
  selected_product_name: 'selected_product_name',
};

// 'sort' is either one of REGISTRATION_SORT_COLUMNS' own keys, or
// 'field:<id>' for one of the campaign's own dynamic fields — <id>
// must parse as a plain positive integer (a campaign_fields row id),
// so it's always bound as a query parameter rather than ever
// interpolated into the SQL string directly (same never-trust-the-
// caller's-sort-value rule as CAMPAIGN_SORT_COLUMNS above).
function resolveRegistrationSortColumn(sortKey) {
  if (sortKey && sortKey.startsWith('field:')) {
    const fieldId = parseInt(sortKey.slice('field:'.length), 10);
    if (Number.isInteger(fieldId) && fieldId > 0) return { dynamicFieldId: String(fieldId) };
  }
  return { column: REGISTRATION_SORT_COLUMNS[sortKey] || 'created_at' };
}

async function listRegistrations(pool, campaignId, brandScope, query) {
  await assertCampaignAccess(pool, campaignId, brandScope);

  const q = (query && query.q || '').trim();
  const searchPattern = q ? `%${q}%` : null;
  const whereClause = `
    WHERE campaign_id = $1 AND ($2::text IS NULL OR (
      custom_fields::text ILIKE $2
      OR COALESCE(selected_gift_name, '') ILIKE $2
      OR COALESCE(selected_gift_sku, '') ILIKE $2
      OR COALESCE(selected_product_name, '') ILIKE $2
      OR COALESCE(selected_product_sku, '') ILIKE $2
    ))
  `;
  const baseParams = [campaignId, searchPattern];

  if (!query || !query.page) {
    const result = await pool.query(
      `SELECT ${REGISTRATION_COLUMNS} FROM registrations ${whereClause} ORDER BY created_at DESC`,
      baseParams
    );
    return { status: 200, body: result.rows };
  }

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const order = query.order === 'asc' ? 'ASC' : 'DESC';
  const sortResolved = resolveRegistrationSortColumn(query.sort);

  let orderByExpr, listParams;
  if (sortResolved.dynamicFieldId) {
    orderByExpr = 'custom_fields ->> $3';
    listParams = [...baseParams, sortResolved.dynamicFieldId, pageSize, (page - 1) * pageSize];
  } else {
    orderByExpr = sortResolved.column;
    listParams = [...baseParams, pageSize, (page - 1) * pageSize];
  }
  const limitIdx = listParams.length - 1;
  const offsetIdx = listParams.length;

  const [rowsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT ${REGISTRATION_COLUMNS} FROM registrations ${whereClause}
       ORDER BY ${orderByExpr} ${order} NULLS LAST, created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams
    ),
    pool.query(`SELECT COUNT(*) AS total FROM registrations ${whereClause}`, baseParams),
  ]);
  const total = parseInt(countResult.rows[0].total, 10);
  return { status: 200, body: { rows: rowsResult.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

async function getRegistrationInvoice(pool, registrationId, brandScope) {
  const result = await pool.query(
    `SELECT r.invoice, r.invoice_mime, r.invoice_filename, c.brand_id
     FROM registrations r JOIN campaigns c ON c.id = r.campaign_id WHERE r.id = $1`,
    [registrationId]
  );
  if (result.rowCount === 0) throw httpError(404, 'ההרשמה לא נמצאה');
  if (brandScope && !brandScope.includes(result.rows[0].brand_id)) {
    throw httpError(403, 'אין לך הרשאת גישה למותג זה');
  }
  // The fixed invoice upload is now optional — nothing to serve if
  // this registrant's campaign didn't collect one.
  if (!result.rows[0].invoice) throw httpError(404, 'לא הועלתה חשבונית עבור הרשמה זו');
  return {
    mime: result.rows[0].invoice_mime,
    buffer: result.rows[0].invoice,
    filename: result.rows[0].invoice_filename,
  };
}

// A dynamic 'file' field's uploaded bytes, same access rules as the
// fixed invoice (auth'd, scoped to the registrant's campaign's brand).
async function getRegistrationFieldFile(pool, registrationId, fieldId, brandScope) {
  const result = await pool.query(
    `SELECT rf.file, rf.file_mime, rf.file_filename, c.brand_id
     FROM registration_field_files rf
     JOIN registrations r ON r.id = rf.registration_id
     JOIN campaigns c ON c.id = r.campaign_id
     WHERE rf.registration_id = $1 AND rf.field_id = $2`,
    [registrationId, fieldId]
  );
  if (result.rowCount === 0) throw httpError(404, 'הקובץ לא נמצא');
  if (brandScope && !brandScope.includes(result.rows[0].brand_id)) {
    throw httpError(403, 'אין לך הרשאת גישה למותג זה');
  }
  return {
    mime: result.rows[0].file_mime,
    buffer: result.rows[0].file,
    filename: result.rows[0].file_filename,
  };
}

module.exports = {
  httpError,
  getStatus,
  listBrands,
  createBrand,
  updateBrand,
  deleteBrand,
  setBrandLogo,
  getBrandLogo,
  deleteBrandLogo,
  listCampaigns,
  getCampaign,
  getCampaignBySlug,
  recordCampaignFormStart,
  createCampaign,
  duplicateCampaign,
  updateCampaign,
  deleteCampaign,
  listCampaignActivityLog,
  setCampaignBanner,
  getCampaignBanner,
  deleteCampaignBanner,
  listCampaignFields,
  createCampaignField,
  updateCampaignField,
  deleteCampaignField,
  moveCampaignField,
  reorderCampaignFields,
  listCampaignGifts,
  createCampaignGift,
  updateCampaignGift,
  deleteCampaignGift,
  duplicateCampaignGift,
  moveCampaignGift,
  setCampaignGiftImage,
  getCampaignGiftImage,
  deleteCampaignGiftImage,
  listCampaignProducts,
  createCampaignProduct,
  updateCampaignProduct,
  deleteCampaignProduct,
  duplicateCampaignProduct,
  moveCampaignProduct,
  setCampaignProductImage,
  getCampaignProductImage,
  deleteCampaignProductImage,
  createRegistration,
  listRegistrations,
  getRegistrationInvoice,
  getRegistrationFieldFile,
  MAX_BANNER_BYTES,
  ALLOWED_BANNER_MIME_TYPES,
  MAX_INVOICE_BYTES,
  ALLOWED_INVOICE_MIME_TYPES,
  CAMPAIGN_TEMPLATES,
  CAMPAIGN_FIELD_TYPES,
  CAMPAIGN_GIFT_MODES,
  MAX_CAMPAIGN_FIELD_FILE_BYTES,
  ALLOWED_CAMPAIGN_FIELD_FILE_MIME_TYPES,
};
