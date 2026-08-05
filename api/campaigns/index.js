const pool = require('../../lib/db');
const handlers = require('../../lib/handlers');
const auth = require('../../lib/auth');
const { respond, handleError } = require('../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    auth.requireAuth(req);
    if (req.method === 'GET') return respond(res, await handlers.listCampaigns(pool, req.query));
    if (req.method === 'POST') return respond(res, await handlers.createCampaign(pool, req.body));
    res.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    handleError(res, error);
  }
};
