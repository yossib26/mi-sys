const pool = require('../../../../lib/db');
const handlers = require('../../../../lib/handlers');
const users = require('../../../../lib/users');
const auth = require('../../../../lib/auth');
const { respond, handleError } = require('../../../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const { id } = req.query;
    const user = auth.requireAuth(req);
    const brandScope = await users.getBrandScope(pool, user);
    if (req.method === 'GET') return respond(res, await handlers.listCampaignFields(pool, id, brandScope));
    if (req.method === 'POST') return respond(res, await handlers.createCampaignField(pool, id, req.body, brandScope, user));
    res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
  } catch (error) {
    handleError(res, error);
  }
};
