const pool = require('../../lib/db');
const handlers = require('../../lib/handlers');
const { respond, handleError } = require('../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const { id } = req.query;
    if (req.method === 'DELETE') return respond(res, await handlers.deleteBrand(pool, id));
    res.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    handleError(res, error);
  }
};
