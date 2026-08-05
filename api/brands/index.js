const pool = require('../../lib/db');
const handlers = require('../../lib/handlers');
const auth = require('../../lib/auth');
const { respond, handleError } = require('../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    // Any logged-in user can read brands (needed to pick one when
    // creating/editing a campaign); managing the list is admin-only.
    if (req.method === 'GET') {
      auth.requireAuth(req);
      return respond(res, await handlers.listBrands(pool));
    }
    if (req.method === 'POST') {
      auth.requireAdmin(req);
      return respond(res, await handlers.createBrand(pool, req.body));
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    handleError(res, error);
  }
};
