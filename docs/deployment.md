# Deployment readiness (2026-10-30)

Base e6d9079840bd7a7469488031ab777a851c7f8d78. Public hosting: **BLOCKED_PENDING_HOSTING**.
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

Set DEMO_PASSWORD privately in the invoking shell/secret manager (>=12 chars); never log it.
Compose fails closed if absent. An optional apps/server/.env is ignored by Git; do not use
the previous example password. Compose process variables override that file for the keys below.
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

## Verification

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
