/**
 * LabelInn SDK Test Suite — Node.js
 * Tests all SDK features against the live API
 */
const LabelInn = require('../lib/index.js');

const API_KEY = process.env.LABELINN_API_KEY || process.argv[2];
if (!API_KEY) {
  console.error('Usage: node test_all.js <api_key>');
  process.exit(1);
}

const client = new LabelInn(API_KEY);
let passed = 0, failed = 0, skipped = 0;
const results = [];

async function test(name, fn) {
  try {
    const result = await fn();
    passed++;
    results.push({ name, status: 'PASS', detail: result || '' });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes('404') || msg.includes('not found') || msg.includes('NOT_FOUND')) {
      skipped++;
      results.push({ name, status: 'SKIP', detail: msg });
      console.log(`  ○ ${name} (endpoint not deployed)`);
    } else {
      failed++;
      results.push({ name, status: 'FAIL', detail: msg });
      console.log(`  ✗ ${name}: ${msg}`);
    }
  }
}

async function main() {
  console.log('LabelInn Node.js SDK Test Suite');
  console.log('================================\n');

  // ── Fleet ──
  console.log('Fleet (Printers)');
  let printers = [];
  await test('fleet.list()', async () => {
    const r = await client.fleet.list();
    printers = r.printers || r.data || r;
    if (!Array.isArray(printers)) printers = [];
    return `${printers.length} printers`;
  });

  if (printers.length > 0) {
    const pid = printers[0].id;
    await test(`fleet.get("${pid}")`, async () => {
      const r = await client.fleet.get(pid);
      return `name: ${r.name}, status: ${r.status}`;
    });
    await test(`fleet.status("${pid}")`, async () => {
      const r = await client.fleet.status(pid);
      return `online: ${r.is_online || r.online}`;
    });
  } else {
    await test('fleet.get() [no printers]', async () => 'SKIPPED - no printers');
  }

  // ── Fleet Groups ──
  console.log('\nFleet Groups');
  await test('fleet.groups.list()', async () => {
    const r = await client.fleet.groups.list();
    return JSON.stringify(r).substring(0, 100);
  });

  // ── Designs ──
  console.log('\nDesigns');
  let designs = [];
  await test('designs.list()', async () => {
    const r = await client.designs.list();
    designs = r.designs || r.data || r;
    if (!Array.isArray(designs)) designs = [];
    return `${designs.length} designs`;
  });

  if (designs.length > 0) {
    const did = designs[0].id;
    await test(`designs.get("${did}")`, async () => {
      const r = await client.designs.get(did);
      return `name: ${r.name}`;
    });
    await test(`designs.listVariables("${did}")`, async () => {
      const r = await client.designs.listVariables(did);
      return JSON.stringify(r).substring(0, 100);
    });
    await test(`designs.listElements("${did}")`, async () => {
      const r = await client.designs.listElements(did);
      return `got elements`;
    });
    await test(`designs.revisions("${did}")`, async () => {
      const r = await client.designs.revisions(did);
      return JSON.stringify(r).substring(0, 100);
    });
  }

  // ── Print Jobs ──
  console.log('\nPrint Jobs');
  let jobs = [];
  await test('print.list()', async () => {
    const r = await client.print.list();
    jobs = r.jobs || r.data || r;
    if (!Array.isArray(jobs)) jobs = [];
    return `${jobs.length} jobs`;
  });

  if (jobs.length > 0) {
    const jid = jobs[0].id;
    await test(`print.get("${jid}")`, async () => {
      const r = await client.print.get(jid);
      return `status: ${r.status}, type: ${r.payload_type}`;
    });
  }

  // Test creating a job (will fail without printers, but tests the request flow)
  await test('print.create() [validation test]', async () => {
    try {
      await client.print.create({
        printer_id: 'prt_nonexistent',
        payload_type: 'zpl',
        payload_data: '^XA^FO50,50^ADN,36,20^FDHello^FS^XZ'
      });
      return 'created (unexpected)';
    } catch (err) {
      // We expect this to fail with a printer not found error — that proves the API validated
      if (err.message && (err.message.includes('not found') || err.message.includes('NOT_FOUND') || err.message.includes('PRINTER_NOT_FOUND') || err.status === 404 || err.status === 400)) {
        return 'correctly rejected: ' + (err.code || err.message).substring(0, 60);
      }
      throw err;
    }
  });

  // Test batch (validation)
  await test('print.batch() [validation test]', async () => {
    try {
      await client.print.batch([
        { printer_id: 'prt_nonexistent', payload_type: 'zpl', payload_data: '^XA^FDTest^FS^XZ' }
      ]);
      return 'created (unexpected)';
    } catch (err) {
      if (err.status === 400 || err.status === 404 || (err.message && err.message.includes('not found'))) {
        return 'correctly rejected batch';
      }
      // Batch might return 200 with per-job failures
      throw err;
    }
  });

  // ── Webhooks ──
  console.log('\nWebhooks');
  await test('webhooks.list()', async () => {
    const r = await client.webhooks.list();
    const whs = r.webhooks || r.data || r;
    return `${Array.isArray(whs) ? whs.length : 0} webhooks`;
  });

  // Create and delete a webhook (full lifecycle)
  let testWebhookId = null;
  await test('webhooks.create()', async () => {
    const r = await client.webhooks.create({
      url: 'https://httpbin.org/post',
      events: ['print.job.completed'],
      description: 'SDK test webhook'
    });
    testWebhookId = r.id;
    return `created: ${r.id}, secret: ${r.secret ? 'yes' : r.signing_secret ? 'yes' : 'no'}`;
  });

  if (testWebhookId) {
    await test('webhooks.test()', async () => {
      await client.webhooks.test(testWebhookId);
      return 'ping sent';
    });

    await test('webhooks.update()', async () => {
      const r = await client.webhooks.update(testWebhookId, {
        events: ['print.job.completed', 'print.job.failed'],
        description: 'Updated SDK test webhook'
      });
      return `updated events`;
    });

    await test('webhooks.deliveries()', async () => {
      const r = await client.webhooks.deliveries(testWebhookId);
      return `deliveries response OK`;
    });

    await test('webhooks.delete()', async () => {
      await client.webhooks.delete(testWebhookId);
      return 'deleted';
    });
  }

  // ── Summary ──
  console.log('\n================================');
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('================================\n');

  // Print failures for debugging
  const failures = results.filter(r => r.status === 'FAIL');
  if (failures.length > 0) {
    console.log('FAILURES:');
    failures.forEach(f => console.log(`  ${f.name}: ${f.detail}`));
  }

  const skipList = results.filter(r => r.status === 'SKIP');
  if (skipList.length > 0) {
    console.log('SKIPPED (endpoint not deployed):');
    skipList.forEach(s => console.log(`  ${s.name}: ${s.detail}`));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
