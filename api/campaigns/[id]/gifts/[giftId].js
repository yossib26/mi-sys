const pool = require('../../../../lib/db');
const handlers = require('../../../../lib/handlers');
const users = require('../../../../lib/users');
const auth = require('../../../../lib/auth');
const { respond, handleError } = require('../../../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const { id, giftId } = req.query;
    const user = auth.requireAuth(req);
    const brandScope = await users.getBrandScope(pool, user);
    if (req.method === 'PUT') return respond(res, await handlers.updateCampaignGift(pool, id, giftId, req.body, brandScope, user));
    if (req.method === 'DELETE') return respond(res, await handlers.deleteCampaignGift(pool, id, giftId, brandScope, user));
    res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
  } catch (error) {
    handleError(res, error);
  }
};
