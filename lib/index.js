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

const BASE_URL = 'https://labelinn.com/v1';

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
      'User-Agent': 'labelinn-node/2.0.0',
    };
    if (opts.idempotencyKey) {
      headers['X-Idempotency-Key'] = opts.idempotencyKey;
    }

    const fetchOpts = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeout),
    };
    if (body && method !== 'GET') {
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

    const result = data?.data || data;
    result._rateLimit = rateLimit;
    if (data?._idempotent) result._idempotent = true;
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
   * @param {string} params.payload_type - "zpl" | "image" | "template"
   * @param {string} [params.payload_data] - ZPL string or base64 image
   * @param {string} [params.image_url] - HTTPS URL to image (for payload_type:"image")
   * @param {string} [params.design_id] - Template ID (for payload_type:"template")
   * @param {object|object[]} [params.data] - Variable values for template
   * @param {string} [params.job_name] - Human-readable job name
   * @param {number} [params.copies] - Number of copies (1-1000)
   * @param {number} [params.media_width_mm] - Label width in mm
   * @param {number} [params.media_height_mm] - Label height in mm
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
   * Reprint a previous job.
   * @param {string} jobId
   * @param {object} [overrides] - { printer_id, copies, data }
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
}

// ─── Resource: Fleet (Printers) ──────────────────────────────

class FleetResource {
  constructor(http) {
    this._http = http;
    this.groups = new FleetGroupsResource(http);
  }

  /**
   * List all printers.
   * @param {object} [query] - { status, type, connection }
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
   * Update printer metadata.
   * @param {string} printerId
   * @param {object} params - { name, metadata }
   */
  update(printerId, params) {
    return this._http.put(`/fleet/printers/${printerId}`, params);
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
   * @param {object} params - { printer_id, data, copies }
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
  nearest(lat, lng) { return this._http.get(`/sites/nearest?lat=${lat}&lng=${lng}`); }
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
   * @param {object} params - { printer_id, design_id, record_ids?, ingest_id?, copies?, field_mappings? }
   */
  print(sourceId, params) {
    return this._http.post(`/connect/sources/${sourceId}/print`, params);
  }
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

    /** @type {RenderResource} Render-as-a-Service */
    this.render = new RenderResource(this._http);

    /** @type {RulesResource} No-code automation rules */
    this.rules = new RulesResource(this._http);

    /** @type {AuditResource} Audit trail & compliance */
    this.audit = new AuditResource(this._http);

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
module.exports.default = LabelInn;
