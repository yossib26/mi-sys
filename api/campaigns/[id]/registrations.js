const pool = require('../../../lib/db');
const handlers = require('../../../lib/handlers');
const users = require('../../../lib/users');
const auth = require('../../../lib/auth');
const { respond, handleError } = require('../../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const { id } = req.query;

    // POST stays public — this is the visitor-facing sign-up
    // submission from the public campaign page, not an admin action.
    if (req.method === 'POST') return respond(res, await handlers.createRegistration(pool, id, req.body));

    const user = auth.requireAuth(req);
    if (req.method === 'GET') {
      const brandScope = await users.getBrandScope(pool, user);
      return respond(res, await handlers.listRegistrations(pool, id, brandScope, req.query));
    }
    res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
  } catch (error) {
    handleError(res, error);
  }
};

// Registrations carry an invoice as a base64 JSON data URI, larger
// than the default parsed-body limit.
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
};
