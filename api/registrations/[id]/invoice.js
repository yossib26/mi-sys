const pool = require('../../../lib/db');
const handlers = require('../../../lib/handlers');
const users = require('../../../lib/users');
const auth = require('../../../lib/auth');
const { handleError } = require('../../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'method not allowed' });
      return;
    }
    // Registrant invoices carry PII — unlike the campaign banner,
    // this is not part of the public page.
    const user = auth.requireAuth(req);
    const brandScope = await users.getBrandScope(pool, user);
    const { id } = req.query;
    const { mime, buffer, filename } = await handlers.getRegistrationInvoice(pool, id, brandScope);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${(filename || 'invoice').replace(/"/g, '')}"`);
    res.status(200).send(buffer);
  } catch (error) {
    handleError(res, error);
  }
};
