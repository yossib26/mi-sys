const pool = require('../../../../../lib/db');
const handlers = require('../../../../../lib/handlers');
const { respond, handleError } = require('../../../../../lib/vercel-response');

// Public — called from the campaign page itself (switching gift picks,
// or on unload via a keepalive fetch) to give back a reservation
// that's not going to be used. No auth required, same as reserve.js.
module.exports = async (req, res) => {
  try {
    const { id, giftId } = req.query;
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
      return;
    }
    return respond(res, await handlers.releaseCampaignGift(pool, id, giftId));
  } catch (error) {
    handleError(res, error);
  }
};
