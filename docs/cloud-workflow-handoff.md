# Cloud workflow handoff — Тәңірберді / captain / QA

Checkpoint: Stage D/F of Draft PR #39, branch `codex/cloud-api-persistence`.
The exact accepted commit is in the PR description; use that SHA, not a floating branch, for acceptance.
Stage A was `3e25d3dd49498afdf879c92770f74c0cdba06b03`; Stage B is `e95d2c2db6ae84d0b5504105ceb4c50faa795509` (CI success). Stage C: `787f7b18cd9038785f061e0132857dc8e8eab88a` (CI success). Public backend origin: **not provisioned**.
The reported public mock at https://green-pavlodar-mock.pages.dev/ is separate from this API.
PR #35 reviewed at `1916d199b62ee6416502b4aac3244b5aa47d37d9`; its published static source is `98cf6c6`.
The owner's reported 16/16 public mock checks were not rerun or counted as backend evidence.

## Exact API / DTO sources

All URLs below use `/api/v1`. The live `/api/v1/openapi.json` and generated
`apps/server/openapi-cloud.json` contain the exact input/output schemas (87 operations at Stage D).
The method, permission and state matrix is in [cloud-api-contract.md](cloud-api-contract.md).

- `POST /auth/login` input `{login,password}`; output `{data:{user,csrfToken}}` and the session cookie.
  `GET /auth/me` refreshes the public user/CSRF view. Public user fields are
  `id,displayName,role,active,version`; profile endpoints add availability, never credentials.
- `GET /tasks?status=assigned` returns `{data:[Task],meta:{limit,offset,total}}` in the actor's scope.
  `GET /tasks/:id` returns `{data:{...Task,reports:[Report]}}`.
- `GET /workers` returns `{data:[{...User,profile}]}`; `GET /crews` returns crew documents and
  membership history. Admin configures profiles with `PATCH /users/:id` and creates/edits crews.
- `POST /tasks` (coordinator) needs `objectType,objectId,action,description,estimatedMinutes,evidenceIds`.
  `minWorkers` defaults to 1. `water`/`weed` require an existing plant; `plant` requires the approved
  design release route. Success is 201 `{data:Task}` with `status:draft,version:1,isDemo:true`.
- `POST /tasks/:id/assign` (coordinator):
  `{expectedVersion,crewId,scheduledStart,scheduledEnd,resourceIds}`. Interval must fit the duration.
- `POST /tasks/:id/assign-workers` (own foreman): `{expectedVersion,workerIds}`.
  Worker profiles must fit the shift/capacity/skills; active membership and overlapping work are checked.
- `POST /tasks/:id/start` (assigned executor/own foreman): `{expectedVersion}`.
- `POST /tasks/:id/reports`: `{expectedVersion,note,actualWorkerIds,photoIds,actualPlantingItems}`.
  Upload photos first through the private route below. Success 201 is
  `{data:{report,task}}`; use both returned versions for review.
- Groups use `POST /tasks/:id/report-draft/contributions` with
  `{expectedVersion,expectedDraftVersion,note,photoIds}`; own foreman saves the summary with
  `PUT /tasks/:id/report-draft` using the full report content plus the two expected versions.
  Group submission is by own foreman with current `expectedDraftVersion`.
- `POST /reports/:id/review` (coordinator):
  `{expectedVersion:task.version,expectedReportVersion:report.version,decision:"accepted",comment}`.
  Return uses `decision:"changes_requested"`, not `rejected`. Response:
  `{data:{report,task,plants,careTasks,warnings}}`. No second acceptance/registry insertion.
- Viewer reads `GET /tasks`, `/tasks/:id`, `/tasks/:id/history`, `/reports`, `/reports/:id`,
  `/workers`, `/crews` and permitted object context. Viewer cannot create, edit, assign, start,
  contribute, submit, review, or approve.

## Photo request / response

`POST /uploads` uses `FormData` with exactly `taskId` and one `file`. Worker/own foreman needs an
in_progress task. Keep the file and the original key on an ambiguous response; do not manually set
multipart Content-Type. JPEG/PNG/WebP, max 5 MiB, single frame, max 4096×4096; server strips metadata
and returns WebP. Up to 50 stored/pending photos per task; two simultaneous normalizations, otherwise 429.

```js
const form = new FormData();
form.set('taskId', task.id);
form.set('file', selectedFile);
const response = await fetch('/api/v1/uploads', {
  method: 'POST', credentials: 'same-origin',
  headers: { 'X-CSRF-Token': csrfToken, 'Idempotency-Key': retainedUploadKey },
  body: form
});
```

201 DTO: `{data:{id,taskId,ownerId,reportId:null,sha256,byteSize,mediaType:"image/webp",createdAt,contentUrl}}`.
Use `contentUrl` (same-origin `/api/v1/uploads/<id>`) for authenticated binary reads, and `id` in report
photoIds. Do not construct a public Supabase URL. Group participants explicitly contribute their own
photos before a foreman can submit them. Viewer reads but cannot upload. Storage outage/corrupt/missing
bytes return 503. PHOTO_STORAGE_NOT_CONFIGURED means operator configuration is still absent.

Migration 4 preserves durable upload intents for safe recovery. Only the operator CLI can reconcile
aged unreferenced pending intents; see the contract. Retry after DB failure or response loss keeps the
same object/metadata/report; the backend never silently switches to a local uploads directory.

## Outcomes request / response examples

The inspection screen currently has an informational “manual confirmation” label, not a new form.
The API can be integrated independently; this task does not build or change that UI.

```js
// All calls use the same authenticated cookie and stable per-action Idempotency-Key.
const forecastBody = {
  id: 'outcome-demo-forecast', siteId: site.id,
  expectedVersion: site.version, expectedRatesVersion: rates.version, variant: 'econom'
}; // POST /api/v1/outcomes/snapshots → {data:{id,snapshot,createdAt}}
const cohortBody = {
  id: 'outcome-demo-cohort', siteId: site.id, plantIds: acceptedPlantIds,
  plantedOn: null, snapshotId: savedForecast.id, evidenceIds: demoEvidenceIds,
  expectedVersion: 0
}; // POST /api/v1/outcomes/cohorts → {data:Cohort}
// Composition MUST match savedForecast; plantIds are canonical accepted planting results.
const inspectionBody = {
  id: 'outcome-demo-inspection', observedOn: reportDayInUTCPlus5,
  expectedVersion: cohort.version, evidenceIds: demoEvidenceIds,
  observations: [
    {plantId: firstPlantId, state: 'alive', reportId: acceptedInspectReport.id, evidenceIds: []},
    {plantId: secondPlantId, state: 'unknown', reportId: null, evidenceIds: []}
  ]
}; // POST /api/v1/outcomes/cohorts/<id>/inspections → {data:Inspection}
```

The linked report must be accepted, for an inspect task on that exact tree, dated on observedOn.
The accepted planting report alone is insufficient. A specialist explicitly confirms state; prose
does not create facts. Test records are DEMO. Unknown/null remain unknown/null, with no invented zeros.
After append, reload cohort.version. Snapshot/inspection bodies and member/source links are immutable.

Viewer reads `/outcomes/sites/:id`, `/outcomes/cohorts`, `/outcomes/cohorts/:id`,
`/outcomes/cohorts/:id/inspections`, `/outcomes/cohorts/:id/summary?inspectionId=...`.
List cohorts uses `{data:[{data,meta}]}`; detail `{data,meta}`; summary `{data:{summary,comparison,asOf}}`.
The whole site read model is `{data:{siteId,asOf,cohorts,inspections,registry,forecasts}}`.
Do not send the mock-only `/outcomes/:id/forecasts` route to this API.


## Session and retry contract

Use `credentials:'same-origin'`. Cookie: `gp_v2_session`, host-only (no Domain),
`HttpOnly; Secure; SameSite=Strict; Path=/api/v1`, 8-hour session. Production requires HTTPS.
Take `csrfToken` from login/me; send `X-CSRF-Token` on every POST/PATCH/PUT, including logout.
JSON body requires `Content-Type: application/json`; maximum 32 KiB.

Every mutation also needs a stable `Idempotency-Key` (1–128 allowed characters).
Keep the original key **and exact body** if the response is lost. Explicit retry returns the
original response plus `Idempotency-Replayed:true`; changed body under the key is 409.
A new action uses a new key and the latest version. Rights are checked before replay.
Do not automatically retry POST with a new key or replace failures with mock data.

Errors: `{error:{code,message,requestId,details?}}`. 401 requires login; 403 is permission/CSRF/
Origin/Host; 404 hides absent/out-of-scope objects; 409 requires reconciliation of version/status/
idempotency; 503 means DB/storage/unmigrated capability, not success. The existing web compatibility
adapter lowercases codes. Proxy timeouts may return a shorter proxy error or non-JSON response.

## Fixed Cloudflare same-origin proxy

Preserve `/api/v1/*`, query, method, raw multipart body, cookies, CSRF, Idempotency-Key, content type,
individual Set-Cookie headers, binary response and HTTP status. Set no-store on browser/CDN paths.
Use a fixed reviewed HTTPS backend origin from server configuration, never request input.
Reject all upstream redirects and keep the original client Origin.

`ALLOWED_HOSTS` contains the real backend Host without scheme/port/wildcards; never use
X-Forwarded-Host for authorization. `FRONTEND_ORIGINS` contains the exact public HTTPS origin
(no path/trailing slash). PR #35 removes Host and client forwarding headers before upstream fetch;
Host then comes from the fixed backend URL. Render's immediate trusted ingress must overwrite
X-Forwarded-Proto. Set `CLOUD_TRUST_PROXY_HOPS=1` only behind that ingress, not a public bare Node port.
Do not add a cookie Domain or strip Secure/SameSite/Path at the proxy.

Local loopback tests cover the forwarding contract, Origin rejection, CSRF and PUT preflight.
These tests do not prove real Cloudflare runtime, public TLS, cold-start or mobile/second-device access.

## Health, run and configuration

`GET /health` or `/api/v1/health`: process liveness. `GET /api/v1/ready`: live PostgreSQL and exact
migration count, capabilities and photo readiness. At Stage D: schemaVersion 5; photos not-configured or private-storage-configured (bucket verified).
Readiness does not prove complete API coverage or seed suitability. Other authenticated unsupported
URLs return 503 `CLOUD_ENDPOINT_UNSUPPORTED`; missing session is checked first.

From `apps/server`:

```sh
npm ci
npm run typecheck
npm run build
npm run test:postgres
npm test
npm run openapi:cloud
```

Native PostgreSQL tests provision only new isolated loopback clusters; no Docker/system service,
user SQLite or user volumes are touched. Evidence dirs are printed without secrets. To run an
approved isolated DB manually, use ignored `.env.cloud` based on `cloud.env.example`:
`npm run seed:cloud` (explicit opt-in) then `npm run start:cloud`. Startup and seed run checked,
append-only migrations; neither resets a database. Repeat seed preserves existing accounts/passwords
and planning records. Admin creates crews and profiles through the above APIs.

Configuration names only: `DATABASE_URL`, `CLOUD_ALLOWED_HOSTS`, `PG_CA_FILE`, `ALLOWED_HOSTS`,
`FRONTEND_ORIGINS`, `PORT`, `CLOUD_TRUST_PROXY_HOPS`. Loopback tests alone use `CLOUD_LOCAL_TEST`.
Explicit seed alone uses `CLOUD_DEMO_SEED`, `DEMO_PASSWORD`. Do not log any values or commit env files.
Storage configuration names: SUPABASE_URL, SUPABASE_STORAGE_BUCKET, SUPABASE_SERVICE_ROLE_KEY, STORAGE_ALLOWED_HOSTS. Never use a public bucket.

## Local evidence at Stage D/F

Expanded native HTTP chain **12/12**; SQLite Outcomes **10/10**. Typecheck/build and generated
OpenAPI PASS (87 operations). Full PostgreSQL **60/60**, full backend/SQLite **105/105**, zero skipped,
after the final generator correction; see [Stage D evidence](cloud-stage-d-acceptance.md).
Actual current frontend API-mode adapters were invoked over HTTP; no browser UI/public cloud PASS
is claimed. Render/Supabase/HTTPS/cold-start/redeploy remain NOT RUN.

## Historical local evidence at Stage C

Server typecheck/build and generated OpenAPI PASS (78 operations). Full backend/SQLite **105/105**;
full native PostgreSQL HTTP **48/48**, zero skipped. Targeted private photos **11/11**.
See [Stage C evidence](cloud-stage-c-acceptance.md). Public provider checks remain NOT RUN.

## Historical local evidence at Stage B

Server typecheck/build PASS; full backend/SQLite 104/104; native PostgreSQL HTTP 37/37.
The latter includes shared DTO parity, actor scope, group draft versions, lost-response replay,
concurrent version conflicts, late rollback, one-time planting, v2→v3 upgrade, backend/PostgreSQL
restart and repeat seed. Failed parallel startup and subsequent serial PASS are recorded separately
in [cloud-stage-b-acceptance.md](cloud-stage-b-acceptance.md). No provider PASS is inferred.

## Owner actions and remaining limits

- Backend: B/C/D and linked local HTTP acceptance are implemented. Search, drawn-zone save, imports, care calendar, assistant and context regeneration remain a separate backlog; see cloud-route-coverage.md.
- Тәңірберді: keep mock and API modes explicit; wait for accepted backend SHA and actual HTTPS origin;
  bind the fixed Pages proxy only after captain approval. Preserve request/key/draft/photo on ambiguity.
- Captain: approve a new isolated demo provider project and free service; supply credentials securely;
  build the accepted SHA, check exact Host/Origin/TLS settings and private bucket policy. Do not delete
  user volumes or provision a paid plan. Merge to coordinator remains the captain's task.
- QA: on the accepted combined version run login → worker task → photo → report → review → viewer,
  then native/provider restarts, seed, private reads, history, null/unknown Outcomes and another device.
- Render, Supabase PostgreSQL/private Storage, real HTTPS, cold start, real redeploy persistence:
  **BLOCKED / NOT RUN (approved credentials and infrastructure unavailable)**.

## Local operator and captain sequence

From repository root: `npm ci --prefix apps/server --include=dev`, then
`npm run typecheck --prefix apps/server` and `npm run build --prefix apps/server`.
Keep the repository root: unchanged shared analytics TypeScript lives under apps/web and is loaded
by the existing tsx bridge. No web build is needed for the cloud API entry point.

From apps/server, populate ignored `.env.cloud` securely from cloud.env.example. For a NEW isolated
loopback test DB only, CLOUD_LOCAL_TEST=1 allows loopback PostgreSQL/test storage; never use this
flag in a provider deployment. Production requires verified PostgreSQL TLS and private HTTPS storage.
`npm run start:cloud` applies checked migrations before listen. `npm run seed:cloud` also migrates,
and requires explicit CLOUD_DEMO_SEED=1 plus a private DEMO_PASSWORD. It inserts missing users and
reference records; repeat seed does not reset accounts or workflow. There is no destructive reset command.
After the explicit seed, remove the seed opt-in/password from service configuration. Create profiles,
crews and membership via admin API before assigning work; cloud seed does not fabricate those records.

Captain: use render.cloud.yaml only after approved infrastructure/access. Confirm its exact source
SHA, Node 24.21, repo-root build, auto-deploy off, fixed Host/Origin, one trusted ingress hop and all
private-storage variables. Provision no paid service without authorization. Check migrated private
schema and bucket policy, seed once if appropriate, then perform the documented actor/photo/Outcomes
chain through the real Cloudflare HTTPS proxy. Restart/redeploy and verify IDs/bytes/history/passwords;
repeat seed and confirm unchanged hashes/counts. Repeat from a second device. Local evidence is not
a substitute for these provider checks.

For storage repair: `npm run storage:reconcile` is dry-run; inspect counts first. `npm run
storage:reconcile -- --apply` removes only aged pending unreferenced intents under the workflow lock.
No bucket-wide deletion or user volume deletion is needed.

Docker Compose CLI v5.0.1 is available; Engine named pipe dockerDesktopLinuxEngine is absent.
Docker runtime remains BLOCKED, and no engine installation/system change was attempted. Native
PostgreSQL/server/private-test-storage restart is separately tested. Docker runtime stays the captain's task.
