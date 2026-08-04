const pool = require('../../lib/db');
const handlers = require('../../lib/handlers');
const { respond, handleError } = require('../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const { id } = req.query;
    if (req.method === 'GET') return respond(res, await handlers.getCampaign(pool, id));
    if (req.method === 'PUT') return respond(res, await handlers.updateCampaign(pool, id, req.body));
    if (req.method === 'DELETE') return respond(res, await handlers.deleteCampaign(pool, id));
    res.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    handleError(res, error);
  }
};
