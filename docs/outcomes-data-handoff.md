# Outcomes storage / handoff (2026-10-30)

Dependency: PR #18 is OPEN, not merged, head 7c9b387b2d69e4500bf799e8b11f509704a5537f.
This branch fast-forwards from coordinator e6d9079840bd7a7469488031ab777a851c7f8d78 to that exact
head, then adds storage. Merge #18 first, then review this PR's own diff. No #19/deployment changes.

## Transport extension proposed for captain review

#18 defines JSON and pure math, **not routes, role matrix or envelopes**. These routes extend it,
without changing those DTOs/signatures. Cohort/inspection isDemo stays in provenance as contracted;
creation/reviewer fields are response metadata/DB columns, not invented additions to the core DTO.
Prefix /api/v1/outcomes; authenticated OpenAPI: GET /openapi.json under this prefix.

| Method/path | Body / result |
| --- | --- |
| POST /snapshots | {id,siteId,expectedVersion:siteVersion,variant: econom/optimal/max} → {data:{id,snapshot,createdAt}} |
| POST /cohorts | {id,siteId,plantIds,plantedOn:null or YYYY-MM-DD,snapshotId:null or stored ID,evidenceIds,expectedVersion:0} → {data:OutcomeCohort} |
| GET /cohorts | {data:[{data:OutcomeCohort,meta:{createdAt,createdBy}}]} |
| GET /cohorts/:id | {data:OutcomeCohort,meta:{createdAt,createdBy}} |
| POST /cohorts/:id/inspections | {id,observedOn,observations:[{plantId,state:alive/dead/unknown,reportId:null or ID,evidenceIds:[]}],evidenceIds:[],expectedVersion:cohortVersion} → {data:OutcomeInspection} |
| GET /cohorts/:id/inspections | {data:[{data:OutcomeInspection,meta:{createdAt,reviewerId}}]} |
| GET /cohorts/:id/summary?inspectionId=ID | {data:{summary,comparison,asOf}}; omission means NO inspection, not silently latest |

POST /api/v1/auth/login {login,password}; retain HttpOnly cookie, take data.csrfToken.
Use credentials:'include', Content-Type:'application/json', X-CSRF-Token and a fresh Idempotency-Key
on writes. Retry an identical request with the same key after transport failure. Different body with
same key → 409. New key with stale expectedVersion → 409; reload before retry. Never log passwords/cookies.
Errors: {error:{code,message,requestId,details?}}. 400 validation/source failure, 401 login,
403 CSRF/write role, 404 inaccessible/missing object, 409 versions/duplicates, 500 rollback.
No API error should be converted to mock data. This module does not wire another owner's UI.

## Storage and safety

Schema 5→6 in Store's existing atomic migration: outcome_snapshots, outcome_cohorts,
outcome_members, outcome_inspections, outcome_sources. Composite foreign keys refer to existing
V2 site/plant documents; report links use v2_reports. A tree belongs to one original cohort.
No parallel plant registry. Tree only; flowerbed is rejected. Snapshot/inspection UPDATE and DELETE
are blocked by triggers. Cohort content is immutable; its version increments per appended inspection.
One inspection per cohort/day. Corrections require an explicit future contract, not overwriting history.
Create IDs are supplied by clients, so retry with a new key still cannot duplicate the same object.

Admin/coordinator write; viewer read only. Foreman/worker read only where their existing tasks cover
the entire cohort or its explicit site. A task on one member does not expose the other members.
Client role is ignored. Access is rechecked on idempotent writes by existing mutate/auth machinery.

Plant site must be explicit plant.siteId or accepted planting receipt → task.objectId;
species must resolve exactly in the existing catalog. Unknown planting dates remain null.
Snapshot endpoint computes with current persisted site/rates/catalog via original analyzeZone and
createOutcomeSnapshot; no client-supplied forecast/capture date accepted. Only saved snapshot IDs may
be attached; original cohort composition/date checks use createOutcomeCohort. Summary/comparison call
the original #18 functions over saved JSON; no alternate formulas. API snapshots are conservatively
marked isDemo=true while the bundled model/prices include synthetic/demo inputs.

Alive/dead needs an accepted, reviewed **inspect** report for this plant and observation calendar day.
Current V2 report has no structured alive/dead property: admin/coordinator explicitly attests the state
when creating an inspection. The module does not infer death from prose or watering deadlines. This
attestation workflow needs captain sign-off; a worker cannot claim acceptance or change an inspection.
Evidence ID alone is insufficient, except the explicitly synthetic outcomes-demo-evidence on demo cohorts.
All inspection rows retain reviewer and sources; absent observations stay unknown.

## Demo and frontend / E2E

Use an isolated DB with private DEMO_PASSWORD; run existing npm run seed:tz, then from apps/server:
node --env-file-if-exists=.env --import ./scripts/local-network-guard.mjs --import tsx src/outcomes/seed-cli.ts
Opt-in only, not automatic startup. Repeating seed returns created:false and preserves records.
IDs: outcomes-demo-cohort / outcomes-demo-forecast / outcomes-demo-inspection; trees outcomes-demo-tree-N.
On the audited base the econom tree-only calculation creates 32 synthetic registered trees;
the control inspection records 3 observations (alive, dead, unknown), leaving the others unknown.
Snapshot is captured on seed day before synthetic planting; observations are synthetic alive/dead/unknown,
not historical field validation. Non-anniversary comparison is unmatched_horizon, not a fabricated delta.

Тәңірберді: use exact envelopes above and original #18 DTOs; display provenance for cohort, forecast
and inspection independently. Render missing forecast/date and null percentages with issues. Select an
inspection explicitly. Show assessment coverage and survival among assessed separately. Do not show
comparisonKey or turn unknown into zero/dead. Mock transport must remain explicitly selected.

Айдана (no tools/e2e changes): login all roles; viewer write 403; unrelated worker 404; related site crew
can read; omit CSRF →403; repeat write key returns same object; stale version →409; duplicate day →409;
reload and restart retain all history; coefficients/rates edits must not alter persisted forecast JSON;
unknown dates/no inspection display null; missing/unaccepted/wrong-plant report rejected; demo labels visible.
Run against accepted final coordinator SHA, not an unfinished branch. No browser E2E claim in this PR.

New shared/api/outcomes-reader.ts supplies apiOutcomesReader() and mockOutcomesReader(cohorts,
inspections, asOf) with equivalent read envelopes. The latter takes explicitly labelled synthetic
fixtures and runs entirely offline; it does not emulate authentication. Unit tests use both transports
and verify API failures propagate. UI owners must select the transport explicitly; existing screens
are intentionally not rewired. Write request examples above use the existing authenticated HTTP client.

Before schema 6 rollout, take a coherent DB/uploads backup. Old coordinator code only accepts
schema 5: rollback requires the matching pre-migration backup in a separate restored volume,
not running the old binary against schema 6. Migration preservation tests compare every old row.

## Actual verification

- Backend typecheck and build: PASS.
- Complete backend suite: **73 passed, 0 failed, 0 skipped**, including 8 new outcomes tests,
  V2 group planting/acceptance, migration preservation, auth, roles and municipal import/export.
- Final command: `node --import ./scripts/local-network-guard.mjs --import ./tests/setup-env.mjs --import tsx --test --test-concurrency=2 tests/*.test.ts` from apps/server.
- Tests ran against an isolated source copy outside .codex (221 source/test files compared byte-for-byte).
  The existing sendFile dot-directory defect is described in deployment PR #22; no global access policy changed.
- Initial npm test found two remaining schema-5 assertions and a request timeout under machine load.
  Assertions now expect schema 6 while retaining all preservation checks; final run limits concurrency,
  without changing request deadlines or skipping tests. All 73 pass.
- Frontend: typecheck/build/check:i18n PASS (1550/1550); **119 tests passed**, zero failed/skipped,
  including #18 analytics and 2 new reader transport tests. Existing large-chunk warning remains.
- Real HTTP + SQLite: invalid/foreign/duplicate trees, unknown date/state, reports, CSRF, role isolation,
  idempotent replay, stale versions, duplicate submission, injected rollback, closed-DB/server restart,
  session continuity, immutable snapshot after rate change and repeat seed covered.
- Docker runtime and public HTTPS: BLOCKED; no engine socket or approved hosting. Browser E2E: NOT RUN.
- Domain limitation: a report supports an explicit coordinator/admin attestation, not automatic inference
  of alive/dead. The new route/permission extension and reviewer workflow require captain review.
