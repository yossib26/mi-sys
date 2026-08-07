const pool = require('../../lib/db');
const handlers = require('../../lib/handlers');
const users = require('../../lib/users');
const auth = require('../../lib/auth');
const { respond, handleError } = require('../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const { id } = req.query;

    // Archiving (the DELETE verb) is admin-only; everything else on
    // a campaign just needs any logged-in user (scoped to their
    // assigned brands, for a 'user' account).
    if (req.method === 'DELETE') {
      auth.requireAdmin(req);
      return respond(res, await handlers.deleteCampaign(pool, id));
    }

    const user = auth.requireAuth(req);
    const brandScope = await users.getBrandScope(pool, user);
    if (req.method === 'GET') return respond(res, await handlers.getCampaign(pool, id, brandScope));
    if (req.method === 'PUT') {
      // Archiving via a plain status edit would bypass the admin-only
      // archive flow above — only that route may set 'archived'.
      if (req.body && req.body.status === 'archived' && user.role !== 'admin') {
        throw auth.httpError(403, 'רק מנהל יכול להעביר קמפיין לארכיון');
      }
      return respond(res, await handlers.updateCampaign(pool, id, req.body, brandScope, user));
    }
    res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
  } catch (error) {
    handleError(res, error);
  }
};
