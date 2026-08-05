// Shared business logic for brands & campaigns, decoupled from any
// particular HTTP framework. Used by both the local dev server
// (server.js, raw Node http) and the Vercel serverless functions
// (api/**), so the two never drift apart.

const { buildSlug } = require('./slug');

const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'completed', 'cancelled'];
const UPDATABLE_CAMPAIGN_FIELDS = ['brand_id', 'name', 'description', 'budget', 'start_date', 'end_date', 'status'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_BANNER_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_BANNER_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_INVOICE_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const MAX_INVOICE_BYTES = 3 * 1024 * 1024; // 3MB

// Explicit column list for every campaign SELECT/RETURNING: `banner`
// is a (potentially large) BYTEA blob that must never ride along on
// ordinary list/get/update responses — callers get `has_banner`
// instead and fetch the actual image via its own dedicated route.
const CAMPAIGN_COLUMNS = `
  c.id, c.brand_id, c.name, c.description, c.budget, c.start_date, c.end_date,
  c.status, c.slug, c.created_at, c.updated_at, (c.banner IS NOT NULL) AS has_banner
`;

// Same idea for registrations: `invoice` is excluded from list
// responses, fetched only via its own route.
const REGISTRATION_COLUMNS = `
  id, campaign_id, first_name, last_name, email, marketing_consent,
  invoice_filename, created_at
`;

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
};
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

async function getStatus(pool) {
  const result = await pool.query('SELECT NOW() AS current_time');
  return { status: 200, body: { status: 'connected', current_time: result.rows[0].current_time } };
}

// ----- Brands -----

async function listBrands(pool) {
  const result = await pool.query('SELECT * FROM brands ORDER BY name');
  return { status: 200, body: result.rows };
}

async function createBrand(pool, body) {
  const name = ((body && body.name) || '').trim();
  if (!name) throw httpError(400, 'name is required');

  try {
    const result = await pool.query('INSERT INTO brands (name) VALUES ($1) RETURNING *', [name]);
    return { status: 201, body: result.rows[0] };
  } catch (error) {
    if (error.code === '23505') throw httpError(409, 'brand name already exists');
    throw error;
  }
}

async function deleteBrand(pool, id) {
  const result = await pool.query('DELETE FROM brands WHERE id = $1 RETURNING id', [id]);
  if (result.rowCount === 0) throw httpError(404, 'brand not found');
  return { status: 204, body: null };
}

// ----- Campaigns -----

async function listCampaigns(pool, query) {
  const sortColumn = CAMPAIGN_SORT_COLUMNS[query && query.sort] || CAMPAIGN_SORT_COLUMNS.created_at;
  const order = query && query.order === 'asc' ? 'ASC' : 'DESC';
  const page = Math.max(1, parseInt(query && query.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query && query.pageSize, 10) || DEFAULT_PAGE_SIZE));

  const whereParams = [];
  let whereClause = '';
  if (query && query.brand_id) {
    whereParams.push(query.brand_id);
    whereClause = ` WHERE c.brand_id = $${whereParams.length}`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total FROM campaigns c${whereClause}`,
    whereParams
  );
  const total = parseInt(countResult.rows[0].total, 10);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const listParams = [...whereParams, pageSize, (page - 1) * pageSize];
  const sql = `
    SELECT ${CAMPAIGN_COLUMNS}, b.name AS brand_name
    FROM campaigns c
    JOIN brands b ON b.id = c.brand_id
    ${whereClause}
    ORDER BY ${sortColumn} ${order} NULLS LAST, c.id ${order}
    LIMIT $${listParams.length - 1} OFFSET $${listParams.length}
  `;
  const result = await pool.query(sql, listParams);

  return { status: 200, body: { rows: result.rows, total, page, pageSize, totalPages } };
}

async function getCampaign(pool, id) {
  const result = await pool.query(
    `SELECT ${CAMPAIGN_COLUMNS}, b.name AS brand_name
     FROM campaigns c JOIN brands b ON b.id = c.brand_id WHERE c.id = $1`,
    [id]
  );
  if (result.rowCount === 0) throw httpError(404, 'campaign not found');
  return { status: 200, body: result.rows[0] };
}

async function createCampaign(pool, body) {
  const {
    brand_id,
    name,
    description = null,
    budget = null,
    start_date = null,
    end_date = null,
  } = body || {};
  const status = (body && body.status) || 'draft';

  if (!brand_id || !name) throw httpError(400, 'brand_id and name are required');
  if (!CAMPAIGN_STATUSES.includes(status)) {
    throw httpError(400, `status must be one of: ${CAMPAIGN_STATUSES.join(', ')}`);
  }

  try {
    const inserted = await pool.query(
      `INSERT INTO campaigns (brand_id, name, description, budget, start_date, end_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [brand_id, name, description, budget, start_date, end_date, status]
    );
    const campaign = inserted.rows[0];
    // Slug depends on the generated id (for guaranteed uniqueness) and
    // the brand name, so it's set in a follow-up update rather than
    // the insert itself.
    const brandResult = await pool.query('SELECT name FROM brands WHERE id = $1', [campaign.brand_id]);
    const slug = buildSlug(brandResult.rows[0]?.name, campaign.name, campaign.id);
    const result = await pool.query(
      `UPDATE campaigns c SET slug = $1 WHERE c.id = $2 RETURNING ${CAMPAIGN_COLUMNS}`,
      [slug, campaign.id]
    );
    return { status: 201, body: { ...result.rows[0], brand_name: brandResult.rows[0]?.name } };
  } catch (error) {
    if (error.code === '23503') throw httpError(400, 'brand_id does not exist');
    throw error;
  }
}

async function updateCampaign(pool, id, body) {
  const fields = Object.keys(body || {}).filter((key) => UPDATABLE_CAMPAIGN_FIELDS.includes(key));
  if (fields.length === 0) throw httpError(400, 'no updatable fields provided');
  if (body.status && !CAMPAIGN_STATUSES.includes(body.status)) {
    throw httpError(400, `status must be one of: ${CAMPAIGN_STATUSES.join(', ')}`);
  }

  const setClause = fields.map((field, i) => `${field} = $${i + 1}`).join(', ');
  const values = fields.map((field) => body[field]);
  values.push(id);

  try {
    const result = await pool.query(
      `UPDATE campaigns c SET ${setClause} WHERE c.id = $${values.length} RETURNING ${CAMPAIGN_COLUMNS}`,
      values
    );
    if (result.rowCount === 0) throw httpError(404, 'campaign not found');
    return { status: 200, body: result.rows[0] };
  } catch (error) {
    if (error.code === '23503') throw httpError(400, 'brand_id does not exist');
    throw error;
  }
}

async function getCampaignBySlug(pool, slug) {
  const result = await pool.query(
    `SELECT ${CAMPAIGN_COLUMNS}, b.name AS brand_name
     FROM campaigns c JOIN brands b ON b.id = c.brand_id WHERE c.slug = $1`,
    [slug]
  );
  if (result.rowCount === 0) throw httpError(404, 'campaign not found');
  return { status: 200, body: result.rows[0] };
}

async function deleteCampaign(pool, id) {
  const result = await pool.query('DELETE FROM campaigns WHERE id = $1 RETURNING id', [id]);
  if (result.rowCount === 0) throw httpError(404, 'campaign not found');
  return { status: 204, body: null };
}

// ----- Inline file blobs -----

function parseFileDataUri(dataUri, allowedMimeTypes, maxBytes) {
  const match = /^data:([\w./+-]+);base64,(.+)$/s.exec(dataUri || '');
  if (!match) throw httpError(400, 'file must be a base64 data URI');
  const [, mime, base64] = match;
  if (!allowedMimeTypes.includes(mime)) {
    throw httpError(400, `unsupported file type: ${mime} (allowed: ${allowedMimeTypes.join(', ')})`);
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw httpError(400, 'empty file');
  if (buffer.length > maxBytes) {
    throw httpError(413, `file too large (max ${maxBytes / (1024 * 1024)}MB)`);
  }
  return { mime, buffer };
}

// ----- Campaign banner (marketing image) -----

async function setCampaignBanner(pool, id, body) {
  const { mime, buffer } = parseFileDataUri(body && body.image, ALLOWED_BANNER_MIME_TYPES, MAX_BANNER_BYTES);
  const result = await pool.query(
    'UPDATE campaigns SET banner = $1, banner_mime = $2 WHERE id = $3 RETURNING id',
    [buffer, mime, id]
  );
  if (result.rowCount === 0) throw httpError(404, 'campaign not found');
  return { status: 200, body: { ok: true } };
}

async function getCampaignBanner(pool, id) {
  const result = await pool.query('SELECT banner, banner_mime FROM campaigns WHERE id = $1', [id]);
  if (result.rowCount === 0 || !result.rows[0].banner) throw httpError(404, 'banner not found');
  return { mime: result.rows[0].banner_mime, buffer: result.rows[0].banner };
}

async function deleteCampaignBanner(pool, id) {
  const result = await pool.query(
    'UPDATE campaigns SET banner = NULL, banner_mime = NULL WHERE id = $1 RETURNING id',
    [id]
  );
  if (result.rowCount === 0) throw httpError(404, 'campaign not found');
  return { status: 204, body: null };
}

// ----- Registrations (public sign-up on the campaign page) -----

async function createRegistration(pool, campaignId, body) {
  const firstName = ((body && body.first_name) || '').trim();
  const lastName = ((body && body.last_name) || '').trim();
  const email = ((body && body.email) || '').trim();
  const marketingConsent = !!(body && body.marketing_consent);

  if (!firstName || !lastName) throw httpError(400, 'first_name and last_name are required');
  if (email && !EMAIL_PATTERN.test(email)) throw httpError(400, 'email is not a valid email address');

  const { mime, buffer } = parseFileDataUri(body && body.invoice, ALLOWED_INVOICE_MIME_TYPES, MAX_INVOICE_BYTES);
  const filename = (body && body.invoice_filename) ? String(body.invoice_filename).slice(0, 200) : null;

  try {
    const result = await pool.query(
      `INSERT INTO registrations (campaign_id, first_name, last_name, email, marketing_consent, invoice, invoice_mime, invoice_filename)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${REGISTRATION_COLUMNS}`,
      [campaignId, firstName, lastName, email || null, marketingConsent, buffer, mime, filename]
    );
    return { status: 201, body: result.rows[0] };
  } catch (error) {
    if (error.code === '23503') throw httpError(404, 'campaign not found');
    throw error;
  }
}

async function listRegistrations(pool, campaignId) {
  const result = await pool.query(
    `SELECT ${REGISTRATION_COLUMNS} FROM registrations WHERE campaign_id = $1 ORDER BY created_at DESC`,
    [campaignId]
  );
  return { status: 200, body: result.rows };
}

async function getRegistrationInvoice(pool, registrationId) {
  const result = await pool.query(
    'SELECT invoice, invoice_mime, invoice_filename FROM registrations WHERE id = $1',
    [registrationId]
  );
  if (result.rowCount === 0) throw httpError(404, 'registration not found');
  return {
    mime: result.rows[0].invoice_mime,
    buffer: result.rows[0].invoice,
    filename: result.rows[0].invoice_filename,
  };
}

module.exports = {
  httpError,
  getStatus,
  listBrands,
  createBrand,
  deleteBrand,
  listCampaigns,
  getCampaign,
  getCampaignBySlug,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  setCampaignBanner,
  getCampaignBanner,
  deleteCampaignBanner,
  createRegistration,
  listRegistrations,
  getRegistrationInvoice,
  MAX_BANNER_BYTES,
  ALLOWED_BANNER_MIME_TYPES,
  MAX_INVOICE_BYTES,
  ALLOWED_INVOICE_MIME_TYPES,
};
