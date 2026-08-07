const pool = require('../../lib/db');
const users = require('../../lib/users');
const auth = require('../../lib/auth');
const { respond, handleError } = require('../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    const currentUser = auth.requireAdmin(req);
    const { id } = req.query;
    if (req.method === 'PUT') return respond(res, await users.updateUser(pool, id, req.body));
    if (req.method === 'DELETE') return respond(res, await users.deleteUser(pool, id, currentUser.id));
    res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
  } catch (error) {
    handleError(res, error);
  }
};
