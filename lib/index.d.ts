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

  // ── Print Jobs ──

  interface CreateJobParams {
    printer_id: string;
    payload_type: 'zpl' | 'image' | 'template';
    payload_data?: string;
    image_url?: string;
    design_id?: string;
    data?: Record<string, string> | Record<string, string>[];
    job_name?: string;
    copies?: number;
    media_width_mm?: number;
    media_height_mm?: number;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    print_at?: string;
  }

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
  }

  interface PrintJobList extends ApiResponse {
    jobs: PrintJob[];
    next_page_token?: string;
    total?: number;
  }

  interface BatchResult extends ApiResponse {
    jobs: PrintJob[];
    errors?: Array<{ index: number; error: string }>;
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
  }

  interface UpdatePrinterParams {
    name?: string;
    metadata?: Record<string, string>;
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

  interface FleetGroupList extends ApiResponse {
    groups: FleetGroup[];
    next_page_token?: string;
  }

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

  interface PrinterList extends ApiResponse {
    printers: Printer[];
  }

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

  interface DesignList extends ApiResponse {
    designs: Design[];
  }

  interface DesignRevision extends ApiResponse {
    revision_id: string;
    design_id: string;
    created_at: string;
    author?: string;
    summary?: string;
  }

  interface DesignRevisionList extends ApiResponse {
    revisions: DesignRevision[];
  }

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
    print(designId: string, params: { printer_id: string; data?: Record<string, string> | Record<string, string>[]; copies?: number }): Promise<PrintJob>;
    revisions(designId: string, query?: { limit?: number }): Promise<DesignRevisionList>;
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

  interface WebhookList extends ApiResponse {
    webhooks: Webhook[];
  }

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

  interface WebhookDeliveryList extends ApiResponse {
    deliveries: WebhookDelivery[];
  }

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

  interface ConnectSourceList extends ApiResponse {
    sources: ConnectSource[];
    next_page_token?: string;
  }

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

  interface ConnectRecordList extends ApiResponse {
    records: ConnectRecord[];
    next_page_token?: string;
  }

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
    copies?: number;
    field_mappings?: Record<string, string>;
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
  }
}

export = LabelInn;
