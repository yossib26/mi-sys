// Renders the public, read-only page for a single campaign (served at
// /c/:slug both locally and on Vercel). Framework-agnostic: returns an
// HTML string, the caller decides how to send it.

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

// The only markup a campaign description can contain is a link,
// written [text](https://example.com) — or [text](https://example.com|self)
// for one that should open in the same tab instead of a new one — by
// edit.html's "הוסף קישור" toolbar button. The '|self' flag (not
// quotes) is deliberate: escapeHtml below turns '"' into '&quot;',
// which would otherwise mangle a quote-delimited flag before this
// pattern ever gets to match it.
//
// Safety here is by construction, not by stripping tags: the whole
// string is HTML-escaped *first* (so any stray '<'/'>'/'"' someone
// typed is inert), and only afterwards are real <a> tags spliced in —
// built from pieces pulled out of that already-escaped string, using
// a scheme-restricted (http/https only) regex. Nothing else in the
// text is ever treated as HTML.
const DESCRIPTION_LINK_PATTERN = /\[([^[\]]+)\]\((https?:\/\/[^\s()|]+)(\|self)?\)/g;

function renderDescriptionHtml(text) {
  return escapeHtml(text).replace(
    DESCRIPTION_LINK_PATTERN,
    (match, linkText, url, sameWindow) => (sameWindow
      ? `<a href="${url}">${linkText}</a>`
      : `<a href="${url}" target="_blank" rel="noopener noreferrer">${linkText}</a>`)
  );
}

// Renders one of a campaign's dynamic form fields (see campaign_fields
// in db/schema.sql). data-field-id/-type are read back by the page's
// own <script> on submit to build the custom_fields payload.
// One gift card in a 'simple_choice' campaign's "בחר מתנה" section.
// data-gift-id is read back by the page's own <script> on click/submit
// to build the gift_id sent alongside the registration.
function renderGiftCard(campaignId, gift) {
  return `
    <div class="gift-card" data-gift-id="${gift.id}">
      ${gift.has_image ? `<img src="/api/campaigns/${campaignId}/gifts/${gift.id}/image" alt="" />` : ''}
      <div class="gift-name">${escapeHtml(gift.name)}</div>
      ${gift.sku ? `<div class="gift-sku">${escapeHtml(gift.sku)}</div>` : ''}
    </div>`;
}

// Same idea, for a 'product_and_gift' campaign's "איזה מוצר רכשת"
// section — a separate, independent pick from the gift above (no
// filtering between the two lists). data-product-id is read back on
// click/submit to build the product_id sent alongside the registration.
function renderProductCard(campaignId, product) {
  return `
    <div class="product-card" data-product-id="${product.id}">
      ${product.has_image ? `<img src="/api/campaigns/${campaignId}/products/${product.id}/image" alt="" />` : ''}
      <div class="gift-name">${escapeHtml(product.name)}</div>
      ${product.sku ? `<div class="gift-sku">${escapeHtml(product.sku)}</div>` : ''}
    </div>`;
}

function renderDynamicField(field) {
  const fid = `cf_${field.id}`;
  const required = field.required ? 'required' : '';

  if (field.type === 'checkbox') {
    return `
      <label class="checkbox">
        <input type="checkbox" id="${fid}" data-field-id="${field.id}" data-field-type="checkbox" ${required} />
        ${escapeHtml(field.label)}
      </label>`;
  }

  if (field.type === 'select') {
    const values = (field.options && field.options.values) || [];
    return `
      <div class="field">
        <label for="${fid}">${escapeHtml(field.label)}</label>
        <select id="${fid}" data-field-id="${field.id}" data-field-type="select" ${required}>
          <option value="">בחר/י…</option>
          ${values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}
        </select>
      </div>`;
  }

  if (field.type === 'email') {
    return `
      <div class="field">
        <label for="${fid}">${escapeHtml(field.label)}</label>
        <input type="email" id="${fid}" data-field-id="${field.id}" data-field-type="email" ${required} />
      </div>`;
  }

  if (field.type === 'phone') {
    return `
      <div class="field">
        <label for="${fid}">${escapeHtml(field.label)}</label>
        <input type="tel" id="${fid}" data-field-id="${field.id}" data-field-type="phone"
          pattern="[\\d\\s+\\-()]{7,20}" inputmode="tel" ${required} />
      </div>`;
  }

  if (field.type === 'date') {
    return `
      <div class="field">
        <label for="${fid}">${escapeHtml(field.label)}</label>
        <input type="text" id="${fid}" data-field-id="${field.id}" data-field-type="date"
          placeholder="dd/mm/yy" pattern="[0-3]\\d/[01]\\d/\\d{2}" inputmode="numeric" ${required} />
      </div>`;
  }

  if (field.type === 'file') {
    return `
      <div class="field">
        <label for="${fid}">${escapeHtml(field.label)} (עד 1MB)</label>
        <input type="file" id="${fid}" data-field-id="${field.id}" data-field-type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp,image/gif" ${required} />
      </div>`;
  }

  // text
  const maxLength = (field.options && field.options.max_length) || 200;
  return `
    <div class="field">
      <label for="${fid}">${escapeHtml(field.label)}</label>
      <input type="text" id="${fid}" data-field-id="${field.id}" data-field-type="text" maxlength="${maxLength}" ${required} />
    </div>`;
}

function renderNotFoundPage() {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>קמפיין לא נמצא</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #fbfbfc; color: #2c2e33; display: flex; align-items: center; justify-content: center;
    min-height: 100vh; margin: 0; padding: 24px;
  }
  main { text-align: center; max-width: 320px; }
  svg { margin: 0 0 8px; }
  h1 { font-size: 2.4rem; font-weight: 700; margin: 4px 0; letter-spacing: -0.02em; }
  p { color: #9a9ea8; margin: 6px 0 0; line-height: 1.5; }
  a { color: #4361ee; text-decoration: none; font-size: 0.9rem; }
</style>
</head>
<body>
<main>
  <svg width="160" height="160" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <line x1="100" y1="18" x2="100" y2="36" stroke="#c7cad1" stroke-width="4" stroke-linecap="round"/>
    <circle cx="100" cy="14" r="7" fill="#4361ee"/>
    <rect x="54" y="36" width="92" height="72" rx="20" fill="#eef1fe" stroke="#4361ee" stroke-width="4"/>
    <circle cx="82" cy="71" r="7" fill="#2c2e33"/>
    <path d="M107 65 L125 79 M125 65 L107 79" stroke="#e0455a" stroke-width="4" stroke-linecap="round"/>
    <path d="M80 95 Q100 87 120 95" stroke="#2c2e33" stroke-width="4" fill="none" stroke-linecap="round"/>
    <rect x="64" y="116" width="72" height="56" rx="14" fill="#ffffff" stroke="#e6e7eb" stroke-width="4"/>
    <circle cx="100" cy="144" r="14" fill="#fbfbfc" stroke="#e6e7eb" stroke-width="3"/>
    <path d="M100 137v14M93 144h14" stroke="#c7cad1" stroke-width="3" stroke-linecap="round"/>
    <line x1="64" y1="134" x2="40" y2="150" stroke="#c7cad1" stroke-width="6" stroke-linecap="round"/>
    <line x1="136" y1="134" x2="160" y2="150" stroke="#c7cad1" stroke-width="6" stroke-linecap="round"/>
    <circle cx="38" cy="153" r="8" fill="#c7cad1"/>
    <circle cx="162" cy="153" r="8" fill="#c7cad1"/>
  </svg>
  <h1>404</h1>
  <p>הקמפיין המבוקש לא נמצא, או שנמחק.</p>
  <p><a href="/">← חזרה לדף הבית</a></p>
</main>
</body>
</html>`;
}

function renderCampaignPage(campaign) {
  const t = TEMPLATES[campaign.template] || TEMPLATES.classic;

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
  .banner { display: block; width: ${t.cardBorder ? 'calc(100% + 64px)' : '100%'}; margin: ${t.cardBorder ? '-28px -32px 22px' : '0 0 24px'}; max-height: 150px; object-fit: cover; border-radius: ${t.cardBorder ? '0' : t.radius}; }
  h1 { margin: 0 0 16px; font-size: 1.7rem; font-weight: ${t.headingWeight}; letter-spacing: ${t.headingWeight >= 700 ? '-0.01em' : 'normal'}; }
  p.description { line-height: 1.6; margin: 0 0 22px; }
  p.description a { color: var(--accent); text-decoration: underline; }
  h2 { font-size: 1.05rem; margin: 24px 0 14px; padding-top: 20px; border-top: 1px solid ${t.cardBorder ? 'var(--border)' : '#e6e7eb'}; font-weight: ${Math.min(t.headingWeight, 700)}; }
  .gift-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; margin-bottom: 20px; }
  .gift-card, .product-card {
    border: 2px solid ${t.cardBorder ? 'var(--border)' : '#e6e7eb'}; border-radius: 10px; padding: 10px;
    cursor: pointer; text-align: center; background: ${t.cardBorder ? 'var(--bg)' : '#fafafa'}; transition: border-color 0.15s ease;
  }
  .gift-card:hover, .product-card:hover { border-color: var(--muted); }
  .gift-card.selected, .product-card.selected { border-color: var(--accent); }
  .gift-card img, .product-card img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; margin-bottom: 6px; }
  .gift-card .gift-name, .product-card .gift-name { font-size: 0.85rem; font-weight: 600; }
  .gift-card .gift-sku, .product-card .gift-sku { font-size: 0.72rem; color: var(--muted); }
  .gift-grid-empty { grid-column: 1 / -1; color: var(--muted); font-style: italic; font-size: 0.85rem; margin: 0; }
  .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .field label { font-size: 0.85rem; color: var(--muted); }
  input, select {
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
    <h1>${escapeHtml(campaign.name)}</h1>
    ${campaign.description ? `<p class="description">${renderDescriptionHtml(campaign.description)}</p>` : ''}

    ${(campaign.gift_mode === 'product_and_gift' || campaign.gift_mode === 'product_then_gift') && campaign.products && campaign.products.length ? `
      <h2>איזה מוצר רכשת?</h2>
      <p class="form-msg" id="productMsg"></p>
      <div class="gift-grid" id="productGrid">
        ${campaign.products.map((p) => renderProductCard(campaign.id, p)).join('')}
      </div>
    ` : ''}

    ${campaign.gift_mode === 'product_then_gift' ? `
      <h2>בחר מתנה</h2>
      <p class="form-msg" id="giftMsg"></p>
      <div class="gift-grid" id="giftGrid">
        <p class="gift-grid-empty">בחר קודם מוצר כדי לראות את המתנות הזמינות עבורו.</p>
      </div>
    ` : (campaign.gift_mode === 'simple_choice' || campaign.gift_mode === 'product_and_gift') && campaign.gifts && campaign.gifts.length ? `
      <h2>בחר מתנה</h2>
      <p class="form-msg" id="giftMsg"></p>
      <div class="gift-grid" id="giftGrid">
        ${campaign.gifts.map((g) => renderGiftCard(campaign.id, g)).join('')}
      </div>
    ` : ''}

    <h2>הרשמה למבצע</h2>
    <form id="regForm" novalidate>
      ${(campaign.fields || []).map(renderDynamicField).join('')}
      <button type="submit">שליחה</button>
      <p class="form-msg" id="regMsg"></p>
    </form>
  </div>
</main>
<script>
  // Fires once, on the visitor's first interaction with any form field.
  let formStartSent = false;
  document.getElementById('regForm').addEventListener('input', () => {
    if (formStartSent) return;
    formStartSent = true;
    fetch(${JSON.stringify(`/api/campaigns/${campaign.id}/form-start`)}, { method: 'POST' }).catch(() => {});
  }, { once: true });

  function readFileAsDataUri(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('קריאת הקובץ נכשלה'));
      reader.readAsDataURL(file);
    });
  }

  // Gathers every dynamic field's current value into { fieldId: value },
  // keyed by the data-field-id the server-rendered markup carries. A
  // 'file' field's value is { file: dataUri, filename } — validated
  // against the same 1MB cap the server enforces, so an oversized
  // upload is rejected before it's even read into memory.
  async function collectCustomFields() {
    const result = {};
    for (const el of document.querySelectorAll('[data-field-id]')) {
      const fieldId = el.getAttribute('data-field-id');
      const type = el.getAttribute('data-field-type');
      if (type === 'checkbox') {
        result[fieldId] = el.checked;
      } else if (type === 'file') {
        const file = el.files[0];
        if (!file) continue;
        if (file.size > 1024 * 1024) {
          throw new Error('הקובץ שהועלה גדול מדי (מקסימום 1MB)');
        }
        result[fieldId] = { file: await readFileAsDataUri(file), filename: file.name };
      } else {
        result[fieldId] = el.value.trim();
      }
    }
    return result;
  }

  // Gift/product selection (present for the three gift-choice modes)
  // lives outside <form id="regForm"> — the grids sit above it in the
  // page — so each pick is tracked here and read at submit time
  // instead. In 'product_and_gift' the two picks are unrelated; in
  // 'product_then_gift' picking a product rebuilds the gift grid to
  // only the gifts assigned to it (GIFTS_DATA carries every gift's
  // product_id for that — server-rendered once, filtered client-side
  // so switching products never needs another request).
  const GIFT_MODE = ${JSON.stringify(campaign.gift_mode || 'none')};
  const CAMPAIGN_ID = ${JSON.stringify(campaign.id)};
  const GIFTS_DATA = ${JSON.stringify((campaign.gifts || []).map((g) => (
    { id: g.id, name: g.name, sku: g.sku, has_image: g.has_image, product_id: g.product_id }
  )))};

  function escapeHtmlClient(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function buildGiftCardHtml(gift) {
    const img = gift.has_image
      ? '<img src="/api/campaigns/' + CAMPAIGN_ID + '/gifts/' + gift.id + '/image" alt="" />'
      : '';
    const sku = gift.sku ? '<div class="gift-sku">' + escapeHtmlClient(gift.sku) + '</div>' : '';
    return '<div class="gift-card" data-gift-id="' + gift.id + '">' + img
      + '<div class="gift-name">' + escapeHtmlClient(gift.name) + '</div>' + sku + '</div>';
  }

  function wireGiftCardClicks() {
    document.querySelectorAll('.gift-card').forEach((card) => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.gift-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedGiftId = card.getAttribute('data-gift-id');
      });
    });
  }

  // Only used in 'product_then_gift' — rebuilds #giftGrid from
  // GIFTS_DATA filtered to the chosen product, and re-wires clicks on
  // the freshly rendered cards (innerHTML replacement drops old
  // listeners).
  function renderGiftGridForProduct(productId) {
    const giftGrid = document.getElementById('giftGrid');
    if (!giftGrid) return;
    selectedGiftId = null;
    const matching = GIFTS_DATA.filter((g) => String(g.product_id) === String(productId));
    giftGrid.innerHTML = matching.length
      ? matching.map(buildGiftCardHtml).join('')
      : '<p class="gift-grid-empty">אין מתנות זמינות למוצר הזה.</p>';
    wireGiftCardClicks();
  }

  let selectedGiftId = null;
  wireGiftCardClicks();

  let selectedProductId = null;
  document.querySelectorAll('.product-card').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.product-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedProductId = card.getAttribute('data-product-id');
      if (GIFT_MODE === 'product_then_gift') renderGiftGridForProduct(selectedProductId);
    });
  });

  // Shows a validation message right above the section it concerns
  // (#productMsg / #giftMsg sit right under that section's <h2>, not
  // down by the submit button) and scrolls it into view — so a
  // visitor who clicked "שליחה" from wherever they were on a long page
  // immediately sees both *what's* wrong and *where*.
  function showSectionMsg(elId, text) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = text;
    el.className = 'form-msg error';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function clearSectionMsg(elId) {
    const el = document.getElementById(elId);
    if (el) { el.textContent = ''; el.className = 'form-msg'; }
  }

  document.getElementById('regForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('regMsg');
    msgEl.textContent = '';
    msgEl.className = 'form-msg';
    clearSectionMsg('productMsg');
    clearSectionMsg('giftMsg');

    // Checked in the same top-to-bottom order the sections appear on
    // the page — "בחר מוצר" sits above "בחר מתנה" for the modes that
    // have both — then the rest of the form, last.
    if (document.querySelectorAll('.product-card').length && !selectedProductId) {
      showSectionMsg('productMsg', 'נא לבחור מוצר');
      return;
    }
    if (document.querySelectorAll('.gift-card').length && !selectedGiftId) {
      showSectionMsg('giftMsg', 'נא לבחור מתנה');
      return;
    }
    // Product/gift picks are checked above, before anything else. Only
    // once both pass does the rest of the form get its native
    // required-field validation — the <form novalidate> above stops
    // the browser from doing that automatically (and earlier) on its
    // own the moment "שליחה" is clicked.
    if (!e.target.reportValidity()) return;
    try {
      const customFields = await collectCustomFields();
      const res = await fetch(${JSON.stringify(`/api/campaigns/${campaign.id}/registrations`)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_fields: customFields, gift_id: selectedGiftId, product_id: selectedProductId }),
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
