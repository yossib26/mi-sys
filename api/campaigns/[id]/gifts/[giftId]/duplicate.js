const pool = require('../../../../../lib/db');
const handlers = require('../../../../../lib/handlers');
const users = require('../../../../../lib/users');
const auth = require('../../../../../lib/auth');
const { respond, handleError } = require('../../../../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const { id, giftId } = req.query;
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
      return;
    }
    const user = auth.requireAuth(req);
    const brandScope = await users.getBrandScope(pool, user);
    return respond(res, await handlers.duplicateCampaignGift(pool, id, giftId, brandScope, user));
  } catch (error) {
    handleError(res, error);
  }
};
