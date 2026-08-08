const pool = require('../../../../lib/db');
const handlers = require('../../../../lib/handlers');
const users = require('../../../../lib/users');
const auth = require('../../../../lib/auth');
const { respond, handleError } = require('../../../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const { id } = req.query;
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
      return;
    }
    const user = auth.requireAuth(req);
    const brandScope = await users.getBrandScope(pool, user);
    const fieldIds = req.body && req.body.field_ids;
    return respond(res, await handlers.reorderCampaignFields(pool, id, fieldIds, brandScope, user));
  } catch (error) {
    handleError(res, error);
  }
};
