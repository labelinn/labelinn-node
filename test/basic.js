'use strict';

// Offline tests: `fetch` is replaced by a recorder, so these assert exactly
// what goes over the wire. Run with `npm test` (no API key, no network).

const assert = require('assert');
const crypto = require('crypto');
const LabelInn = require('../lib/index.js');
const pkg = require('../package.json');

const calls = [];
global.fetch = async (url, opts) => {
  calls.push({ url: new URL(url), opts });
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ data: { ok: true } }),
  };
};

const route = (c) => `${c.opts.method} ${c.url.pathname}`;
const query = (c) => Object.fromEntries(c.url.searchParams);

let failures = 0;
async function test(name, fn) {
  calls.length = 0;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}\n    ${e.message}`);
  }
}

(async () => {
  const client = new LabelInn('sk_test_abc');

  await test('version is 3.2.0 and sent as User-Agent', async () => {
    assert.strictEqual(pkg.version, '3.2.0');
    await client.workflows.list();
    assert.strictEqual(calls[0].opts.headers['User-Agent'], 'labelinn-node/3.2.0');
  });

  await test('print.create posts the job', async () => {
    await client.print.create({ printer_id: 'prt_1', payload_type: 'zpl', payload_data: '^XA^XZ' });
    assert.strictEqual(route(calls[0]), 'POST /v1/print/jobs');
    assert.deepStrictEqual(JSON.parse(calls[0].opts.body),
      { printer_id: 'prt_1', payload_type: 'zpl', payload_data: '^XA^XZ' });
  });

  await test('workflow CRUD paths', async () => {
    await client.workflows.capabilities();
    await client.workflows.list({ limit: 5 });
    await client.workflows.get('wf_1');
    await client.workflows.create({ name: 'Orders' });
    await client.workflows.replace('wf_1', { name: 'Orders', nodes: [], edges: [] });
    await client.workflows.update('wf_1', { enabled: false });
    await client.workflows.delete('wf_1');
    await client.workflows.test('wf_1', { sku: 'A-1' });
    assert.deepStrictEqual(calls.map(route), [
      'GET /v1/workflows/capabilities',
      'GET /v1/workflows',
      'GET /v1/workflows/wf_1',
      'POST /v1/workflows',
      'PUT /v1/workflows/wf_1',
      'PATCH /v1/workflows/wf_1',
      'DELETE /v1/workflows/wf_1',
      'POST /v1/workflows/wf_1/test',
    ]);
    assert.deepStrictEqual(query(calls[1]), { limit: '5' });
    assert.deepStrictEqual(JSON.parse(calls[3].opts.body),
      { nodes: [], edges: [], enabled: true, name: 'Orders' });
    assert.deepStrictEqual(JSON.parse(calls[7].opts.body), { row: { sku: 'A-1' } });
  });

  await test('trigger management', async () => {
    await client.workflows.listTriggers('wf_1');
    await client.workflows.createTrigger('wf_1', { signed: true });
    await client.workflows.deleteTrigger('wf_1', 'tok_9');
    assert.deepStrictEqual(calls.map(route), [
      'GET /v1/workflows/wf_1/triggers',
      'POST /v1/workflows/wf_1/triggers',
      'DELETE /v1/workflows/wf_1/triggers/tok_9',
    ]);
    assert.deepStrictEqual(JSON.parse(calls[1].opts.body), { signed: true });
  });

  await test('fire() signs exactly the bytes it sends', async () => {
    await client.workflows.fire('wf_1', 'tok_9', { sku: 'Ä-1' }, { secret: 's3cret' });
    const c = calls[0];
    assert.strictEqual(route(c), 'POST /v1/workflows/wf_1/trigger/tok_9');
    // Mirror of functions/api/workflowTriggers.js verifySignature().
    const expected = 'sha256=' + crypto.createHmac('sha256', 's3cret').update(c.opts.body).digest('hex');
    assert.strictEqual(c.opts.headers['X-LabelInn-Signature'], expected);
  });

  await test('fire() without a secret sends no signature', async () => {
    await client.workflows.fire('wf_1', 'tok_9', { sku: 'A-1' });
    assert.strictEqual(calls[0].opts.headers['X-LabelInn-Signature'], undefined);
    assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { sku: 'A-1' });
  });

  await test('print history and verification', async () => {
    await client.audit.printHistory({ printerId: 'prt_1', limit: 10 });
    await client.audit.printHistoryEntry('job_1');
    await client.audit.printArtifacts('job_1');
    await client.audit.printArtifact('job_1', 'zpl', { as: 'url' });
    await client.audit.verifyPrint('job_1', { expect_copies: 2 });
    await client.audit.verifyChain({ start_seq: 1 });
    assert.deepStrictEqual(calls.map(route), [
      'GET /v1/audit/print-history',
      'GET /v1/audit/print-history/job_1',
      'GET /v1/audit/print-history/job_1/artifacts',
      'GET /v1/audit/print-history/job_1/artifacts/zpl',
      'GET /v1/audit/print-history/job_1/verify',
      'GET /v1/audit/verify-chain',
    ]);
    assert.deepStrictEqual(query(calls[0]), { printerId: 'prt_1', limit: '10' });
    assert.deepStrictEqual(query(calls[3]), { as: 'url' });
  });

  await test('fleet and design additions', async () => {
    await client.fleet.supplyAlerts({ state: 'low' });
    await client.designs.renderStatus('rnd_1');
    await client.designs.replacePageElement('dsg_1', 'pg_1', 'el_1', { x: 10 });
    assert.deepStrictEqual(calls.map(route), [
      'GET /v1/fleet/supply-alerts',
      'GET /v1/designs/renders/rnd_1',
      'PUT /v1/designs/dsg_1/pages/pg_1/elements/el_1',
    ]);
  });

  await test('an empty 204 body does not throw', async () => {
    const saved = global.fetch;
    global.fetch = async () => ({ ok: true, status: 204, headers: { get: () => null },
      json: async () => { throw new Error('no body'); } });
    try {
      const r = await client.workflows.delete('wf_1');
      assert.strictEqual(r, null);
    } finally {
      global.fetch = saved;
    }
  });

  await test('list keeps the page cursor', async () => {
    const saved = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ data: [{ id: 'job_1' }], pagination: { has_more: true, next_page_token: 'job_1' } }) });
    try {
      const jobs = await client.print.list({ limit: 1 });
      assert.ok(Array.isArray(jobs));
      assert.strictEqual(jobs[0].id, 'job_1');
      assert.deepStrictEqual(jobs._pagination, { has_more: true, next_page_token: 'job_1' });
    } finally {
      global.fetch = saved;
    }
  });

  await test('printer commands', async () => {
    await client.fleet.command('prt_1', 'STATUS', { wait: false });
    await client.fleet.getCommand('prt_1', 'cmd_9');
    await client.fleet.update('prt_1', { is_locked: true, lock_reason: 'service' });
    assert.deepStrictEqual(calls.map(route), [
      'POST /v1/fleet/printers/prt_1/command',
      'GET /v1/fleet/printers/prt_1/commands/cmd_9',
      'PUT /v1/fleet/printers/prt_1',
    ]);
    assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { command: 'STATUS', wait: false });
  });

  await test('connect: print from a design and custom connections', async () => {
    await client.connect.printDesign({ printer_id: 'p', design_id: 'd', row_start: 1, row_count: 5 });
    await client.connect.custom.list();
    await client.connect.custom.create({ name: 'Cargo', kind: 'cargo' });
    await client.connect.custom.get('c 1');
    await client.connect.custom.update('c1', { name: 'X' });
    await client.connect.custom.delete('c1');
    await client.connect.custom.test('c1', { operationId: 'list' });
    await client.connect.custom.execute('c1', { operationId: 'createShipment', dryRun: true });
    assert.deepStrictEqual(calls.map(route), [
      'POST /v1/connect/print',
      'GET /v1/connect/custom',
      'POST /v1/connect/custom',
      'GET /v1/connect/custom/c%201',
      'PUT /v1/connect/custom/c1',
      'DELETE /v1/connect/custom/c1',
      'POST /v1/connect/custom/c1/test',
      'POST /v1/connect/custom/c1/execute',
    ]);
  });

  await test('passports', async () => {
    await client.passport.register({ link: 'x' });
    await client.passport.update({ link: 'x', fields: { state_of_health: 90 } });
    await client.passport.updateBatch([{ link: 'x' }]);
    await client.passport.reserveIdentifiers({ count: 2 });
    await client.passport.linkSuccession({ from: 'a', to: 'b' });
    await client.passport.setPage({ gtin: '09506000134352', brand: { name: 'B' } });
    await client.passport.generatePage({ category: 'battery' });
    await client.passport.resolve('/01/09506000134352/21/A B');
    assert.deepStrictEqual(calls.map(route), [
      'POST /v1/passport',
      'POST /v1/passport/update',
      'POST /v1/passport/update/batch',
      'POST /v1/passport/identifiers',
      'POST /v1/passport/succession',
      'POST /v1/passport/page',
      'POST /v1/passport/page/ai',
      'GET /v1/passport/resolve/01/09506000134352/21/A%20B',
    ]);
    assert.deepStrictEqual(JSON.parse(calls[2].opts.body), { updates: [{ link: 'x' }] });
    assert.deepStrictEqual(query(calls[7]), { format: 'json' });
  });

  await test('labels preview, UFI, compliance sign, relay, reprint overrides', async () => {
    await client.labels.preview({ data: { h_codes: ['H225'] } });
    await client.ufi.generate({ vat: 'DE123', formulationNumber: 1 });
    await client.ufi.decode('ABCD-EFGH');
    await client.audit.compliance.sign({ companyId: 'c', designId: 'd', decision: 'approved' });
    await client.relay.status();
    await client.print.reprint('job_1', { media_width_mm: 50 });
    assert.deepStrictEqual(calls.map(route), [
      'POST /v1/labels/preview',
      'POST /v1/ufi/generate',
      'POST /v1/ufi/decode',
      'POST /v1/compliance/sign',
      'GET /v1/relay/status',
      'POST /v1/print/jobs/job_1/reprint',
    ]);
    assert.deepStrictEqual(JSON.parse(calls[2].opts.body), { ufi: 'ABCD-EFGH' });
  });

  // UNIFIED PRINTERS: kind/family filters and office options go over the wire as given.
  await test('fleet.list kind/family filter and office print options', async () => {
    await client.fleet.list({ kind: 'receipt' });
    await client.fleet.list({ family: 'office', kind: 'office' });
    const office = { sheet: 'a4-21', paper: 'a4', start_at: 3, collate: true, color: 'grayscale' };
    await client.print.create({ printer_id: 'prt_hp', payload_type: 'image', image_url: 'https://x/doc.pdf', office });
    await client.designs.print('dsg_1', { printer_id: 'prt_hp', office: { sheet: 'a4-1' } });
    assert.deepStrictEqual(calls.map(route), [
      'GET /v1/fleet/printers',
      'GET /v1/fleet/printers',
      'POST /v1/print/jobs',
      'POST /v1/designs/dsg_1/print',
    ]);
    assert.deepStrictEqual(query(calls[0]), { kind: 'receipt' });
    assert.deepStrictEqual(query(calls[1]), { family: 'office', kind: 'office' });
    assert.deepStrictEqual(JSON.parse(calls[2].opts.body).office, office);
    assert.deepStrictEqual(JSON.parse(calls[3].opts.body).office, { sheet: 'a4-1' });
  });

  await test('office.fill_order goes over the wire as given; OFFICE_FILL_ORDERS lists the values', async () => {
    const LabelInnPkg = require('../lib/index.js');
    assert.deepStrictEqual([...LabelInnPkg.OFFICE_FILL_ORDERS],
      ['top_left_lr', 'top_right_rl', 'bottom_left_lr', 'bottom_right_rl']);
    const office = { sheet: 'a4-21', fill_order: 'bottom_right_rl' };
    await client.print.create({ printer_id: 'prt_hp', payload_type: 'template', design_id: 'dsg_1', office });
    assert.deepStrictEqual(JSON.parse(calls[0].opts.body).office, office);
  });

  await test('sites.nearest sends lat and lon (the names the API reads)', async () => {
    await client.sites.nearest(41.01, 28.97);
    assert.strictEqual(route(calls[0]), 'GET /v1/sites/nearest');
    assert.deepStrictEqual(query(calls[0]), { lat: '41.01', lon: '28.97' });
  });

  // ── UNIFIED PRINTERS R3: large files through POST /print/uploads ──

  await test('printFile: small file goes inline as payload_data, no upload', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1000, 7)]);
    await client.print.printFile('prt_1', png, { copies: 2, media_width_mm: 100, media_height_mm: 150 });
    assert.deepStrictEqual(calls.map(route), ['POST /v1/print/jobs']);
    assert.deepStrictEqual(JSON.parse(calls[0].opts.body), {
      printer_id: 'prt_1', payload_type: 'image', copies: 2, media_width_mm: 100, media_height_mm: 150,
      payload_data: png.toString('base64'),
    });
  });

  await test('printFile: exactly 500 KB of base64 is still inline', async () => {
    const buf = Buffer.alloc(384000, 1); // ceil(384000/3)*4 = 512000
    await client.print.printFile('prt_1', buf);
    assert.deepStrictEqual(calls.map(route), ['POST /v1/print/jobs']);
    assert.strictEqual(JSON.parse(calls[0].opts.body).payload_data.length, 512000);
  });

  await test('printFile: big file is uploaded (signed PUT, no auth) then printed by upload_id', async () => {
    const saved = global.fetch;
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600 * 1024, 3)]);
    const sha = crypto.createHash('sha256').update(big).digest('hex');
    const slotHeaders = {
      'Content-Type': 'image/png',
      'x-goog-content-length-range': `${big.length},${big.length}`,
      'x-goog-if-generation-match': '0',
    };
    global.fetch = async (url, opts) => {
      calls.push({ url: new URL(url), opts });
      const u = new URL(url);
      let body = { data: { ok: true } };
      if (u.host === 'storage.example') return { ok: true, status: 200, headers: { get: () => null }, json: async () => null, text: async () => '' };
      if (u.pathname === '/v1/print/uploads') {
        body = { data: { upload_id: 'up_' + 'a'.repeat(32), upload_url: 'https://storage.example/put?sig=1',
          method: 'PUT', headers: slotHeaders, expires_at: 'x', max_bytes: 26214400, max_pdf_pages: 200 } };
      } else if (u.pathname === '/v1/print/jobs') {
        body = { data: { id: 'job_9', upload_id: 'up_' + 'a'.repeat(32), file_size_bytes: big.length, file_kind: 'png' } };
      }
      return { ok: true, status: 201, headers: { get: () => null }, json: async () => body };
    };
    try {
      const job = await client.print.printFile('prt_1', big, { copies: 3, office: { sheet: 'a4-1' }, idempotencyKey: 'k1' });
      assert.deepStrictEqual(calls.map((c) => `${c.opts.method} ${c.url.host}${c.url.pathname}`), [
        'POST labelinn.com/v1/print/uploads',
        'PUT storage.example/put',
        'POST labelinn.com/v1/print/jobs',
      ]);
      assert.deepStrictEqual(JSON.parse(calls[0].opts.body),
        { content_type: 'image/png', size_bytes: big.length, sha256: sha });
      const put = calls[1].opts;
      assert.deepStrictEqual(put.headers, slotHeaders);
      assert.strictEqual(Object.keys(put.headers).some((k) => k.toLowerCase() === 'authorization'), false);
      assert.ok(Buffer.from(put.body).equals(big));
      assert.deepStrictEqual(JSON.parse(calls[2].opts.body), {
        printer_id: 'prt_1', payload_type: 'image', copies: 3, office: { sheet: 'a4-1' }, upload_id: 'up_' + 'a'.repeat(32),
      });
      assert.strictEqual(calls[2].opts.headers['X-Idempotency-Key'], 'k1');
      assert.strictEqual(job.file_kind, 'png');
    } finally {
      global.fetch = saved;
    }
  });

  await test('uploadFile: over 25 MB is refused before any request', async () => {
    const huge = Buffer.alloc(25 * 1024 * 1024 + 1);
    huge.write('%PDF-', 0, 'latin1');
    await assert.rejects(client.print.uploadFile(huge), (e) => e.code === 'PAYLOAD_TOO_LARGE');
    await assert.rejects(client.print.printFile('prt_1', huge), (e) => e.code === 'PAYLOAD_TOO_LARGE');
    assert.strictEqual(calls.length, 0);
  });

  await test('createUpload / getUpload paths and content sniffing', async () => {
    await client.print.createUpload('application/pdf', 10, 'f'.repeat(64), 'a.pdf');
    await client.print.getUpload('up_1');
    assert.deepStrictEqual(calls.map(route), ['POST /v1/print/uploads', 'GET /v1/print/uploads/up_1']);
    assert.deepStrictEqual(JSON.parse(calls[0].opts.body),
      { content_type: 'application/pdf', size_bytes: 10, sha256: 'f'.repeat(64), file_name: 'a.pdf' });
    const s = LabelInn.sniffContentType;
    assert.strictEqual(s(Buffer.from('%PDF-1.7')), 'application/pdf');
    assert.strictEqual(s(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
    assert.strictEqual(s(Buffer.from('GIF89a')), 'image/gif');
    assert.strictEqual(s(Buffer.from('BM\0\0')), 'image/bmp');
    assert.strictEqual(s(Buffer.from('RIFF\0\0\0\0WEBP')), 'image/webp');
    assert.strictEqual(s(Buffer.from([0x49, 0x49, 0x2a, 0x00])), 'image/tiff');
    assert.strictEqual(s(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])), 'image/tiff');
    assert.strictEqual(s(Buffer.from('hello')), null);
  });

  await require('./edge.test.js')(test);

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
