# Deployment readiness (2026-10-30)

Base synchronized by normal merges with coordinator cf07b97, then b53c180 (UI/fonts/site names).
Public hosting: **BLOCKED_PENDING_HOSTING**. PR #22 stays Draft until Docker runtime acceptance.
Required from captain: approved Linux host, domain, SSH access via secure channel,
budget and permission to publish a specific accepted coordinator SHA. No paid resources provisioned.

## Host and build

Recommended pilot: Linux x86_64, 2 vCPU, 4 GB RAM, 20 GB SSD plus separate encrypted backups.
One backend replica only (SQLite); no multi-host volume. Allow public 443 and edge HTTP redirect,
restrict SSH. Install Git, Docker Engine and Compose v2+ using the vendor's instructions for the
approved OS; this task does not install them. Node 24 is required for local server commands.
Use a dedicated checkout, not a developer worktree. Record the last working SHA before updating:

```sh
git fetch origin
git worktree add --detach ../release-<SHA> <APPROVED_COORDINATOR_SHA>
cd ../release-<SHA>
git rev-parse HEAD
docker compose -p green-pavlodar config --quiet
docker compose -p green-pavlodar build --pull
docker compose -p green-pavlodar up -d --wait
curl --fail http://127.0.0.1:8080/health
curl --fail http://127.0.0.1:8080/
```

Use these changed configuration files only after captain accepts this PR. Image provenance must
be recorded against that exact clean commit; retain image IDs/tags for rollback. Lockfiles drive npm ci.
Web Dockerfile includes tools/worker-demo/demo; server includes shared analytics and OSM/Pavlodar fixtures.

## Environment and network

Default URL `http://localhost:8080` opens **mock**. `http://localhost:8080/?source=api`
explicitly opens API mode. `DATA_SOURCE` build argument defaults to mock; no API/model/key is
needed for mock data. Map tiles can still need network. Compose still starts the backend and
waits for health; a standalone frontend mock session does not request backend data.

For API login, create a private `apps/server/.env` from the example and set DEMO_PASSWORD
(>=12 characters) **before first seed of a new demo database**. It is ignored by Git and excluded
from the Docker build context. Compose `env_file` (optional, `required: false`) injects its values
into the server process; the physical file is not copied into the image. No required password
interpolation and no DEMO_PASSWORD environment override remain in Compose. A shell-only password
is not automatically passed through: use this private file or an approved secret injection override.

With no file/password, existing seed generates random demo credentials. The deployment seed CLI
now prints only a notice, never their value. This one-line CLI change is the necessary scope extension
to prevent the existing Docker CMD from leaking generated credentials in container logs; password
generation/hashing/authentication are unchanged. Mock needs no known server password. Adding a password
later does not change existing account hashes; use a separate new demo volume/project or an authorized
account reset, never delete/reseed user data. `docker compose config --quiet` is safe to display;
plain `config`/`docker inspect` may expose injected secrets and must not be shared.

Compose process variables override the env_file for the explicit network keys below.
ALLOWED_HOSTS=approved.example.org; FRONTEND_ORIGINS=https://approved.example.org (replace with approved domain).
WEB_PORT defaults 8080. STORAGE_ROOT=/data; DB_PATH and UPLOADS_PATH must be unset for defaults
/data/db/green-pavlodar.sqlite and /data/uploads. NODE_ENV=production, HOST=0.0.0.0, PORT=3100,
TRUST_PROXY=uniquelocal are set by Compose. Never place keys in VITE_*.

Compose publishes web only on 127.0.0.1. Put an approved TLS edge on the same host, forwarding
to localhost:8080, preserving Host and **overwriting** X-Forwarded-Proto with https. Redirect public
HTTP to HTTPS. Do not expose this internal listener externally or accept arbitrary forwarded headers.
Nginx passes /api unchanged and marks gp_v2_session Secure on HTTPS, HttpOnly, SameSite=Strict.
The existing backend cookie is intentionally unchanged; HTTPS Secure enforcement is at nginx.
Explicit HTTPS FRONTEND_ORIGINS is required by the existing application origin check.
X-Forwarded-For is replaced at internal nginx; rate limiting is conservatively per edge address.
Validate actual Set-Cookie via the approved HTTPS URL before public acceptance. TLS certificate
issuance/renewal and public URL verification remain hosting dependencies.

POST /api/v1/auth/login with login/password returns data.csrfToken and the session cookie.
Use credentials:include and X-CSRF-Token on writes; domain mutations also require Idempotency-Key
and the documented expectedVersion. Never turn off Auth/CSRF for health or demo scripts.
GET /health is a minimal database liveness probe, not a workflow readiness guarantee.

## Seed, migrations and persistence

Server container runs the existing seed:tz equivalent on start (accounts, V2, TZ, municipal).
Existing accounts/passwords, documents and reports must survive repeated seed. Demo users are
admin/coordinator/viewer/foreman1/worker1; obtain passwords privately. Synthetic demo data is not field evidence.
Migrations run transactionally when Store opens, with foreign_key_check before commit. Back up first.
The named gp-data volume stores SQLite WAL files, sessions and uploads. Keep Compose project name
green-pavlodar stable between release directories. Never use down -v or volume prune.
Stop writes before consistent database-plus-files backup; copying only a live .sqlite misses WAL.

After PR #23 is accepted into the same release image, opt-in Outcomes demonstration data is seeded by:

```sh
docker compose -p green-pavlodar exec -T server npm run seed:outcomes
```

Run after the normal server startup seed. PR #22 alone does not contain this npm script; it belongs
to PR #23. Repeat is idempotent and does not overwrite the saved forecast or user records. UI `#/outcomes`
also needs accepted PR #24. See `docs/outcomes-data-handoff.md` in the integrated release.

To check persistence, record a cohort/report ID and its version through authenticated API, run
`docker compose -p green-pavlodar restart server`, wait for healthy status, then read the same record
and session again. Use the same project name/volume; do not run `down -v`. Confirm uploaded-file download
and repeat seed as well. These container checks remain BLOCKED here until Engine is available.

## Backup and restore

Use a new protected backup directory on separate storage. The backup command uses SQLite backup API
and integrity checks; a stopped server is required to make uploads and DB represent the same moment.

```sh
docker compose -p green-pavlodar stop server
docker compose -p green-pavlodar run --rm --no-deps -v /secure/backups:/backups server node scripts/backup.mjs /data /backups/release-<SHA>-<UTC_TIMESTAMP>
docker compose -p green-pavlodar start server
```

Restore first into a NEW empty disposable storage directory/volume. Copy green-pavlodar.sqlite
to db/green-pavlodar.sqlite and uploads/ to uploads/. Do not overwrite live data or copy old WAL/SHM.
Ensure node UID owns restored files, run PRAGMA integrity_check and foreign_key_check, start exactly
the backup's compatible release image and run login, report/download and upload retrieval checks.
For a live recovery, stop writers and preserve the old volume as an emergency snapshot; switch
to the verified restored volume only with operator approval. Backups contain sessions and must be private.

## Update, rollback, recovery

Before update record SHA/image IDs/schema version, stop writes and take the above backup. Build accepted
SHA separately, start with the same project/volume, verify health/auth/CSRF and representative records.
If migration fails, do not reset the DB; retain logs without secrets. Roll back application image only
when old code supports the current schema. Otherwise restore the paired backup into a new volume and
run the old image. Never run an old image against an unsupported migrated DB. Emergency recovery uses
the same verified restore procedure and preserves failed storage for diagnosis.

## AI and release acceptance

Leave LLM_API_KEY/LLM2_API_KEY empty for rules fallback. No provider calls made in this task.
Rules is not live LLM; model failure falls back under existing behavior. Provider keys remain server-only.
Before public release, Ayдана verifies API mode, all five roles, logout revocation, #/worker,
RU/KK, Word export and rules labels using the final URL/SHA. Word export is client-side and requires
browser E2E; this infrastructure task does not claim browser acceptance from server tests.

## Earlier verification (before final captain corrections)

Docker client 29.1.5 and Compose 5.0.1 are installed. Docker Engine socket missing:
**BLOCKED** image build, container startup, nginx runtime, container recreate and HTTPS cookie test.
No system installation/settings changes.

| Local verification | Actual result |
| --- | --- |
| Backend typecheck / build | PASS / PASS |
| Backend suite | 67 passed, 0 failed, 0 skipped in isolated source copy outside a dot-directory |
| Web tests | 80 passed, 0 failed, 0 skipped |
| Web typecheck / build / check:i18n | PASS; 1550/1550 keys; large-chunk warning only |
| Compose config --quiet | PASS with ephemeral private password; no config/secrets printed |
| HTTP login for all five roles / missing CSRF / logout | PASS |
| Session after server shutdown, DB close and reopen | PASS |
| Repeated seed | PASS; accounts and full existing documents unchanged |
| SQLite backup, integrity, disposable restore and stored-file contents | PASS |
| Actual uploaded-photo access/traversal | PASS in existing integration suite |
| Upload HTTP retrieval after container recreate | BLOCKED: Engine unavailable |
| Nginx runtime / TLS cookie / browser navigation and Word download | NOT RUN; needs runtime / E2E owner |
| Rules API / RU+KK / DOCX generation | PASS in existing backend/web automated suites; not browser E2E |

### Reproducible pre-existing local-path defect for backend owner

Running npm test under C:/Users/user/.codex/worktrees/... gives 66/67: integration.test.ts
"OpenAPI inventory ... Swagger assets" receives HTTP 500 instead of 200 at line 50.
The unchanged app.ts uses res.sendFile on an absolute path containing .codex; send's default
dotfiles policy rejects that path. Identical sources and dependencies copied into an isolated
non-hidden directory pass 67/67. Tests were not weakened and app.ts was not changed in this PR.
Reproduction: start app from a dot-directory and GET /api-docs/assets/swagger-ui.css.
Expected: 200 for explicitly allowlisted assets; actual: 500 NotFoundError. Owner: backend static
asset handler; suggested separate fix is a narrowly scoped explicit asset root, not global dotfile access.
The container path /app has no dot component, but container runtime is still BLOCKED, not inferred PASS.

## Local fallback without Docker (PowerShell, Node 24)

Use the existing deploy-readiness worktree, or a separately approved final checkout. From its root,
install missing dependencies with `npm --prefix apps/server ci` and `npm --prefix apps/web ci`.
Do not use a real user database for demonstration. In terminal 1, create a new disposable storage root
and enter a private password; the commands do not write .env or print the password:

```powershell
$env:STORAGE_ROOT = Join-Path ([IO.Path]::GetTempPath()) ('gp-local-demo-' + [guid]::NewGuid().ToString('N'))
$env:DB_PATH = Join-Path $env:STORAGE_ROOT 'db/green-pavlodar.sqlite'
$env:UPLOADS_PATH = Join-Path $env:STORAGE_ROOT 'uploads'
$demoSecret = Read-Host 'Private demo password (at least 12 characters)' -AsSecureString
$env:DEMO_PASSWORD = [Net.NetworkCredential]::new('', $demoSecret).Password
$env:NODE_ENV = 'development'
$env:HOST = '127.0.0.1'
$env:PORT = '13100'
$env:ALLOWED_HOSTS = '127.0.0.1,localhost'
$env:FRONTEND_ORIGINS = 'http://127.0.0.1:15173'
$env:TRUST_PROXY = ''
$env:LLM_API_KEY = ''
$env:LLM2_API_KEY = ''
Set-Location apps/server
node --import ./scripts/local-network-guard.mjs --import tsx src/tz/seed-cli.ts
node --import ./scripts/local-network-guard.mjs --import tsx src/server.ts
```

Direct node commands intentionally do not read any existing .env. Keep the terminal/environment
for restart: Ctrl+C and rerun only the server command, preserving STORAGE_ROOT. Do not repeat the
new-folder line when demonstrating persistence. A second seed in this same environment is safe.
For outcomes, use its own worktree or an approved integrated checkout and additionally run its documented
opt-in outcomes seed before starting the server; that module is not part of deployment PR #22.

Terminal 2, from the same checkout root:

```powershell
$env:VITE_API_PROXY = 'http://127.0.0.1:13100'
npm --prefix apps/web run dev -- --host 127.0.0.1 --port 15173 --strictPort
```

Open `http://127.0.0.1:15173/?source=api&lang=kk#/map` (or lang=ru), then log in with
coordinator and the private password. Worker/foreman accounts are routed to #/worker.
Health is `http://127.0.0.1:13100/health`. These are local URLs, not an external deployment.
For an explicit offline browser demonstration use `?source=mock&lang=kk#/map`: mock data is browser-side,
not SQLite, and map tiles may still need network access. Rules needs no LLM key; API mode needs backend.
If either port is occupied, choose free ports and change PORT, FRONTEND_ORIGINS and VITE_API_PROXY
together; do not stop another developer's process. No system or Docker settings need changing.

## Earlier repeat check, 2026-10-30 (superseded below)

GitHub and explicit fetch reconfirm coordinator e6d9079840bd7a7469488031ab777a851c7f8d78;
#17 merged, #18/#19 open, #22/#23 Draft. Existing PRs are continued, not recreated.
Docker Engine remains BLOCKED; Compose config --quiet passed again. Local production frontend HTML
and bundled JavaScript were fetched successfully over HTTP (not browser E2E).
The two deployment tests were rerun: **2 passed, 0 failed/skipped**, covering all five logins,
CSRF, logout, session restart, repeat seed and separate SQLite/files backup/restore.
The complete previously recorded 67/67 backend and 80/80 web results apply to unchanged application code;
this follow-up changes documentation/comments only and does not claim another complete suite run.

## Final captain corrections / acceptance, 2026-10-30

- DATA_SOURCE is `${DATA_SOURCE:-mock}`; optional env_file supplies the password, with no required
  Compose interpolation. One-line TZ CLI log redaction prevents the no-password case from exposing
  the generated credential. Auth/RBAC/CSRF/versions and seed generation are unchanged.
- Isolated Compose Case A, no .env and DEMO_PASSWORD removed from process: **PASS config**.
  Case B, separate private .env: **PASS config**, verified resolved environment equals its password
  without displaying it. Explicit DATA_SOURCE=api override, loopback bind, health dependency and /data verified.
- Real local seed/HTTP equivalents: **4/4 deployment tests PASS**, including both environment cases,
  existing credentials preserved on repeat seed, admin/coordinator/viewer login, all five roles,
  HttpOnly/SameSite cookie, CSRF denial, logout, DB/server reopen and backup/restore/files.
  The first added test expected nine users but TZ also creates the specialist alias; corrected to ten.
- Full backend after coordinator merge: **69 passed, 0 failed, 0 skipped**; typecheck/build PASS.
  Run in an isolated non-hidden source copy because of the pre-existing Swagger asset path defect above.
- Docker client/Compose available; `docker compose build` fails because Docker Engine pipe is absent.
  Case A/B container startup, nginx runtime, container restart and HTTPS cookie: **BLOCKED**, not PASS.
  No actual user .env, SQLite, volume or system settings changed. PR #22 remains **Draft**.
- Before Ready: Ayдана/operator must execute both cases using separate Compose project names and
  disposable volumes, preserve user env/data, verify mock without an API session and API login/restart.
  Public deployment remains BLOCKED_PENDING_HOSTING and requires separate authorization.

The final source tree also includes coordinator b53c180; frontend typecheck/build PASS with the bundled
Kazakh fonts. Node dependencies were refreshed using the checked-in lockfile. Compose config Cases A/B
were repeated successfully. Final full backend rerun: **69 passed, 0 failed, 0 skipped**, including
all four deployment tests, on b53c180 + this PR. Backend typecheck/build PASS; frontend typecheck/build PASS.
All validation sources/fixtures were compared byte-for-byte with this worktree; no user DB was copied.
