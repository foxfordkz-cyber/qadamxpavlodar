# Cloud API contract — first PostgreSQL slice

Status, 31 October 2026: **local PostgreSQL verified; public deployment BLOCKED**.
The owner confirmed that Render/Supabase access is not available. No public backend origin exists
for this work, and no paid service was created. The existing Cloudflare publication is a mock.

Verified integration source: `13519968547fb005e25f6470db40ad60433f12b7`.
Original adapter implementation: `28a6db490fef80f7cccebba13be09ff781413b7c`; the ordinary integration merge did not change backend sources.
A final cloud error-handler fix preserves HTTP 415 for unsupported JSON encodings.
Integrated base: `98cf6c68d5370331d6f95aa9e749f82d504e5670`, `codex/coordinator`, included by ordinary merge.
Branch: `codex/cloud-api-persistence`; target: `codex/coordinator`, **Draft**.
The documentation-only follow-up does not change that tested application source.
Results and historical failures: [cloud-persistence-verification.md](cloud-persistence-verification.md).

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

Resource `ownerCrewId` must remain `null` in this slice. A non-null crew reference returns
503 `CLOUD_REFERENCE_UNSUPPORTED`; it is never silently cleared or accepted into an unimplemented
relationship. `evidenceIds` must refer to existing sources. Evidence links have real foreign keys.
Unknown `capacity`, dates and other nullable values remain `null`.

Public service endpoints:

| Path | Meaning |
| --- | --- |
| GET `/health`, `/api/v1/health` | Process liveness, PostgreSQL slice label; not a DB or full-release acceptance |
| GET `/api/v1/ready` | DB connectivity and exact migration version; returns 503 on DB failure/unknown schema |
| GET `/api/v1/openapi.json` | Live generator; exactly 8 implemented operations |

Readiness explicitly reports `capabilities: ["auth","evidence","resources"]` and
`photos: "unsupported"`. It does not certify Supabase Storage or the worker workflow.

## Unsupported cloud domains

Authenticated requests to other `/api/v1/*` routes return 503 `CLOUD_ENDPOINT_UNSUPPORTED`.
Unauthenticated requests first receive 401; unsafe authenticated methods still require CSRF.
There is no fallback to SQLite, memory or mock data.

Not migrated: users CRUD/profiles, sites, plants, projects/design proposals and approvals,
tasks/assignment/executors, reports/review, uploads/photo ownership, crews/workers, planting receipts,
care events, Outcomes cohorts, forecast snapshots, inspections, analyses, imports/exports, assistant,
weather, RAG and image generation. History and idempotency persist **for the supported reference
mutations only**; the existing global history API is not enabled in cloud mode.

The regular SQLite entry point keeps all these existing local modules. This branch is not a full
replacement for the API used by the map or worker UI. Do not switch PR #35's complete frontend to
this backend and describe it as a finished cloud release.

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
- JSON limit is 32 KiB. Multipart `/uploads` is **not supported in this cloud slice**. Existing local
  uploads accept one `file` plus `taskId`, JPEG/PNG/WebP up to 5 MiB; decoded images are limited to
  4096×4096 and normalized to WebP. Do not advertise these local limits as cloud upload acceptance.

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
Storage adapter names reserved for the next slice: `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET`,
`SUPABASE_SERVICE_ROLE_KEY` (server only); these do not enable `/uploads` today.

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
   only missing demo accounts (`admin`, `coordinator`, `foreman`, `worker`, `viewer`). Remove the
   password/seed opt-in from the long-running service. Repeat seed never updates existing accounts.
4. In Render New Web Service (or Blueprint with custom path `render.cloud.yaml`), select the correct
   repository and an explicitly accepted commit of this branch. Root `apps/server`, Node 24.21.0,
   build `npm ci --include=dev && npm run build`, start `npm run start:cloud`, plan **Free**, automatic
   deployments **off**, healthcheck `/api/v1/ready`. Set exact Host/Origin/DB/network settings.
   Add a CA secret file if required. No SQLite path or uploads disk is used by this entry point.
5. Startup applies versioned, checksummed migrations transactionally under a PostgreSQL advisory
   lock. Unknown/modified migrations fail startup without resetting data. SIGTERM stops HTTP intake,
   drains requests and closes the pool, with a 15-second shutdown bound. Never seed on every boot.
6. Record the **actual** Render origin and deployed SHA after a successful deployment. Repeat login,
   evidence/resource create, replay, read and manual redeploy; read again, compare versions/history
   and repeat seed. Then stop local processes/tunnels and have Aidana read from another device.
   These public checks are pending, not implied by local PostgreSQL results.
7. Storage preparation for the next slice: create a **private** bucket, WebP only, max 5 MiB; no public
   or anon policies. The adapter verifies these restrictions before upload/read, disallows redirects
   and overwrite, bounds downloads and checks SHA-256. It is an internal primitive only: task/report
   authorization, metadata transactions, orphan reconciliation and the full photo HTTP workflow
   must be implemented and accepted before connecting it to API routes. Keep its service-role key
   out of the current service until needed.

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
