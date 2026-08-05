const pool = require('../../../lib/db');
const handlers = require('../../../lib/handlers');
const { handleError } = require('../../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'method not allowed' });
      return;
    }
    const { id } = req.query;
    const { mime, buffer, filename } = await handlers.getRegistrationInvoice(pool, id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${(filename || 'invoice').replace(/"/g, '')}"`);
    res.status(200).send(buffer);
  } catch (error) {
    handleError(res, error);
  }
};
