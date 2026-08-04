const pool = require('../../lib/db');
const handlers = require('../../lib/handlers');
const { respond, handleError } = require('../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') return respond(res, await handlers.listCampaigns(pool, req.query));
    if (req.method === 'POST') return respond(res, await handlers.createCampaign(pool, req.body));
    res.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    handleError(res, error);
  }
};
