const pool = require('../../../../../lib/db');
const handlers = require('../../../../../lib/handlers');
const { respond, handleError } = require('../../../../../lib/vercel-response');

// Public — called from the campaign page itself when a visitor clicks
// a gift, not from the admin UI. No auth required, same as
// registrations/form-start.
module.exports = async (req, res) => {
  try {
    const { id, giftId } = req.query;
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
      return;
    }
    return respond(res, await handlers.reserveCampaignGift(pool, id, giftId));
  } catch (error) {
    handleError(res, error);
  }
};
