/**
 * LabelInn Node.js SDK
 *
 * Usage:
 *   const LabelInn = require('labelinn');
 *   const client = new LabelInn('sk_live_xxxxx');
 *
 *   // Print a label from a template
 *   const job = await client.print.create({
 *     printer_id: 'abc123',
 *     payload_type: 'template',
 *     design_id: 'tmpl_shipping',
 *     data: { barcode: 'TR123', name: 'Ali' },
 *   });
 *
 *   // Check job status
 *   const status = await client.print.get(job.id);
 */

'use strict';

const crypto = require('crypto');
const { version: SDK_VERSION } = require('../package.json');

const BASE_URL = 'https://labelinn.com/v1';

/** Encode one path segment. */
function enc(v) { return encodeURIComponent(String(v)); }

/** `?a=1&b=2` from an object, skipping undefined/null; '' when empty. */
function toQuery(query = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const qstr = qs.toString();
  return qstr ? '?' + qstr : '';
}

class LabelInnError extends Error {
  constructor(status, code, message, raw) {
    super(message);
    this.name = 'LabelInnError';
    this.status = status;
    this.code = code;
    this.raw = raw;
  }
}

class LabelInnRateLimitError extends LabelInnError {
  constructor(status, code, message, retryAfter, raw) {
    super(status, code, message, raw);
    this.name = 'LabelInnRateLimitError';
    this.retryAfter = retryAfter;
  }
}

// ─── HTTP Client ─────────────────────────────────────────────

class HttpClient {
  constructor(apiKey, opts = {}) {
    this.apiKey = apiKey;
    this.baseUrl = opts.baseUrl || BASE_URL;
    this.timeout = opts.timeout || 30000;
  }

  async request(method, path, body, opts = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': `labelinn-node/${SDK_VERSION}`,
    };
    if (opts.idempotencyKey) {
      headers['X-Idempotency-Key'] = opts.idempotencyKey;
    }
    if (opts.headers) Object.assign(headers, opts.headers);

    const fetchOpts = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeout),
    };
    if (opts.rawBody !== undefined) {
      // Exact bytes, e.g. when they are signed (signed workflow triggers).
      fetchOpts.body = opts.rawBody;
    } else if (body && method !== 'GET') {
      fetchOpts.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOpts);

    // Parse rate limit headers
    const rateLimit = {
      limit: parseInt(response.headers.get('x-ratelimit-limit') || '0', 10),
      remaining: parseInt(response.headers.get('x-ratelimit-remaining') || '0', 10),
      reset: parseInt(response.headers.get('x-ratelimit-reset') || '0', 10),
    };

    let data;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const err = data?.error || {};
      if (response.status === 429) {
        throw new LabelInnRateLimitError(
          429, err.code || 'RATE_LIMIT_EXCEEDED',
          err.message || 'Rate limit exceeded',
          err.retry_after_seconds || rateLimit.reset,
          data
        );
      }
      throw new LabelInnError(
        response.status,
        err.code || 'API_ERROR',
        err.message || `HTTP ${response.status}`,
        data
      );
    }

    const result = data && data.data !== undefined ? data.data : data;
    // A 204 / empty body has nothing to annotate.
    if (result && typeof result === 'object') {
      result._rateLimit = rateLimit;
      if (data?._idempotent) result._idempotent = true;
      // List endpoints page with { pagination: { has_more, next_page_token } }
      // beside `data`; keep it reachable instead of dropping it on unwrap.
      if (data?.pagination) result._pagination = data.pagination;
    }
    return result;
  }

  get(path) { return this.request('GET', path); }
  post(path, body, opts) { return this.request('POST', path, body, opts); }
  put(path, body) { return this.request('PUT', path, body); }
  patch(path, body) { return this.request('PATCH', path, body); }
  del(path) { return this.request('DELETE', path); }
}

// ─── Resource: Print Jobs ────────────────────────────────────

class PrintResource {
  constructor(http) { this._http = http; }

  /**
   * Submit a print job.
   *
   * @param {object} params
   * @param {string} params.printer_id - Target printer ID
   * @param {string} params.payload_type - "zpl" | "image" | "template" | "ghs_row"
   * @param {string} [params.payload_data] - ZPL string or base64 image
   *   (UNIFIED PRINTERS: on an office printer whose `office.payload_types`
   *   includes "image", the image may also be a PDF)
   * @param {string} [params.image_url] - HTTPS URL to image (for payload_type:"image"; PDF allowed on office printers)
   *   (UNIFIED PRINTERS R3: files up to 25 MB; the API stages anything over 500 KB itself)
   * @param {string} [params.upload_id] - UNIFIED PRINTERS R3: a file sent through
   *   createUpload()/uploadFile() (payload_type:"image"; alias `file_id`) instead of payload_data/image_url
   * @param {string} [params.design_id] - Template ID (for payload_type:"template")
   * @param {object|object[]} [params.data] - Variable values for template
   * @param {string} [params.job_name] - Human-readable job name
   * @param {number} [params.copies] - Number of copies (1-1000)
   * @param {number} [params.media_width_mm] - Label width in mm
   * @param {number} [params.media_height_mm] - Label height in mm
   * @param {string} [params.priority] - "low" | "normal" | "high" | "urgent"
   * @param {string} [params.print_at] - ISO time to print at (future, max 30 days)
   * @param {string} [params.workflow_id] - Trigger a workflow with `data` instead
   * @param {object} [params.office] - UNIFIED PRINTERS: office (A4/Letter) printers only:
   *   { sheet?: "a4-21"|"a4-1"|"us-1"|"us-30"|..., grid?: { cols, rows, label_width_mm,
   *   label_height_mm, left_mm?, top_mm?, h_gap_mm?, v_gap_mm? }, paper?: "a4"|"letter"|"a5"|"legal",
   *   start_at?: number (1-based first cell), collate?: boolean,
   *   color?: "color"|"grayscale"|"black_white",
   *   fill_order?: "top_left_lr"|"top_right_rl"|"bottom_left_lr"|"bottom_right_rl" (default top_left_lr) }.
   *   Office printers take "template"
   *   (printed as label sheets, or a full page when the design is page-sized) and,
   *   when the printer's `office.payload_types` includes "image", "image" (PNG/JPEG/...
   *   or PDF: one full page per image/PDF page unless media_width_mm/media_height_mm
   *   are given). "zpl"/"ghs_row" are refused with OFFICE_PRINTER_NEEDS_DESIGN;
   *   office options on a label printer with OFFICE_OPTIONS_FOR_LABEL_PRINTER; "zpl"
   *   to an ESC/POS, Phomemo, DYMO or Brother QL printer with PRINTER_LANGUAGE_MISMATCH;
   *   a bare "image" to an Epson colour printer with PRINTER_LANGUAGE_MISMATCH too
   *   (send a "template": put the image in a design).
   * @param {string} [opts.idempotencyKey] - Prevents duplicate prints
   * @returns {Promise<object>} Created job
   */
  create(params, opts = {}) {
    return this._http.post('/print/jobs', params, opts);
  }

  /**
   * List print jobs.
   * @param {object} [query] - { status, printer_id, limit, page_token }
   */
  list(query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/print/jobs${qstr ? '?' + qstr : ''}`);
  }

  /**
   * Get a single print job by ID.
   * @param {string} jobId
   */
  get(jobId) {
    return this._http.get(`/print/jobs/${jobId}`);
  }

  /**
   * Cancel a queued print job.
   * @param {string} jobId
   */
  cancel(jobId) {
    return this._http.del(`/print/jobs/${jobId}`);
  }

  /**
   * Reprint a previous job. Rows of a completed job are read back from its
   * audit record by the server, so no `data` is needed to repeat them.
   * @param {string} jobId
   * @param {object} [overrides] - { printer_id, copies, data, media_width_mm, media_height_mm }
   */
  reprint(jobId, overrides = {}) {
    return this._http.post(`/print/jobs/${jobId}/reprint`, overrides);
  }

  /**
   * Retry a failed job (creates new job from original).
   * @param {string} jobId
   * @param {object} [params] - { printer_id } optional override
   */
  retry(jobId, params = {}) {
    return this._http.post(`/print/jobs/${jobId}/retry`, params);
  }

  /**
   * Submit up to 100 print jobs in a single request.
   * @param {object[]} jobs - Array of job objects
   */
  batch(jobs) {
    return this._http.post('/print/batch', { jobs });
  }

  // ── UNIFIED PRINTERS R3: large files (PDF / images up to 25 MB) ──

  /**
   * UNIFIED PRINTERS R3: reserve an upload slot (POST /print/uploads).
   * @param {string} contentType - application/pdf | image/png | image/jpeg | image/gif | image/bmp | image/webp | image/tiff
   * @param {number} sizeBytes - exact file size in bytes (max 25 MB)
   * @param {string} sha256 - lowercase hex SHA-256 of the raw bytes
   * @param {string} [fileName]
   * @returns {Promise<object>} { upload_id, upload_url, method, headers, expires_at, max_bytes, max_pdf_pages, delete_after }
   */
  createUpload(contentType, sizeBytes, sha256, fileName) {
    const body = { content_type: contentType, size_bytes: sizeBytes, sha256 };
    if (fileName) body.file_name = fileName;
    return this._http.post('/print/uploads', body);
  }

  /**
   * UNIFIED PRINTERS R3: read an upload (status "pending" | "ready").
   * @param {string} uploadId
   */
  getUpload(uploadId) {
    return this._http.get(`/print/uploads/${enc(uploadId)}`);
  }

  /**
   * UNIFIED PRINTERS R3: upload a file and return its `upload_id`. The content
   * type is read from the file's first bytes when not given. The bytes are PUT
   * to the signed storage URL with exactly the headers the API returned (and
   * no Authorization header). Files over 25 MB are refused before any request.
   * @param {Buffer|Uint8Array|ArrayBuffer} bytes
   * @param {string} [contentType]
   * @param {string} [fileName]
   * @returns {Promise<string>} upload_id
   */
  async uploadFile(bytes, contentType, fileName) {
    const buf = toBuffer(bytes);
    if (buf.length === 0) throw new LabelInnError(0, 'INVALID_FIELD', 'LabelInn: the file is empty', null);
    if (buf.length > MAX_UPLOAD_BYTES) {
      throw new LabelInnError(413, 'PAYLOAD_TOO_LARGE',
        `LabelInn: the file is ${buf.length} bytes; a print upload is at most ${MAX_UPLOAD_BYTES} bytes (25 MB). Split the PDF into smaller jobs.`, null);
    }
    const ct = contentType || sniffContentType(buf);
    if (!ct) {
      throw new LabelInnError(415, 'UNSUPPORTED_MEDIA_TYPE',
        'LabelInn: could not tell the file type from its bytes; pass contentType (application/pdf, image/png, image/jpeg, image/gif, image/bmp, image/webp or image/tiff)', null);
    }
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const up = await this.createUpload(ct, buf.length, sha256, fileName);
    // Test keys get no URL (nothing is written); the job call then answers in test mode.
    if (up && up.upload_url) {
      const res = await fetch(up.upload_url, {
        method: up.method || 'PUT',
        headers: { ...(up.headers || {}) },
        body: buf,
        signal: AbortSignal.timeout(Math.max(this._http.timeout, UPLOAD_PUT_TIMEOUT_MS)),
      });
      if (!res.ok) {
        let text = '';
        try { text = await res.text(); } catch { /* no body */ }
        throw new LabelInnError(res.status, 'UPLOAD_FAILED',
          `LabelInn: uploading the file to storage failed (HTTP ${res.status})`, text || null);
      }
    }
    return up.upload_id;
  }

  /**
   * UNIFIED PRINTERS R3: print a PDF or image file. Small files (base64 ≤ 500 KB)
   * go inline as `payload_data`, exactly like `create({payload_type: 'image', ...})`;
   * larger ones (up to 25 MB) are uploaded first and printed by `upload_id`.
   * @param {string} printerId
   * @param {Buffer|Uint8Array|ArrayBuffer|string} bytesOrPath - the bytes, or a file path
   * @param {object} [opts] - { copies, media_width_mm, media_height_mm, office, job_name,
   *   priority, print_at, content_type, file_name, idempotencyKey, ...other job fields }
   * @returns {Promise<object>} Created job
   */
  async printFile(printerId, bytesOrPath, opts = {}) {
    const { content_type: contentType, file_name: fileNameOpt, idempotencyKey, ...jobFields } = opts || {};
    let fileName = fileNameOpt;
    let buf;
    if (typeof bytesOrPath === 'string') {
      buf = require('fs').readFileSync(bytesOrPath);
      if (!fileName) fileName = require('path').basename(bytesOrPath);
    } else {
      buf = toBuffer(bytesOrPath);
    }
    const job = { printer_id: printerId, payload_type: 'image', ...jobFields };
    const createOpts = idempotencyKey ? { idempotencyKey } : {};
    if (base64Length(buf.length) <= INLINE_MAX_BASE64) {
      return this.create({ ...job, payload_data: buf.toString('base64') }, createOpts);
    }
    const uploadId = await this.uploadFile(buf, contentType, fileName);
    return this.create({ ...job, upload_id: uploadId }, createOpts);
  }
}

// ─── UNIFIED PRINTERS R3: file helpers ───────────────────────

/** UNIFIED PRINTERS R3: inline payload_data cap (base64 characters). */
const INLINE_MAX_BASE64 = 500 * 1024;
/** UNIFIED PRINTERS R3: largest file POST /print/uploads accepts (25 MB). */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** UNIFIED PRINTERS R3: floor for the storage PUT timeout (big files take a while). */
const UPLOAD_PUT_TIMEOUT_MS = 300000;

/** UNIFIED PRINTERS R3: length of the base64 text for n bytes. */
function base64Length(n) { return Math.ceil(n / 3) * 4; }

/** UNIFIED PRINTERS R3 */
function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new TypeError('LabelInn: file bytes must be a Buffer, Uint8Array or ArrayBuffer');
}

/**
 * UNIFIED PRINTERS R3: content type from magic bytes, or null. Same checks,
 * same order as the API's sniffKind() (functions/api/printUploads.js).
 */
function sniffContentType(b) {
  if (!b || b.length < 4) return null;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'application/pdf';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00)
    || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)) return 'image/tiff';
  return null;
}

// ─── Resource: Fleet (Printers) ──────────────────────────────

class FleetResource {
  constructor(http) {
    this._http = http;
    this.groups = new FleetGroupsResource(http);
  }

  /**
   * Labels or ribbon running low or out, across the fleet.
   * @param {object} [query] - { state, printer_id, limit }
   */
  supplyAlerts(query = {}) { return this._http.get(`/fleet/supply-alerts${toQuery(query)}`); }

  /**
   * List all printers.
   * @param {object} [query] - { status, type, connection, family, kind }
   *   UNIFIED PRINTERS: `family` = "label"|"office"; `kind` = "label"|"receipt"|"color"|"office".
   *   Each printer carries `kind`, `family` / `printer_family` and, for office printers,
   *   `office` (incl. `payload_types`: ["template"] or ["template","image"]).
   */
  list(query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/fleet/printers${qstr ? '?' + qstr : ''}`);
  }

  /**
   * Get printer details + telemetry.
   * @param {string} printerId
   */
  get(printerId) {
    return this._http.get(`/fleet/printers/${printerId}`);
  }

  /**
   * Get live printer status (lightweight).
   * @param {string} printerId
   */
  status(printerId) {
    return this._http.get(`/fleet/printers/${printerId}/status`);
  }

  /**
   * Update a printer. Only the fields you send change.
   * @param {string} printerId
   * @param {object} params - { name?, metadata?, allowed_user_ids?, site_id?, is_hidden?, is_locked?, lock_reason? }
   */
  update(printerId, params) {
    return this._http.put(`/fleet/printers/${printerId}`, params);
  }

  /**
   * Send a control command to an online printer and wait for its answer.
   * Returns the result, or `{ status: 'queued'|'pending', poll_url }` when the
   * device has not answered (or `wait: false`); then poll `getCommand()`.
   * @param {string} printerId
   * @param {string} command - STATUS | FEED | CALIBRATE | RESET | PAUSE | RESUME | TEST_PRINT | WRITE_CONFIG | CANCEL_ALL | IDENTIFY | SET_MEDIA | RAW
   * @param {object} [opts] - { args?, wait?, timeout_ms? }
   */
  command(printerId, command, opts = {}) {
    return this._http.post(`/fleet/printers/${enc(printerId)}/command`, { command, ...opts });
  }

  /** Read a command's result (for `wait: false` or a pending command). */
  getCommand(printerId, commandId) {
    return this._http.get(`/fleet/printers/${enc(printerId)}/commands/${enc(commandId)}`);
  }

  /**
   * Flash/beep a printer to identify it.
   * @param {string} printerId
   */
  identify(printerId) {
    return this._http.post(`/fleet/printers/${printerId}/identify`);
  }

  /**
   * Set media definition on a printer.
   * @param {string} printerId
   * @param {object} params - { width_mm, height_mm, media_type, gap_mm, ... }
   */
  setMedia(printerId, params) {
    return this._http.put(`/fleet/printers/${printerId}/media`, params);
  }

  // ── Discovery ──

  /**
   * Start a printer auto-discovery session.
   * A device running the LabelInn desktop app will scan for USB, network, and Bluetooth printers.
   * @param {object} [params] - { device_id } target a specific device (optional)
   * @returns {{ data: { session_id, status, message } }}
   */
  startDiscovery(params = {}) {
    return this._http.post('/fleet/discover', params);
  }

  /**
   * Poll a discovery session for results.
   * @param {string} sessionId - Session ID from startDiscovery
   * @returns {{ data: { session_id, status, printers, count } }}
   */
  getDiscoveryStatus(sessionId) {
    return this._http.get(`/fleet/discover/${sessionId}`);
  }

  /**
   * Add a discovered printer to your fleet.
   * @param {string} sessionId - Discovery session ID
   * @param {object} params - { address, name? }
   * @returns {{ data: { id, name, address, type, status } }}
   */
  addDiscoveredPrinter(sessionId, params) {
    return this._http.post(`/fleet/discover/${sessionId}/add`, params);
  }
}

class FleetGroupsResource {
  constructor(http) { this._http = http; }

  create(params) { return this._http.post('/fleet/groups', params); }
  list(query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/fleet/groups${qstr ? '?' + qstr : ''}`);
  }
  get(groupId) { return this._http.get(`/fleet/groups/${groupId}`); }
  update(groupId, params) { return this._http.put(`/fleet/groups/${groupId}`, params); }
  delete(groupId) { return this._http.del(`/fleet/groups/${groupId}`); }
}

// ─── Resource: Designs (Templates) ───────────────────────────

class DesignsResource {
  constructor(http) { this._http = http; }

  list(query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/designs${qstr ? '?' + qstr : ''}`);
  }

  get(designId) {
    return this._http.get(`/designs/${designId}`);
  }

  create(params) {
    return this._http.post('/designs', params);
  }

  update(designId, params) {
    return this._http.put(`/designs/${designId}`, params);
  }

  delete(designId) {
    return this._http.del(`/designs/${designId}`);
  }

  // ── Elements ──

  listElements(designId) {
    return this._http.get(`/designs/${designId}/elements`);
  }

  addElement(designId, params) {
    return this._http.post(`/designs/${designId}/elements`, params);
  }

  updateElement(designId, elementId, params) {
    return this._http.patch(`/designs/${designId}/elements/${elementId}`, params);
  }

  deleteElement(designId, elementId) {
    return this._http.del(`/designs/${designId}/elements/${elementId}`);
  }

  // ── Variables & Actions ──

  listVariables(designId) {
    return this._http.get(`/designs/${designId}/variables`);
  }

  clone(designId) {
    return this._http.post(`/designs/${designId}/clone`);
  }

  render(designId, params = {}) {
    return this._http.post(`/designs/${designId}/render`, params);
  }

  /**
   * Print a design directly with data.
   * @param {string} designId
   * @param {object} params - { printer_id, data, copies, office? }
   *   (UNIFIED PRINTERS: `office` sheet options apply when printer_id is an office printer)
   */
  print(designId, params) {
    return this._http.post(`/designs/${designId}/print`, params);
  }

  /**
   * List revision history for a design.
   * @param {string} designId
   * @param {object} [query] - { limit }
   */
  revisions(designId, query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/designs/${designId}/revisions${qstr ? '?' + qstr : ''}`);
  }

  // ── Publish & Snapshots ──

  publish(designId, params = {}) {
    return this._http.post(`/designs/${designId}/publish`, params);
  }

  listSnapshots(designId, query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/designs/${designId}/snapshots${qstr ? '?' + qstr : ''}`);
  }

  getSnapshot(designId, snapshotId) {
    return this._http.get(`/designs/${designId}/snapshots/${snapshotId}`);
  }

  // ── Pages (multi-page labels) ──

  listPages(designId) {
    return this._http.get(`/designs/${designId}/pages`);
  }

  listPageElements(designId, pageId) {
    return this._http.get(`/designs/${designId}/pages/${pageId}/elements`);
  }

  addPageElement(designId, pageId, params) {
    return this._http.post(`/designs/${designId}/pages/${pageId}/elements`, params);
  }

  updatePageElement(designId, pageId, elementId, params) {
    return this._http.patch(`/designs/${designId}/pages/${pageId}/elements/${elementId}`, params);
  }

  deletePageElement(designId, pageId, elementId) {
    return this._http.del(`/designs/${designId}/pages/${pageId}/elements/${elementId}`);
  }

  /** Replace an element on a page (PUT — every field you omit is reset). */
  replacePageElement(designId, pageId, elementId, params) {
    return this._http.put(`/designs/${designId}/pages/${pageId}/elements/${elementId}`, params);
  }

  /** Poll an async render started by render(). */
  renderStatus(renderId) {
    return this._http.get(`/designs/renders/${renderId}`);
  }
}

// ─── Resource: Webhooks ──────────────────────────────────────

class WebhooksResource {
  constructor(http) { this._http = http; }

  /**
   * Subscribe to events.
   * @param {object} params - { url, events, description }
   */
  create(params) {
    return this._http.post('/webhooks', params);
  }

  list() {
    return this._http.get('/webhooks');
  }

  delete(webhookId) {
    return this._http.del(`/webhooks/${webhookId}`);
  }

  /**
   * Send a test ping to a webhook endpoint.
   * @param {string} webhookId
   */
  test(webhookId) {
    return this._http.post(`/webhooks/${webhookId}/test`);
  }

  /**
   * Update a webhook subscription.
   * @param {string} webhookId
   * @param {object} params - { url, events, description, enabled }
   */
  update(webhookId, params) {
    return this._http.put(`/webhooks/${webhookId}`, params);
  }

  /**
   * List recent delivery attempts for a webhook.
   * @param {string} webhookId
   * @param {object} [query] - { limit }
   */
  deliveries(webhookId, query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/webhooks/${webhookId}/deliveries${qstr ? '?' + qstr : ''}`);
  }

  get(webhookId) {
    return this._http.get(`/webhooks/${webhookId}`);
  }

  events() {
    return this._http.get('/webhooks/events');
  }
}

// ─── Resource: Render-as-a-Service ───────────────────────────

class RenderResource {
  constructor(http) { this._http = http; }

  create(params) { return this._http.post('/render', params); }
  html(params) { return this._http.post('/render/html', params); }
  get(renderId) { return this._http.get(`/render/${renderId}`); }
  getImage(renderId) { return this._http.get(`/render/${renderId}/image`); }
}

// ─── Resource: Rules Engine ──────────────────────────────────

class RulesResource {
  constructor(http) { this._http = http; }

  create(params) { return this._http.post('/rules', params); }
  list(query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/rules${qstr ? '?' + qstr : ''}`);
  }
  get(ruleId) { return this._http.get(`/rules/${ruleId}`); }
  update(ruleId, params) { return this._http.put(`/rules/${ruleId}`, params); }
  delete(ruleId) { return this._http.del(`/rules/${ruleId}`); }
  test(ruleId, sampleData = {}) { return this._http.post(`/rules/${ruleId}/test`, sampleData); }
}

// ─── Resource: Audit & Compliance ────────────────────────────

class AuditResource {
  constructor(http) {
    this._http = http;
    this.compliance = new ComplianceResource(http);
  }

  list(query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/audit/trail${qstr ? '?' + qstr : ''}`);
  }
  get(entryId) { return this._http.get(`/audit/trail/${entryId}`); }
  summary(query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/audit/summary${qstr ? '?' + qstr : ''}`);
  }
  ingest(events) { return this._http.post('/audit/ingest', { events }); }

  // ── Print history (forensic record of every job) ──

  /** @param {object} [query] - { start, end, printerId, designId, status, limit, page_token } */
  printHistory(query = {}) { return this._http.get(`/audit/print-history${toQuery(query)}`); }
  printHistoryEntry(jobId) { return this._http.get(`/audit/print-history/${jobId}`); }
  printArtifacts(jobId) { return this._http.get(`/audit/print-history/${jobId}/artifacts`); }
  /** Signed download URL for one captured artefact. @param {object} [query] - { as } */
  printArtifact(jobId, kind, query = {}) {
    return this._http.get(`/audit/print-history/${jobId}/artifacts/${kind}${toQuery(query)}`);
  }
  /** @param {object} [expect] - { expect_status, expect_design_id, expect_printer_id, expect_copies } */
  verifyPrint(jobId, expect = {}) {
    return this._http.get(`/audit/print-history/${jobId}/verify${toQuery(expect)}`);
  }
  /** @param {object} [query] - { start_seq, end_seq, limit } */
  verifyChain(query = {}) { return this._http.get(`/audit/verify-chain${toQuery(query)}`); }
}

// ─── Resource: Workflows ─────────────────────────────────────

class WorkflowsResource {
  constructor(http) { this._http = http; }

  /** The workflow building contract: node types, ports and config. */
  capabilities() { return this._http.get('/workflows/capabilities'); }
  /** @param {object} [query] - { limit, page_token } */
  list(query = {}) { return this._http.get(`/workflows${toQuery(query)}`); }
  get(workflowId) { return this._http.get(`/workflows/${workflowId}`); }
  /** @param {object} params - { name, nodes, edges, enabled, description } */
  create(params) {
    return this._http.post('/workflows', { nodes: [], edges: [], enabled: true, ...params });
  }
  /** Replace the whole graph (bumps the version). */
  replace(workflowId, workflow) { return this._http.put(`/workflows/${workflowId}`, workflow); }
  /** Patch name, description, canvas, nodes, edges or enabled. */
  update(workflowId, fields) { return this._http.patch(`/workflows/${workflowId}`, fields); }
  delete(workflowId) { return this._http.del(`/workflows/${workflowId}`); }
  /** Dry-run with a sample record. Nothing prints. */
  test(workflowId, row = {}) { return this._http.post(`/workflows/${workflowId}/test`, { row }); }

  listTriggers(workflowId) { return this._http.get(`/workflows/${workflowId}/triggers`); }
  /**
   * Mint an inbound trigger URL. With { signed: true } the response carries a
   * `secret` (shown once) that fire() uses to sign each call.
   * @param {object} [opts] - { node_id, signed }
   */
  createTrigger(workflowId, opts = {}) {
    return this._http.post(`/workflows/${workflowId}/triggers`, { signed: false, ...opts });
  }
  deleteTrigger(workflowId, token) { return this._http.del(`/workflows/${workflowId}/triggers/${token}`); }

  /**
   * Run a workflow with `row` through its inbound trigger. Pass { secret } for
   * a signed trigger: the exact request bytes are signed with HMAC-SHA256 and
   * sent as `X-LabelInn-Signature: sha256=<hex>`.
   */
  fire(workflowId, token, row, opts = {}) {
    const rawBody = JSON.stringify(row);
    const headers = {};
    if (opts.secret) {
      const digest = crypto.createHmac('sha256', opts.secret).update(rawBody).digest('hex');
      headers['X-LabelInn-Signature'] = `sha256=${digest}`;
    }
    return this._http.request('POST', `/workflows/${workflowId}/trigger/${token}`, undefined,
      { rawBody, headers });
  }
}

class ComplianceResource {
  constructor(http) { this._http = http; }

  createPool(params) { return this._http.post('/audit/compliance/pools', params); }
  listPools(query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/audit/compliance/pools${qstr ? '?' + qstr : ''}`);
  }
  getPool(poolId) { return this._http.get(`/audit/compliance/pools/${poolId}`); }
  allocate(poolId, params) { return this._http.post(`/audit/compliance/pools/${poolId}/allocate`, params); }
  void(poolId, params) { return this._http.post(`/audit/compliance/pools/${poolId}/void`, params); }
  report(poolId) { return this._http.get(`/audit/compliance/pools/${poolId}/report`); }

  /**
   * Sign a design compliance review (needs the opt-in `compliance_review` scope).
   * @param {object} params - { companyId, designId, decision: 'approved'|'rejected', notes?, scope?, reviewerRole? }
   */
  sign(params) { return this._http.post('/compliance/sign', params); }
}

// ─── Resource: Sites & Geo-Routing ───────────────────────────

class SitesResource {
  constructor(http) { this._http = http; }

  create(params) { return this._http.post('/sites', params); }
  list(query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/sites${qstr ? '?' + qstr : ''}`);
  }
  get(siteId) { return this._http.get(`/sites/${siteId}`); }
  update(siteId, params) { return this._http.put(`/sites/${siteId}`, params); }
  delete(siteId) { return this._http.del(`/sites/${siteId}`); }
  /** Nearest site; the API reads `lat` and `lon`. */
  nearest(lat, lng) { return this._http.get(`/sites/nearest${toQuery({ lat, lon: lng })}`); }
  assignPrinters(siteId, params) { return this._http.post(`/sites/${siteId}/printers`, params); }
  removePrinter(siteId, printerId) { return this._http.del(`/sites/${siteId}/printers/${printerId}`); }
  analytics(siteId, query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/sites/${siteId}/analytics${qstr ? '?' + qstr : ''}`);
  }
}

// ─── Resource: Analytics ─────────────────────────────────────

class AnalyticsResource {
  constructor(http) { this._http = http; }

  predictions(printerId) { return this._http.get(`/analytics/predictions/${printerId}`); }
  fleetTrends(query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/analytics/fleet/trends${qstr ? '?' + qstr : ''}`);
  }
  qualityScore(printerId) { return this._http.get(`/analytics/quality/${printerId}`); }
  simulate(params) { return this._http.post('/analytics/digital-twin/simulate', params); }
  compare(params) { return this._http.post('/analytics/digital-twin/compare', params); }
}

// ─── Resource: Usage ─────────────────────────────────────────

class UsageResource {
  constructor(http) { this._http = http; }

  summary() { return this._http.get('/usage'); }
  daily(query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/usage/daily${qstr ? '?' + qstr : ''}`);
  }
}

// ─── Main Client ─────────────────────────────────────────────

class ConnectResource {
  constructor(http) { this._http = http; }

  /**
   * Push data in any format (XML, CSV, JSON).
   * @param {object} params - { payload, source_id?, format?, name?, config? }
   */
  ingest(params) {
    return this._http.post('/connect/ingest', params);
  }

  /**
   * Parse data without storing (dry run).
   * @param {object} params - { payload, format?, config? }
   */
  testParse(params) {
    return this._http.post('/connect/test-parse', params);
  }

  /**
   * Create a connector source.
   * @param {object} params - { name, description?, format?, config? }
   */
  createSource(params) {
    return this._http.post('/connect/sources', params);
  }

  /** List all connector sources. */
  listSources(query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/connect/sources${qstr ? '?' + qstr : ''}`);
  }

  /** Get a connector source by ID. */
  getSource(sourceId) {
    return this._http.get(`/connect/sources/${sourceId}`);
  }

  /** Update a connector source. */
  updateSource(sourceId, params) {
    return this._http.put(`/connect/sources/${sourceId}`, params);
  }

  /** Delete (deactivate) a connector source. */
  deleteSource(sourceId) {
    return this._http.del(`/connect/sources/${sourceId}`);
  }

  /** Get records from a connector source. */
  listRecords(sourceId, query = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const qstr = qs.toString();
    return this._http.get(`/connect/sources/${sourceId}/records${qstr ? '?' + qstr : ''}`);
  }

  /** Get discovered schema for a connector source. */
  getSchema(sourceId) {
    return this._http.get(`/connect/sources/${sourceId}/schema`);
  }

  /** Get field mappings for a connector source. */
  getMappings(sourceId) {
    return this._http.get(`/connect/sources/${sourceId}/mappings`);
  }

  /** Set field→label mappings. */
  updateMappings(sourceId, mappings) {
    return this._http.put(`/connect/sources/${sourceId}/mappings`, { mappings });
  }

  /**
   * Print labels from connector data.
   * @param {string} sourceId
   * @param {object} params - { printer_id, design_id, record_ids?, ingest_id?, row_start?, row_end?, row_count?, copies?, field_mappings? }
   */
  print(sourceId, params) {
    return this._http.post(`/connect/sources/${sourceId}/print`, params);
  }

  /**
   * Print a design from its data source. `source_id` is optional: without it
   * the source the design is bound to (a `connect:<id>` element) is used.
   * @param {object} params - { printer_id, design_id, source_id?, record_ids?, ingest_id?, row_start?, row_end?, row_count?, copies? }
   */
  printDesign(params) {
    return this._http.post('/connect/print', params);
  }
}

// ─── Resource: Custom API connections (/connect/custom) ──────

class CustomConnectionsResource {
  constructor(http) { this._http = http; }

  /** List custom API connections (credential values are never returned). */
  list() { return this._http.get('/connect/custom'); }

  /**
   * Create a connection.
   * @param {object} params - { name, kind: 'marketplace'|'cargo'|'generic', baseUrl, manifest, credentials, description? }
   */
  create(params) { return this._http.post('/connect/custom', params); }

  get(connectionId) { return this._http.get(`/connect/custom/${enc(connectionId)}`); }

  /** Partial update; send `credentials` only to replace them. */
  update(connectionId, params) { return this._http.put(`/connect/custom/${enc(connectionId)}`, params); }

  delete(connectionId) { return this._http.del(`/connect/custom/${enc(connectionId)}`); }

  /**
   * Test one operation.
   * @param {object} [params] - { operationId?, live?, input? }
   */
  test(connectionId, params = {}) { return this._http.post(`/connect/custom/${enc(connectionId)}/test`, params); }

  /**
   * Run an operation. Side-effect operations need `confirmSideEffect: true`
   * and an `idempotencyKey` unless `dryRun` is set.
   * @param {object} params - { operationId, input?, dryRun?, confirmSideEffect?, idempotencyKey? }
   */
  execute(connectionId, params) { return this._http.post(`/connect/custom/${enc(connectionId)}/execute`, params); }
}

// ─── Resource: Product passports (/passport) ─────────────────

class PassportResource {
  constructor(http) { this._http = http; }

  /** Register a passport for one item (GS1 Digital Link). */
  register(params) { return this._http.post('/passport', params); }

  /** Push live data onto an issued passport (state of health, status, ...). */
  update(params) { return this._http.post('/passport/update', params); }

  /** Up to 500 updates in one call; each item is an `update()` body. */
  updateBatch(updates) { return this._http.post('/passport/update/batch', { updates }); }

  /** Reserve serials / identifiers for passports. */
  reserveIdentifiers(params) { return this._http.post('/passport/identifiers', params); }

  /** Link a passport to its successor (repurposed / remanufactured item). */
  linkSuccession(params) { return this._http.post('/passport/succession', params); }

  /**
   * Design the hosted page for a GTIN.
   * @param {object} params - { gtin, page_layout?, brand?, static_fields?, category?, product_name?, font_family? }
   */
  setPage(params) { return this._http.post('/passport/page', params); }

  /** Generate a page layout with AI (not saved). */
  generatePage(params = {}) { return this._http.post('/passport/page/ai', params); }

  /**
   * Resolve a GS1 Digital Link path as JSON (public route).
   * @param {string} path - e.g. "01/09506000134352/21/ABC123"
   */
  resolve(path) {
    const clean = String(path).replace(/^\/+/, '').split('/').map(enc).join('/');
    return this._http.get(`/passport/resolve/${clean}?format=json`);
  }
}

// ─── Resource: GHS label preview, UFI, relay ─────────────────

class LabelsResource {
  constructor(http) { this._http = http; }

  /**
   * Resolve a chemical (GHS) row without printing.
   * @param {object} params - { data, strict_level?, source_id?, transform? }
   */
  preview(params) { return this._http.post('/labels/preview', params); }
}

class UfiResource {
  constructor(http) { this._http = http; }

  /** @param {object} params - { vat, formulationNumber, countryCode? } */
  generate(params) { return this._http.post('/ufi/generate', params); }

  decode(ufi) { return this._http.post('/ufi/decode', { ufi }); }
}

class RelayResource {
  constructor(http) { this._http = http; }

  status() { return this._http.get('/relay/status'); }
}

class LabelInn {
  /**
   * Create a LabelInn API client.
   *
   * @param {string} apiKey - Your API key (sk_live_xxx or sk_test_xxx)
   * @param {object} [opts]
   * @param {string} [opts.baseUrl] - Override API base URL
   * @param {number} [opts.timeout] - Request timeout in ms (default: 30000)
   */
  constructor(apiKey, opts = {}) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('LabelInn: apiKey is required. Get one at https://labelinn.com → Settings → API Keys');
    }
    if (!apiKey.startsWith('sk_live_') && !apiKey.startsWith('sk_test_')) {
      throw new Error('LabelInn: apiKey must start with sk_live_ or sk_test_');
    }

    this._http = new HttpClient(apiKey, opts);

    /** @type {PrintResource} Print job operations */
    this.print = new PrintResource(this._http);

    /** @type {FleetResource} Printer fleet management */
    this.fleet = new FleetResource(this._http);

    /** @type {DesignsResource} Design/template management */
    this.designs = new DesignsResource(this._http);

    /** @type {WebhooksResource} Webhook subscriptions */
    this.webhooks = new WebhooksResource(this._http);

    /** @type {ConnectResource} Data Connect — enterprise data ingestion */
    this.connect = new ConnectResource(this._http);
    /** @type {CustomConnectionsResource} Customer-built API connections */
    this.connect.custom = new CustomConnectionsResource(this._http);

    /** @type {PassportResource} EU Digital Product Passports */
    this.passport = new PassportResource(this._http);

    /** @type {LabelsResource} GHS label preview (no print) */
    this.labels = new LabelsResource(this._http);

    /** @type {UfiResource} UFI generate / decode */
    this.ufi = new UfiResource(this._http);

    /** @type {RelayResource} Edge-to-cloud relay status */
    this.relay = new RelayResource(this._http);

    /** @type {RenderResource} Render-as-a-Service */
    this.render = new RenderResource(this._http);

    /** @type {RulesResource} No-code automation rules */
    this.rules = new RulesResource(this._http);

    /** @type {AuditResource} Audit trail & compliance */
    this.audit = new AuditResource(this._http);

    /** Visual label workflows: build, test and trigger them from code. */
    this.workflows = new WorkflowsResource(this._http);

    /** @type {SitesResource} Multi-site & geo-routing */
    this.sites = new SitesResource(this._http);

    /** @type {AnalyticsResource} Predictions & digital twin */
    this.analytics = new AnalyticsResource(this._http);

    /** @type {UsageResource} Quota & usage stats */
    this.usage = new UsageResource(this._http);
  }

  /** Returns true if using a test key */
  get isTestMode() {
    return this._http.apiKey.startsWith('sk_test_');
  }
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = LabelInn;
module.exports.LabelInn = LabelInn;
module.exports.LabelInnError = LabelInnError;
module.exports.LabelInnRateLimitError = LabelInnRateLimitError;
module.exports.sniffContentType = sniffContentType; // UNIFIED PRINTERS R3
module.exports.MAX_UPLOAD_BYTES = MAX_UPLOAD_BYTES; // UNIFIED PRINTERS R3
/** Valid `office.fill_order` values (the server default is 'top_left_lr'). */
module.exports.OFFICE_FILL_ORDERS = Object.freeze(['top_left_lr', 'top_right_rl', 'bottom_left_lr', 'bottom_right_rl']);
const edge = require('./edge');
module.exports.LabelInnEdge = edge.LabelInnEdge;
module.exports.LabelInnEdgeError = edge.LabelInnEdgeError;
module.exports.LabelInnEdgePinError = edge.LabelInnEdgePinError;
module.exports.readEdgeDescriptor = edge.readDescriptor;
module.exports.certificateFingerprint = edge.certificateFingerprint;
module.exports.default = LabelInn;
