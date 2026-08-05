const pool = require('../../lib/db');
const handlers = require('../../lib/handlers');
const auth = require('../../lib/auth');
const { respond, handleError } = require('../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const { id } = req.query;

    // Archiving (the DELETE verb) is admin-only; everything else on
    // a campaign just needs any logged-in user.
    if (req.method === 'DELETE') {
      auth.requireAdmin(req);
      return respond(res, await handlers.deleteCampaign(pool, id));
    }

    const user = auth.requireAuth(req);
    if (req.method === 'GET') return respond(res, await handlers.getCampaign(pool, id));
    if (req.method === 'PUT') {
      // Archiving via a plain status edit would bypass the admin-only
      // archive flow above — only that route may set 'archived'.
      if (req.body && req.body.status === 'archived' && user.role !== 'admin') {
        throw auth.httpError(403, 'only an admin can archive a campaign');
      }
      return respond(res, await handlers.updateCampaign(pool, id, req.body));
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    handleError(res, error);
  }
};
