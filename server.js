// Local dev server. Vercel production deployments use the serverless
// functions under api/** instead — both share lib/handlers.js so the
// business logic never drifts between the two.
const http = require('http');
const fs = require('fs');
const path = require('path');
const pool = require('./lib/db');
const handlers = require('./lib/handlers');
const { renderCampaignPage, renderNotFoundPage } = require('./lib/campaign-page');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required.');
  process.exit(1);
}

const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'));

function sendJson(res, status, body) {
  if (body === null) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 6e6) { // banner images arrive as base64 JSON, ~4-5MB
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(handlers.httpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const routes = [
  { method: 'GET', pattern: /^\/api\/status$/, handler: () => handlers.getStatus(pool) },
  { method: 'GET', pattern: /^\/api\/brands$/, handler: () => handlers.listBrands(pool) },
  { method: 'POST', pattern: /^\/api\/brands$/, handler: async (req) => handlers.createBrand(pool, await readJsonBody(req)) },
  { method: 'DELETE', pattern: /^\/api\/brands\/(\d+)$/, handler: (_req, [id]) => handlers.deleteBrand(pool, id) },
  { method: 'GET', pattern: /^\/api\/campaigns$/, handler: (_req, _m, query) => handlers.listCampaigns(pool, query) },
  { method: 'POST', pattern: /^\/api\/campaigns$/, handler: async (req) => handlers.createCampaign(pool, await readJsonBody(req)) },
  { method: 'GET', pattern: /^\/api\/campaigns\/(\d+)$/, handler: (_req, [id]) => handlers.getCampaign(pool, id) },
  { method: 'PUT', pattern: /^\/api\/campaigns\/(\d+)$/, handler: async (req, [id]) => handlers.updateCampaign(pool, id, await readJsonBody(req)) },
  { method: 'DELETE', pattern: /^\/api\/campaigns\/(\d+)$/, handler: (_req, [id]) => handlers.deleteCampaign(pool, id) },
  { method: 'PUT', pattern: /^\/api\/campaigns\/(\d+)\/banner$/, handler: async (req, [id]) => handlers.setCampaignBanner(pool, id, await readJsonBody(req)) },
  { method: 'DELETE', pattern: /^\/api\/campaigns\/(\d+)\/banner$/, handler: (_req, [id]) => handlers.deleteCampaignBanner(pool, id) },
];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexHtml);
      return;
    }

    const slugMatch = req.method === 'GET' && url.pathname.match(/^\/c\/([^/]+)$/);
    if (slugMatch) {
      try {
        const { body: campaign } = await handlers.getCampaignBySlug(pool, decodeURIComponent(slugMatch[1]));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderCampaignPage(campaign));
      } catch (error) {
        res.writeHead(error.statusCode || 500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderNotFoundPage());
      }
      return;
    }

    const bannerMatch = req.method === 'GET' && url.pathname.match(/^\/api\/campaigns\/(\d+)\/banner$/);
    if (bannerMatch) {
      try {
        const { mime, buffer } = await handlers.getCampaignBanner(pool, bannerMatch[1]);
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' });
        res.end(buffer);
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message });
      }
      return;
    }

    for (const route of routes) {
      if (route.method !== req.method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;
      const result = await route.handler(req, match.slice(1), Object.fromEntries(url.searchParams));
      sendJson(res, result.status, result.body);
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
