/**
 * Create a 100x150 cargo label design with a single HTML element.
 *
 * Usage (PowerShell):
 *   $env:LABELINN_API_KEY = "sk_live_or_test_key"
 *   $env:LABELINN_BASE_URL = "https://labelinn.com/v1"   # optional
 *   node sdk/node/examples/create-cargo-label-100x150-html.js
 */

const BASE_URL = process.env.LABELINN_BASE_URL || 'https://labelinn.com/v1';
const API_KEY = process.env.LABELINN_API_KEY;

if (!API_KEY) {
  console.error('Missing LABELINN_API_KEY environment variable.');
  process.exit(1);
}

async function api(path, method, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.error?.message || `HTTP ${res.status}`;
    throw new Error(`${method} ${path} failed: ${message}`);
  }
  return json;
}

function buildCargoHtml() {
  const html = `
<div class="cargo-card">
  <div class="top-row">
    <div class="brand">LABELINN CARGO</div>
    <div class="service">PRIORITY</div>
  </div>

  <div class="route">
    <div class="from">IST</div>
    <div class="arrow">→</div>
    <div class="to">ANK</div>
  </div>

  <div class="meta-grid">
    <div class="meta"><span>ORDER</span><strong>#TRK-2026-08421</strong></div>
    <div class="meta"><span>WEIGHT</span><strong>2.4 KG</strong></div>
    <div class="meta"><span>CUSTOMER</span><strong>Arda Yilmaz</strong></div>
    <div class="meta"><span>PHONE</span><strong>+90 555 123 45 67</strong></div>
  </div>

  <div class="address">
    Ataturk Mah. Kargo Sok. No:12<br/>
    Etimesgut / Ankara
  </div>

  <div class="barcode-band">|||| ||| |||||| || |||| | |||| |||</div>
  <div class="tracking">1Z-LBI-90TR-5521-8847</div>
</div>`;

  const css = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Trebuchet MS", "Segoe UI", sans-serif;
  background: #f7f7f5;
}

.cargo-card {
  width: 100%;
  height: 100%;
  border: 2px solid #111;
  border-radius: 12px;
  padding: 10px;
  color: #111;
  background:
    radial-gradient(circle at 85% 0%, rgba(0,0,0,0.08), transparent 38%),
    linear-gradient(160deg, #fffdf8 0%, #f5f3eb 100%);
  display: grid;
  grid-template-rows: auto auto auto auto auto auto;
  gap: 6px;
}

.top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px dashed #333;
  padding-bottom: 6px;
}

.brand {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1px;
}

.service {
  font-size: 10px;
  font-weight: 800;
  padding: 3px 7px;
  border: 1px solid #111;
  border-radius: 999px;
  background: #111;
  color: #fff;
}

.route {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-weight: 900;
}

.route .from,
.route .to {
  font-size: 26px;
  line-height: 1;
}

.route .arrow {
  font-size: 18px;
  transform: translateY(-1px);
}

.meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}

.meta {
  border: 1px solid #222;
  border-radius: 8px;
  padding: 4px 6px;
  background: #fff;
}

.meta span {
  display: block;
  font-size: 8px;
  opacity: 0.75;
  letter-spacing: 0.5px;
}

.meta strong {
  display: block;
  font-size: 11px;
  margin-top: 2px;
}

.address {
  border: 1px solid #222;
  border-radius: 8px;
  background: #fff;
  padding: 7px;
  font-size: 10px;
  line-height: 1.3;
  min-height: 40px;
}

.barcode-band {
  font-family: "Courier New", monospace;
  font-size: 13px;
  letter-spacing: 1px;
  text-align: center;
  border-top: 1px solid #111;
  border-bottom: 1px solid #111;
  padding: 4px 0;
  background: #fff;
}

.tracking {
  text-align: center;
  font-size: 11px;
  letter-spacing: 1.2px;
  font-weight: 700;
}`;

  return { html, css };
}

async function main() {
  const design = await api('/designs', 'POST', {
    name: 'Cargo Label 100x150 HTML',
    category: 'cargo',
    size: { w: 100, h: 150 },
    description: 'Single HTML element cargo label (100x150 mm)',
  });

  const designId = design?.data?.id;
  if (!designId) {
    throw new Error('Design created but no design id returned.');
  }

  const { html, css } = buildCargoHtml();

  const element = await api(`/designs/${designId}/elements`, 'POST', {
    type: 'html',
    position: { x: 3, y: 3 },
    size: { w: 94, h: 144 },
    properties: {
      html_content: html,
      css_content: css,
      thermal_mode: false,
      opacity: 1,
    },
  });

  console.log('Created design:', designId);
  console.log('Created element:', element?.data?.id || '(id not returned)');
  console.log('Open design with GET /v1/designs/' + designId);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
