const pool = require('../../../lib/db');
const handlers = require('../../../lib/handlers');
const { respond, handleError } = require('../../../lib/vercel-response');

// Public — fired from the unauthenticated public campaign page the
// moment a visitor starts filling in the registration form.
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
      return;
    }
    return respond(res, await handlers.recordCampaignFormStart(pool, req.query.id));
  } catch (error) {
    handleError(res, error);
  }
};
