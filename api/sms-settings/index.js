const pool = require('../../lib/db');
const handlers = require('../../lib/handlers');
const auth = require('../../lib/auth');
const { respond, handleError } = require('../../lib/vercel-response');

// Admin-only, same as user management: these are server-wide
// credentials, not something a brand-scoped 'user' account may touch.
module.exports = async (req, res) => {
  try {
    const user = auth.requireAdmin(req);
    if (req.method === 'GET') return respond(res, await handlers.getSmsSettings(pool));
    if (req.method === 'PUT') return respond(res, await handlers.updateSmsSettings(pool, req.body, user));
    res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
  } catch (error) {
    handleError(res, error);
  }
};
