const pool = require('../../lib/db');
const handlers = require('../../lib/handlers');
const users = require('../../lib/users');
const auth = require('../../lib/auth');
const { respond, handleError } = require('../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const user = auth.requireAuth(req);
    const brandScope = await users.getBrandScope(pool, user);
    if (req.method === 'GET') return respond(res, await handlers.listCampaigns(pool, req.query, brandScope));
    if (req.method === 'POST') return respond(res, await handlers.createCampaign(pool, req.body, brandScope));
    res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
  } catch (error) {
    handleError(res, error);
  }
};
