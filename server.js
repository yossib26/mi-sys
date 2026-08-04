const http = require('http');
const fs = require('fs');
const path = require('path');
const pool = require('./lib/db');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required.');
  process.exit(1);
}

const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'));
const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'completed', 'cancelled'];
const UPDATABLE_CAMPAIGN_FIELDS = ['brand_id', 'name', 'description', 'budget', 'start_date', 'end_date', 'status'];

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// ----- Brands -----

async function listBrands(req, res) {
  const result = await pool.query('SELECT * FROM brands ORDER BY name');
  sendJson(res, 200, result.rows);
}

async function createBrand(req, res) {
  const body = await readJsonBody(req);
  const name = (body.name || '').trim();
  if (!name) return sendJson(res, 400, { error: 'name is required' });

  try {
    const result = await pool.query('INSERT INTO brands (name) VALUES ($1) RETURNING *', [name]);
    sendJson(res, 201, result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return sendJson(res, 409, { error: 'brand name already exists' });
    throw error;
  }
}

async function deleteBrand(req, res, id) {
  const result = await pool.query('DELETE FROM brands WHERE id = $1 RETURNING id', [id]);
  if (result.rowCount === 0) return sendJson(res, 404, { error: 'brand not found' });
  sendNoContent(res);
}

// ----- Campaigns -----

async function listCampaigns(req, res, query) {
  const params = [];
  let sql = `
    SELECT c.*, b.name AS brand_name
    FROM campaigns c
    JOIN brands b ON b.id = c.brand_id
  `;
  if (query.brand_id) {
    params.push(query.brand_id);
    sql += ` WHERE c.brand_id = $${params.length}`;
  }
  sql += ' ORDER BY c.created_at DESC';

  const result = await pool.query(sql, params);
  sendJson(res, 200, result.rows);
}

async function getCampaign(req, res, id) {
  const result = await pool.query(
    'SELECT c.*, b.name AS brand_name FROM campaigns c JOIN brands b ON b.id = c.brand_id WHERE c.id = $1',
    [id]
  );
  if (result.rowCount === 0) return sendJson(res, 404, { error: 'campaign not found' });
  sendJson(res, 200, result.rows[0]);
}

async function createCampaign(req, res) {
  const body = await readJsonBody(req);
  const {
    brand_id,
    name,
    description = null,
    budget = null,
    start_date = null,
    end_date = null,
  } = body;
  const status = body.status || 'draft';

  if (!brand_id || !name) return sendJson(res, 400, { error: 'brand_id and name are required' });
  if (!CAMPAIGN_STATUSES.includes(status)) {
    return sendJson(res, 400, { error: `status must be one of: ${CAMPAIGN_STATUSES.join(', ')}` });
  }

  try {
    const result = await pool.query(
      `INSERT INTO campaigns (brand_id, name, description, budget, start_date, end_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [brand_id, name, description, budget, start_date, end_date, status]
    );
    sendJson(res, 201, result.rows[0]);
  } catch (error) {
    if (error.code === '23503') return sendJson(res, 400, { error: 'brand_id does not exist' });
    throw error;
  }
}

async function updateCampaign(req, res, id) {
  const body = await readJsonBody(req);
  const fields = Object.keys(body).filter((key) => UPDATABLE_CAMPAIGN_FIELDS.includes(key));

  if (fields.length === 0) return sendJson(res, 400, { error: 'no updatable fields provided' });
  if (body.status && !CAMPAIGN_STATUSES.includes(body.status)) {
    return sendJson(res, 400, { error: `status must be one of: ${CAMPAIGN_STATUSES.join(', ')}` });
  }

  const setClause = fields.map((field, i) => `${field} = $${i + 1}`).join(', ');
  const values = fields.map((field) => body[field]);
  values.push(id);

  try {
    const result = await pool.query(
      `UPDATE campaigns SET ${setClause} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rowCount === 0) return sendJson(res, 404, { error: 'campaign not found' });
    sendJson(res, 200, result.rows[0]);
  } catch (error) {
    if (error.code === '23503') return sendJson(res, 400, { error: 'brand_id does not exist' });
    throw error;
  }
}

async function deleteCampaign(req, res, id) {
  const result = await pool.query('DELETE FROM campaigns WHERE id = $1 RETURNING id', [id]);
  if (result.rowCount === 0) return sendJson(res, 404, { error: 'campaign not found' });
  sendNoContent(res);
}

async function getStatus(req, res) {
  const result = await pool.query('SELECT NOW() AS current_time');
  sendJson(res, 200, { status: 'connected', current_time: result.rows[0].current_time });
}

// ----- Router -----

const routes = [
  { method: 'GET', pattern: /^\/api\/status$/, handler: (req, res) => getStatus(req, res) },
  { method: 'GET', pattern: /^\/api\/brands$/, handler: (req, res) => listBrands(req, res) },
  { method: 'POST', pattern: /^\/api\/brands$/, handler: (req, res) => createBrand(req, res) },
  { method: 'DELETE', pattern: /^\/api\/brands\/(\d+)$/, handler: (req, res, [id]) => deleteBrand(req, res, id) },
  { method: 'GET', pattern: /^\/api\/campaigns$/, handler: (req, res, _m, query) => listCampaigns(req, res, query) },
  { method: 'POST', pattern: /^\/api\/campaigns$/, handler: (req, res) => createCampaign(req, res) },
  { method: 'GET', pattern: /^\/api\/campaigns\/(\d+)$/, handler: (req, res, [id]) => getCampaign(req, res, id) },
  { method: 'PUT', pattern: /^\/api\/campaigns\/(\d+)$/, handler: (req, res, [id]) => updateCampaign(req, res, id) },
  { method: 'DELETE', pattern: /^\/api\/campaigns\/(\d+)$/, handler: (req, res, [id]) => deleteCampaign(req, res, id) },
];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexHtml);
      return;
    }

    for (const route of routes) {
      if (route.method !== req.method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;
      await route.handler(req, res, match.slice(1), Object.fromEntries(url.searchParams));
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status === 500) console.error(error);
    sendJson(res, status, { error: error.message });
  }
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
