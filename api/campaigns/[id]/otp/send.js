const pool = require('../../../../lib/db');
const handlers = require('../../../../lib/handlers');
const { respond, handleError } = require('../../../../lib/vercel-response');

// Public — the public campaign page asks for an SMS code here once the
// visitor has filled the form, before it submits anything. No auth,
// same as the registration submission it precedes.
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
      return;
    }
    return respond(res, await handlers.sendRegistrationOtp(pool, req.query.id, req.body));
  } catch (error) {
    handleError(res, error);
  }
};
