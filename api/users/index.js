const pool = require('../../lib/db');
const users = require('../../lib/users');
const auth = require('../../lib/auth');
const { respond, handleError } = require('../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    auth.requireAdmin(req);
    if (req.method === 'GET') return respond(res, await users.listUsers(pool));
    if (req.method === 'POST') return respond(res, await users.createUser(pool, req.body));
    res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
  } catch (error) {
    handleError(res, error);
  }
};
