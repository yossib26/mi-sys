const pool = require('../lib/db');
const handlers = require('../lib/handlers');
const { respond, handleError } = require('../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') return respond(res, await handlers.getStatus(pool));
    res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
  } catch (error) {
    handleError(res, error);
  }
};
