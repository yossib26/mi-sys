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
  dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; margin: 0 0 24px; }
  dt { color: var(--muted); font-size: 0.85rem; }
  dd { margin: 0; font-weight: 600; }
  h2 { font-size: 1.05rem; margin: 24px 0 14px; padding-top: 20px; border-top: 1px solid var(--border); }
  .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .field label { font-size: 0.85rem; color: var(--muted); }
  input {
    font: inherit; padding: 9px 10px; border: 1px solid var(--border);
    border-radius: 6px; background: var(--bg); color: var(--text); width: 100%;
  }
  label.checkbox { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; cursor: pointer; margin-bottom: 16px; }
  label.checkbox input { width: auto; }
  button {
    font: inherit; padding: 10px 20px; border: none; border-radius: 6px;
    background: var(--accent); color: #fff; cursor: pointer;
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
    <span class="badge badge-${campaign.status}">${STATUS_LABELS[campaign.status] || campaign.status}</span>
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

module.exports = { renderCampaignPage, renderNotFoundPage };
