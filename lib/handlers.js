// Shared business logic for brands & campaigns, decoupled from any
// particular HTTP framework. Used by both the local dev server
// (server.js, raw Node http) and the Vercel serverless functions
// (api/**), so the two never drift apart.

const { buildSlug } = require('./slug');

const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'completed', 'cancelled'];
const UPDATABLE_CAMPAIGN_FIELDS = ['brand_id', 'name', 'description', 'budget', 'start_date', 'end_date', 'status'];
const ALLOWED_BANNER_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_BANNER_BYTES = 2 * 1024 * 1024; // 2MB

// Explicit column list for every campaign SELECT/RETURNING: `banner`
// is a (potentially large) BYTEA blob that must never ride along on
// ordinary list/get/update responses — callers get `has_banner`
// instead and fetch the actual image via its own dedicated route.
const CAMPAIGN_COLUMNS = `
  c.id, c.brand_id, c.name, c.description, c.budget, c.start_date, c.end_date,
  c.status, c.slug, c.created_at, c.updated_at, (c.banner IS NOT NULL) AS has_banner
`;

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
  const params = [];
  let sql = `
    SELECT ${CAMPAIGN_COLUMNS}, b.name AS brand_name
    FROM campaigns c
    JOIN brands b ON b.id = c.brand_id
  `;
  if (query && query.brand_id) {
    params.push(query.brand_id);
    sql += ` WHERE c.brand_id = $${params.length}`;
  }
  sql += ' ORDER BY c.created_at DESC';

  const result = await pool.query(sql, params);
  return { status: 200, body: result.rows };
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

// ----- Campaign banner (marketing image) -----

function parseImageDataUri(dataUri) {
  const match = /^data:([\w./+-]+);base64,(.+)$/s.exec(dataUri || '');
  if (!match) throw httpError(400, 'image must be a base64 data URI');
  const [, mime, base64] = match;
  if (!ALLOWED_BANNER_MIME_TYPES.includes(mime)) {
    throw httpError(400, `unsupported image type: ${mime} (allowed: ${ALLOWED_BANNER_MIME_TYPES.join(', ')})`);
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw httpError(400, 'empty image');
  if (buffer.length > MAX_BANNER_BYTES) {
    throw httpError(413, `image too large (max ${MAX_BANNER_BYTES / (1024 * 1024)}MB)`);
  }
  return { mime, buffer };
}

async function setCampaignBanner(pool, id, body) {
  const { mime, buffer } = parseImageDataUri(body && body.image);
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
  MAX_BANNER_BYTES,
  ALLOWED_BANNER_MIME_TYPES,
};
