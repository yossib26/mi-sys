const pool = require('../../lib/db');
const handlers = require('../../lib/handlers');
const auth = require('../../lib/auth');
const { respond, handleError } = require('../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    auth.requireAdmin(req);
    const { id } = req.query;
    if (req.method === 'PUT') return respond(res, await handlers.updateBrand(pool, id, req.body));
    if (req.method === 'DELETE') return respond(res, await handlers.deleteBrand(pool, id));
    res.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    handleError(res, error);
  }
};
