const pool = require('../../../../../lib/db');
const handlers = require('../../../../../lib/handlers');
const users = require('../../../../../lib/users');
const auth = require('../../../../../lib/auth');
const { respond, handleError } = require('../../../../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const { giftId, id } = req.query;

    // GET stays public — a gift's photo has to render on the
    // unauthenticated public campaign page, not just the admin
    // edit page (same reasoning as the campaign banner).
    if (req.method === 'GET') {
      const { mime, buffer } = await handlers.getCampaignGiftImage(pool, giftId);
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.status(200).send(buffer);
      return;
    }

    const user = auth.requireAuth(req);
    const brandScope = await users.getBrandScope(pool, user);
    if (req.method === 'PUT') return respond(res, await handlers.setCampaignGiftImage(pool, id, giftId, req.body, brandScope, user));
    if (req.method === 'DELETE') return respond(res, await handlers.deleteCampaignGiftImage(pool, id, giftId, brandScope, user));
    res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
  } catch (error) {
    handleError(res, error);
  }
};

// Gift images arrive as a base64 JSON data URI, larger than the
// default parsed-body limit.
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
};
