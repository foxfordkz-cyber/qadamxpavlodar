# Cloud Stage D/F acceptance — Outcomes and complete linked workflow

Branch/PR: existing `codex/cloud-api-persistence`, Draft [#39](https://github.com/foxfordkz-cyber/qadamxpavlodar/pull/39).
Base: `98cf6c68d5370331d6f95aa9e749f82d504e5670`.
Stage B: `e95d2c2db6ae84d0b5504105ceb4c50faa795509`.
Stage C: `787f7b18cd9038785f061e0132857dc8e8eab88a`,
[CI success](https://github.com/foxfordkz-cyber/qadamxpavlodar/actions/runs/41198888442).
This document belongs to the Stage D code commit; its exact SHA is recorded in the PR description and final handoff.

## Implementation

- Migration 5 adds immutable forecast snapshots, cohorts, canonical registry membership, dated
  inspections, per-plant source links and accepted-report foreign keys. No second plant registry.
- Existing Outcomes domain operations are shared between synchronous SQLite and awaited PostgreSQL
  transactions. The existing web analytics functions/formulas are imported unchanged.
- The planning adapter supplies the same catalog, soil-aware site and checked rates within the same
  transaction. Snapshot stores the entire analysis, catalog, rates, assumptions and provenance.
- Original authorization, source/date validation, manual coordinator attestation, versions,
  CSRF and idempotency remain. Viewer reads; worker/foreman see cohorts only through explicit task links.
- Inspections and snapshot contents cannot be updated/deleted. Cohort content is immutable except
  version. Membership/source rows are append-only. Native foreign keys preserve links.
- `null` planting date and unknown survival stay unknown. No inspection is not evidence of death.
  Accepted planting report is not an accepted inspection report. Prose is never parsed into survival.
- PostgreSQL seed remains insert-only; it does not create fictitious Outcomes automatically or
  overwrite HTTP-created records. Test-created data is marked DEMO, never claimed as field data.
- Added 9 Outcomes operations; generated cloud OpenAPI has 87 operations. Dashboard response
  schema now correctly describes an array, matching the actual response and SQLite contract.
  The shared generator also describes the Outcomes OpenAPI document without an incorrect data envelope;
  the real extension response is schema-validated over HTTP. Other response envelopes are unchanged.
- Owner-applied Render blueprint lists private-storage configuration names only; auto-deploy stays off.

## Actual HTTP chain

`login → existing zone → recommendation/estimate → saved calculation → tree-only forecast →
admin-approved design → planting task → crew/worker assignment → private photo → report →
coordinator acceptance → canonical plants → cohort with exact forecast composition →
separate plant-inspection task/report → acceptance → specialist attestation → viewer summary/history`

Every main-chain record is created by the real compiled backend over HTTP in a new native PostgreSQL
cluster. The image is sent over HTTP to explicitly test-only private durable storage. Actual response
DTOs are validated against live generated OpenAPI. A separate disposable SQLite copy checks identical
HTTP DTOs/scopes; it is never used by the cloud runtime.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Typecheck/build | PASS | d-typecheck-publish.log, d-build-publish.log |
| OpenAPI generator | PASS, 87 operations | d-openapi-spec.log |
| Targeted native PostgreSQL linked chain | PASS 12/12, including final extension schema; also in full suite | d-outcomes-publish.log; d-pg-spec-final.log |
| SQLite Outcomes regression | PASS 10/10 | d-sqlite-targeted-2.log |
| Full PostgreSQL HTTP suite | PASS 60/60, zero skipped | d-pg-spec-final.log |
| Full backend/SQLite | PASS 105/105, zero skipped | d-sqlite-spec-final.log |
| Docker Compose CLI/config | PASS, v5.0.1 and config --quiet | stage-d-docker-status.json; separate from Engine/runtime |
| Render blueprint schema | PASS | d-render-validation.json; cached official schema, not provider deployment |
| Docker Engine / runtime | BLOCKED | dockerDesktopLinuxEngine named pipe unavailable |
| Supabase PostgreSQL/private Storage | NOT RUN / BLOCKED | No approved access |
| Render/HTTPS/cold start/real redeploy | NOT RUN / BLOCKED | No approved backend origin |

Coverage includes concurrent same-key requests, changed-body conflict, lost inspection response,
concurrent version conflict, late history failure rolling back source links/version/receipt,
immutable history and snapshots, actual existing frontend API-mode adapters over real HTTP,
explicit unsupported-route 503s, foreign worker/cohort scope, complete restart and repeat seed.

Upgrade check starts at published migration 4 with existing linked tasks, accepted reports, photos,
intents, users, saved calculations and histories. An intentionally colliding test table makes
migration 5 fail after its first DDL; all new DDL rolls back and all old rows remain unchanged.
Removing only that artificial QA table allows upgrade. Repeated migration checks all checksums.
Fresh schema, older v1/v2 upgrades, changed/unknown migration refusal remain in the full suite.

After closing backend, stopping/starting native PostgreSQL and restarting the durable test storage,
the scenario verifies the same report, photo digest, task history, complete Outcomes read model,
snapshot and table hashes/counts. Two repeat seeds preserve password hashes and account versions;
fresh role logins then succeed. No user SQLite or Docker volumes are used.

## Failed attempts retained, not counted as PASS

- Initial targeted SQLite command omitted the existing `tests/setup-env.mjs` runner; login input was
  invalid (10 failures). Re-run with the normal random-credential setup: 10/10. Auth was not weakened.
- Initial native test used the report-review envelope for GET report detail. The existing detail DTO
  is `{data:Report}`; test was corrected to the published transport. Initial failure log retained.
- Expanded adapter run found the dashboard OpenAPI array mismatch. The server schema was corrected,
  not the assertion. The snapshot is produced by the normal generator.
- An intermediate test-only TypeScript inferred an untyped accumulator recursively; explicit
  result type fixed it. All final checks run after the source corrections.

## Limits

Local native PostgreSQL is not Supabase. Test HTTP storage is not actual Supabase Storage.
Local proxy simulation is not Cloudflare runtime/TLS. No public deployment was performed.
Global workflow write serialization (including private remote finalization) is conservative and
limits concurrency. Unsupported UI routes remain in [cloud-route-coverage.md](cloud-route-coverage.md);
this is not a claim of complete cloud API coverage.

[Contract](cloud-api-contract.md) · [Тәңірберді/captain handoff](cloud-workflow-handoff.md).


Final native-suite artifacts (outside Git):

- `C:\Users\user\AppData\Local\Temp\gp-cloud-workflow-5ZcvXr`
- `C:\Users\user\AppData\Local\Temp\gp-cloud-workflow-LtyN0a`
- `C:\Users\user\AppData\Local\Temp\gp-cloud-planning-KcimBC`
- `C:\Users\user\AppData\Local\Temp\gp-cloud-workflow-8cgnCG`

The first directory contains stage-d-persistence.json, the exact linked IDs, aggregate table
counts/hashes and photo digest; HTTP trace and remaining-routes.json contain no credentials.
Native runs stop their own services and retain only isolated test data.

Final timings: PostgreSQL 367.704 s; backend/SQLite 268.591 s (runner timings).
The preceding complete 60/60 and 105/105 runs predate the final generator correction; the logs
ending spec-final are the final source verification. No test expectations or generated snapshot
were manually weakened to pass.

After the full suites, only EOF whitespace and the cloud extension specification title/HTTPS
description were corrected. Typecheck/build and the full targeted 12-case HTTP Outcomes chain
were rerun for publication; no domain/schema/authorization logic changed in that final cleanup.
