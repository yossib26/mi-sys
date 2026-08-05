const pool = require('../../../lib/db');
const handlers = require('../../../lib/handlers');
const { respond, handleError } = require('../../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const { id } = req.query;

    if (req.method === 'GET') {
      const { mime, buffer } = await handlers.getCampaignBanner(pool, id);
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.status(200).send(buffer);
      return;
    }
    if (req.method === 'PUT') return respond(res, await handlers.setCampaignBanner(pool, id, req.body));
    if (req.method === 'DELETE') return respond(res, await handlers.deleteCampaignBanner(pool, id));
    res.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    handleError(res, error);
  }
};

// Banner images arrive as a base64 JSON data URI, larger than the
// default parsed-body limit.
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
};
