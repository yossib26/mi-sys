const auth = require('../../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  res.setHeader('Set-Cookie', auth.buildLogoutCookie());
  res.status(204).end();
};
