# Changelog

All notable changes to the LabelInn Node.js SDK will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [3.2.0] - 2026-11-16

### Added

- `OfficePrintOptions.fill_order` (`top_left_lr` | `top_right_rl` |
  `bottom_left_lr` | `bottom_right_rl`, default `top_left_lr`), the order labels
  are laid onto the sheet; `OfficeFillOrder` type and `LabelInn.OFFICE_FILL_ORDERS`.
- Docs: a bare `payload_type: 'image'` to an Epson colour printer is refused with
  `PRINTER_LANGUAGE_MISMATCH` (`accepted_payload_types: ['template']`); `zpl` is
  also refused for receipt, Phomemo, DYMO and Brother QL printers. README
  sections for office, receipt and Epson colour printers.

- One printer list: `Printer` gains optional `kind` (`label` | `receipt` |
  `color` | `office`), `family` / `printer_family` (`label` | `office`) and
  `office` (null for label printers) with `payload_types`
  (`['template']` or `['template', 'image']`).
- `fleet.list()` documents and types the `kind` and `family` filters.
- `CreateJobParams.office` (`OfficePrintOptions`: `sheet`, `grid`, `paper`,
  `start_at`, `collate`, `color`) for office printers; also on `designs.print()`.
- Docs: `payload_type: 'image'` on an office printer accepts a PDF and prints
  one full page per image / PDF page unless a label size is given. New error
  code `PRINTER_LANGUAGE_MISMATCH` (ZPL to an ESC/POS, Phomemo, DYMO or Brother
  QL printer).
- Large files (PDF / images up to 25 MB): `print.createUpload()`,
  `print.getUpload()`, `print.uploadFile()` (content type sniffed from the
  bytes, SHA-256, signed PUT with the returned headers and no auth header;
  over 25 MB refused locally) and `print.printFile(printerId, bytesOrPath, opts)`
  (inline `payload_data` when the base64 is at most 500 KB, otherwise upload +
  `upload_id`). `CreateJobParams.upload_id` / `file_id`; `PrintJob` gains
  `upload_id`, `file_size_bytes`, `file_kind`, `failure_code`, `requeue_count`,
  `receipt_fit`; `Printer` gains `receipt_roll_mm`, `receipt_printable_mm`.
  Docs: `image_url` accepts files up to 25 MB; new error codes
  `PRINTER_APP_TOO_OLD`, `UPLOAD_*`, `UNSUPPORTED_MEDIA_TYPE`. <!-- UNIFIED PRINTERS R3 -->

## [3.1.0] - 2026-10-13

### Added

- `LabelInnEdge` — client for the local Edge API (`/local/v1/*`, port 6631).
  `LabelInnEdge.fromDescriptor()` reads `~/.labelinn/edge.json`; when it carries
  `tlsSha256` the client uses https and pins the PC's self-signed certificate
  (checked during the handshake, before the request is written; a mismatch
  throws `LabelInnEdgePinError`). Without a fingerprint it keeps using plain
  http, so older PCs still work. Methods: `health`, `print`, `getJob`,
  `listPrinters`, `listPeers`, `startDiscovery`, `getDiscovery`, `listDesigns`,
  `getDesign`, `scheduleStatus`, `scheduleRunNow`, `auditRecent`.
- `fleet.command()` / `fleet.getCommand()` — two-way printer commands.
- `connect.printDesign()` (`POST /connect/print`) and row ranges
  (`row_start`, `row_end`, `row_count`) on connector prints.
- `connect.custom` — custom API connections (list, create, get, update, delete,
  test, execute).
- `client.passport` — register, update, updateBatch, reserveIdentifiers,
  linkSuccession, setPage, generatePage, resolve.
- `client.labels.preview()` (GHS row resolution), `client.ufi.generate()` /
  `decode()`, `audit.compliance.sign()`, `client.relay.status()`.
- Types for all of the above; `CreateJobParams` gains `ghs_row`, `workflow_id`,
  `plan`, `dry_run`, `row_id`, `strict_level`.

### Fixed

- `sites.nearest()` sent `lng`; the API reads `lat` and `lon`, so every call
  failed with 400 `VALIDATION_ERROR`.
- README showed `connect.print({ source_id, ... })`; the signature is
  `connect.print(sourceId, params)`.

## [3.0.0] - 2026-10-01

### Added

- `client.workflows` — build, test and trigger visual label workflows from code:
  `capabilities()`, `list()`, `get()`, `create()`, `replace()`, `update()`,
  `delete()`, `test()`, `listTriggers()`, `createTrigger()`, `deleteTrigger()`,
  `fire()` (signs the request with HMAC-SHA256 when the trigger is signed).
- Print history: `audit.printHistory()`, `audit.printHistoryEntry()`,
  `audit.printArtifacts()`, `audit.printArtifact()`, `audit.verifyPrint()`,
  `audit.verifyChain()`.
- `fleet.supplyAlerts()`, `designs.renderStatus()`, `designs.replacePageElement()`.
- List responses carry `_pagination` (`has_more`, `next_page_token`); it was
  dropped when the `data` envelope was unwrapped, so only page one was reachable.
- TypeScript declarations for every resource, `ListResponse<T>`, `Workflow*`.

### Fixed

- TypeScript and README described list calls as `{ printers }` / `{ jobs }`
  objects; the SDK has always returned the array itself. The declarations
  now match what the code returns (old `*List` names remain as aliases).
- An empty (204) response no longer throws `Cannot set properties of null`.
- `User-Agent` reported `labelinn-node/2.0.0` regardless of version.
- `npm test` pointed at a file that did not exist; it now runs offline tests.
- `BatchResult` type now matches the API: `total`, `succeeded`, `failed`, `results`.

## [1.1.0] - 2026-03-18

### Added

- `ConnectResource` — universal data ingestion (XML, CSV, JSON, TSV, NDJSON)
  - `connect.ingest()` — push data in any format
  - `connect.testParse()` — dry-run parse without storing
  - `connect.sources.create/list/get/update/delete()` — manage connector sources
  - `connect.sources.records()` — list ingested records
  - `connect.sources.schema()` — get auto-discovered schema
  - `connect.sources.getMappings/updateMappings()` — field→label mappings
  - `connect.sources.print()` — print labels from connector data
- CLI: `npx labelinn connect sources`, `connect ingest`, `connect parse`

## [1.0.0] - 2026-03-30

### Added

- Initial public release
- `PrintResource` — create, list, get, cancel, reprint print jobs
- `FleetResource` — list printers, get details, check status
- `DesignsResource` — full design CRUD, element management, variables, clone, render, print
- `WebhooksResource` — create, list, delete, test webhook subscriptions
- `LabelInnError` and `LabelInnRateLimitError` error classes
- Idempotency support via `X-Idempotency-Key` header
- Test mode detection (`sk_test_*` keys)
- Rate limit info on every response (`_rateLimit`)
- CLI tool: `npx labelinn test|printers|print|jobs|designs|webhooks`
- Full TypeScript type definitions
- Zero external dependencies (uses Node.js 18+ built-in `fetch`)
