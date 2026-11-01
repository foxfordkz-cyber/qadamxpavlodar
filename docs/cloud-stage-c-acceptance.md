# Stage C acceptance — private photos

Existing branch/PR #39; Stage B is published at `e95d2c2db6ae84d0b5504105ceb4c50faa795509`.
Its [CI run](https://github.com/foxfordkz-cyber/qadamxpavlodar/actions/runs/41196981655) succeeded.
Stage C adds migration 4 and POST `/api/v1/uploads`, GET `/api/v1/uploads/:id` (78 Swagger operations).
Published migrations 1–3 remain unchanged. Full cloud/Outcomes release acceptance is still pending.

## Implementation

- Existing image normalization moved into a memory-only base class shared by SQLite PhotoStorage and
  the cloud service. Same limits/decoding/WebP conversion; no cloud filesystem fallback.
- Existing SupabasePrivateStorage now backs authorized multipart upload/download and exact-object
  reconciliation. A private bucket is verified; production is fixed allowlisted HTTPS and service key
  only. Explicit loopback integration tests use a separate real HTTP service with persisted bytes.
- Durable intent before remote PUT; stable random name, raw-request hash, normalized SHA/size, unique
  owner/key. Exact same object is verified on retry after remote success/DB failure. Metadata, receipt
  and committed intent are one transaction. Pending records bound the orphan cleanup scope.
- One-time report binding reuses the existing report workflow. Worker draft photo ownership remains;
  viewer reads permitted existing photos but cannot upload or change reports.
- CLI cleanup defaults to dry-run; --apply only removes aged pending unreferenced server objects.
  It shares the finalization lock and never enumerates/deletes a bucket wholesale or touches user volumes.

## Local tests

| Check | Result | Evidence |
| --- | --- | --- |
| Server typecheck/build | PASS | c-typecheck-2.log, c-build-2.log |
| Generated actual OpenAPI | PASS | c-openapi-2.log; 78 operations |
| Real HTTP photo acceptance | PASS 11/11 | c-photos-2.log, tests/postgres/photos.test.ts |
| Full native PostgreSQL suite | PASS 48/48, zero skipped | c-pg-full.log |
| Full backend/SQLite | PASS 105/105, zero skipped | c-sqlite.log |
| Supabase private Storage | NOT RUN | Approved credentials unavailable |
| Render/PostgreSQL provider/HTTPS/redeploy | NOT RUN / BLOCKED | No actual approved cloud origin/infrastructure |

HTTP coverage: login/assigned task, image byte validation and metadata removal, authorized private
read, anonymous/provider denial, viewer/coordinator write denial, unassigned and draft-owner denial,
file/dimension/multipart limits, current sessions/CSRF, concurrent replay and body conflict, API response
loss, remote response loss after persisted bytes, DB failure after stored bytes, pending cleanup dry-run
and --apply through the actual CLI, deletion failure, no metadata/receipt partial commit, report binding,
acceptance and viewer read, group contribution permissions, revoked sessions, fixed-proxy multipart/
binary/no-store/key preservation, backend/native-PG/test-storage restart and unchanged repeat seed.
All test inputs are synthetic DEMO; none is described as a field observation.

Initial passing photo artifact: `%LOCALAPPDATA%/Temp/gp-cloud-workflow-gpmbEb/stage-c-persistence.json`
with aggregate table counts/hashes, photo SHA and linked report ID. Runtime credentials/DB dumps are
not committed. The final full-suite artifacts supersede this initial run when listed below.

## Limits

The integration storage is an explicitly labelled test HTTP service with durable disk objects. It is
not Supabase, Render or the Cloudflare runtime. No public URL, real TLS, provider policy, cold-start,
redeploy or another-device PASS is claimed. Cloud without configured storage returns explicit 503;
readiness reports not-configured. Stage D Outcomes and the separate remaining-route backlog still apply.
Global write serialization during remote calls is conservative and has a documented throughput limit.

[Protocol and maintenance](cloud-api-contract.md) · [Тәңірберді/captain handoff](cloud-workflow-handoff.md).

Final full-suite retained isolated evidence directories: `C:\Users\user\AppData\Local\Temp\gp-cloud-workflow-Aq5WaG`, `C:\Users\user\AppData\Local\Temp\gp-cloud-workflow-nAw7Tl`. No credentials or dumps are tracked.
