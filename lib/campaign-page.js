// Renders the public, read-only page for a single campaign (served at
// /c/:slug both locally and on Vercel). Framework-agnostic: returns an
// HTML string, the caller decides how to send it.

// Fixed visual templates, picked per campaign from the edit page
// (edit.html) and stored in campaigns.template. 'classic' is the
// default. Keep this in sync with lib/handlers.js's CAMPAIGN_TEMPLATES
// whitelist. ('bold' and 'minimal' were removed as selectable options
// — see the campaigns_template_check migration in db/schema.sql,
// which reassigns any campaign still using either to 'classic'.)
//
// Optional per-template typographic overrides (h1Size/h1Tracking/
// h2Size/h2Weight/h2Transform/h2Tracking/bodySize/labelSize/
// smallSize) let a template refine its own font scale beyond just
// weight — see renderCampaignPage's <style> block, which falls back to
// classic's original sizing wherever a template doesn't set one.
const TEMPLATES = {
  classic: {
    label: 'קלאסי',
    bg: '#fbfbfc', card: '#ffffff', border: '#e6e7eb', text: '#2c2e33',
    muted: '#9a9ea8', accent: '#4361ee', accentText: '#ffffff',
    radius: '16px', cardBorder: true, headingWeight: 700, badgeStyle: 'pill',
    swatch: ['#fbfbfc', '#4361ee', '#ffffff'],
  },
  // A restrained, "professional dashboard" dark theme: a near-black
  // slate background (not pure black — easier on the eyes and lets
  // the card read as an actual elevated surface), a single restrained
  // blue accent instead of a saturated one, a moderate radius, and a
  // tighter, smaller-caps section-heading style more typical of a
  // polished SaaS dark mode than of a marketing page.
  dark: {
    label: 'כהה מקצועי',
    bg: '#0d0f14', card: '#171a21', border: '#262b36', text: '#e7e9ee',
    muted: '#8a92a3', accent: '#5b8cff', accentText: '#ffffff',
    radius: '10px', cardBorder: true, headingWeight: 600, badgeStyle: 'pill',
    h1Size: '1.5rem', h1Tracking: '-0.015em',
    h2Size: '0.78rem', h2Weight: 700, h2Transform: 'uppercase', h2Tracking: '0.07em',
    bodySize: '0.95rem', labelSize: '0.82rem', smallSize: '0.72rem',
    swatch: ['#0d0f14', '#5b8cff', '#171a21'],
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
const LINK_MARKUP_PATTERN = /\[([^[\]]+)\]\((https?:\/\/[^\s()|]+)(\|self)?\)/g;

// Shared by the description (renderDescriptionHtml below) and a
// checkbox field's label (e.g. the fixed terms-agreement field) —
// same escape-first-then-splice-links markup, an optional CSS class
// lets the link render differently per call site (the terms-agreement
// link is bold+underlined via .field-label-link, description links
// aren't).
function renderTextWithLinks(text, linkClass) {
  const cls = linkClass ? ` class="${linkClass}"` : '';
  return escapeHtml(text).replace(
    LINK_MARKUP_PATTERN,
    (match, linkText, url, sameWindow) => (sameWindow
      ? `<a href="${url}"${cls}>${linkText}</a>`
      : `<a href="${url}" target="_blank" rel="noopener noreferrer"${cls}>${linkText}</a>`)
  );
}

function renderDescriptionHtml(text) {
  return renderTextWithLinks(text);
}

// Renders one of a campaign's dynamic form fields (see campaign_fields
// in db/schema.sql). data-field-id/-type are read back by the page's
// own <script> on submit to build the custom_fields payload.
// One gift card in a 'simple_choice' campaign's "בחר מתנה" section.
// data-gift-id is read back by the page's own <script> on click/submit
// to build the gift_id sent alongside the registration.
function renderGiftCard(campaignId, gift) {
  // stock === 0 specifically (not null/undefined, which mean
  // unlimited/untracked) — pointer-events:none on .gift-card-disabled
  // (see its CSS rule) is what actually blocks selecting it; the real
  // enforcement either way is server-side, in claimGiftStock.
  const outOfStock = gift.stock === 0;
  return `
    <div class="gift-card${outOfStock ? ' gift-card-disabled' : ''}" data-gift-id="${gift.id}">
      ${gift.has_image ? `<img src="/api/campaigns/${campaignId}/gifts/${gift.id}/image" alt="" />` : ''}
      <div class="gift-name">${escapeHtml(gift.name)}</div>
      ${gift.sku ? `<div class="gift-sku">${escapeHtml(gift.sku)}</div>` : ''}
      ${outOfStock ? '<div class="gift-out-of-stock">אזל המלאי</div>' : ''}
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

// One network icon in the "בחר רשת" grid — same card shape as a gift/
// product, showing its logo if it has one. A dedicated "+" card
// (networkCustomCard, rendered separately below) sits alongside these
// for a visitor whose network isn't in the campaign's own list.
function renderNetworkCard(network) {
  return `
    <div class="gift-card" data-network-id="${network.id}">
      ${network.has_logo ? `<img src="/api/networks/${network.id}/logo" alt="" />` : ''}
      <div class="gift-name">${escapeHtml(network.name)}</div>
    </div>`;
}

function renderDynamicField(field) {
  const fid = `cf_${field.id}`;
  const required = field.required ? 'required' : '';

  if (field.type === 'checkbox') {
    return `
      <label class="checkbox">
        <input type="checkbox" id="${fid}" data-field-id="${field.id}" data-field-type="checkbox" ${required} />
        <span>${renderTextWithLinks(field.label, 'field-label-link')}</span>
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
  h1 { margin: 0 0 16px; font-size: ${t.h1Size || '1.7rem'}; font-weight: ${t.headingWeight}; letter-spacing: ${t.h1Tracking || (t.headingWeight >= 700 ? '-0.01em' : 'normal')}; }
  p.description { line-height: 1.6; margin: 0 0 22px; font-size: ${t.bodySize || '1rem'}; }
  p.description a { color: var(--accent); text-decoration: underline; }
  h2 {
    font-size: ${t.h2Size || '1.05rem'}; margin: 24px 0 14px; padding-top: 20px;
    border-top: 1px solid ${t.cardBorder ? 'var(--border)' : '#e6e7eb'};
    font-weight: ${t.h2Weight || Math.min(t.headingWeight, 700)};
    text-transform: ${t.h2Transform || 'none'}; letter-spacing: ${t.h2Tracking || 'normal'};
  }
  .gift-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; margin-bottom: 20px; }
  .gift-card, .product-card {
    border: 2px solid ${t.cardBorder ? 'var(--border)' : '#e6e7eb'}; border-radius: 10px; padding: 10px;
    cursor: pointer; text-align: center; background: ${t.cardBorder ? 'var(--bg)' : '#fafafa'}; transition: border-color 0.15s ease;
  }
  .gift-card:hover, .product-card:hover { border-color: var(--muted); }
  .gift-card.selected, .product-card.selected { border-color: var(--accent); }
  .gift-card-disabled { cursor: not-allowed; opacity: 0.55; pointer-events: none; }
  .gift-out-of-stock { font-size: ${t.smallSize || '0.72rem'}; font-weight: 700; color: #c0392b; margin-top: 4px; }
  .gift-card img, .product-card img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; margin-bottom: 6px; }
  .gift-card .gift-name, .product-card .gift-name { font-size: ${t.labelSize || '0.85rem'}; font-weight: 600; }
  .gift-card .gift-sku, .product-card .gift-sku { font-size: ${t.smallSize || '0.72rem'}; color: var(--muted); }
  .gift-grid-empty { grid-column: 1 / -1; color: var(--muted); font-style: italic; font-size: ${t.labelSize || '0.85rem'}; margin: 0; }
  .network-custom-card { display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .network-custom-icon { font-size: 1.6rem; line-height: 1; color: var(--muted); margin-bottom: 6px; }
  .network-custom-card.selected .network-custom-icon { color: var(--accent); }
  .network-custom-input { margin-top: 10px; }
  .network-custom-input[hidden] { display: none; }
  .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .field label { font-size: ${t.labelSize || '0.85rem'}; color: var(--muted); }
  input, select {
    font: inherit; font-size: ${t.bodySize || '1rem'}; padding: 9px 10px; border: 1px solid ${t.cardBorder ? 'var(--border)' : '#dcdde2'};
    border-radius: 6px; background: ${t.cardBorder ? 'var(--bg)' : '#fafafa'}; color: var(--text); width: 100%;
  }
  label.checkbox { display: flex; align-items: center; gap: 8px; font-size: ${t.bodySize || '0.9rem'}; cursor: pointer; margin-bottom: 16px; }
  label.checkbox input { width: auto; }
  .field-label-link { font-weight: 700; text-decoration: underline; color: inherit; }
  button {
    font: inherit; font-size: ${t.bodySize || '1rem'}; font-weight: 600; padding: 10px 20px; border: none; border-radius: 8px;
    background: var(--accent); color: var(--accent-text); cursor: pointer;
  }
  button:hover { filter: brightness(1.08); }
  .form-msg { font-size: ${t.labelSize || '0.88rem'}; margin-top: 12px; min-height: 1.1em; }
  .form-msg.error { color: #d64545; }
  .form-msg.success { color: #2e9e5b; }
  .page-footer { max-width: 640px; margin: 22px auto 0; display: flex; align-items: flex-start; gap: 14px; }
  .page-footer img { width: 60px; height: 60px; object-fit: contain; border-radius: 8px; flex: none; }
  .page-footer p { margin: 0; font-size: ${t.smallSize || '0.75rem'}; line-height: 1.55; color: var(--muted); }
</style>
</head>
<body>
<main>
  <div class="card">
    ${campaign.has_banner ? `<img class="banner" src="/api/campaigns/${campaign.id}/banner?v=${new Date(campaign.updated_at).getTime()}" alt="" />` : ''}
    <h1>${escapeHtml(campaign.name)}</h1>
    ${campaign.description ? `<p class="description">${renderDescriptionHtml(campaign.description)}</p>` : ''}

    ${campaign.networks && campaign.networks.length ? `
      <h2>${escapeHtml(campaign.networks_section_title)}</h2>
      <div class="gift-grid" id="networkGrid">
        ${campaign.networks.map(renderNetworkCard).join('')}
        <div class="gift-card network-custom-card" id="networkCustomCard">
          <div class="network-custom-icon">+</div>
          <div class="gift-name">רשת אחרת</div>
        </div>
      </div>
      <input type="text" class="network-custom-input" id="networkCustomInput" placeholder="הקלד/י שם רשת" hidden />
      <p class="form-msg" id="networkMsg"></p>
    ` : ''}

    ${(campaign.gift_mode === 'product_and_gift' || campaign.gift_mode === 'product_then_gift') && campaign.products && campaign.products.length ? `
      <h2>${escapeHtml(campaign.products_section_title)}</h2>
      <p class="form-msg" id="productMsg"></p>
      <div class="gift-grid" id="productGrid">
        ${campaign.products.map((p) => renderProductCard(campaign.id, p)).join('')}
      </div>
    ` : ''}

    ${campaign.gift_mode === 'product_then_gift' ? `
      <h2>${escapeHtml(campaign.gifts_section_title)}</h2>
      <p class="form-msg" id="giftMsg"></p>
      <div class="gift-grid" id="giftGrid">
        <p class="gift-grid-empty">בחר קודם מוצר כדי לראות את המתנות הזמינות עבורו.</p>
      </div>
    ` : (campaign.gift_mode === 'simple_choice' || campaign.gift_mode === 'product_and_gift') && campaign.gifts && campaign.gifts.length ? `
      <h2>${escapeHtml(campaign.gifts_section_title)}</h2>
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
${campaign.footer_note ? `
<footer class="page-footer">
  ${campaign.brand_has_logo ? `<img src="/api/brands/${campaign.brand_id}/logo" alt="${escapeHtml(campaign.brand_name)}" />` : ''}
  <p>${escapeHtml(campaign.footer_note)}</p>
</footer>
` : ''}
<script>
  // A checkbox field's label can contain a link (e.g. the terms-
  // agreement field's "תקנון" link) — since the <input> lives inside
  // the <label>, a native click anywhere in the label (including the
  // link) also toggles the checkbox. Stop that specific click from
  // bubbling so opening the link doesn't silently check/uncheck the
  // box as a side effect.
  document.querySelectorAll('label.checkbox a').forEach((a) => {
    a.addEventListener('click', (e) => e.stopPropagation());
  });

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
    { id: g.id, name: g.name, sku: g.sku, has_image: g.has_image, product_id: g.product_id, stock: g.stock }
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
    // stock === 0 specifically (not null/undefined, meaning
    // unlimited/untracked) — same rule as renderGiftCard server-side.
    const outOfStock = gift.stock === 0;
    const cls = 'gift-card' + (outOfStock ? ' gift-card-disabled' : '');
    const badge = outOfStock ? '<div class="gift-out-of-stock">אזל המלאי</div>' : '';
    return '<div class="' + cls + '" data-gift-id="' + gift.id + '">' + img
      + '<div class="gift-name">' + escapeHtmlClient(gift.name) + '</div>' + sku + badge + '</div>';
  }

  // Gives back a reservation the visitor isn't going to use after all
  // (see releaseCampaignGift server-side) — fire-and-forget, and
  // deliberately not awaited by any of its callers: nothing on screen
  // depends on it finishing, and a page navigating away can't wait for
  // it anyway. keepalive lets the request still go out even as the
  // page unloads (the same job navigator.sendBeacon is usually for,
  // without that API's body/method restrictions).
  function releaseGift(giftId) {
    if (!giftId) return;
    fetch('/api/campaigns/' + CAMPAIGN_ID + '/gifts/' + giftId + '/release', { method: 'POST', keepalive: true }).catch(() => {});
  }

  // Reserves a gift the moment it's clicked — not just checked at
  // final form submission — so two visitors racing for the last unit
  // get resolved right here: the loser sees "המוצר לא זמין במלאי"
  // immediately, before ever filling out the rest of the form. See
  // reserveCampaignGift server-side for the atomic claim this calls.
  async function selectGift(card) {
    const giftId = card.getAttribute('data-gift-id');
    if (String(selectedGiftId) === String(giftId)) return;
    if (card.classList.contains('gift-card-disabled')) return;

    clearSectionMsg('giftMsg');
    let ok = false;
    try {
      const res = await fetch('/api/campaigns/' + CAMPAIGN_ID + '/gifts/' + giftId + '/reserve', { method: 'POST' });
      ok = res.ok;
    } catch (err) {
      ok = false;
    }

    if (!ok) {
      showSectionMsg('giftMsg', 'המוצר לא זמין במלאי');
      card.classList.add('gift-card-disabled');
      if (!card.querySelector('.gift-out-of-stock')) {
        const badge = document.createElement('div');
        badge.className = 'gift-out-of-stock';
        badge.textContent = 'אזל המלאי';
        card.appendChild(badge);
      }
      return;
    }

    // Switching from a previously-reserved gift to this one — give
    // the old one back now that it's no longer needed.
    releaseGift(selectedGiftId);
    document.querySelectorAll('#giftGrid .gift-card').forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedGiftId = giftId;
  }

  // Scoped to #giftGrid specifically — the network icon grid below
  // reuses the same .gift-card class for its own cards (same visual
  // treatment), which a bare '.gift-card' selector would incorrectly
  // also pick up here.
  function wireGiftCardClicks() {
    document.querySelectorAll('#giftGrid .gift-card').forEach((card) => {
      card.addEventListener('click', () => { selectGift(card); });
    });
  }

  // Only used in 'product_then_gift' — rebuilds #giftGrid from
  // GIFTS_DATA filtered to the chosen product, and re-wires clicks on
  // the freshly rendered cards (innerHTML replacement drops old
  // listeners). Switching products abandons whatever gift was reserved
  // under the previous one, so that's released too.
  function renderGiftGridForProduct(productId) {
    const giftGrid = document.getElementById('giftGrid');
    if (!giftGrid) return;
    releaseGift(selectedGiftId);
    selectedGiftId = null;
    const matching = GIFTS_DATA.filter((g) => String(g.product_id) === String(productId));
    giftGrid.innerHTML = matching.length
      ? matching.map(buildGiftCardHtml).join('')
      : '<p class="gift-grid-empty">אין מתנות זמינות למוצר הזה.</p>';
    wireGiftCardClicks();
  }

  let selectedGiftId = null;
  wireGiftCardClicks();

  // Best-effort release when the visitor leaves without submitting —
  // pagehide is the modern, reliable choice for this across browsers
  // (including back-forward-cache) and is the one actually wired here.
  // Only one listener on purpose: releaseCampaignGift server-side does
  // a plain "stock = stock + 1" with no dedup, so firing this twice
  // for the same still-set selectedGiftId (e.g. pagehide *and*
  // beforeunload both listening) silently inflates stock by one extra
  // every time a visitor leaves after reserving — clearing
  // selectedGiftId immediately here is what makes a second, redundant
  // call (or a bfcache restore-then-leave-again) a safe no-op.
  window.addEventListener('pagehide', () => {
    releaseGift(selectedGiftId);
    selectedGiftId = null;
  });

  let selectedProductId = null;
  document.querySelectorAll('.product-card').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.product-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedProductId = card.getAttribute('data-product-id');
      if (GIFT_MODE === 'product_then_gift') renderGiftGridForProduct(selectedProductId);
    });
  });

  // Network icon grid (#networkGrid) — plus a dedicated "+" card
  // (#networkCustomCard) for a visitor whose network isn't in the
  // campaign's own list: clicking it reveals a plain text input
  // instead, and *that* becomes the pick (network_name, no
  // network_id) — clicking a real network icon clears the custom text
  // back out, and vice versa, so exactly one is ever "selected".
  let selectedNetworkId = null;
  const networkGrid = document.getElementById('networkGrid');
  const networkCustomCard = document.getElementById('networkCustomCard');
  const networkCustomInput = document.getElementById('networkCustomInput');
  if (networkGrid) {
    networkGrid.querySelectorAll('.gift-card[data-network-id]').forEach((card) => {
      card.addEventListener('click', () => {
        networkGrid.querySelectorAll('.gift-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedNetworkId = card.getAttribute('data-network-id');
        networkCustomInput.hidden = true;
        networkCustomInput.value = '';
      });
    });

    networkCustomCard.addEventListener('click', () => {
      networkGrid.querySelectorAll('.gift-card').forEach((c) => c.classList.remove('selected'));
      networkCustomCard.classList.add('selected');
      selectedNetworkId = null;
      networkCustomInput.hidden = false;
      networkCustomInput.focus();
    });

    networkCustomInput.addEventListener('input', () => {
      if (networkCustomInput.value.trim()) networkCustomCard.classList.add('selected');
      else networkCustomCard.classList.remove('selected');
    });
  }

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
    clearSectionMsg('networkMsg');
    clearSectionMsg('productMsg');
    clearSectionMsg('giftMsg');

    // Checked in the same top-to-bottom order the sections appear on
    // the page — network first, then "בחר מוצר" above "בחר מתנה" for
    // the modes that have both — then the rest of the form, last.
    const customNetworkName = networkCustomInput ? networkCustomInput.value.trim() : '';
    if (networkGrid && !selectedNetworkId && !customNetworkName) {
      showSectionMsg('networkMsg', 'נא לבחור רשת');
      return;
    }
    if (document.querySelectorAll('.product-card').length && !selectedProductId) {
      showSectionMsg('productMsg', 'נא לבחור מוצר');
      return;
    }
    if (document.querySelectorAll('#giftGrid .gift-card').length && !selectedGiftId) {
      showSectionMsg('giftMsg', 'נא לבחור מתנה');
      return;
    }
    // Network/product/gift picks are checked above, before anything
    // else. Only once all pass does the rest of the form get its
    // native required-field validation — the <form novalidate> above
    // stops the browser from doing that automatically (and earlier) on
    // its own the moment "שליחה" is clicked.
    if (!e.target.reportValidity()) return;
    try {
      const customFields = await collectCustomFields();
      const res = await fetch(${JSON.stringify(`/api/campaigns/${campaign.id}/registrations`)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custom_fields: customFields, gift_id: selectedGiftId, product_id: selectedProductId,
          network_id: selectedNetworkId, network_name: customNetworkName || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || 'שגיאה בשליחה');
      document.getElementById('regForm').outerHTML = '<p class="form-msg success">תודה! ההרשמה נקלטה בהצלחה.</p>';
      // The reservation is now a real, completed registration — stop
      // tracking it, so leaving the page afterwards doesn't release
      // (give back) a gift that was legitimately claimed.
      selectedGiftId = null;
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
