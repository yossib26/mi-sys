const pool = require('../../../lib/db');
const handlers = require('../../../lib/handlers');
const { respond, handleError } = require('../../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const { id } = req.query;
    if (req.method === 'GET') return respond(res, await handlers.listRegistrations(pool, id));
    if (req.method === 'POST') return respond(res, await handlers.createRegistration(pool, id, req.body));
    res.status(405).json({ error: 'method not allowed' });
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
