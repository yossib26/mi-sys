const auth = require('../../lib/auth');
const { handleError } = require('../../lib/vercel-response');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'method not allowed' });
      return;
    }
    res.status(200).json(auth.requireAuth(req));
  } catch (error) {
    handleError(res, error);
  }
};
