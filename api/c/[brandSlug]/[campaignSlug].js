const pool = require('../../../lib/db');
const handlers = require('../../../lib/handlers');
const { renderCampaignPage, renderNotFoundPage } = require('../../../lib/campaign-page');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  try {
    const { body: campaign } = await handlers.getCampaignBySlug(pool, req.query.brandSlug, req.query.campaignSlug);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(renderCampaignPage(campaign));
  } catch (error) {
    if (error.statusCode !== 404) console.error(error);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(error.statusCode || 500).send(renderNotFoundPage());
  }
};
