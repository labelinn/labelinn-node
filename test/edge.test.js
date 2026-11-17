'use strict';

// Edge client tests against REAL local servers: a pinned https server with a
// throwaway self-signed certificate (made with the openssl CLI; skipped when
// openssl is not installed) and a plain http one (older PCs, TLS off).

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  LabelInnEdge, LabelInnEdgePinError, LabelInnEdgeError,
} = require('../lib/index.js');
const { normalizeFingerprint } = require('../lib/edge.js');

function makeCert(dir) {
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
      '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=LabelInn Edge',
    ], { stdio: 'ignore' });
  } catch {
    return null;
  }
  const certPem = fs.readFileSync(cert, 'utf8');
  return {
    key: fs.readFileSync(key, 'utf8'),
    cert: certPem,
    sha256: crypto.createHash('sha256').update(new crypto.X509Certificate(certPem).raw).digest('hex'),
  };
}

function handler(seen) {
  return (req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/local/v1/health') return res.end(JSON.stringify({ status: 'ok' }));
      if (req.headers.authorization !== 'Bearer tok') {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: 'Authorization required' }));
      }
      if (req.method === 'POST' && req.url === '/local/v1/print/jobs') {
        res.statusCode = 202;
        return res.end(JSON.stringify({ jobId: 'j1', status: 'accepted' }));
      }
      if (req.url.startsWith('/local/v1/fleet/printers')) {
        return res.end(JSON.stringify({ printers: [], count: 0 }));
      }
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: 'Not found' }));
    });
  };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

module.exports = async function edgeTests(test) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labelinn-edge-'));
  const cert = makeCert(dir);

  await test('edge: fingerprint normalisation and constructor guards', async () => {
    const hex = 'ab'.repeat(32);
    assert.strictEqual(normalizeFingerprint(hex.toUpperCase().match(/../g).join(':')), hex);
    assert.throws(() => normalizeFingerprint('abc'), /64 hex/);
    assert.throws(() => new LabelInnEdge({ scheme: 'https' }), /tlsSha256/);
    assert.strictEqual(new LabelInnEdge({ tlsSha256: hex }).scheme, 'https');
    assert.strictEqual(new LabelInnEdge({}).baseUrl, 'http://127.0.0.1:6631');
  });

  await test('edge: fromDescriptor picks https+pin, or http for older PCs', async () => {
    const withTls = path.join(dir, 'tls.json');
    fs.writeFileSync(withTls, JSON.stringify({
      version: 1, host: '127.0.0.1', port: 7001, authToken: 't', scheme: 'https', tlsSha256: 'cd'.repeat(32),
    }));
    const a = LabelInnEdge.fromDescriptor({ file: withTls });
    assert.strictEqual(a.baseUrl, 'https://127.0.0.1:7001');
    assert.strictEqual(a.tlsSha256, 'cd'.repeat(32));
    assert.strictEqual(a.token, 't');

    const plain = path.join(dir, 'plain.json');
    fs.writeFileSync(plain, JSON.stringify({ version: 1, host: '127.0.0.1', port: 7002, authToken: 't' }));
    assert.strictEqual(LabelInnEdge.fromDescriptor({ file: plain }).baseUrl, 'http://127.0.0.1:7002');

    assert.throws(() => LabelInnEdge.fromDescriptor({ file: path.join(dir, 'missing.json') }), /no edge descriptor/);
  });

  await test('edge: plain http keeps working (TLS off / older app)', async () => {
    const seen = [];
    const server = http.createServer(handler(seen));
    const port = await listen(server);
    try {
      const edge = new LabelInnEdge({ port, token: 'tok' });
      const r = await edge.print({ printerId: 'p1', payloadType: 'zpl', payloadData: '^XA^XZ' });
      assert.deepStrictEqual(r, { jobId: 'j1', status: 'accepted' });
      assert.strictEqual(seen[0].headers['content-type'], 'application/json');
      assert.deepStrictEqual(JSON.parse(seen[0].body), { printerId: 'p1', payloadType: 'zpl', payloadData: '^XA^XZ' });
      await edge.listPrinters({ includePeers: false });
      assert.strictEqual(seen[1].url, '/local/v1/fleet/printers?include_peers=false');
      const bad = new LabelInnEdge({ port, token: 'nope' });
      await assert.rejects(() => bad.listPrinters(), (e) => e instanceof LabelInnEdgeError && e.status === 401);
    } finally {
      server.close();
    }
  });

  if (!cert) {
    console.log('  - edge: pinned https tests skipped (openssl not found)');
    return;
  }

  await test('edge: https with the right pin talks to the server', async () => {
    const seen = [];
    const server = https.createServer({ key: cert.key, cert: cert.cert }, handler(seen));
    const port = await listen(server);
    try {
      const edge = new LabelInnEdge({ port, token: 'tok', tlsSha256: cert.sha256 });
      assert.deepStrictEqual(await edge.health(), { status: 'ok' });
      const r = await edge.print({ printerId: 'p1', payloadType: 'zpl', payloadData: '^XA^XZ' });
      assert.strictEqual(r.jobId, 'j1');
      assert.strictEqual(seen[1].headers.authorization, 'Bearer tok');
    } finally {
      server.close();
    }
  });

  await test('edge: a wrong pin is refused before any request is sent', async () => {
    const seen = [];
    const server = https.createServer({ key: cert.key, cert: cert.cert }, handler(seen));
    const port = await listen(server);
    try {
      const edge = new LabelInnEdge({ port, token: 'tok', tlsSha256: '00'.repeat(32) });
      await assert.rejects(
        () => edge.print({ printerId: 'p1', payloadType: 'zpl', payloadData: 'SECRET' }),
        (e) => e instanceof LabelInnEdgePinError && e.actual === cert.sha256);
      assert.strictEqual(seen.length, 0, 'the server must not have received the request');
    } finally {
      server.close();
    }
  });
};
