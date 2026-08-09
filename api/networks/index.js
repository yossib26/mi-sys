const pool = require('../../lib/db');
const handlers = require('../../lib/handlers');
const auth = require('../../lib/auth');
const { respond, handleError } = require('../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    // Any logged-in user can read the network catalog (needed for the
    // campaign checkbox list); managing it (add/rename/delete) is
    // admin-only — same split as brands.
    if (req.method === 'GET') {
      auth.requireAuth(req);
      return respond(res, await handlers.listNetworks(pool));
    }
    if (req.method === 'POST') {
      auth.requireAdmin(req);
      return respond(res, await handlers.createNetwork(pool, req.body));
    }
    res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
  } catch (error) {
    handleError(res, error);
  }
};
