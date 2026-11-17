# LabelInn Node.js SDK

[![npm version](https://img.shields.io/npm/v/labelinn.svg)](https://www.npmjs.com/package/labelinn)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

Official Node.js SDK for the [LabelInn](https://labelinn.com) Cloud Print API. Send labels to thermal printers (Zebra, TSC, Honeywell), manage your fleet, and build print automation workflows — all from code.

**Zero dependencies.** Uses Node.js 18+ built-in `fetch`.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [Print Jobs](#print-jobs)
- [Fleet Management](#fleet-management)
- [Designs (Templates)](#designs-templates)
- [Webhooks](#webhooks)
- [Data Connect](#data-connect)
- [Product Passports, GHS and UFI](#product-passports-ghs-and-ufi)
- [Local Edge API (LAN, pinned TLS)](#local-edge-api-lan-pinned-tls)
- [Rate Limits](#rate-limits)
- [Error Handling](#error-handling)
- [CLI Tool](#cli-tool)
- [Configuration](#configuration)
- [Requirements](#requirements)
- [Contributing](#contributing)
- [License](#license)

## Installation

```bash
npm install labelinn
```

## Quick Start

```js
const LabelInn = require('labelinn');

// Use a test key for development (no real prints, no quota cost)
const client = new LabelInn('sk_test_xxxxx');

// Print a ZPL label
const job = await client.print.create({
  printer_id: 'prt_abc123',
  payload_type: 'zpl',
  payload_data: '^XA^FO50,50^ADN,36,20^FDHello World^FS^XZ',
});

console.log(`Job ${job.id} → ${job.status}`);
```

## Authentication

Get your API key from **LabelInn → Settings → API Keys**.

| Key prefix    | Mode    | Description                        |
|---------------|---------|------------------------------------|
| `sk_test_xxx` | Sandbox | No real prints, separate quota     |
| `sk_live_xxx` | Live    | Sends jobs to physical printers    |

```js
// Test mode — safe for development
const dev = new LabelInn('sk_test_xxxxx');
console.log(dev.isTestMode); // true

// Live mode — real prints
const prod = new LabelInn('sk_live_xxxxx');
```

## Print Jobs

### Send a ZPL label
```js
const job = await client.print.create({
  printer_id: 'prt_abc123',
  payload_type: 'zpl',
  payload_data: '^XA^FO50,50^ADN,36,20^FDShipping Label^FS^XZ',
  copies: 2,
  job_name: 'Order #1234',
});
```

### Send an image label
```js
// From a URL (HTTPS only, max 25 MB; the API stages files over 500 KB itself)
const job = await client.print.create({
  printer_id: 'prt_abc123',
  payload_type: 'image',
  image_url: 'https://example.com/labels/shipping.png',
});
```

<!-- UNIFIED PRINTERS R3 -->
### Large files (PDF / images up to 25 MB)

Inline `payload_data` is capped at 500 KB of base64. `printFile()` picks the
route for you: small files go inline exactly as before, larger ones (up to
25 MB) are uploaded first and printed by `upload_id`.

```js
// A path or a Buffer; PDF, PNG, JPEG, GIF, BMP, WebP or TIFF (type read from the bytes)
const job = await client.print.printFile('prt_abc123', './invoice.pdf', {
  copies: 2,
  office: { paper: 'a4' }, // office printers; or media_width_mm / media_height_mm
});

// Or step by step:
const uploadId = await client.print.uploadFile(buffer, 'application/pdf', 'invoice.pdf');
await client.print.create({ printer_id: 'prt_abc123', payload_type: 'image', upload_id: uploadId });
const upload = await client.print.getUpload(uploadId); // { status: 'pending' | 'ready', ... }
```

`uploadFile()` calls `POST /v1/print/uploads` (content type, size, SHA-256),
then PUTs the bytes to the signed storage URL with exactly the returned headers
and no `Authorization` header (the URL is valid 15 minutes). Files over 25 MB
are refused locally with `PAYLOAD_TOO_LARGE`. Upload errors: `UPLOAD_NOT_FOUND`,
`UPLOAD_NOT_RECEIVED`, `UPLOAD_EXPIRED`, `UPLOAD_HASH_MISMATCH`,
`UPLOAD_SIZE_MISMATCH`, `UPLOAD_TYPE_MISMATCH`, `UNSUPPORTED_MEDIA_TYPE`,
`UPLOAD_UNAVAILABLE`; `PRINTER_APP_TOO_OLD` when the PC that owns the printer
runs a LabelInn version that cannot print uploaded files.

### Office (A4 / Letter) printers
Office printers (`kind: 'office'` in `fleet.list()`) take `template` jobs placed on a
label sheet, and `image` jobs (a PDF or an image, one whole page each) when the
printer's `office.payload_types` includes `'image'`. `zpl` is refused with
`OFFICE_PRINTER_NEEDS_DESIGN`.

```js
await client.print.create({
  printer_id: 'prt_office',
  payload_type: 'template',
  design_id: 'dsg_address_label',
  data: rows,
  copies: 1,
  office: {
    sheet: 'a4-21',          // or grid: { cols, rows, label_width_mm, label_height_mm, ... }
    start_at: 4,             // first free cell of a part-used sheet
    collate: false,
    color: 'black_white',    // 'color' | 'grayscale' | 'black_white'
    fill_order: 'top_right_rl', // top_left_lr (default) | top_right_rl | bottom_left_lr | bottom_right_rl
  },
});
// LabelInn.OFFICE_FILL_ORDERS lists the valid fill_order values.
```

### Receipt printers
Receipt / POS printers (`kind: 'receipt'`: ESC/POS, Phomemo) report `receipt_roll_mm`
(58 or 80) and `receipt_printable_mm` (48 or 72) in `fleet.list()`. Send a `template`
or an `image`; a wider design is scaled to the roll and the job reports
`receipt_fit`. `payload_type: 'zpl'` is refused with `PRINTER_LANGUAGE_MISMATCH`
(also for DYMO and Brother QL printers).

### Epson colour: send a template, not a bare image
Epson ColorWorks (`kind: 'color'`) cannot print a bare image. `payload_type: 'image'`
is refused with `400 PRINTER_LANGUAGE_MISMATCH` (`accepted_payload_types: ['template']`).
Put the image in a design and print the design:

```js
await client.print.create({ printer_id: 'prt_epson', payload_type: 'template', design_id: 'dsg_photo_label' });
```

### Print from a template
```js
const job = await client.print.create({
  printer_id: 'prt_abc123',
  payload_type: 'template',
  design_id: 'dsg_shipping_v2',
  data: {
    order_id: 'ORD-9876',
    customer: 'Ali Yilmaz',
    barcode: 'TR123456789',
  },
});
```

### Idempotency (prevent duplicate prints)
```js
const job = await client.print.create(
  { printer_id: 'prt_abc123', payload_type: 'zpl', payload_data: '...' },
  { idempotencyKey: 'order-9876-label' }
);
// Calling again with the same key returns the original job
```

### List & manage jobs
```js
// List recent jobs
const jobs = await client.print.list({ limit: 10 });
// Next page: client.print.list({ limit: 10, page_token: jobs._pagination?.next_page_token })

// Filter by status
const failed = await client.print.list({ status: 'failed' });

// Get job details
const job = await client.print.get('job_abc123');

// Cancel a queued job
await client.print.cancel('job_abc123');

// Reprint with different printer
await client.print.reprint('job_abc123', { printer_id: 'prt_backup' });
```

## Fleet Management

```js
// List all printers
const printers = await client.fleet.list();

// Filter by status
const online = await client.fleet.list({ status: 'online' });

// Get printer details
const printer = await client.fleet.get('prt_abc123');

// Quick status check
const status = await client.fleet.status('prt_abc123');
console.log(`${status.status} — Paper: ${status.paper_status}`);

// Talk to the printer: send a command and get its answer back
const answer = await client.fleet.command('prt_abc123', 'STATUS');
console.log(answer.response_text);

// Lock a printer (operators see the reason), or restrict who may use it
await client.fleet.update('prt_abc123', { is_locked: true, lock_reason: 'Head cleaning' });
```

## Designs (Templates)

```js
// List designs
const designs = await client.designs.list();

// Get design with elements
const design = await client.designs.get('dsg_abc123');

// Create a design
const newDesign = await client.designs.create({
  name: 'Shipping Label v3',
  width_mm: 100,
  height_mm: 60,
});

// Add elements
await client.designs.addElement('dsg_abc123', {
  type: 'text',
  x: 10, y: 10,
  text: '{{order_id}}',
  font_size: 14,
});

await client.designs.addElement('dsg_abc123', {
  type: 'barcode',
  x: 10, y: 40,
  barcode_type: 'code128',
  data: '{{tracking_number}}',
});

// Clone a design
const clone = await client.designs.clone('dsg_abc123');

// Print directly from a design
await client.designs.print('dsg_abc123', {
  printer_id: 'prt_abc123',
  data: { order_id: 'ORD-5555', tracking_number: 'TR999' },
  copies: 1,
});
```

## Workflows

Build, test and trigger visual label workflows from code.

```js
// Dry-run with a sample record — nothing prints
const result = await client.workflows.test('wf_abc123', { sku: 'A-1042', qty: 2 });
console.log(result.trace);

// Mint a signed inbound trigger once and store the secret
const trigger = await client.workflows.createTrigger('wf_abc123', { signed: true });

// Then, from your system, run the workflow with a record
await client.workflows.fire('wf_abc123', trigger.token,
  { order_id: 'ORD-9876', sku: 'A-1042' },
  { secret: trigger.secret });
```

## Print History

```js
const history = await client.audit.printHistory({ printerId: 'prt_abc123', status: 'completed', limit: 50 });
const entry = await client.audit.printHistoryEntry('job_abc123');
const check = await client.audit.verifyPrint('job_abc123', { expect_copies: 2 });
```

## Webhooks

```js
// Subscribe to events
const webhook = await client.webhooks.create({
  url: 'https://yourapp.com/webhooks/labelinn',
  events: ['print_job.completed', 'print_job.failed', 'printer.offline'],
  description: 'Production monitoring',
});

// Save the signing secret!
console.log('Signing secret:', webhook.signing_secret);

// List subscriptions
const webhooks = await client.webhooks.list();

// Send a test ping
await client.webhooks.test(webhook.id);

// Unsubscribe
await client.webhooks.delete(webhook.id);
```

### Verifying webhook signatures

```js
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// In your Express handler:
app.post('/webhooks/labelinn', (req, res) => {
  const signature = req.headers['x-labelinn-signature'];
  const valid = verifyWebhook(JSON.stringify(req.body), signature, WEBHOOK_SECRET);
  if (!valid) return res.status(401).send('Invalid signature');

  const { event, data } = req.body;
  console.log(`Event: ${event}`, data);
  res.sendStatus(200);
});
```

## Data Connect

Data Connect lets you ingest data from any enterprise system (SAP, Oracle, CSV exports, custom APIs) and print labels from it. Supports XML/IDoc, CSV/TSV, and JSON/NDJSON formats with auto-detection.

### Ingest Data

```js
// From a JSON payload
const result = await client.connect.ingest({
  source_id: 'src_abc123',
  payload: JSON.stringify([
    { sku: 'A001', name: 'Widget', qty: 10 },
    { sku: 'A002', name: 'Gadget', qty: 5 },
  ]),
  format: 'json',
});
console.log(`Ingested ${result.records_count} records`);

// From XML/IDoc
const xmlResult = await client.connect.ingest({
  source_id: 'src_sap',
  payload: xmlString,
  format: 'xml',
});
```

### Test Parse (Dry Run)

```js
const parsed = await client.connect.testParse({
  payload: csvString,
  format: 'csv',
});
console.log(`Detected ${parsed.records.length} records`);
console.log('Schema:', parsed.schema.map(f => f.path));
```

### Manage Sources

```js
// Create a source
const source = await client.connect.createSource({
  name: 'SAP Orders',
  format: 'xml',
});

// List all sources
const sources = await client.connect.listSources();

// Get source details
const detail = await client.connect.getSource('src_abc123');

// Update a source
await client.connect.updateSource('src_abc123', { name: 'SAP Orders v2' });

// Delete a source
await client.connect.deleteSource('src_abc123');
```

### Schema & Records

```js
// Get detected schema
const schema = await client.connect.getSchema('src_abc123');
schema.fields.forEach(f => console.log(`${f.path} (${f.type}): ${f.sample}`));

// List ingested records
const records = await client.connect.listRecords('src_abc123', 50);
```

### Field Mappings

```js
// Get current mappings
const mappings = await client.connect.getMappings('src_abc123');

// Update mappings
await client.connect.updateMappings('src_abc123', {
  sku: 'product_code',
  name: 'product_name',
});
```

### Print from Connector

```js
// From a given source: rows 1-25, one label per row
const printResult = await client.connect.print('src_abc123', {
  design_id: 'dsg_shipping',
  printer_id: 'prt_warehouse1',
  row_start: 1,
  row_count: 25,
});

// Or let the design's own bound data source be used
await client.connect.printDesign({ design_id: 'dsg_shipping', printer_id: 'prt_warehouse1' });
```

### Custom API connections

```js
const conn = await client.connect.custom.create({
  name: 'My cargo API', kind: 'cargo', baseUrl: 'https://api.example-cargo.com',
  manifest: { auth: { type: 'bearer', credential: 'token' }, operations: [/* ... */] },
  credentials: { token: process.env.CARGO_TOKEN },
});
await client.connect.custom.execute(conn.id, {
  operationId: 'createShipment', input: { orderId: 'A-1' },
  confirmSideEffect: true, idempotencyKey: 'order-A-1',
});
```

## Product Passports, GHS and UFI

```js
await client.passport.update({ gtin: '09506000134352', serial: 'SN1', fields: [{ key: 'state_of_health', value: 92 }] });
await client.passport.setPage({ gtin: '09506000134352', brand: { name: 'Acme', accent: '#1f7a4d' } });
const passport = await client.passport.resolve('01/09506000134352/21/SN1');   // public JSON

const ghs = await client.labels.preview({ data: { h_codes: ['H225', 'H319'], languages: ['en'] } });
const { ufi } = await client.ufi.generate({ countryCode: 'DE', vat: 'DE123456789', formulationNumber: 4521 });
```

## Local Edge API (LAN, pinned TLS)

Every PC running the LabelInn desktop app can serve a local API on port 6631.
`LabelInnEdge` reads `~/.labelinn/edge.json` (written by the app) for the address
and token. When the PC serves HTTPS with its own self-signed certificate, the file
carries `tlsSha256` and the client **pins** it: the TLS handshake is checked
against that SHA-256 before any byte of the request is sent, and a mismatch
throws `LabelInnEdgePinError`. PCs without TLS (or older app versions) keep
working over plain http.

```js
const { LabelInnEdge } = require('labelinn');

const edge = LabelInnEdge.fromDescriptor();                 // this PC
// another PC: token and fingerprint from the app's "Copy token" / device list
const remote = new LabelInnEdge({ host: '192.168.1.40', token: 'EDGE_TOKEN', tlsSha256: '3f1c...e9' });

const { jobId } = await edge.print({ printerId: 'usb_zebra_01', payloadType: 'zpl', payloadData: '^XA^XZ' });
const result = await edge.getJob(jobId);                    // 404 until processed
const printers = await edge.listPrinters({ includePeers: false });
```

Other methods: `health()`, `listPeers()`, `startDiscovery()`, `getDiscovery()`,
`listDesigns()`, `getDesign()`, `scheduleStatus()`, `scheduleRunNow()`,
`auditRecent()`.

MQTT note: the app's built-in broker only accepts `labelinn/cmd/*` commands from a
client that logs in with the configured MQTT username and password (or from the
same PC).

## Rate Limits

Every response includes rate limit info:

```js
const result = await client.print.list();
console.log(result._rateLimit);
// { limit: 2000, remaining: 1847, reset: 3600 }
```

| Plan       | Daily Limit |
|------------|-------------|
| Pro        | 2,000       |
| Enterprise | 50,000      |
| Test keys  | 500 minimum |

When rate-limited, the SDK throws `LabelInnRateLimitError`:

```js
const { LabelInnRateLimitError } = require('labelinn');

try {
  await client.print.create({ ... });
} catch (err) {
  if (err instanceof LabelInnRateLimitError) {
    console.log(`Rate limited. Retry in ${err.retryAfter}s`);
  }
}
```

## Error Handling

```js
const { LabelInnError } = require('labelinn');

try {
  await client.print.create({ ... });
} catch (err) {
  if (err instanceof LabelInnError) {
    console.error(`[${err.status}] ${err.code}: ${err.message}`);
    // err.raw contains the full response body
  }
}
```

## CLI Tool

The SDK includes a CLI for quick testing:

```bash
# Set your API key
export LABELINN_API_KEY=sk_test_xxxxx

# Verify connectivity
npx labelinn test

# List printers
npx labelinn printers

# Print a ZPL label
npx labelinn print prt_abc123 --zpl "^XA^FO50,50^ADN,36,20^FDHello^FS^XZ"

# Print from a template
npx labelinn print prt_abc123 --design dsg_shipping --data '{"name":"Ali"}'

# List jobs
npx labelinn jobs

# Get raw JSON output
npx labelinn printers --json

# --- Data Connect ---
# List connected data sources
npx labelinn connect sources

# Ingest data from a file
npx labelinn connect ingest conn_abc123 --file data.csv

# Test-parse a local file
npx labelinn connect parse --file data.csv --format csv
```

Run `npx labelinn --help` for all commands.

## Configuration

```js
const client = new LabelInn('sk_test_xxxxx', {
  baseUrl: 'https://labelinn.com/v1',  // default
  timeout: 30000,                       // 30s default
});
```

## Requirements

- Node.js 18+ (uses built-in `fetch`)
- No external dependencies

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on [GitHub](https://github.com/ArisHub/labelinn-node).

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -am 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## Links

- [LabelInn Website](https://labelinn.com)
- [API Documentation](https://labelinn.com/developers)
- [Python SDK](https://github.com/ArisHub/labelinn-python)
- [Changelog](./CHANGELOG.md)
- [Report a Bug](https://github.com/ArisHub/labelinn-node/issues)

## License

MIT — see [LICENSE](./LICENSE) for details.
