const pool = require('../../../../lib/db');
const handlers = require('../../../../lib/handlers');
const users = require('../../../../lib/users');
const auth = require('../../../../lib/auth');
const { respond, handleError } = require('../../../../lib/vercel-response');

// Which of the global networks (see /api/networks) are relevant to
// this campaign — GET the current selection, PUT to replace it with a
// whole new set (edit.html's checkbox list saves the full set on
// every change, not one add/remove call per checkbox).
module.exports = async (req, res) => {
  try {
    const { id } = req.query;
    const user = auth.requireAuth(req);
    const brandScope = await users.getBrandScope(pool, user);
    if (req.method === 'GET') return respond(res, await handlers.listCampaignNetworks(pool, id, brandScope));
    if (req.method === 'PUT') return respond(res, await handlers.setCampaignNetworks(pool, id, req.body && req.body.network_ids, brandScope, user));
    res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
  } catch (error) {
    handleError(res, error);
  }
};
