# Cloud API contract — PostgreSQL planning and workflow

Status, 31 October 2026: **local PostgreSQL verified; public deployment BLOCKED**.
The owner confirmed that Render/Supabase access is not available. No public backend origin exists
for this work, and no paid service was created. The existing Cloudflare publication is a mock.

Stages A/B/C extend the existing PR #39; base remains `98cf6c68d5370331d6f95aa9e749f82d504e5670`.
Branch: `codex/cloud-api-persistence`; target: `codex/coordinator`, **Draft**.
Current scope, real frontend route matrix, verification and remaining work:
[cloud-stage-a-acceptance.md](cloud-stage-a-acceptance.md) (historical Stage A) and
[cloud-stage-b-acceptance.md](cloud-stage-b-acceptance.md) (workflow) and [cloud-stage-c-acceptance.md](cloud-stage-c-acceptance.md) (private photos).
Earlier source/results/failures remain historical in
[cloud-persistence-verification.md](cloud-persistence-verification.md).

## Supported operations

Paths below have the `/api/v1` prefix. Requests and DTOs are the existing V2 contract.
SQLite and PostgreSQL share the session handlers, reference-data handlers, schemas, password
verification, DTO construction and OpenAPI generator. No Promise is passed to SQLite's synchronous
transaction callback. PostgreSQL transactions await every statement on one checked-out client.

| Method/path | Permission / behavior | PostgreSQL HTTP status |
| --- | --- | --- |
| POST `/auth/login` | Five demo roles; persistent throttling and scrypt; rotates session | 200 |
| GET `/auth/me` | Signed-in user; public user DTO and CSRF token only | 200 |
| POST `/auth/logout` | Current session, CSRF, JSON `{}` | 200 |
| GET `/evidence` | admin, coordinator, viewer, foreman | 200, `{data,meta}` |
| POST `/evidence` | admin or coordinator; CSRF + Idempotency-Key | 201 |
| GET `/resources` | admin, coordinator, viewer, foreman | 200, `{data,meta}` |
| POST `/resources` | admin; CSRF + Idempotency-Key | 201 |
| PATCH `/resources/:id` | admin; `expectedVersion`, CSRF + Idempotency-Key | 200 |

Worker cannot read these two reference lists, matching the existing local contract. Viewer cannot
write. Foreman cannot create sources/resources. Coordinator can create evidence but cannot edit
resources. Role/active/version are rechecked inside the transaction before idempotent replay.
Lists use `limit` (1–200, default 100) and `offset` (default 0).

Resource `ownerCrewId` may reference an existing crew; a missing crew returns 400
`INVALID_REFERENCE`, matching SQLite. `evidenceIds` must refer to existing sources and have
real foreign keys. Stage B adds canonical crew ownership without a second resource registry.
Unknown `capacity`, dates and other nullable values remain `null`.

Public service endpoints:

| Path | Meaning |
| --- | --- |
| GET `/health`, `/api/v1/health` | Process liveness, PostgreSQL slice label; not a DB or full-release acceptance |
| GET `/api/v1/ready` | DB connectivity and exact migration version; returns 503 on DB failure/unknown schema |
| GET `/api/v1/openapi.json` | Live generator; 78 implemented operations; `openapi-cloud.json` is generated from this HTTP route |

Readiness reports migration version 4, `capabilities: ["auth","evidence","resources","sites","context","analysis","rates","snapshots","crews","workers","designs","tasks","reports"]`
and `photos: "not-configured"` without storage configuration. With storage it verifies the private
bucket, adds the `photos` capability and returns `photos: "private-storage-configured"`; a storage
failure or unsafe bucket returns 503. This is DB/schema readiness, not full-release or seeded-data acceptance.

## Added planning operations

All paths have `/api/v1`. Planning calculation readers are admin/coordinator/viewer. Worker/foreman site/plant/design
reads use the existing assignment scope; city-wide calculation access remains denied. No write privilege is added to viewer.

| Method/path | DTO / behavior |
| --- | --- |
| GET `/sites`, `/plant-catalog` | Existing paginated V2 documents; preserve IDs/checks/nulls; limit 1–200, offset |
| GET `/sites/:id` | `{data: V2Site}`; frontend `siteFromV2` performs the existing conversion |
| GET `/sites/:id/context` | Persisted V2 context for downstream integrations |
| GET `/zones/:id/context?radius=50` | Existing SiteContext, radius 30/50/100/200; stale geometry version returns 409 |
| GET `/species`, `/rates` | Existing species array; `{rates,version}`; no fabricated price for null |
| GET `/layers/sources`, `/reference/facts` | Persisted source metadata/facts and attribution |
| GET `/layers/soils`, `/layers/greenery`, `/layers/city`, `/layers/zones` | Persisted GeoJSON; soil is explicitly synthetic until imported |
| GET `/dashboard/metrics` | Shared metrics from persisted sites, tasks, reports and design revisions |
| POST `/zones/:id/analysis`, `/zones/:id/variants` | `{options}`; shared mathematical model; CSRF required, no write/idempotency key needed |
| GET `/problems`; POST `/priorities`, `/decision-lab` | Existing shared calculations, persistent source inputs |
| PATCH `/rates` | Admin only, expectedVersion + CSRF + idempotency; atomic history/version/replay |
| POST `/zones/:id/snapshots` | Admin/coordinator only, CSRF + idempotency; 201 immutable analysis and exact input hash |
| GET `/analysis-snapshots/:id` | Persisted analysis, input snapshot and provenance; no recalculation |
| POST `/zones/:id/export` | `{options,format:"pdf"|"xlsx"}`; existing renderer, binary output; PDF needs Unicode font |

Word is **not** a new server route. Existing `loadMemo` reads rates before/after, site, analysis,
species and evidence through the real API and `buildMemoDocx` creates RU/KK OOXML. Cost and growth
are fields of `ZoneAnalysis`; the time-machine renderer uses that response and persisted context.
Do not invent `/recommendation`, `/cost`, `/growth` or `/word` endpoints.

POST `/zones/<id>/analysis` body: `{"options":{"variant":"optimal","watering":"regular","careYears":2}}`.
Response: `{data:{siteId,options,facts,scheme,cost,survival,survivalAvg,effect,inputSnapshot,provenance,...}}`.
Use the returned numbers unchanged. `effect` contains years 5/10/20; unknown dust/population stays null.
A missing mandatory coefficient returns 422 `MISSING_RATES`; missing measured area returns 422 `MISSING_AREA`.
Unknown option species returns 400 `UNKNOWN_SPECIES`. The existing frontend compatibility transport
maps server error codes to lowercase (for example `unknown_species`), preserving HTTP status.

## Unsupported cloud domains and next stages

Authenticated requests to other `/api/v1/*` routes return 503 `CLOUD_ENDPOINT_UNSUPPORTED`.
Unauthenticated requests receive 401 first; unsafe methods require CSRF even when unsupported.
There is no SQLite/memory/mock response fallback. Fixtures are used only by the explicit seed.

Stage B is implemented: profiles, crews/members, plants/sites/catalog/care policies, designs,
approval/revisions, tasks/assignment/start, group drafts, contributions, reports/review, issues,
planting receipts and history. See the endpoint/authorization matrix below. Shared domain generators
run synchronously on SQLite and await real PostgreSQL statements on one transaction client.
Writes take one database advisory lock before actor rows; this conservatively preserves SQLite's
serialized cross-task scheduling/resource checks. It is a scalability limitation, not a queue.

Stage C `/uploads` is implemented and tested with a local private HTTP storage service and PostgreSQL.
Real Supabase remains NOT RUN without approved credentials. Stage D (Outcomes) is pending in this
checkpoint; Stage A calculations are not Outcomes records.
GIS import/preview/commit, new drawn zones, geocode, care schedule, assistant, weather, RAG and
generated images remain unsupported. Site PATCH/checks, plant map points and task/design reads
are now available; the complete map editing/import scenario is still blocked.

## Workflow API (Stage B)

Every listed mutation requires CSRF and Idempotency-Key; edits/transitions use the schema's
expectedVersion and, where applicable, expectedReportVersion/expectedDraftVersion. Viewer is
read-only. Admin is not a substitute for coordinator on role-specific task/report actions.

| Method/path | Permission / response |
| --- | --- |
| GET `/users`; POST `/users`; PATCH `/users/:id`; GET `/users/:id/history` | Admin only; public user/profile DTO, no hash/session; edits revoke sessions |
| GET `/workers`, `/crews` | Viewer/admin/coordinator all; foreman own crew; worker own membership/context |
| POST `/crews`; PATCH `/crews/:id`; POST `/crews/:id/members` | Admin; one active crew per worker, versioned membership history |
| GET `/plants`, `/plants/geojson`, `/plants/:id`; `/sites`, `/sites/:id`, `/sites/:id/context` | Reader roles; worker/foreman assigned object scope |
| POST `/plants`; PATCH `/plants/:id` | Coordinator; sourced DEMO registry records |
| PATCH `/sites/:id` | Admin/coordinator; recorded checks use server reviewer/time |
| GET/POST `/plant-catalog`; PATCH `/plant-catalog/:id` | Admin/coordinator writes; reader roles; worker catalog limited to assigned approved design |
| GET/POST `/care-policies` | Admin/coordinator writes; reader roles except worker |
| GET `/designs`, `/designs/:id` | Viewer/admin/coordinator; assigned workers/foremen only linked immutable revisions on detail |
| POST `/designs`; PATCH `/designs/:id`; POST `/designs/:id/submit`, `/withdraw` | Coordinator; approved edit creates next revision |
| POST `/designs/:id/review` | Admin, decision `approved` or `changes_requested`; cleared current site/checks required |
| POST `/designs/:id/create-tasks` | Coordinator, exact approved revision, one issuance; never duplicate earlier planting |
| GET `/tasks`, `/tasks/:id`, `/tasks/:id/history` | Viewer/admin/coordinator all; worker assigned; foreman own crew |
| POST `/tasks`; POST `/tasks/:id/assign` | Coordinator; manual inspect/water/weed; plant tasks require approved design |
| POST `/tasks/:id/assign-workers` | Own foreman; profiles, skills, intervals, capacity and conflicts checked |
| POST `/tasks/:id/start` | Assigned worker/own foreman; revalidates assignment |
| GET `/tasks/:id/report-draft`; PUT `/tasks/:id/report-draft` | Task read scope; own foreman writes current draft version |
| POST `/tasks/:id/report-draft/contributions` | Assigned participant's own contribution only |
| POST `/tasks/:id/reports` | Assigned solo executor, or own foreman for group; `{data:{report,task}}`, 201 |
| GET `/reports`, `/reports/:id` | Viewer/admin/coordinator all, worker/foreman task scope |
| POST `/reports/:id/review` | Coordinator; `accepted` or **`changes_requested`**; `{data:{report,task,plants,careTasks,warnings}}` |
| GET/POST `/tasks/:id/issues` | Task read scope; worker/foreman/coordinator write; separate from completion |
| GET `/plants/:id/care-history`; GET `/dashboard?from=…&to=…` | Admin/coordinator; accepted events/counts only |

Task lifecycle is `draft → assigned → in_progress → submitted → verified`. A returned report is
`changes_requested` and returns its task to `assigned`; `rejected` is not a contract state.
Approval snapshots are immutable. Acceptance inserts plants/evidence/receipts, report state,
care events, task history and the idempotency receipt atomically. Repeating acceptance does not
insert a second plant. All rows are synthetic DEMO; acceptance is not evidence of field work.

## Sessions, proxy and transport

- Production cookie: `gp_v2_session`; `Secure; HttpOnly; SameSite=Strict; Path=/api/v1`, 8 hours.
  No Domain attribute. Local SQLite retains its established HTTP-cookie behavior. The cloud
  loopback test mode also omits Secure; it cannot connect to a non-loopback database.
- Get `csrfToken` from login or `/auth/me`. Send `X-CSRF-Token` on every unsafe request, including
  logout. Duplicate session cookies are rejected. `X-Demo-User` does not authenticate cloud users.
- Use one fixed HTTPS backend origin in the Cloudflare server proxy. Preserve `/api/v1/*`, Cookie,
  separate Set-Cookie headers, Content-Type, CSRF, Idempotency-Key and response status. Never accept
  upstream URLs from browser input. Disable caching and reject upstream redirects.
- Browser requests use same-origin `/api/*` and `credentials: 'same-origin'`. Do not expose database
  or Supabase service-role credentials to frontend code or build variables.
- Set `ALLOWED_HOSTS` to the actual Render/custom backend host names, without scheme/port/wildcards.
  The guard checks the actual Host header, not X-Forwarded-Host. The proxy must use the fixed
  upstream host for Host; preserve the browser Origin and allow that exact HTTPS origin via
  `FRONTEND_ORIGINS`. Origins with paths or trailing slash are invalid configuration.
- `CLOUD_TRUST_PROXY_HOPS=1` is for the single Render ingress immediately in front of Express.
  Render must overwrite forwarding headers. Do not use it for a directly exposed Node port.
  Cloudflare must discard caller-supplied forwarding headers. Secure-cookie behavior was tested
  with a local ingress simulation; real Render/Cloudflare HTTPS has not been tested.
- JSON limit is 32 KiB. Multipart `POST /uploads` accepts one `file` plus `taskId`, JPEG/PNG/WebP
  up to 5 MiB. Image bytes are checked, single-frame decoded images are limited to 4096×4096,
  EXIF/metadata are removed and bytes are normalized to WebP. At most two normalizations run
  concurrently; PHOTO_BUSY is 429. Stored + pending photos are limited to 50 per task.

## Private photos (Stage C)

`POST /uploads`: assigned worker or own foreman, while task is in_progress. Multipart fields are
`taskId` and `file`; do not set Content-Type manually in browser fetch (FormData supplies its boundary).
Send Cookie, X-CSRF-Token and the original Idempotency-Key on a deliberate retry.
201 response is `{data:{id,taskId,ownerId,reportId:null,sha256,byteSize,mediaType:"image/webp",createdAt,contentUrl}}`.
Only the application URL `/api/v1/uploads/<id>` is exposed. Object names and server keys are not DTO fields.

`GET /uploads/:id`: authenticated binary WebP in task read scope. Viewer/admin/coordinator can read;
foreman is crew-scoped; worker is assignment-scoped and cannot read another participant's unsubmitted
photo. The response is inline `report.webp`, no-store. Anonymous/private-provider URLs do not grant access.

Put photo IDs in report `photoIds` or explicitly contribute them to the group draft. Report submission
binds metadata atomically. A photo cannot bind to another report/task; another participant must first
contribute their photo. Accepting a report preserves the existing photo links.

A durable upload intent is committed **before** remote I/O. Raw request hash, stable server UUID/name,
normalized SHA/size and state survive a process crash. Remote PUT uses no overwrite. If a previous PUT
succeeded but DB metadata failed, the same-key retry authenticates a read and verifies the exact object
before finalizing metadata/receipt. A committed response loss replays the original DTO with no new object.
Remote failure returns 503, never success or a local substitute. Committed missing/corrupt bytes also
return 503; restoring provider data requires an explicit operator action, not fabricated replacement.

Reconciliation is explicit maintenance, not a startup cleanup:

```sh
npm run storage:reconcile           # dry-run, no object deletion
npm run storage:reconcile -- --apply
```

Only server-created pending intents untouched for 24 hours, with no metadata reference, are eligible
(maximum 100 per run). Cleanup and upload finalization share the write lock, preventing deletion of a
concurrently committed object. Failed cleanup retains its intent for retry. Committed photos/report
links and unrelated bucket objects are not candidates. A cleaned intent can be retried with its same
original key/body. Remote calls currently hold the conservative global writer lock; large/slow storage
workloads can cause bounded lock-timeout 503s and need later throughput tuning.

Provider protocol sources: [private downloads](https://supabase.com/docs/guides/storage/serving/downloads),
[private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals),
[storage errors](https://supabase.com/docs/guides/storage/debugging/error-codes),
[official removal request](https://github.com/supabase/storage-js/blob/main/src/packages/StorageFileApi.ts).
These documents support the adapter protocol, not a claim of actual provider testing.

## Examples without embedded credentials

In the frontend login handler, take `login` and `password` from the existing user form. Do not
log the request, returned CSRF token or cookie. A minimal same-origin sequence is:

```js
const signedIn = await fetch('/api/v1/auth/login', {
  method: 'POST', credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login, password })
});
if (!signedIn.ok) throw new Error(`Login failed (${signedIn.status})`);
const { data: session } = await signedIn.json();
const headers = {
  'Content-Type': 'application/json',
  'X-CSRF-Token': session.csrfToken,
  'Idempotency-Key': crypto.randomUUID()
};
// Keep this key and body together if a network failure leaves the result uncertain.
const created = await fetch('/api/v1/evidence', {
  method: 'POST', credentials: 'same-origin', headers,
  body: JSON.stringify({
    sourceType: 'fixture', sourceLabel: 'Cloud DEMO acceptance',
    dataClass: 'demo', note: 'Synthetic test; not a field observation'
  })
});
if (!created.ok) {
  const failure = await created.json();
  // Present failure.error.code/message; never replace the result with mock data.
  throw new Error(failure.error.code);
}
const { data: evidence } = await created.json();
```

Resource creation by **admin**, using the returned evidence ID:

```json
{
  "label": "Cloud DEMO water tank",
  "type": "water",
  "ownerCrewId": null,
  "capacity": null,
  "unit": "litre",
  "availableIntervals": [{"start":"2026-11-01T00:00:00Z","end":"2026-11-02T00:00:00Z"}],
  "evidenceIds": ["<returned-evidence-id>"]
}
```

POST returns `{data: { ...resource, id, version: 1, createdAt, updatedAt }}` with 201.
PATCH `/resources/<returned-id>` with a **new** key and
`{"expectedVersion":1,"label":"Cloud DEMO updated tank"}` returns version 2.
GET `/resources` returns `{data:[...],meta:{limit:100,offset:0,total:N}}`.
Repeat the exact same successful mutation with its original key to receive the original response
and `Idempotency-Replayed: true`. A changed body with that key returns 409. A stale version with
a new key also returns 409. Do not automatically retry a write with a newly generated key.

Errors retain `{error:{code,message,requestId,details?}}`: 400 validation/key, 401 session,
403 role/CSRF/Host/Origin/HTTPS, 404 absent reference, 409 version/key conflict, 413 JSON limit,
415 media type, 429 login throttle, 503 database or explicitly unsupported cloud capability.
No SQL text, password, hash or provider key is returned. Cold-start ingress may return non-JSON
HTML/502/503 before Express is available; the proxy/client must preserve that failure and offer a
bounded, cancelable read retry. Never infer write success from a timeout.

## Configuration and owner deployment steps

`apps/server/cloud.env.example` contains names and local defaults, no credentials. Copy it to the
Git-ignored `.env.cloud` for an isolated local configuration. Production must omit
`CLOUD_LOCAL_TEST`. Required configuration names: `DATABASE_URL`, `ALLOWED_HOSTS`,
`FRONTEND_ORIGINS`, `CLOUD_ALLOWED_HOSTS`; runtime `PORT` is supplied by Render.
Optional `PG_CA_FILE` supplies a trusted CA PEM; TLS always verifies certificates outside loopback
test mode. SSL-related URL query parameters are rejected to prevent overriding verification.
`CLOUD_DEMO_SEED` and `DEMO_PASSWORD` are needed only for the explicit seed command.
Private photo configuration names: `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET`,
`SUPABASE_SERVICE_ROLE_KEY` (server only), `STORAGE_ALLOWED_HOSTS` (exact DNS names). The first three
are required together and the origin must be allowlisted. Production requires HTTPS; explicit
CLOUD_LOCAL_TEST permits the separate loopback HTTP integration fixture. Missing configuration
returns PHOTO_STORAGE_NOT_CONFIGURED on photo operations; no local-disk fallback exists.

1. Captain approves a **new isolated demo** Supabase project and a free Render service; do not reuse
   user/team databases. Create no paid disk/database/plan. Keep credentials in provider secrets or
   a local ignored configuration file; no keys in chat, PR, screenshots or frontend variables.
2. In Supabase Connect, obtain the PostgreSQL **session pooler** connection for IPv4 (port 5432).
   Use its exact host in `CLOUD_ALLOWED_HOSTS`; use URL-encoded credentials and no URL query string.
   If needed, download the project's CA into an approved secret file and set `PG_CA_FILE`.
   Prefer the session pooler for this persistent Node pool; five connections are the configured max.
3. Run `npm ci --include=dev`, `npm run build` from `apps/server`. In a secure local `.env.cloud`
   configured for that **new demo** database, set the one-off seed opt-in and a newly generated
   strong `DEMO_PASSWORD`, then run `npm run seed:cloud`. It migrates schema `gp_cloud` and inserts
   only missing demo accounts (`admin`, `coordinator`, `foreman`, `worker`, `viewer`) and planning fixtures (114 original OSM zones, 456 contexts, 50 species, 27 rates and sources). Remove the
   password/seed opt-in from the long-running service. Repeat seed never updates existing accounts.
4. In Render New Web Service (or Blueprint with custom path `render.cloud.yaml`), select the correct
   repository and an explicitly accepted commit of this branch. Repository root (leave Root Directory empty), Node 24.21.0,
   build `npm ci --prefix apps/server --include=dev && npm run build --prefix apps/server`,
   start `npm run start:cloud --prefix apps/server`, plan **Free**, automatic
   deployments **off**, healthcheck `/api/v1/ready`. Set exact Host/Origin/DB/network settings.
   Add a CA secret file if required. No SQLite path or uploads disk is used by this entry point.
5. Startup applies versioned, checksummed migrations transactionally under a PostgreSQL advisory
   lock. Unknown/modified migrations fail startup without resetting data. SIGTERM stops HTTP intake,
   drains requests and closes the pool, with a 15-second shutdown bound. Never seed on every boot.
6. Record the **actual** Render origin and deployed SHA after a successful deployment. Repeat login,
   evidence/resource create, replay, read and manual redeploy; read again, compare versions/history
   and repeat seed. Then stop local processes/tunnels and have Aidana read from another device.
   These public checks are pending, not implied by local PostgreSQL results.
7. Configure a **private** bucket, WebP only, max 5 MiB; no public/anon policies. Set the four storage
   variables above. The adapter verifies private bucket restrictions before put/read/delete, rejects
   redirects/overwrite and checks downloaded byte length and SHA-256. The HTTP integration, metadata,
   report binding and reconciliation are locally tested; real provider policy/TLS behavior is NOT RUN.
   Use a new isolated demo namespace and keep the service-role key out of the frontend.

The Render blueprint was validated against the official JSON schema locally; this is not a
provider-side create/build/deploy check. No system service, Docker setting or user volume changed.

## Free-tier constraints verified 31 October 2026

Render Free sleeps after 15 idle minutes; wake-up is about a minute. Its filesystem is ephemeral
across restarts/redeploys, and a free service cannot attach a persistent disk. Free Render Postgres
expires after 30 days, so it is not the selected persistence plan. Workspace quotas can suspend
service; inspect the account limits before acceptance. [Render Free documentation](https://render.com/docs/free).

Supabase Free lists 500 MB database, 1 GB file storage, 5 GB egress plus 5 GB cached egress, two
active projects and pausing after one week of inactivity. These limits are not an availability
guarantee for defence day. Do not enable upgrades without approval. [Supabase pricing](https://supabase.com/pricing).
Connection and private-download behavior: [PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres),
[private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals),
[authenticated downloads](https://supabase.com/docs/guides/storage/serving/downloads).

## Team handoff

| Owner | Next concrete action |
| --- | --- |
| Bekzat | Complete task/report/crew persistence and private-photo metadata transaction before claiming photo E2E; then migrate Outcomes immutable snapshots without changing calculations |
| Damir / captain | Review Draft scope; merge only when accepted; approve/provision free hosting; own public Docker/HTTPS acceptance; the E2E-09 fix is now inherited from #38 |
| Tәңірберді (#35) | Keep fixed same-origin proxy; preserve cookies/CSRF/idempotency/statuses and cold-start state; do not connect the full UI to this limited slice as a completed release |
| Aidana | After provisioning and integration, independently repeat role/CSRF/replay/redeploy checks on the exact public SHA; photo E2E and full UI acceptance remain pending |

PR #36 and #37 are now merged through the captain’s integration #38. Their upstream changes
(including the E2E-09 fix) entered this branch by ordinary merge. No frontend changes were authored
in this PR. Captain-reported Docker/E2E acceptance on `20e642b` is recorded in docs/deployment.md;
it is separate from this environment’s unavailable Engine and from the unperformed cloud acceptance.

### Planning persistence and runtime requirements

Migration 1 is unchanged. Migration 2 adds planning documents, version-bound contexts, immutable
analysis snapshots and rate history. Both migrations are checksummed and transactional; future/gapped
or changed versions fail without reset. The database must be UTF8; migration fails before schema writes
otherwise. No existing database encoding is changed. New native test clusters explicitly use UTF8/C locale.
The explicit seed inserts only missing IDs; repeating it preserves passwords, human changes, rate versions,
sources, contexts, snapshots and idempotency receipts. It does not import an existing user's SQLite database.

The compiled cloud server runs with `tsx`, exactly as required by the existing shared TypeScript analytics.
Render must retain repository-level `apps/web` files: files outside Root Directory are unavailable at runtime
([Render monorepo documentation](https://render.com/docs/monorepo-support)). The updated blueprint uses
repository-root commands. It has **not** been deployed; `autoDeployTrigger: off` remains.
Regenerate only via `npm run openapi:cloud` from `apps/server`.
