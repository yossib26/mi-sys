const pool = require('../../lib/db');
const handlers = require('../../lib/handlers');
const users = require('../../lib/users');
const auth = require('../../lib/auth');
const { respond, handleError } = require('../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    // Any logged-in user can read brands, scoped to their own
    // assignment if they're a 'user' account; managing the list
    // itself (add/rename/delete) is admin-only.
    if (req.method === 'GET') {
      const user = auth.requireAuth(req);
      const brandScope = await users.getBrandScope(pool, user);
      return respond(res, await handlers.listBrands(pool, brandScope));
    }
    if (req.method === 'POST') {
      auth.requireAdmin(req);
      return respond(res, await handlers.createBrand(pool, req.body));
    }
    res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
  } catch (error) {
    handleError(res, error);
  }
};
