const pool = require('../../../../../lib/db');
const handlers = require('../../../../../lib/handlers');
const users = require('../../../../../lib/users');
const auth = require('../../../../../lib/auth');
const { handleError } = require('../../../../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
      return;
    }
    // Carries whatever a registrant uploaded — PII by default, so
    // this is admin/user-only, same as the fixed invoice route.
    const user = auth.requireAuth(req);
    const brandScope = await users.getBrandScope(pool, user);
    const { id, fieldId } = req.query;
    const { mime, buffer, filename } = await handlers.getRegistrationFieldFile(pool, id, fieldId, brandScope);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${(filename || 'file').replace(/"/g, '')}"`);
    res.status(200).send(buffer);
  } catch (error) {
    handleError(res, error);
  }
};
