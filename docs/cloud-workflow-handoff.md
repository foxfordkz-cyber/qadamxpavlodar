# Cloud workflow handoff — Тәңірберді / captain / QA

Checkpoint: Stage B of Draft PR #39, branch `codex/cloud-api-persistence`.
The exact accepted commit is in the PR description; use that SHA, not a floating branch, for acceptance.
Stage A was `3e25d3dd49498afdf879c92770f74c0cdba06b03`. Public backend origin: **not provisioned**.
The reported public mock at https://green-pavlodar-mock.pages.dev/ is separate from this API.
PR #35 reviewed at `1916d199b62ee6416502b4aac3244b5aa47d37d9`; its published static source is `98cf6c6`.
The owner's reported 16/16 public mock checks were not rerun or counted as backend evidence.

## Exact API / DTO sources

All URLs below use `/api/v1`. The live `/api/v1/openapi.json` and generated
`apps/server/openapi-cloud.json` contain the exact input/output schemas (76 operations at Stage B).
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
  Omit photo IDs at the Stage B checkpoint: cloud upload is not implemented yet. Success 201 is
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
migration count, capabilities and photo readiness. At Stage B: schemaVersion 3, photos unsupported.
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
Storage configuration is reserved until Stage C; do not enable a public bucket.

## Local evidence at Stage B

Server typecheck/build PASS; full backend/SQLite 104/104; native PostgreSQL HTTP 37/37.
The latter includes shared DTO parity, actor scope, group draft versions, lost-response replay,
concurrent version conflicts, late rollback, one-time planting, v2→v3 upgrade, backend/PostgreSQL
restart and repeat seed. Failed parallel startup and subsequent serial PASS are recorded separately
in [cloud-stage-b-acceptance.md](cloud-stage-b-acceptance.md). No provider PASS is inferred.

## Owner actions and remaining limits

- Backend: finish Stage C private photos and Stage D Outcomes, linked restart/reseed acceptance,
  then update this handoff and the actual generated OpenAPI. Stage B is not the full worker scenario.
- Тәңірберді: keep mock and API modes explicit; wait for accepted backend SHA and actual HTTPS origin;
  bind the fixed Pages proxy only after captain approval. Preserve request/key/draft/photo on ambiguity.
- Captain: approve a new isolated demo provider project and free service; supply credentials securely;
  build the accepted SHA, check exact Host/Origin/TLS settings and private bucket policy. Do not delete
  user volumes or provision a paid plan. Merge to coordinator remains the captain's task.
- QA: on the accepted combined version run login → worker task → photo → report → review → viewer,
  then native/provider restarts, seed, private reads, history, null/unknown Outcomes and another device.
- Render, Supabase PostgreSQL/private Storage, real HTTPS, cold start, real redeploy persistence:
  **BLOCKED / NOT RUN (approved credentials and infrastructure unavailable)**.
