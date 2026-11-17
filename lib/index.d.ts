/**
 * TypeScript declarations for the LabelInn Node.js SDK
 */

declare class LabelInn {
  constructor(apiKey: string, opts?: LabelInn.ClientOptions);

  readonly print: LabelInn.PrintResource;
  readonly fleet: LabelInn.FleetResource;
  readonly designs: LabelInn.DesignsResource;
  readonly webhooks: LabelInn.WebhooksResource;
  readonly connect: LabelInn.ConnectResource;
  readonly audit: LabelInn.AuditResource;
  readonly workflows: LabelInn.WorkflowsResource;
  readonly passport: LabelInn.PassportResource;
  readonly labels: LabelInn.LabelsResource;
  readonly ufi: LabelInn.UfiResource;
  readonly relay: LabelInn.RelayResource;
  readonly render: any;
  readonly rules: any;
  readonly sites: any;
  readonly analytics: any;
  readonly usage: any;
  readonly isTestMode: boolean;
}

declare namespace LabelInn {
  interface ClientOptions {
    baseUrl?: string;
    timeout?: number;
  }

  // ── Rate Limit ──

  interface RateLimitInfo {
    limit: number;
    remaining: number;
    reset: number;
  }

  interface ApiResponse {
    _rateLimit?: RateLimitInfo;
    _idempotent?: boolean;
  }

  interface Pagination {
    has_more?: boolean;
    next_page_token?: string;
  }

  /**
   * A list response: the array the API returns in `data`, plus the page
   * cursor it sends beside it. Pass `_pagination.next_page_token` back as
   * `page_token` to get the next page.
   */
  type ListResponse<T> = T[] & ApiResponse & { _pagination?: Pagination };

  // ── Print Jobs ──

  interface CreateJobParams {
    printer_id: string;
    payload_type: 'zpl' | 'image' | 'template' | 'ghs_row';
    payload_data?: string;
    workflow_id?: string;
    source_id?: string;
    plan?: Record<string, any>;
    dry_run?: boolean;
    row_id?: string;
    strict_level?: 'basic' | 'strict' | 'enforce';
    image_url?: string;
    design_id?: string;
    data?: Record<string, string> | Record<string, string>[];
    job_name?: string;
    copies?: number;
    media_width_mm?: number;
    media_height_mm?: number;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    print_at?: string;
    /**
     * UNIFIED PRINTERS R3: a file sent through print.createUpload()/uploadFile()
     * (payload_type 'image'), instead of payload_data / image_url.
     */
    upload_id?: string;
    /** UNIFIED PRINTERS R3: alias of `upload_id`. */
    file_id?: string;
    /**
     * UNIFIED PRINTERS: sheet options for an office (A4/Letter) printer. Office
     * printers take 'template' (label sheets; page-sized designs print as one
     * full page) and, when the printer's `office.payload_types` includes 'image',
     * 'image' (PNG/JPEG/... or a PDF; one full page per image/PDF page unless
     * media_width_mm/media_height_mm are given). Sending these to a label
     * printer is refused with OFFICE_OPTIONS_FOR_LABEL_PRINTER.
     */
    office?: OfficePrintOptions;
  }

  /** UNIFIED PRINTERS: custom label grid on an office sheet. */
  interface OfficeGrid {
    cols: number;
    rows: number;
    label_width_mm: number;
    label_height_mm: number;
    left_mm?: number;
    top_mm?: number;
    h_gap_mm?: number;
    v_gap_mm?: number;
  }

  /** UNIFIED PRINTERS: `office` body of a print job sent to an office printer. */
  interface OfficePrintOptions {
    /** Sheet catalogue id, e.g. 'a4-21', 'a4-1' (full A4 page), 'us-1', 'us-30'. */
    sheet?: string;
    /** Custom grid instead of `sheet`. */
    grid?: OfficeGrid;
    paper?: 'a4' | 'letter' | 'a5' | 'legal';
    /** 1-based first cell on the first sheet. */
    start_at?: number;
    collate?: boolean;
    color?: 'color' | 'grayscale' | 'black_white';
    /**
     * The order labels are laid onto the sheet's cells (which corner, which
     * direction). Default 'top_left_lr' (what a sheet without this field uses).
     */
    fill_order?: OfficeFillOrder;
  }

  /** `office.fill_order` values. Exported at runtime as `OFFICE_FILL_ORDERS`. */
  type OfficeFillOrder = 'top_left_lr' | 'top_right_rl' | 'bottom_left_lr' | 'bottom_right_rl';

  interface CreateJobOpts {
    idempotencyKey?: string;
  }

  interface ListJobsQuery {
    status?: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
    printer_id?: string;
    limit?: number;
    page_token?: string;
  }

  interface PrintJob extends ApiResponse {
    id: string;
    status: string;
    printer_id: string;
    payload_type: string;
    job_name?: string;
    copies: number;
    priority?: string;
    print_at?: string;
    created_at: string;
    updated_at: string;
    completed_at?: string;
    error_message?: string;
    /** UNIFIED PRINTERS R3: the upload the job prints (upload_id jobs and staged image_url files). */
    upload_id?: string | null;
    /** UNIFIED PRINTERS R3 */
    file_size_bytes?: number | null;
    /** UNIFIED PRINTERS R3: 'pdf' | 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | 'tiff'. */
    file_kind?: string | null;
    /** UNIFIED PRINTERS R3: machine-readable failure reason, e.g. PRINTER_APP_TOO_OLD. */
    failure_code?: string | null;
    /** UNIFIED PRINTERS R3: how many times the job was put back in the queue. */
    requeue_count?: number;
    /** UNIFIED PRINTERS R3: template jobs on receipt printers: how the design fits the roll. */
    receipt_fit?: ReceiptFit;
  }

  /** UNIFIED PRINTERS R3 */
  interface ReceiptFit {
    roll_mm: 58 | 80 | number | null;
    roll_known: boolean;
    printable_mm: number;
    design_width_mm: number;
    action: 'asIs' | 'scaleToRoll';
    note?: string;
  }

  /** UNIFIED PRINTERS R3: POST /print/uploads response. */
  interface PrintUploadSlot extends ApiResponse {
    upload_id: string;
    /** Signed storage URL; null with a test key (nothing is written). */
    upload_url: string | null;
    method: 'PUT';
    /** Send exactly these headers with the PUT, and no Authorization header. */
    headers: Record<string, string>;
    expires_at: string;
    max_bytes: number;
    max_pdf_pages: number;
    delete_after?: string;
    is_test?: boolean;
  }

  /** UNIFIED PRINTERS R3: GET /print/uploads/{id} response. */
  interface PrintUpload extends ApiResponse {
    upload_id: string;
    status: 'pending' | 'ready';
    content_type: string | null;
    size_bytes: number | null;
    sha256: string | null;
    file_name: string | null;
    kind: string | null;
    upload_expires_at: string | null;
    delete_after: string | null;
    created_at: string | null;
  }

  /** UNIFIED PRINTERS R3: options of print.printFile(). */
  interface PrintFileOptions extends Partial<Omit<CreateJobParams, 'printer_id' | 'payload_type' | 'payload_data' | 'image_url' | 'upload_id' | 'file_id'>> {
    /** Read from the file's first bytes when omitted. */
    content_type?: string;
    /** Defaults to the file name when a path is given. */
    file_name?: string;
    idempotencyKey?: string;
  }

  /** @deprecated since 3.0 — the API returns an array; use ListResponse<PrintJob>. */
  type PrintJobList = ListResponse<PrintJob>;

  interface BatchResult extends ApiResponse {
    total: number;
    succeeded: number;
    failed: number;
    /** One entry per submitted job, in order. */
    results: Array<{ index: number; status: 'accepted' | 'rejected'; data?: PrintJob; error?: { code: string; message: string } }>;
  }

  interface RetryParams {
    printer_id?: string;
  }

  class PrintResource {
    create(params: CreateJobParams, opts?: CreateJobOpts): Promise<PrintJob>;
    list(query?: ListJobsQuery): Promise<PrintJobList>;
    get(jobId: string): Promise<PrintJob>;
    cancel(jobId: string): Promise<ApiResponse>;
    reprint(jobId: string, overrides?: Partial<CreateJobParams>): Promise<PrintJob>;
    retry(jobId: string, params?: RetryParams): Promise<PrintJob>;
    batch(jobs: CreateJobParams[]): Promise<BatchResult>;
    /** UNIFIED PRINTERS R3: reserve an upload slot (POST /print/uploads). */
    createUpload(contentType: string, sizeBytes: number, sha256: string, fileName?: string): Promise<PrintUploadSlot>;
    /** UNIFIED PRINTERS R3 */
    getUpload(uploadId: string): Promise<PrintUpload>;
    /** UNIFIED PRINTERS R3: upload a file (≤ 25 MB) and return its upload_id. */
    uploadFile(bytes: Uint8Array | ArrayBuffer, contentType?: string, fileName?: string): Promise<string>;
    /**
     * UNIFIED PRINTERS R3: print a PDF / image file. Inline when its base64 is
     * ≤ 500 KB, otherwise uploaded first and printed by upload_id.
     */
    printFile(printerId: string, bytesOrPath: Uint8Array | ArrayBuffer | string, opts?: PrintFileOptions): Promise<PrintJob>;
  }

  // ── Fleet ──

  interface Printer extends ApiResponse {
    id: string;
    name: string;
    model?: string;
    type?: string;
    connection?: string;
    status: string;
    ip_address?: string;
    serial_number?: string;
    last_seen?: string;
    /**
     * UNIFIED PRINTERS: what the printer is for. label = thermal/label printers
     * (ZPL, TSPL, TPCL, DYMO, Brother QL); receipt = ESC/POS and Phomemo on
     * 58/80 mm rolls; color = Epson ColorWorks; office = A4/Letter printers.
     */
    kind?: PrinterKind;
    /** UNIFIED PRINTERS: 'label' | 'office'. */
    family?: PrinterFamily;
    /** UNIFIED PRINTERS: alias of `family`. */
    printer_family?: PrinterFamily;
    /** UNIFIED PRINTERS: office printer details; null for label printers. */
    office?: OfficePrinterInfo | null;
    /** UNIFIED PRINTERS R3: receipt printers: roll width (58 | 80), null when unknown. */
    receipt_roll_mm?: 58 | 80 | null;
    /** UNIFIED PRINTERS R3: receipt printers: printable width (48 | 72). */
    receipt_printable_mm?: 48 | 72;
  }

  /** UNIFIED PRINTERS */
  type PrinterKind = 'label' | 'receipt' | 'color' | 'office';
  /** UNIFIED PRINTERS */
  type PrinterFamily = 'label' | 'office';

  /** UNIFIED PRINTERS: `office` block of an office printer. */
  interface OfficePrinterInfo {
    color?: boolean | null;
    /** Named papers, e.g. 'A4', 'LETTER'. */
    paper_sizes?: string[];
    /** The printer's own PWG media names. */
    media_sizes?: string[];
    resolutions_dpi?: number[];
    languages?: string[];
    best_route?: string | null;
    needs_driver?: boolean;
    make?: string | null;
    model?: string | null;
    /**
     * What the printer accepts: ['template'] or ['template', 'image'].
     * 'image' (PNG/JPEG/GIF/BMP/WebP/TIFF or PDF) appears only when the PC
     * that owns the printer runs a LabelInn version that prints them.
     */
    payload_types?: Array<'template' | 'image'>;
  }

  interface UpdatePrinterParams {
    name?: string;
    metadata?: Record<string, string>;
    allowed_user_ids?: string[];
    site_id?: string | null;
    is_hidden?: boolean;
    is_locked?: boolean;
    lock_reason?: string;
  }

  type PrinterCommandName = 'STATUS' | 'FEED' | 'CALIBRATE' | 'RESET' | 'PAUSE' | 'RESUME'
    | 'TEST_PRINT' | 'WRITE_CONFIG' | 'CANCEL_ALL' | 'IDENTIFY' | 'SET_MEDIA' | 'RAW';

  interface PrinterCommandResult extends ApiResponse {
    id: string;
    printer_id: string;
    command: string;
    status: string;
    success?: boolean;
    response_text?: string | null;
    response_base64?: string | null;
    response_status?: string | null;
    error?: string | null;
    poll_url?: string;
  }

  interface MediaDefinitionParams {
    width_mm: number;
    height_mm: number;
    media_type?: string;
    gap_mm?: number;
  }

  interface FleetGroup extends ApiResponse {
    id: string;
    name: string;
    printer_ids?: string[];
    metadata?: Record<string, string>;
    created_at?: string;
    updated_at?: string;
  }

  /** @deprecated since 3.0 — the API returns an array; use ListResponse<FleetGroup>. */
  type FleetGroupList = ListResponse<FleetGroup>;

  interface CreateGroupParams {
    name: string;
    printer_ids?: string[];
    metadata?: Record<string, string>;
  }

  interface UpdateGroupParams {
    name?: string;
    printer_ids?: string[];
    metadata?: Record<string, string>;
  }

  /** @deprecated since 3.0 — the API returns an array; use ListResponse<Printer>. */
  type PrinterList = ListResponse<Printer>;

  interface PrinterStatus extends ApiResponse {
    id: string;
    status: string;
    last_seen?: string;
    paper_status?: string;
    ribbon_status?: string;
  }

  interface ListPrintersQuery {
    status?: string;
    type?: string;
    connection?: string;
    /** UNIFIED PRINTERS: filter by family. */
    family?: PrinterFamily;
    /** UNIFIED PRINTERS: filter by kind. */
    kind?: PrinterKind;
  }

  class FleetGroupsResource {
    create(params: CreateGroupParams): Promise<FleetGroup>;
    list(query?: Record<string, string>): Promise<FleetGroupList>;
    get(groupId: string): Promise<FleetGroup>;
    update(groupId: string, params: UpdateGroupParams): Promise<FleetGroup>;
    delete(groupId: string): Promise<ApiResponse>;
  }

  class FleetResource {
    readonly groups: FleetGroupsResource;
    list(query?: ListPrintersQuery): Promise<PrinterList>;
    get(printerId: string): Promise<Printer>;
    status(printerId: string): Promise<PrinterStatus>;
    update(printerId: string, params: UpdatePrinterParams): Promise<Printer>;
    identify(printerId: string): Promise<ApiResponse>;
    setMedia(printerId: string, params: MediaDefinitionParams): Promise<ApiResponse>;
    /** Labels or ribbon running low or out, across the fleet. */
    supplyAlerts(query?: { state?: string; printer_id?: string; limit?: number }): Promise<ListResponse<Record<string, any>>>;
    /** Send a control command and wait (default) for the printer's answer. */
    command(printerId: string, command: PrinterCommandName, opts?: { args?: Record<string, any>; wait?: boolean; timeout_ms?: number }): Promise<PrinterCommandResult>;
    getCommand(printerId: string, commandId: string): Promise<PrinterCommandResult>;
  }

  // ── Designs ──

  interface Design extends ApiResponse {
    id: string;
    name: string;
    width_mm?: number;
    height_mm?: number;
    elements?: DesignElement[];
    variables?: DesignVariable[];
    created_at?: string;
    updated_at?: string;
  }

  interface DesignElement extends ApiResponse {
    id: string;
    type: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    [key: string]: unknown;
  }

  interface DesignVariable {
    name: string;
    type?: string;
    default_value?: string;
  }

  /** @deprecated since 3.0 — the API returns an array; use ListResponse<Design>. */
  type DesignList = ListResponse<Design>;

  interface DesignRevision extends ApiResponse {
    revision_id: string;
    design_id: string;
    created_at: string;
    author?: string;
    summary?: string;
  }

  /** @deprecated since 3.0 — the API returns an array; use ListResponse<DesignRevision>. */
  type DesignRevisionList = ListResponse<DesignRevision>;

  class DesignsResource {
    list(query?: Record<string, string>): Promise<DesignList>;
    get(designId: string): Promise<Design>;
    create(params: Partial<Design>): Promise<Design>;
    update(designId: string, params: Partial<Design>): Promise<Design>;
    delete(designId: string): Promise<ApiResponse>;
    listElements(designId: string): Promise<{ elements: DesignElement[] } & ApiResponse>;
    addElement(designId: string, params: Partial<DesignElement>): Promise<DesignElement>;
    updateElement(designId: string, elementId: string, params: Partial<DesignElement>): Promise<DesignElement>;
    deleteElement(designId: string, elementId: string): Promise<ApiResponse>;
    listVariables(designId: string): Promise<{ variables: DesignVariable[] } & ApiResponse>;
    clone(designId: string): Promise<Design>;
    render(designId: string, params?: { data?: Record<string, string> }): Promise<ApiResponse>;
    /** UNIFIED PRINTERS: `office` applies when printer_id is an office printer. */
    print(designId: string, params: { printer_id: string; data?: Record<string, string> | Record<string, string>[]; copies?: number; office?: OfficePrintOptions }): Promise<PrintJob>;
    revisions(designId: string, query?: { limit?: number }): Promise<DesignRevisionList>;
    /** Replace an element on a page (PUT — every field you omit is reset). */
    replacePageElement(designId: string, pageId: string, elementId: string, params: Record<string, any>): Promise<ApiResponse>;
    /** Poll an async render started by render(). */
    renderStatus(renderId: string): Promise<ApiResponse & Record<string, any>>;
  }

  // ── Webhooks ──

  type WebhookEvent =
    | 'print.job.completed'
    | 'print.job.failed'
    | 'print.job.cancelled'
    | 'print.job.created'
    | 'printer.status.changed'
    | 'printer.supply.low'
    | 'design.updated'
    | 'design.deleted';

  interface Webhook extends ApiResponse {
    id: string;
    url: string;
    events: WebhookEvent[];
    description?: string;
    enabled?: boolean;
    signing_secret: string;
    created_at: string;
  }

  /** @deprecated since 3.0 — the API returns an array; use ListResponse<Webhook>. */
  type WebhookList = ListResponse<Webhook>;

  interface CreateWebhookParams {
    url: string;
    events: WebhookEvent[];
    description?: string;
  }

  interface UpdateWebhookParams {
    url?: string;
    events?: WebhookEvent[];
    description?: string;
    enabled?: boolean;
  }

  interface WebhookDelivery extends ApiResponse {
    id: string;
    webhook_id: string;
    event: string;
    status_code?: number;
    success: boolean;
    attempted_at: string;
    response_time_ms?: number;
  }

  /** @deprecated since 3.0 — the API returns an array; use ListResponse<WebhookDelivery>. */
  type WebhookDeliveryList = ListResponse<WebhookDelivery>;

  class WebhooksResource {
    create(params: CreateWebhookParams): Promise<Webhook>;
    list(): Promise<WebhookList>;
    delete(webhookId: string): Promise<ApiResponse>;
    test(webhookId: string): Promise<ApiResponse>;
    update(webhookId: string, params: UpdateWebhookParams): Promise<Webhook>;
    deliveries(webhookId: string, query?: { limit?: number }): Promise<WebhookDeliveryList>;
  }

  // ── Errors ──

  class LabelInnError extends Error {
    status: number;
    code: string;
    raw: unknown;
  }

  class LabelInnRateLimitError extends LabelInnError {
    retryAfter: number;
  }

  /**
   * UNIFIED PRINTERS R3: error codes of the file upload path: PRINTER_APP_TOO_OLD (409),
   * UPLOAD_NOT_FOUND (404), UPLOAD_NOT_RECEIVED (409), UPLOAD_EXPIRED (410),
   * UPLOAD_HASH_MISMATCH / UPLOAD_SIZE_MISMATCH / UPLOAD_TYPE_MISMATCH (400),
   * UNSUPPORTED_MEDIA_TYPE (415), UPLOAD_UNAVAILABLE (503), PAYLOAD_TOO_LARGE (413).
   * UPLOAD_FAILED: the storage PUT itself failed (SDK side).
   */
  type UploadErrorCode = 'PRINTER_APP_TOO_OLD' | 'UPLOAD_NOT_FOUND' | 'UPLOAD_NOT_RECEIVED' | 'UPLOAD_EXPIRED'
    | 'UPLOAD_HASH_MISMATCH' | 'UPLOAD_SIZE_MISMATCH' | 'UPLOAD_TYPE_MISMATCH' | 'UNSUPPORTED_MEDIA_TYPE'
    | 'UPLOAD_UNAVAILABLE' | 'PAYLOAD_TOO_LARGE' | 'UPLOAD_FAILED';

  /** UNIFIED PRINTERS R3: content type from a file's first bytes, or null. */
  function sniffContentType(bytes: Uint8Array): string | null;
  /** UNIFIED PRINTERS R3: 25 MB. */
  const MAX_UPLOAD_BYTES: number;
  /** `office.fill_order` values; the server default is 'top_left_lr'. */
  const OFFICE_FILL_ORDERS: ReadonlyArray<OfficeFillOrder>;

  // ── Connect (Data Ingestion) ──

  interface IngestParams {
    payload: string;
    source_id?: string;
    format?: 'xml' | 'csv' | 'json';
    name?: string;
    config?: Record<string, unknown>;
  }

  interface TestParseParams {
    payload: string;
    format?: 'xml' | 'csv' | 'json';
    config?: Record<string, unknown>;
  }

  interface ConnectSource extends ApiResponse {
    id: string;
    name: string;
    description?: string;
    format?: string;
    config?: Record<string, unknown>;
    record_count?: number;
    created_at?: string;
    updated_at?: string;
  }

  /** @deprecated since 3.0 — the API returns an array; use ListResponse<ConnectSource>. */
  type ConnectSourceList = ListResponse<ConnectSource>;

  interface CreateSourceParams {
    name: string;
    description?: string;
    format?: 'xml' | 'csv' | 'json';
    config?: Record<string, unknown>;
  }

  interface UpdateSourceParams {
    name?: string;
    description?: string;
    config?: Record<string, unknown>;
  }

  interface ConnectRecord extends ApiResponse {
    id: string;
    data: Record<string, string>;
    source_id: string;
    ingest_id?: string;
    created_at?: string;
  }

  /** @deprecated since 3.0 — the API returns an array; use ListResponse<ConnectRecord>. */
  type ConnectRecordList = ListResponse<ConnectRecord>;

  interface ConnectSchema extends ApiResponse {
    fields: Array<{ name: string; type?: string; sample_values?: string[] }>;
  }

  interface ConnectMappings extends ApiResponse {
    mappings: Record<string, string>;
  }

  interface ConnectPrintParams {
    printer_id: string;
    design_id: string;
    record_ids?: string[];
    ingest_id?: string;
    row_start?: number;
    row_end?: number;
    row_count?: number;
    copies?: number;
    field_mappings?: Record<string, string>;
  }

  interface CustomConnectionInput {
    name?: string;
    description?: string;
    kind?: 'marketplace' | 'cargo' | 'generic';
    baseUrl?: string;
    manifest?: { auth?: Record<string, any>; operations: Record<string, any>[] };
    credentials?: Record<string, string>;
  }

  class CustomConnectionsResource {
    list(): Promise<ListResponse<Record<string, any>>>;
    create(params: CustomConnectionInput): Promise<ApiResponse & Record<string, any>>;
    get(connectionId: string): Promise<ApiResponse & Record<string, any>>;
    update(connectionId: string, params: CustomConnectionInput): Promise<ApiResponse & Record<string, any>>;
    delete(connectionId: string): Promise<ApiResponse>;
    test(connectionId: string, params?: { operationId?: string; live?: boolean; input?: Record<string, any> }): Promise<ApiResponse & Record<string, any>>;
    execute(connectionId: string, params: { operationId: string; input?: Record<string, any>; dryRun?: boolean; confirmSideEffect?: boolean; idempotencyKey?: string }): Promise<ApiResponse & Record<string, any>>;
  }

  class ConnectResource {
    ingest(params: IngestParams): Promise<ApiResponse>;
    testParse(params: TestParseParams): Promise<ApiResponse>;
    createSource(params: CreateSourceParams): Promise<ConnectSource>;
    listSources(query?: Record<string, string>): Promise<ConnectSourceList>;
    getSource(sourceId: string): Promise<ConnectSource>;
    updateSource(sourceId: string, params: UpdateSourceParams): Promise<ConnectSource>;
    deleteSource(sourceId: string): Promise<ApiResponse>;
    listRecords(sourceId: string, query?: { limit?: number; page_token?: string; ingest_id?: string }): Promise<ConnectRecordList>;
    getSchema(sourceId: string): Promise<ConnectSchema>;
    getMappings(sourceId: string): Promise<ConnectMappings>;
    updateMappings(sourceId: string, mappings: Record<string, string>): Promise<ConnectMappings>;
    print(sourceId: string, params: ConnectPrintParams): Promise<ApiResponse>;
    /** POST /connect/print — source_id optional (the design's bound source is used). */
    printDesign(params: ConnectPrintParams & { source_id?: string }): Promise<ApiResponse & Record<string, any>>;
    readonly custom: CustomConnectionsResource;
  }

  // ── Product passports, GHS preview, UFI, relay ──

  class PassportResource {
    register(params: Record<string, any>): Promise<ApiResponse & Record<string, any>>;
    update(params: Record<string, any>): Promise<ApiResponse & Record<string, any>>;
    updateBatch(updates: Record<string, any>[]): Promise<ApiResponse & Record<string, any>>;
    reserveIdentifiers(params: Record<string, any>): Promise<ApiResponse & Record<string, any>>;
    linkSuccession(params: Record<string, any>): Promise<ApiResponse & Record<string, any>>;
    setPage(params: { gtin: string; page_layout?: Record<string, any>[]; brand?: Record<string, string>; static_fields?: Record<string, any>[]; category?: string; product_name?: string; font_family?: string }): Promise<ApiResponse & Record<string, any>>;
    generatePage(params?: { category?: string; brand_brief?: string; product_name?: string; tone?: string; extra_field_keys?: string[]; asset_urls?: string[] }): Promise<ApiResponse & Record<string, any>>;
    resolve(path: string): Promise<ApiResponse & Record<string, any>>;
  }

  class LabelsResource {
    preview(params: { data: Record<string, any>; strict_level?: 'basic' | 'strict' | 'enforce'; source_id?: string; transform?: Record<string, any> }): Promise<ApiResponse & Record<string, any>>;
  }

  class UfiResource {
    generate(params: { vat: string; formulationNumber: number; countryCode?: string }): Promise<ApiResponse & { ufi: string; labelString: string }>;
    decode(ufi: string): Promise<ApiResponse & Record<string, any>>;
  }

  class RelayResource {
    status(): Promise<ApiResponse & Record<string, any>>;
  }

  class ComplianceResource {
    createPool(params: Record<string, any>): Promise<ApiResponse & Record<string, any>>;
    listPools(query?: Record<string, any>): Promise<ListResponse<Record<string, any>>>;
    getPool(poolId: string): Promise<ApiResponse & Record<string, any>>;
    allocate(poolId: string, params: Record<string, any>): Promise<ApiResponse & Record<string, any>>;
    void(poolId: string, params: Record<string, any>): Promise<ApiResponse & Record<string, any>>;
    report(poolId: string): Promise<ApiResponse & Record<string, any>>;
    /** Needs the opt-in `compliance_review` scope. */
    sign(params: { companyId: string; designId: string; decision: 'approved' | 'rejected'; notes?: string; scope?: string; reviewerRole?: string }): Promise<any>;
  }

  // ── Local Edge API (/local/v1, port 6631) ──

  interface EdgeOptions {
    host?: string;
    port?: number;
    token?: string | null;
    /** SHA-256 of the edge certificate (DER), hex. Setting it switches to pinned https. */
    tlsSha256?: string | null;
    scheme?: 'http' | 'https';
    timeout?: number;
  }

  interface EdgeDescriptor {
    version: number;
    host: string;
    port: number;
    authToken?: string;
    deviceId?: string;
    companyId?: string;
    mode?: string;
    scheme?: 'https';
    tlsSha256?: string;
    startedAt?: string;
  }

  interface EdgePrintJob {
    printerId: string;
    payloadType: 'zpl' | 'escLabel' | 'tpcl' | 'design';
    payloadData?: string;
    designId?: string;
    designDataRows?: Record<string, any>[];
    copies?: number;
    jobName?: string;
    [key: string]: any;
  }

  class LabelInnEdge {
    constructor(opts?: EdgeOptions);
    /** Reads ~/.labelinn/edge.json: pinned https when it has tlsSha256, http otherwise. */
    static fromDescriptor(opts?: { file?: string; host?: string; timeout?: number }): LabelInnEdge;
    readonly host: string;
    readonly port: number;
    readonly scheme: 'http' | 'https';
    readonly tlsSha256: string | null;
    readonly baseUrl: string;
    request(method: string, path: string, body?: any): Promise<any>;
    health(): Promise<Record<string, any>>;
    print(job: EdgePrintJob): Promise<{ jobId: string; status: string; message?: string }>;
    getJob(jobId: string): Promise<Record<string, any>>;
    listPrinters(opts?: { includePeers?: boolean }): Promise<{ printers: Record<string, any>[]; count: number; [key: string]: any }>;
    listPeers(): Promise<Record<string, any>>;
    startDiscovery(): Promise<Record<string, any>>;
    getDiscovery(sessionId: string): Promise<Record<string, any>>;
    listDesigns(): Promise<{ designs: Record<string, any>[]; count: number; revision: number }>;
    getDesign(designId: string): Promise<any>;
    scheduleStatus(): Promise<Record<string, any>>;
    scheduleRunNow(): Promise<Record<string, any>>;
    auditRecent(query?: { limit?: number; action?: string }): Promise<{ events: Record<string, any>[] }>;
  }

  class LabelInnEdgeError extends Error {
    status: number;
    raw: any;
  }

  /** The edge certificate did not match the pin; nothing was sent. */
  class LabelInnEdgePinError extends Error {
    expected: string;
    actual: string;
  }

  function readEdgeDescriptor(file?: string): EdgeDescriptor | null;
  function certificateFingerprint(der: Buffer): string;

  // ── Audit & print history ──

  interface PrintHistoryQuery {
    start?: string;
    end?: string;
    printerId?: string;
    designId?: string;
    status?: string;
    limit?: number;
    page_token?: string;
  }

  class AuditResource {
    readonly compliance: ComplianceResource;
    list(query?: Record<string, any>): Promise<ListResponse<Record<string, any>>>;
    get(entryId: string): Promise<ApiResponse & Record<string, any>>;
    summary(query?: Record<string, any>): Promise<ApiResponse & Record<string, any>>;
    ingest(events: Record<string, any>[]): Promise<ApiResponse>;
    printHistory(query?: PrintHistoryQuery): Promise<ListResponse<Record<string, any>>>;
    printHistoryEntry(jobId: string): Promise<ApiResponse & Record<string, any>>;
    printArtifacts(jobId: string): Promise<ApiResponse & Record<string, any>>;
    printArtifact(jobId: string, kind: string, query?: { as?: string }): Promise<ApiResponse & { download_url?: string; expires_at?: string; hash_sha256?: string; bytes?: number }>;
    verifyPrint(jobId: string, expect?: { expect_status?: string; expect_design_id?: string; expect_printer_id?: string; expect_copies?: number }): Promise<ApiResponse & Record<string, any>>;
    verifyChain(query?: { start_seq?: number; end_seq?: number; limit?: number }): Promise<ApiResponse & Record<string, any>>;
  }

  // ── Workflows ──

  interface WorkflowNode { id: string; type: string; config?: Record<string, any>; [key: string]: any }
  interface WorkflowEdge { from: { node: string; port: string }; to: { node: string; port: string }; [key: string]: any }

  interface Workflow extends ApiResponse {
    id: string;
    name: string;
    description?: string | null;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    enabled: boolean;
    version?: number;
    [key: string]: any;
  }

  interface CreateWorkflowParams {
    name: string;
    description?: string;
    nodes?: WorkflowNode[];
    edges?: WorkflowEdge[];
    enabled?: boolean;
  }

  interface WorkflowTrigger extends ApiResponse {
    token: string;
    url: string;
    node_id: string | null;
    /** Shown once, only for signed triggers. */
    secret?: string;
    signed: boolean;
  }

  interface WorkflowTestResult extends ApiResponse {
    workflowId: string;
    sampleRow: Record<string, any>;
    trace: Record<string, any>;
    evaluationMs: number;
  }

  interface WorkflowFireResult extends ApiResponse {
    workflowId: string;
    accepted: boolean;
    printJobIds: string[];
    nodeStatus: Record<string, any>;
    errors: string[];
    durationMs: number;
  }

  class WorkflowsResource {
    capabilities(): Promise<ApiResponse & Record<string, any>>;
    list(query?: { limit?: number; page_token?: string }): Promise<ListResponse<Workflow>>;
    get(workflowId: string): Promise<Workflow>;
    create(params: CreateWorkflowParams): Promise<Workflow>;
    replace(workflowId: string, workflow: Partial<Workflow>): Promise<Workflow>;
    update(workflowId: string, fields: Partial<CreateWorkflowParams> & { canvas?: Record<string, any> }): Promise<Workflow>;
    delete(workflowId: string): Promise<ApiResponse & { deleted: boolean; id: string }>;
    test(workflowId: string, row?: Record<string, any>): Promise<WorkflowTestResult>;
    listTriggers(workflowId: string): Promise<ListResponse<Record<string, any>>>;
    createTrigger(workflowId: string, opts?: { node_id?: string; signed?: boolean }): Promise<WorkflowTrigger>;
    deleteTrigger(workflowId: string, token: string): Promise<ApiResponse>;
    fire(workflowId: string, token: string, row: Record<string, any>, opts?: { secret?: string }): Promise<WorkflowFireResult>;
  }
}

export = LabelInn;
