// Renders the public, read-only page for a single campaign (served at
// /c/:slug both locally and on Vercel). Framework-agnostic: returns an
// HTML string, the caller decides how to send it.

const STATUS_LABELS = {
  draft: 'טיוטה',
  active: 'פעיל',
  paused: 'מושהה',
  completed: 'הושלם',
  cancelled: 'בוטל',
  archived: 'בארכיון',
};

// Three fixed visual templates, picked per campaign from the edit
// page (edit.html) and stored in campaigns.template. 'classic' is
// the default. Keep this in sync with lib/handlers.js's
// CAMPAIGN_TEMPLATES whitelist.
const TEMPLATES = {
  classic: {
    label: 'קלאסי',
    bg: '#fbfbfc', card: '#ffffff', border: '#e6e7eb', text: '#2c2e33',
    muted: '#9a9ea8', accent: '#4361ee', accentText: '#ffffff',
    radius: '16px', cardBorder: true, headingWeight: 700, badgeStyle: 'pill',
    swatch: ['#fbfbfc', '#4361ee', '#ffffff'],
  },
  bold: {
    label: 'נועז',
    bg: '#131319', card: '#1c1d25', border: '#2d2f3a', text: '#f5f6f8',
    muted: '#9599a8', accent: '#ff5d5d', accentText: '#ffffff',
    radius: '22px', cardBorder: true, headingWeight: 800, badgeStyle: 'pill',
    swatch: ['#131319', '#ff5d5d', '#1c1d25'],
  },
  minimal: {
    label: 'מינימלי',
    bg: '#ffffff', card: '#ffffff', border: '#ffffff', text: '#111114',
    muted: '#767a85', accent: '#111114', accentText: '#ffffff',
    radius: '0px', cardBorder: false, headingWeight: 500, badgeStyle: 'outline',
    swatch: ['#ffffff', '#111114', '#e6e7eb'],
  },
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
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #fbfbfc; color: #2c2e33; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
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
  const t = TEMPLATES[campaign.template] || TEMPLATES.classic;
  const budget = formatBudget(campaign.budget);
  const badgeMarkup = t.badgeStyle === 'outline'
    ? `<span class="badge badge-outline">${STATUS_LABELS[campaign.status] || campaign.status}</span>`
    : `<span class="badge badge-${campaign.status}">${STATUS_LABELS[campaign.status] || campaign.status}</span>`;

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(campaign.name)} · ${escapeHtml(campaign.brand_name)}</title>
<style>
  :root {
    --bg: ${t.bg}; --card: ${t.card}; --border: ${t.border}; --text: ${t.text};
    --muted: ${t.muted}; --accent: ${t.accent}; --accent-text: ${t.accentText};
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
  main { max-width: 640px; margin: 40px auto; }
  .card {
    background: var(--card);
    ${t.cardBorder ? 'border: 1px solid var(--border);' : 'border: none;'}
    border-radius: ${t.radius};
    padding: ${t.cardBorder ? '28px 32px' : '0'};
    overflow: hidden;
  }
  .banner { display: block; width: ${t.cardBorder ? 'calc(100% + 64px)' : '100%'}; margin: ${t.cardBorder ? '-28px -32px 22px' : '0 0 24px'}; max-height: 320px; object-fit: cover; border-radius: ${t.cardBorder ? '0' : t.radius}; }
  .brand { color: var(--accent); font-weight: 600; font-size: 0.95rem; margin: 0 0 6px; }
  h1 { margin: 0 0 16px; font-size: 1.7rem; font-weight: ${t.headingWeight}; letter-spacing: ${t.headingWeight >= 700 ? '-0.01em' : 'normal'}; }
  .badge { display: inline-block; padding: 3px 11px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; margin-bottom: 18px; }
  .badge-draft { background: #f1f2f4; color: #6b7280; } .badge-active { background: #e6f7ee; color: #1a8f52; } .badge-paused { background: #fdf3df; color: #b3760f; }
  .badge-completed { background: #eaf0ff; color: #3151d3; } .badge-cancelled { background: #fdeef0; color: #c72e42; } .badge-archived { background: #f1f2f4; color: #6b7280; }
  .badge-outline { background: transparent; border: 1px solid var(--text); color: var(--text); }
  p.description { line-height: 1.6; margin: 0 0 22px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; margin: 0 0 24px; }
  dt { color: var(--muted); font-size: 0.85rem; }
  dd { margin: 0; font-weight: 600; }
  h2 { font-size: 1.05rem; margin: 24px 0 14px; padding-top: 20px; border-top: 1px solid ${t.cardBorder ? 'var(--border)' : '#e6e7eb'}; font-weight: ${Math.min(t.headingWeight, 700)}; }
  .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .field label { font-size: 0.85rem; color: var(--muted); }
  input {
    font: inherit; padding: 9px 10px; border: 1px solid ${t.cardBorder ? 'var(--border)' : '#dcdde2'};
    border-radius: 6px; background: ${t.cardBorder ? 'var(--bg)' : '#fafafa'}; color: var(--text); width: 100%;
  }
  label.checkbox { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; cursor: pointer; margin-bottom: 16px; }
  label.checkbox input { width: auto; }
  button {
    font: inherit; font-weight: 600; padding: 10px 20px; border: none; border-radius: 8px;
    background: var(--accent); color: var(--accent-text); cursor: pointer;
  }
  button:hover { filter: brightness(1.08); }
  .form-msg { font-size: 0.88rem; margin-top: 12px; min-height: 1.1em; }
  .form-msg.error { color: #d64545; }
  .form-msg.success { color: #2e9e5b; }
</style>
</head>
<body>
<main>
  <div class="card">
    ${campaign.has_banner ? `<img class="banner" src="/api/campaigns/${campaign.id}/banner" alt="" />` : ''}
    <p class="brand">${escapeHtml(campaign.brand_name)}</p>
    <h1>${escapeHtml(campaign.name)}</h1>
    ${badgeMarkup}
    ${campaign.description ? `<p class="description">${escapeHtml(campaign.description)}</p>` : ''}
    <dl>
      ${budget !== null ? `<dt>תקציב</dt><dd>₪${budget}</dd>` : ''}
      ${campaign.start_date ? `<dt>תאריך התחלה</dt><dd>${escapeHtml(campaign.start_date)}</dd>` : ''}
      ${campaign.end_date ? `<dt>תאריך סיום</dt><dd>${escapeHtml(campaign.end_date)}</dd>` : ''}
    </dl>

    <h2>הרשמה למבצע</h2>
    <form id="regForm">
      <div class="field">
        <label for="firstName">שם פרטי</label>
        <input id="firstName" required />
      </div>
      <div class="field">
        <label for="lastName">שם משפחה</label>
        <input id="lastName" required />
      </div>
      <div class="field">
        <label for="email">אימייל</label>
        <input id="email" type="email" />
      </div>
      <div class="field">
        <label for="invoice">חשבונית קנייה</label>
        <input id="invoice" type="file" accept="application/pdf,image/png,image/jpeg" required />
      </div>
      <label class="checkbox">
        <input type="checkbox" id="marketingConsent" />
        אני מאשר/ת קבלת חומר פרסומי
      </label>
      <button type="submit">שליחה</button>
      <p class="form-msg" id="regMsg"></p>
    </form>
  </div>
</main>
<script>
  document.getElementById('regForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('regMsg');
    const file = document.getElementById('invoice').files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      msgEl.textContent = 'הקובץ גדול מדי (מקסימום 3MB)';
      msgEl.className = 'form-msg error';
      return;
    }
    try {
      const invoiceDataUri = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('קריאת הקובץ נכשלה'));
        reader.readAsDataURL(file);
      });
      const res = await fetch(${JSON.stringify(`/api/campaigns/${campaign.id}/registrations`)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: document.getElementById('firstName').value.trim(),
          last_name: document.getElementById('lastName').value.trim(),
          email: document.getElementById('email').value.trim(),
          marketing_consent: document.getElementById('marketingConsent').checked,
          invoice: invoiceDataUri,
          invoice_filename: file.name,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || 'שגיאה בשליחה');
      document.getElementById('regForm').outerHTML = '<p class="form-msg success">תודה! ההרשמה נקלטה בהצלחה.</p>';
    } catch (error) {
      msgEl.textContent = error.message;
      msgEl.className = 'form-msg error';
    }
  });
</script>
</body>
</html>`;
}

module.exports = { renderCampaignPage, renderNotFoundPage, TEMPLATES };
