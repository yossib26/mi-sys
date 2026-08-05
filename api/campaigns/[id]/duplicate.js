const pool = require('../../../lib/db');
const handlers = require('../../../lib/handlers');
const auth = require('../../../lib/auth');
const { respond, handleError } = require('../../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    auth.requireAuth(req);
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method not allowed' });
      return;
    }
    return respond(res, await handlers.duplicateCampaign(pool, req.query.id));
  } catch (error) {
    handleError(res, error);
  }
};
