// Local dev server. Vercel production deployments use the serverless
// functions under api/** instead — both share lib/handlers.js so the
// business logic never drifts between the two.
const http = require('http');
const fs = require('fs');
const path = require('path');
const pool = require('./lib/db');
const handlers = require('./lib/handlers');
const users = require('./lib/users');
const auth = require('./lib/auth');
const { renderCampaignPage, renderNotFoundPage, TEMPLATES } = require('./lib/campaign-page');

const templateList = Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label, swatch: t.swatch }));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required.');
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET environment variable is required.');
  process.exit(1);
}

const staticPages = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/edit.html': 'edit.html',
  '/login.html': 'login.html',
  '/users.html': 'users.html',
};
const htmlCache = Object.fromEntries(
  [...new Set(Object.values(staticPages))].map((file) => [file, fs.readFileSync(path.join(__dirname, file))])
);

function sendJson(res, status, body, extraHeaders) {
  if (body === null) {
    res.writeHead(status, extraHeaders);
    res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
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

// route.auth: undefined = public, 'user' = any logged-in user, 'admin' = admin only.
const routes = [
  { method: 'GET', pattern: /^\/api\/status$/, handler: () => handlers.getStatus(pool) },
  { method: 'GET', pattern: /^\/api\/templates$/, handler: () => ({ status: 200, body: templateList }) },

  { method: 'POST', pattern: /^\/api\/auth\/login$/, handler: async (req) => {
    const user = await users.login(pool, await readJsonBody(req));
    return { status: 200, body: user, headers: { 'Set-Cookie': auth.buildSessionCookie(user) } };
  } },
  { method: 'POST', pattern: /^\/api\/auth\/logout$/, handler: () => ({ status: 204, body: null, headers: { 'Set-Cookie': auth.buildLogoutCookie() } }) },
  { method: 'GET', pattern: /^\/api\/auth\/me$/, handler: (req) => ({ status: 200, body: auth.requireAuth(req) }) },

  { method: 'GET', pattern: /^\/api\/users$/, auth: 'admin', handler: () => users.listUsers(pool) },
  { method: 'POST', pattern: /^\/api\/users$/, auth: 'admin', handler: async (req) => users.createUser(pool, await readJsonBody(req)) },
  { method: 'DELETE', pattern: /^\/api\/users\/(\d+)$/, handler: async (req, [id]) => users.deleteUser(pool, id, auth.requireAdmin(req).id) },

  // Brands: any logged-in user can read them (needed to pick one when
  // creating/editing a campaign), but managing the brand list itself
  // (add/delete) is admin-only.
  { method: 'GET', pattern: /^\/api\/brands$/, auth: 'user', handler: () => handlers.listBrands(pool) },
  { method: 'POST', pattern: /^\/api\/brands$/, auth: 'admin', handler: async (req) => handlers.createBrand(pool, await readJsonBody(req)) },
  { method: 'DELETE', pattern: /^\/api\/brands\/(\d+)$/, auth: 'admin', handler: (_req, [id]) => handlers.deleteBrand(pool, id) },
  { method: 'GET', pattern: /^\/api\/campaigns$/, auth: 'user', handler: (_req, _m, query) => handlers.listCampaigns(pool, query) },
  { method: 'POST', pattern: /^\/api\/campaigns$/, auth: 'user', handler: async (req) => handlers.createCampaign(pool, await readJsonBody(req)) },
  { method: 'GET', pattern: /^\/api\/campaigns\/(\d+)$/, auth: 'user', handler: (_req, [id]) => handlers.getCampaign(pool, id) },
  { method: 'PUT', pattern: /^\/api\/campaigns\/(\d+)$/, auth: 'user', handler: async (req, [id]) => {
    const body = await readJsonBody(req);
    // Archiving via a plain status edit would bypass the admin-only
    // archive flow — only the DELETE route (also admin-gated) may set it.
    if (body.status === 'archived' && auth.getUserFromRequest(req).role !== 'admin') {
      throw auth.httpError(403, 'only an admin can archive a campaign');
    }
    return handlers.updateCampaign(pool, id, body);
  } },
  { method: 'DELETE', pattern: /^\/api\/campaigns\/(\d+)$/, auth: 'admin', handler: (_req, [id]) => handlers.deleteCampaign(pool, id) },
  { method: 'PUT', pattern: /^\/api\/campaigns\/(\d+)\/banner$/, auth: 'user', handler: async (req, [id]) => handlers.setCampaignBanner(pool, id, await readJsonBody(req)) },
  { method: 'DELETE', pattern: /^\/api\/campaigns\/(\d+)\/banner$/, auth: 'user', handler: (_req, [id]) => handlers.deleteCampaignBanner(pool, id) },
  { method: 'GET', pattern: /^\/api\/campaigns\/(\d+)\/registrations$/, auth: 'user', handler: (_req, [id]) => handlers.listRegistrations(pool, id) },
  { method: 'POST', pattern: /^\/api\/campaigns\/(\d+)\/registrations$/, handler: async (req, [id]) => handlers.createRegistration(pool, id, await readJsonBody(req)) },
];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && staticPages[url.pathname]) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlCache[staticPages[url.pathname]]);
      return;
    }

    const slugMatch = req.method === 'GET' && url.pathname.match(/^\/c\/([^/]+)\/([^/]+)$/);
    if (slugMatch) {
      try {
        const { body: campaign } = await handlers.getCampaignBySlug(
          pool,
          decodeURIComponent(slugMatch[1]),
          decodeURIComponent(slugMatch[2])
        );
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderCampaignPage(campaign));
      } catch (error) {
        res.writeHead(error.statusCode || 500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderNotFoundPage());
      }
      return;
    }

    // Public — the campaign banner must render on the unauthenticated
    // public campaign page too, not just the admin edit page.
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

    // Admin/user only — registrant invoices carry PII, unlike the banner.
    const invoiceMatch = req.method === 'GET' && url.pathname.match(/^\/api\/registrations\/(\d+)\/invoice$/);
    if (invoiceMatch) {
      try {
        auth.requireAuth(req);
        const { mime, buffer, filename } = await handlers.getRegistrationInvoice(pool, invoiceMatch[1]);
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Disposition': `inline; filename="${(filename || 'invoice').replace(/"/g, '')}"`,
        });
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
      if (route.auth === 'admin') auth.requireAdmin(req);
      else if (route.auth === 'user') auth.requireAuth(req);
      const result = await route.handler(req, match.slice(1), Object.fromEntries(url.searchParams));
      sendJson(res, result.status, result.body, result.headers);
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
