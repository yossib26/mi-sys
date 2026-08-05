const pool = require('../../lib/db');
const users = require('../../lib/users');
const auth = require('../../lib/auth');
const { respond, handleError } = require('../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const currentUser = auth.requireAdmin(req);
    if (req.method === 'DELETE') return respond(res, await users.deleteUser(pool, req.query.id, currentUser.id));
    res.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    handleError(res, error);
  }
};
