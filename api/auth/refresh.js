const auth = require('../../lib/auth');
const { respond, handleError } = require('../../lib/vercel-response');

// Called by the admin pages' idle-activity watchdog (see
// startSessionWatchdog() in index.html/edit.html/users.html/brands.html)
// roughly every 30s while there's been real activity — re-mints the
// session cookie with a fresh 10-minute expiry (see SESSION_TTL_MS in
// lib/auth.js). A stale/expired cookie fails auth here just like any
// other authenticated route, which is exactly the signal the watchdog
// needs to redirect to the login screen.
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
      return;
    }
    const user = auth.requireAuth(req);
    respond(res, { status: 200, body: user, headers: { 'Set-Cookie': auth.buildSessionCookie(user) } });
  } catch (error) {
    handleError(res, error);
  }
};
