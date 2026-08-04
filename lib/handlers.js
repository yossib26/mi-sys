// Shared business logic for brands & campaigns, decoupled from any
// particular HTTP framework. Used by both the local dev server
// (server.js, raw Node http) and the Vercel serverless functions
// (api/**), so the two never drift apart.

const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'completed', 'cancelled'];
const UPDATABLE_CAMPAIGN_FIELDS = ['brand_id', 'name', 'description', 'budget', 'start_date', 'end_date', 'status'];

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
    SELECT c.*, b.name AS brand_name
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
    'SELECT c.*, b.name AS brand_name FROM campaigns c JOIN brands b ON b.id = c.brand_id WHERE c.id = $1',
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
    const result = await pool.query(
      `INSERT INTO campaigns (brand_id, name, description, budget, start_date, end_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [brand_id, name, description, budget, start_date, end_date, status]
    );
    return { status: 201, body: result.rows[0] };
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
      `UPDATE campaigns SET ${setClause} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rowCount === 0) throw httpError(404, 'campaign not found');
    return { status: 200, body: result.rows[0] };
  } catch (error) {
    if (error.code === '23503') throw httpError(400, 'brand_id does not exist');
    throw error;
  }
}

async function deleteCampaign(pool, id) {
  const result = await pool.query('DELETE FROM campaigns WHERE id = $1 RETURNING id', [id]);
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
  createCampaign,
  updateCampaign,
  deleteCampaign,
};
