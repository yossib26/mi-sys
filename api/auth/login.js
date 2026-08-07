const pool = require('../../lib/db');
const users = require('../../lib/users');
const auth = require('../../lib/auth');
const { respond, handleError } = require('../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
      return;
    }
    const user = await users.login(pool, req.body);
    respond(res, { status: 200, body: user, headers: { 'Set-Cookie': auth.buildSessionCookie(user) } });
  } catch (error) {
    handleError(res, error);
  }
};
