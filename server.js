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
  '/brands.html': 'brands.html',
  '/dashboard.html': 'dashboard.html',
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
        reject(handlers.httpError(413, 'גוף הבקשה גדול מדי'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(handlers.httpError(400, 'גוף הבקשה אינו JSON תקין'));
      }
    });
    req.on('error', reject);
  });
}

// route.auth: undefined = public, 'user' = any logged-in user, 'admin' = admin only.
// handler(req, params, query, user) — `user` is whoever auth resolved
// (null for public routes).
const routes = [
  { method: 'GET', pattern: /^\/api\/status$/, handler: () => handlers.getStatus(pool) },
  { method: 'GET', pattern: /^\/api\/templates$/, handler: () => ({ status: 200, body: templateList }) },

  { method: 'POST', pattern: /^\/api\/auth\/login$/, handler: async (req) => {
    const user = await users.login(pool, await readJsonBody(req));
    return { status: 200, body: user, headers: { 'Set-Cookie': auth.buildSessionCookie(user) } };
  } },
  { method: 'POST', pattern: /^\/api\/auth\/logout$/, handler: () => ({ status: 204, body: null, headers: { 'Set-Cookie': auth.buildLogoutCookie() } }) },
  { method: 'GET', pattern: /^\/api\/auth\/me$/, auth: 'user', handler: (_req, _m, _q, user) => ({ status: 200, body: user }) },
  // Called by the admin pages' idle-activity watchdog roughly every
  // 30s while there's been real activity — re-mints the session
  // cookie with a fresh 10-minute expiry (SESSION_TTL_MS).
  { method: 'POST', pattern: /^\/api\/auth\/refresh$/, auth: 'user', handler: (_req, _m, _q, user) => ({ status: 200, body: user, headers: { 'Set-Cookie': auth.buildSessionCookie(user) } }) },

  { method: 'GET', pattern: /^\/api\/users$/, auth: 'admin', handler: () => users.listUsers(pool) },
  { method: 'POST', pattern: /^\/api\/users$/, auth: 'admin', handler: async (req) => users.createUser(pool, await readJsonBody(req)) },
  { method: 'PUT', pattern: /^\/api\/users\/(\d+)$/, auth: 'admin', handler: async (req, [id]) => users.updateUser(pool, id, await readJsonBody(req)) },
  { method: 'DELETE', pattern: /^\/api\/users\/(\d+)$/, auth: 'admin', handler: (_req, [id], _q, user) => users.deleteUser(pool, id, user.id) },

  // Brands: any logged-in user can read them (scoped to their own
  // assignment, if they're a 'user' account), but managing the brand
  // list itself (add/rename/delete) is admin-only.
  { method: 'GET', pattern: /^\/api\/brands$/, auth: 'user', handler: async (_req, _m, _q, user) => handlers.listBrands(pool, await users.getBrandScope(pool, user)) },
  { method: 'POST', pattern: /^\/api\/brands$/, auth: 'admin', handler: async (req) => handlers.createBrand(pool, await readJsonBody(req)) },
  { method: 'PUT', pattern: /^\/api\/brands\/(\d+)$/, auth: 'admin', handler: async (req, [id]) => handlers.updateBrand(pool, id, await readJsonBody(req)) },
  { method: 'DELETE', pattern: /^\/api\/brands\/(\d+)$/, auth: 'admin', handler: (_req, [id]) => handlers.deleteBrand(pool, id) },
  { method: 'PUT', pattern: /^\/api\/brands\/(\d+)\/logo$/, auth: 'admin', handler: async (req, [id]) => handlers.setBrandLogo(pool, id, await readJsonBody(req)) },
  { method: 'DELETE', pattern: /^\/api\/brands\/(\d+)\/logo$/, auth: 'admin', handler: (_req, [id]) => handlers.deleteBrandLogo(pool, id) },

  { method: 'GET', pattern: /^\/api\/campaigns$/, auth: 'user', handler: async (_req, _m, query, user) => handlers.listCampaigns(pool, query, await users.getBrandScope(pool, user)) },
  { method: 'POST', pattern: /^\/api\/campaigns$/, auth: 'user', handler: async (req, _m, _q, user) => handlers.createCampaign(pool, await readJsonBody(req), await users.getBrandScope(pool, user)) },
  { method: 'POST', pattern: /^\/api\/campaigns\/(\d+)\/duplicate$/, auth: 'user', handler: async (_req, [id], _q, user) => handlers.duplicateCampaign(pool, id, await users.getBrandScope(pool, user)) },
  { method: 'GET', pattern: /^\/api\/campaigns\/(\d+)$/, auth: 'user', handler: async (_req, [id], _q, user) => handlers.getCampaign(pool, id, await users.getBrandScope(pool, user)) },
  { method: 'PUT', pattern: /^\/api\/campaigns\/(\d+)$/, auth: 'user', handler: async (req, [id], _q, user) => {
    const body = await readJsonBody(req);
    // Archiving via a plain status edit would bypass the admin-only
    // archive flow — only the DELETE route (also admin-gated) may set it.
    if (body.status === 'archived' && user.role !== 'admin') {
      throw auth.httpError(403, 'רק מנהל יכול להעביר קמפיין לארכיון');
    }
    return handlers.updateCampaign(pool, id, body, await users.getBrandScope(pool, user), user);
  } },
  { method: 'DELETE', pattern: /^\/api\/campaigns\/(\d+)$/, auth: 'admin', handler: (_req, [id]) => handlers.deleteCampaign(pool, id) },
  { method: 'GET', pattern: /^\/api\/campaigns\/(\d+)\/activity-log$/, auth: 'user', handler: async (_req, [id], query, user) => handlers.listCampaignActivityLog(pool, id, await users.getBrandScope(pool, user), query) },
  { method: 'PUT', pattern: /^\/api\/campaigns\/(\d+)\/banner$/, auth: 'user', handler: async (req, [id], _q, user) => handlers.setCampaignBanner(pool, id, await readJsonBody(req), await users.getBrandScope(pool, user), user) },
  { method: 'DELETE', pattern: /^\/api\/campaigns\/(\d+)\/banner$/, auth: 'user', handler: async (_req, [id], _q, user) => handlers.deleteCampaignBanner(pool, id, await users.getBrandScope(pool, user), user) },
  { method: 'GET', pattern: /^\/api\/campaigns\/(\d+)\/registrations$/, auth: 'user', handler: async (_req, [id], query, user) => handlers.listRegistrations(pool, id, await users.getBrandScope(pool, user), query) },
  { method: 'POST', pattern: /^\/api\/campaigns\/(\d+)\/registrations$/, handler: async (req, [id]) => handlers.createRegistration(pool, id, await readJsonBody(req)) },
  { method: 'POST', pattern: /^\/api\/campaigns\/(\d+)\/form-start$/, handler: (_req, [id]) => handlers.recordCampaignFormStart(pool, id) },

  // Dynamic registration-form fields for a campaign.
  { method: 'GET', pattern: /^\/api\/campaigns\/(\d+)\/fields$/, auth: 'user', handler: async (_req, [id], _q, user) => handlers.listCampaignFields(pool, id, await users.getBrandScope(pool, user)) },
  { method: 'POST', pattern: /^\/api\/campaigns\/(\d+)\/fields$/, auth: 'user', handler: async (req, [id], _q, user) => handlers.createCampaignField(pool, id, await readJsonBody(req), await users.getBrandScope(pool, user), user) },
  { method: 'PUT', pattern: /^\/api\/campaigns\/(\d+)\/fields\/(\d+)$/, auth: 'user', handler: async (req, [id, fieldId], _q, user) => handlers.updateCampaignField(pool, id, fieldId, await readJsonBody(req), await users.getBrandScope(pool, user), user) },
  { method: 'DELETE', pattern: /^\/api\/campaigns\/(\d+)\/fields\/(\d+)$/, auth: 'user', handler: async (_req, [id, fieldId], _q, user) => handlers.deleteCampaignField(pool, id, fieldId, await users.getBrandScope(pool, user), user) },
  { method: 'POST', pattern: /^\/api\/campaigns\/(\d+)\/fields\/(\d+)\/move$/, auth: 'user', handler: async (req, [id, fieldId], _q, user) => handlers.moveCampaignField(pool, id, fieldId, (await readJsonBody(req)).direction, await users.getBrandScope(pool, user), user) },
  { method: 'POST', pattern: /^\/api\/campaigns\/(\d+)\/fields\/reorder$/, auth: 'user', handler: async (req, [id], _q, user) => handlers.reorderCampaignFields(pool, id, (await readJsonBody(req)).field_ids, await users.getBrandScope(pool, user), user) },

  // Gift-choice campaigns: a campaign's own list of gifts.
  { method: 'GET', pattern: /^\/api\/campaigns\/(\d+)\/gifts$/, auth: 'user', handler: async (_req, [id], _q, user) => handlers.listCampaignGifts(pool, id, await users.getBrandScope(pool, user)) },
  { method: 'POST', pattern: /^\/api\/campaigns\/(\d+)\/gifts$/, auth: 'user', handler: async (req, [id], _q, user) => handlers.createCampaignGift(pool, id, await readJsonBody(req), await users.getBrandScope(pool, user), user) },
  { method: 'PUT', pattern: /^\/api\/campaigns\/(\d+)\/gifts\/(\d+)$/, auth: 'user', handler: async (req, [id, giftId], _q, user) => handlers.updateCampaignGift(pool, id, giftId, await readJsonBody(req), await users.getBrandScope(pool, user), user) },
  { method: 'DELETE', pattern: /^\/api\/campaigns\/(\d+)\/gifts\/(\d+)$/, auth: 'user', handler: async (_req, [id, giftId], _q, user) => handlers.deleteCampaignGift(pool, id, giftId, await users.getBrandScope(pool, user), user) },
  { method: 'POST', pattern: /^\/api\/campaigns\/(\d+)\/gifts\/(\d+)\/duplicate$/, auth: 'user', handler: async (_req, [id, giftId], _q, user) => handlers.duplicateCampaignGift(pool, id, giftId, await users.getBrandScope(pool, user), user) },
  { method: 'POST', pattern: /^\/api\/campaigns\/(\d+)\/gifts\/(\d+)\/move$/, auth: 'user', handler: async (req, [id, giftId], _q, user) => handlers.moveCampaignGift(pool, id, giftId, (await readJsonBody(req)).direction, await users.getBrandScope(pool, user), user) },
  { method: 'PUT', pattern: /^\/api\/campaigns\/(\d+)\/gifts\/(\d+)\/image$/, auth: 'user', handler: async (req, [id, giftId], _q, user) => handlers.setCampaignGiftImage(pool, id, giftId, await readJsonBody(req), await users.getBrandScope(pool, user), user) },
  { method: 'DELETE', pattern: /^\/api\/campaigns\/(\d+)\/gifts\/(\d+)\/image$/, auth: 'user', handler: async (_req, [id, giftId], _q, user) => handlers.deleteCampaignGiftImage(pool, id, giftId, await users.getBrandScope(pool, user), user) },

  // 'product_and_gift' campaigns: a campaign's own list of products
  // (independent of, and alongside, its gift list above).
  { method: 'GET', pattern: /^\/api\/campaigns\/(\d+)\/products$/, auth: 'user', handler: async (_req, [id], _q, user) => handlers.listCampaignProducts(pool, id, await users.getBrandScope(pool, user)) },
  { method: 'POST', pattern: /^\/api\/campaigns\/(\d+)\/products$/, auth: 'user', handler: async (req, [id], _q, user) => handlers.createCampaignProduct(pool, id, await readJsonBody(req), await users.getBrandScope(pool, user), user) },
  { method: 'PUT', pattern: /^\/api\/campaigns\/(\d+)\/products\/(\d+)$/, auth: 'user', handler: async (req, [id, productId], _q, user) => handlers.updateCampaignProduct(pool, id, productId, await readJsonBody(req), await users.getBrandScope(pool, user), user) },
  { method: 'DELETE', pattern: /^\/api\/campaigns\/(\d+)\/products\/(\d+)$/, auth: 'user', handler: async (_req, [id, productId], _q, user) => handlers.deleteCampaignProduct(pool, id, productId, await users.getBrandScope(pool, user), user) },
  { method: 'POST', pattern: /^\/api\/campaigns\/(\d+)\/products\/(\d+)\/duplicate$/, auth: 'user', handler: async (_req, [id, productId], _q, user) => handlers.duplicateCampaignProduct(pool, id, productId, await users.getBrandScope(pool, user), user) },
  { method: 'POST', pattern: /^\/api\/campaigns\/(\d+)\/products\/(\d+)\/move$/, auth: 'user', handler: async (req, [id, productId], _q, user) => handlers.moveCampaignProduct(pool, id, productId, (await readJsonBody(req)).direction, await users.getBrandScope(pool, user), user) },
  { method: 'PUT', pattern: /^\/api\/campaigns\/(\d+)\/products\/(\d+)\/image$/, auth: 'user', handler: async (req, [id, productId], _q, user) => handlers.setCampaignProductImage(pool, id, productId, await readJsonBody(req), await users.getBrandScope(pool, user), user) },
  { method: 'DELETE', pattern: /^\/api\/campaigns\/(\d+)\/products\/(\d+)\/image$/, auth: 'user', handler: async (_req, [id, productId], _q, user) => handlers.deleteCampaignProductImage(pool, id, productId, await users.getBrandScope(pool, user), user) },
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

    // Public — same reasoning as the banner: a gift's photo has to
    // render on the unauthenticated public campaign page.
    const giftImageMatch = req.method === 'GET' && url.pathname.match(/^\/api\/campaigns\/\d+\/gifts\/(\d+)\/image$/);
    if (giftImageMatch) {
      try {
        const { mime, buffer } = await handlers.getCampaignGiftImage(pool, giftImageMatch[1]);
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' });
        res.end(buffer);
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message });
      }
      return;
    }

    // Public — same reasoning as the gift photo above.
    const productImageMatch = req.method === 'GET' && url.pathname.match(/^\/api\/campaigns\/\d+\/products\/(\d+)\/image$/);
    if (productImageMatch) {
      try {
        const { mime, buffer } = await handlers.getCampaignProductImage(pool, productImageMatch[1]);
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' });
        res.end(buffer);
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message });
      }
      return;
    }

    // Public — the brand logo renders next to the footer note on the
    // unauthenticated public campaign page, same reasoning as the banner.
    const brandLogoMatch = req.method === 'GET' && url.pathname.match(/^\/api\/brands\/(\d+)\/logo$/);
    if (brandLogoMatch) {
      try {
        const { mime, buffer } = await handlers.getBrandLogo(pool, brandLogoMatch[1]);
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
        const user = auth.requireAuth(req);
        const brandScope = await users.getBrandScope(pool, user);
        const { mime, buffer, filename } = await handlers.getRegistrationInvoice(pool, invoiceMatch[1], brandScope);
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

    // Admin/user only — same PII rationale as the invoice route above,
    // but for a per-registration upload against a dynamic 'file' field.
    const fieldFileMatch = req.method === 'GET' && url.pathname.match(/^\/api\/registrations\/(\d+)\/fields\/(\d+)\/file$/);
    if (fieldFileMatch) {
      try {
        const user = auth.requireAuth(req);
        const brandScope = await users.getBrandScope(pool, user);
        const { mime, buffer, filename } = await handlers.getRegistrationFieldFile(pool, fieldFileMatch[1], fieldFileMatch[2], brandScope);
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Disposition': `inline; filename="${(filename || 'file').replace(/"/g, '')}"`,
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
      let user = null;
      if (route.auth === 'admin') user = auth.requireAdmin(req);
      else if (route.auth === 'user') user = auth.requireAuth(req);
      const result = await route.handler(req, match.slice(1), Object.fromEntries(url.searchParams), user);
      sendJson(res, result.status, result.body, result.headers);
      return;
    }

    sendJson(res, 404, { error: 'הנתיב לא נמצא' });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status === 500) console.error(error);
    sendJson(res, status, { error: error.message });
  }
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
