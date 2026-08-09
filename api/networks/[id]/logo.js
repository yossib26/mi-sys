const pool = require('../../../lib/db');
const handlers = require('../../../lib/handlers');
const auth = require('../../../lib/auth');
const { respond, handleError } = require('../../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const { id } = req.query;

    // GET stays public — a network's logo can render on the
    // unauthenticated public campaign page, same reasoning as the
    // brand logo.
    if (req.method === 'GET') {
      const { mime, buffer } = await handlers.getNetworkLogo(pool, id);
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.status(200).send(buffer);
      return;
    }

    auth.requireAdmin(req);
    if (req.method === 'PUT') return respond(res, await handlers.setNetworkLogo(pool, id, req.body));
    if (req.method === 'DELETE') return respond(res, await handlers.deleteNetworkLogo(pool, id));
    res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
  } catch (error) {
    handleError(res, error);
  }
};

// Logo images arrive as a base64 JSON data URI, larger than the
// default parsed-body limit.
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
};
