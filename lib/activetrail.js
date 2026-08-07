// Thin client for ActiveTrail's REST API (email marketing platform),
// used to sync campaign registrants into an ActiveTrail contact group.
// Both the API token and the group are configured per campaign (in
// edit.html's "סנכרון ל-ActiveTrail" section, stored on the campaign
// itself) rather than as shared server config — see
// maybeSyncRegistrationToActiveTrail in lib/handlers.js.
//
// Reference: https://webapi.mymarketing.co.il/api/docs/

const BASE_URL = 'https://webapi.mymarketing.co.il/api';

async function request(token, path, options) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // ActiveTrail's auth is the raw token in this header — no
      // "Bearer " prefix.
      Authorization: token,
      ...(options && options.headers),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error body (e.g. an HTML error page) — fall through,
    // the !res.ok branch below still reports the HTTP status.
  }
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `ActiveTrail API error (${res.status})`;
    throw Object.assign(new Error(message), { statusCode: res.status });
  }
  return data;
}

// Adds (or updates) one contact in a group. `customFields` is free-form
// extra data — ActiveTrail matches by field name on their side; a name
// that doesn't exist there is simply ignored, not an error here.
async function addContactToGroup(token, groupId, { email, customFields }) {
  return request(token, `/groups/${encodeURIComponent(groupId)}/members`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      status: 'subscribe',
      customFields: customFields || {},
    }),
  });
}

module.exports = { addContactToGroup };
