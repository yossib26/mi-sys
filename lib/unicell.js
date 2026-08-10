// Thin client for Unicell (יוניסל), the SMS provider used to deliver
// the public registration form's one-time-password codes. Same shape
// and spirit as lib/activetrail.js: a single outbound call, isolated
// here so nothing else in the app knows the provider exists.
//
// This deliberately does NOT use any OTP-specific product Unicell may
// offer. The code is generated, hashed, throttled, expired and
// verified entirely by us (see sendRegistrationOtp /
// verifyRegistrationOtp in lib/handlers.js) — Unicell's only job is
// delivering a text message. That keeps every security-relevant
// decision on our side and makes the provider swappable: replacing
// this file is the whole migration to a different SMS vendor.
//
// Unlike ActiveTrail's per-campaign token, the credentials here are
// server-wide (one SMS account for the whole system), so they come
// from the environment and never touch the database or the admin UI:
//
//   UNICELL_API_URL   full URL of the send-message endpoint
//   UNICELL_USER      account user name
//   UNICELL_PASSWORD  account password
//   UNICELL_SENDER    sender id shown on the recipient's handset
//
// ---------------------------------------------------------------
// !! THE REQUEST SHAPE IN buildRequest() BELOW IS NOT YET CONFIRMED !!
// Unicell publishes its API only to account holders, so the exact
// endpoint, authentication style and body format still have to be
// filled in from their documentation. Everything else in the OTP
// feature is finished and testable; this one function is the single
// place that needs editing to make real messages go out. Until
// UNICELL_API_URL is set, isConfigured() returns false and the OTP
// handlers refuse to start a challenge with a clear error rather than
// pretending a code was sent.
// ---------------------------------------------------------------

function isConfigured() {
  return !!(process.env.UNICELL_API_URL && process.env.UNICELL_USER && process.env.UNICELL_PASSWORD);
}

// Israeli local numbers ('05...') are normalised to E.164 ('+9725...'),
// which is what an SMS gateway expects; anything already in
// international form is left alone. Formatting characters the phone
// field allows (spaces, hyphens, parens) are stripped either way.
function normalizePhone(phone) {
  const raw = String(phone || '').replace(/[\s\-()]/g, '');
  if (raw.startsWith('+')) return raw;
  if (raw.startsWith('00')) return `+${raw.slice(2)}`;
  if (raw.startsWith('0')) return `+972${raw.slice(1)}`;
  return `+${raw}`;
}

// The one provider-specific piece: turns "send this text to this
// number" into the actual HTTP request Unicell expects. Returns
// { url, options } for fetch(). Replace the body/auth here with what
// their docs specify — nothing outside this function assumes anything
// about the format.
function buildRequest(phone, text) {
  return {
    url: process.env.UNICELL_API_URL,
    options: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        user: process.env.UNICELL_USER,
        password: process.env.UNICELL_PASSWORD,
        sender: process.env.UNICELL_SENDER || 'OTP',
        recipient: phone,
        message: text,
      }),
    },
  };
}

// Throws on any non-2xx response so the caller can tell "the message
// went out" from "it didn't" — sendRegistrationOtp turns that into a
// visible error rather than leaving a visitor waiting for a code that
// was never sent.
async function sendSms(phone, text) {
  if (!isConfigured()) {
    throw Object.assign(new Error('שירות ה-SMS אינו מוגדר בשרת'), { statusCode: 503 });
  }
  const { url, options } = buildRequest(normalizePhone(phone), text);
  const res = await fetch(url, options);
  const body = await res.text();
  if (!res.ok) {
    throw Object.assign(
      new Error(`Unicell API error (${res.status}): ${body.slice(0, 200)}`),
      { statusCode: 502 }
    );
  }
  return body;
}

module.exports = { sendSms, isConfigured, normalizePhone };
