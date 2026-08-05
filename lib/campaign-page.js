// Renders the public, read-only page for a single campaign (served at
// /c/:slug both locally and on Vercel). Framework-agnostic: returns an
// HTML string, the caller decides how to send it.

const STATUS_LABELS = {
  draft: 'טיוטה',
  active: 'פעיל',
  paused: 'מושהה',
  completed: 'הושלם',
  cancelled: 'בוטל',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatBudget(value) {
  if (value === null || value === undefined) return null;
  return Number(value).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderNotFoundPage() {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>קמפיין לא נמצא</title>
<style>
  body { font-family: Arial, sans-serif; background: #f4f4f6; color: #1f2126; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  main { text-align: center; }
</style>
</head>
<body>
<main>
  <h1>404</h1>
  <p>הקמפיין המבוקש לא נמצא, או שנמחק.</p>
</main>
</body>
</html>`;
}

function renderCampaignPage(campaign) {
  const budget = formatBudget(campaign.budget);
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(campaign.name)} · ${escapeHtml(campaign.brand_name)}</title>
<style>
  :root {
    --bg: #f4f4f6; --card: #ffffff; --border: #e0e0e6; --text: #1f2126;
    --muted: #6b6f7a; --accent: #3355ee;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #16171c; --card: #202228; --border: #34363f; --text: #ecedf0; --muted: #9296a3; --accent: #5b7cfa; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
  main { max-width: 640px; margin: 40px auto; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 28px 32px; overflow: hidden; }
  .banner { display: block; width: calc(100% + 64px); margin: -28px -32px 22px; max-height: 320px; object-fit: cover; }
  .brand { color: var(--accent); font-weight: 600; font-size: 0.95rem; margin: 0 0 6px; }
  h1 { margin: 0 0 16px; font-size: 1.7rem; }
  .badge { display: inline-block; padding: 3px 12px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; color: #fff; margin-bottom: 18px; }
  .badge-draft { background: #8a8f99; } .badge-active { background: #2e9e5b; } .badge-paused { background: #d99a26; }
  .badge-completed { background: #3355ee; } .badge-cancelled { background: #d64545; }
  p.description { line-height: 1.6; margin: 0 0 22px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; margin: 0; }
  dt { color: var(--muted); font-size: 0.85rem; }
  dd { margin: 0; font-weight: 600; }
</style>
</head>
<body>
<main>
  <div class="card">
    ${campaign.has_banner ? `<img class="banner" src="/api/campaigns/${campaign.id}/banner" alt="" />` : ''}
    <p class="brand">${escapeHtml(campaign.brand_name)}</p>
    <h1>${escapeHtml(campaign.name)}</h1>
    <span class="badge badge-${campaign.status}">${STATUS_LABELS[campaign.status] || campaign.status}</span>
    ${campaign.description ? `<p class="description">${escapeHtml(campaign.description)}</p>` : ''}
    <dl>
      ${budget !== null ? `<dt>תקציב</dt><dd>₪${budget}</dd>` : ''}
      ${campaign.start_date ? `<dt>תאריך התחלה</dt><dd>${escapeHtml(campaign.start_date)}</dd>` : ''}
      ${campaign.end_date ? `<dt>תאריך סיום</dt><dd>${escapeHtml(campaign.end_date)}</dd>` : ''}
    </dl>
  </div>
</main>
</body>
</html>`;
}

module.exports = { renderCampaignPage, renderNotFoundPage };
