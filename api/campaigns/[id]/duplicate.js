const pool = require('../../../lib/db');
const handlers = require('../../../lib/handlers');
const users = require('../../../lib/users');
const auth = require('../../../lib/auth');
const { respond, handleError } = require('../../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const user = auth.requireAuth(req);
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
      return;
    }
    const brandScope = await users.getBrandScope(pool, user);
    return respond(res, await handlers.duplicateCampaign(pool, req.query.id, brandScope));
  } catch (error) {
    handleError(res, error);
  }
};
