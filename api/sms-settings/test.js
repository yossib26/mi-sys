const pool = require('../../lib/db');
const handlers = require('../../lib/handlers');
const auth = require('../../lib/auth');
const { respond, handleError } = require('../../lib/vercel-response');

// Sends one real message through the configured provider, so an admin
// can tell working settings from merely saved ones. Admin-only — it
// spends real SMS credit.
module.exports = async (req, res) => {
  try {
    auth.requireAdmin(req);
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
      return;
    }
    return respond(res, await handlers.sendTestSms(pool, req.body));
  } catch (error) {
    handleError(res, error);
  }
};
