const pool = require('../../../../lib/db');
const handlers = require('../../../../lib/handlers');
const { respond, handleError } = require('../../../../lib/vercel-response');

// Public — the code the visitor typed into the OTP dialog is checked
// here. Success only marks the challenge verified; the registration
// itself still has to spend it (see createRegistration).
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
      return;
    }
    return respond(res, await handlers.verifyRegistrationOtp(pool, req.query.id, req.body));
  } catch (error) {
    handleError(res, error);
  }
};
