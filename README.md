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
// From a URL (HTTPS only, max 500KB)
const job = await client.print.create({
  printer_id: 'prt_abc123',
  payload_type: 'image',
  image_url: 'https://example.com/labels/shipping.png',
});
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
const { jobs } = await client.print.list({ limit: 10 });

// Filter by status
const { jobs: failed } = await client.print.list({ status: 'failed' });

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
const { printers } = await client.fleet.list();

// Filter by status
const { printers: online } = await client.fleet.list({ status: 'online' });

// Get printer details
const printer = await client.fleet.get('prt_abc123');

// Quick status check
const status = await client.fleet.status('prt_abc123');
console.log(`${status.status} — Paper: ${status.paper_status}`);
```

## Designs (Templates)

```js
// List designs
const { designs } = await client.designs.list();

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
const { webhooks } = await client.webhooks.list();

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
const printResult = await client.connect.print({
  source_id: 'src_abc123',
  design_id: 'dsg_shipping',
  printer_id: 'prt_warehouse1',
  copies: 1,
});
console.log(`Created ${printResult.count} print jobs`);
```

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
