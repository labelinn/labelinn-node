# Changelog

All notable changes to the LabelInn Node.js SDK will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

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
