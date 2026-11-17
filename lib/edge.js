/**
 * LabelInn local Edge API client (`/local/v1/*`, port 6631 by default).
 *
 * Each PC running the LabelInn desktop app can serve this API. When the PC has
 * TLS switched on it uses its own self-signed certificate, so there is no CA to
 * trust: the client PINS the certificate instead. The SHA-256 of the
 * certificate's DER bytes (lowercase hex) is published as `tlsSha256` in
 * `~/.labelinn/edge.json` and in the company's device registry.
 *
 *   const { LabelInnEdge } = require('labelinn');
 *   const edge = LabelInnEdge.fromDescriptor();           // this PC
 *   const edge2 = new LabelInnEdge({ host: '192.168.1.40', token, tlsSha256 });
 *   const { jobId } = await edge.print({ printerId, payloadType: 'zpl', payloadData: '^XA^XZ' });
 *
 * Without a fingerprint (older app versions, TLS off) the client speaks plain
 * http, exactly as before.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const tls = require('tls');
const net = require('net');

const DEFAULT_PORT = 6631;

class LabelInnEdgeError extends Error {
  constructor(status, message, raw) {
    super(message);
    this.name = 'LabelInnEdgeError';
    this.status = status;
    this.raw = raw;
  }
}

/** The certificate did not match the pinned fingerprint. Nothing was sent. */
class LabelInnEdgePinError extends Error {
  constructor(expected, actual) {
    super(`Edge TLS certificate mismatch: expected sha256 ${expected}, got ${actual}. `
      + 'Refusing to send the request.');
    this.name = 'LabelInnEdgePinError';
    this.expected = expected;
    this.actual = actual;
  }
}

/** `AA:BB:..` or `aabb..` → `aabb..` (lowercase hex, no separators). */
function normalizeFingerprint(fp) {
  if (!fp) return null;
  const clean = String(fp).replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (clean.length !== 64) {
    throw new Error(`LabelInnEdge: tlsSha256 must be a SHA-256 hex fingerprint (64 hex digits), got "${fp}"`);
  }
  return clean;
}

/** SHA-256 of a certificate's DER bytes, lowercase hex. */
function certificateFingerprint(der) {
  return crypto.createHash('sha256').update(der).digest('hex');
}

function defaultDescriptorPath() {
  return path.join(os.homedir(), '.labelinn', 'edge.json');
}

/** Read `~/.labelinn/edge.json` (or `file`). Returns null when it is missing. */
function readDescriptor(file = defaultDescriptorPath()) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
  return JSON.parse(raw);
}

/**
 * Open a TLS socket and check the pin BEFORE any HTTP byte is written.
 * CA and hostname checks are skipped on purpose: the pin replaces them.
 */
function pinnedTlsConnect({ host, port, pin, timeout }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      rejectUnauthorized: false,
      servername: net.isIP(host) ? undefined : host,
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`LabelInnEdge: TLS connect to ${host}:${port} timed out`));
    }, timeout);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const cert = socket.getPeerCertificate(false);
      const actual = cert && cert.raw ? certificateFingerprint(cert.raw) : '(none)';
      if (actual !== pin) {
        socket.destroy();
        reject(new LabelInnEdgePinError(pin, actual));
        return;
      }
      resolve(socket);
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

class LabelInnEdge {
  /**
   * @param {object} [opts]
   * @param {string} [opts.host='127.0.0.1']
   * @param {number} [opts.port=6631]
   * @param {string} [opts.token] - Bearer token (edge.json `authToken`)
   * @param {string} [opts.tlsSha256] - Pin; when set the client uses https
   * @param {string} [opts.scheme] - 'http' | 'https' (default: https when a pin is given)
   * @param {number} [opts.timeout=30000] - ms
   */
  constructor(opts = {}) {
    this.host = opts.host || '127.0.0.1';
    this.port = opts.port || DEFAULT_PORT;
    this.token = opts.token || null;
    this.tlsSha256 = normalizeFingerprint(opts.tlsSha256);
    this.scheme = opts.scheme || (this.tlsSha256 ? 'https' : 'http');
    if (this.scheme !== 'http' && this.scheme !== 'https') {
      throw new Error(`LabelInnEdge: scheme must be http or https, got "${this.scheme}"`);
    }
    if (this.scheme === 'https' && !this.tlsSha256) {
      throw new Error('LabelInnEdge: https needs tlsSha256 — the edge certificate is '
        + 'self-signed and is trusted only by its pinned fingerprint.');
    }
    this.timeout = opts.timeout || 30000;
  }

  /**
   * Build a client from `~/.labelinn/edge.json`, written by the desktop app
   * while its edge server runs. `scheme: "https"` + `tlsSha256` there → pinned
   * https; no scheme → plain http (TLS off or an older app version).
   * @param {object} [opts] - { file?, host?, timeout? } (host overrides the file)
   */
  static fromDescriptor(opts = {}) {
    const d = readDescriptor(opts.file || defaultDescriptorPath());
    if (!d) {
      throw new Error('LabelInnEdge: no edge descriptor at '
        + `${opts.file || defaultDescriptorPath()} — is the LabelInn desktop app running its edge server?`);
    }
    return new LabelInnEdge({
      host: opts.host || d.host || '127.0.0.1',
      port: d.port || DEFAULT_PORT,
      token: d.authToken || null,
      tlsSha256: d.tlsSha256 || null,
      scheme: d.tlsSha256 ? (d.scheme || 'https') : 'http',
      timeout: opts.timeout,
    });
  }

  /** Base URL, e.g. `https://127.0.0.1:6631`. */
  get baseUrl() { return `${this.scheme}://${this.host}:${this.port}`; }

  async request(method, urlPath, body) {
    const headers = { Accept: 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let payload = null;
    if (body !== undefined && body !== null && method !== 'GET') {
      payload = Buffer.from(JSON.stringify(body), 'utf8');
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(payload.length);
    }

    let socket = null;
    if (this.scheme === 'https') {
      socket = await pinnedTlsConnect({
        host: this.host, port: this.port, pin: this.tlsSha256, timeout: this.timeout,
      });
    }

    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        host: this.host,
        port: this.port,
        method,
        path: urlPath,
        headers,
        timeout: this.timeout,
        // https: the already-verified TLS socket carries this one request.
        ...(socket ? { createConnection: () => socket } : { agent: false }),
      }, (r) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => resolve({
          status: r.statusCode,
          headers: r.headers,
          body: Buffer.concat(chunks),
        }));
        r.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error(`LabelInnEdge: ${method} ${urlPath} timed out`)));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

    const type = String(res.headers['content-type'] || '');
    let data = null;
    if (type.includes('json')) {
      try { data = JSON.parse(res.body.toString('utf8')); } catch { data = null; }
    } else {
      data = res.body;
    }
    if (res.status < 200 || res.status >= 300) {
      const msg = (data && typeof data === 'object' && !Buffer.isBuffer(data) && data.error)
        ? (typeof data.error === 'string' ? data.error : data.error.message || JSON.stringify(data.error))
        : `HTTP ${res.status}`;
      throw new LabelInnEdgeError(res.status, msg, data);
    }
    return data;
  }

  /** GET /local/v1/health (no auth). */
  health() { return this.request('GET', '/local/v1/health'); }

  /**
   * Submit a local print job (202). Poll `getJob(jobId)` for the result.
   * @param {object} job - { printerId, payloadType: 'zpl'|'escLabel'|'tpcl'|'design', payloadData?, designId?, designDataRows?, copies?, jobName? }
   */
  print(job) { return this.request('POST', '/local/v1/print/jobs', job); }

  /** GET /local/v1/jobs/{jobId} — 404 while processing or after it expired. */
  getJob(jobId) { return this.request('GET', `/local/v1/jobs/${encodeURIComponent(jobId)}`); }

  /** Printers on this PC and, unless `includePeers` is false, on LAN peers. */
  listPrinters({ includePeers } = {}) {
    const q = includePeers === false ? '?include_peers=false' : '';
    return this.request('GET', `/local/v1/fleet/printers${q}`);
  }

  listPeers() { return this.request('GET', '/local/v1/fleet/peers'); }

  startDiscovery() { return this.request('POST', '/local/v1/fleet/discover'); }

  getDiscovery(sessionId) {
    return this.request('GET', `/local/v1/fleet/discover/${encodeURIComponent(sessionId)}`);
  }

  listDesigns() { return this.request('GET', '/local/v1/designs'); }

  /** The design file (parsed JSON, or a Buffer for other content types). */
  getDesign(designId) {
    return this.request('GET', `/local/v1/designs/${encodeURIComponent(designId)}`);
  }

  scheduleStatus() { return this.request('GET', '/local/v1/rules/schedule/status'); }

  scheduleRunNow() { return this.request('POST', '/local/v1/rules/schedule/run-now'); }

  /** @param {object} [query] - { limit?: 1..500, action? } */
  auditRecent(query = {}) {
    const qs = new URLSearchParams();
    if (query.limit != null) qs.set('limit', String(query.limit));
    if (query.action) qs.set('action', String(query.action));
    const q = qs.toString();
    return this.request('GET', `/local/v1/audit/recent${q ? '?' + q : ''}`);
  }
}

module.exports = {
  LabelInnEdge,
  LabelInnEdgeError,
  LabelInnEdgePinError,
  readDescriptor,
  certificateFingerprint,
  normalizeFingerprint,
  defaultDescriptorPath,
};
