# Real cloud DEMO deployment — evidence, 31 October 2026

**Render + Supabase deployment and HTTPS acceptance PASS for the A/B/C/D DEMO slice.**
Repository: foxfordkz-cyber/qadamxpavlodar; branch codex/cloud-api-persistence; existing Draft #39.
Agreed application SHA: `3b14927def04b35bf97782eae6b550da276c779f`.
This preparation adds operator commands/tests/docs, not a second implementation of A/B/C/D.
Application SHA above is deployed. Operator tools were run from `d167f17928b8d0aa56fd17f7d1da814744d7188d`.
This follow-up changes documentation only; it does not replace the agreed runtime SHA.

## Infrastructure observed

| Item | Actual observation |
| --- | --- |
| Render Dashboard | Authorized; new Node Free service in Frankfurt, Auto-Deploy Off |
| Supabase Dashboard | Authorized; new isolated Free DEMO project in Frankfurt |
| Cloudflare Dashboard | Accessible account had no Pages projects; team proxy/public mock not modified |
| Server credentials | Private ignored env files and Render Environment; values read back and compared without publishing |
| Render service | green-pavlodar-api-demo / srv-dbj0jaetlv9c73btp520 |
| Supabase project / bucket | green-pavlodar-demo / dpkffzawhtbtlldckjhy / green-pavlodar-photos |
| Public backend URL / deployed SHA | https://green-pavlodar-api-demo.onrender.com / 3b14927def04b35bf97782eae6b550da276c779f |
| Public mock | Existing https://green-pavlodar-mock.pages.dev/ returned HTTP 200; not changed |
| Docker Compose | v5.0.1; config --quiet PASS |
| Docker Engine | BLOCKED: dockerDesktopLinuxEngine named pipe absent |
| Container build/start | NOT RUN; no installation, service settings or volumes changed |

## Actual provider acceptance

All times below are 31 October 2026, UTC+5 (Asia/Qyzylorda). The runner used the real HTTPS
origin above, the real PostgreSQL session pooler and real Supabase Storage, with no mock/fallback.

| Check | Actual result |
| --- | --- |
| Config / before-migrations / ready preflight | PASS; UTF8, exact checksum versions 1–5, private schema isolation, private bucket restrictions |
| PostgreSQL TLS | Client-to-pooler encrypted and certificate verified; after SSL enforcement, pg_stat_ssl also confirms pooler-to-Postgres SSL |
| Initial seed | PASS; five demo roles, 456 persisted radius contexts; no user database or SQLite import |
| Private bucket | PASS; public false, exactly 5242880 bytes, only image/webp; zero public policies |
| First live Render build/start | PASS; dep-dbj0sn6c6qcc73b5lkl0, live 20:52:08, agreed SHA, Node 24.21.0 |
| GET /health and /api/v1/ready | Actual HTTPS 200; database ok, schemaVersion 5, photos private-storage-configured, outcomes capability |
| Full HTTPS create | PASS at 20:53:11; 81 HTTP requests including expected denials, not 81 separate unit tests |
| Render restart | Dashboard event “Service restarted by you”, 20:53; verify PASS at 20:56:21 |
| Same-SHA redeploy | dep-dbj0vnk9v7es738qurh0, live 20:58:35; verify PASS at 21:00:32 |
| Repeat seed with a different private seed password | PASS; all 956 rows across 31 persistent tables unchanged, including users; sessions/login_attempts excluded as ephemeral |
| Original-password login and final verification after reseed | PASS at 21:01:34; same existing credentials still work |
| Persistence across all three verify runs | Seven immutable DTO/history reads, five idempotency receipts, accepted reports, cohort/inspection/forecast and identical WebP bytes/SHA-256 |
| Authorization | Viewer reads tasks/reports/photos/crews/workers; create/update/assign/accept denied 403; worker/foreman scopes, CSRF denial, anonymous photo 401 |
| Direct anonymous Supabase object reads | Both public and authenticated object routes denied HTTP 400; application-authorized read succeeds |
| Published OpenAPI | Deep equality with openapi-cloud.json; 87 operations |
| Proxy-compatible Origin/CORS | Allowed exact mock origin OPTIONS 204 with credentials; unapproved Origin 403 |
| Unsupported routes | Authenticated geocode, care-schedule and assistant/history still return 503 CLOUD_ENDPOINT_UNSUPPORTED; this is verified missing functionality |

The main runner completed four successful phases (create + three verify), **201 HTTP requests**
total including logout and expected negative cases. Eight additional provider checks cover OpenAPI,
Origin/CORS, explicit unsupported responses and private provider reads. These are separate from
the local 105/62 test-suite counts below. Synthetic tasks/photos/reports/inspections stay DEMO;
unknown observations remain unknown, and whole-cohort survival remains null when not known.

Render used repository-root Node build/start commands from render.cloud.yaml, entered in Dashboard;
this was not a Blueprint import or a Docker deployment. Environment contains no DEMO_PASSWORD,
CLOUD_DEMO_SEED or CLOUD_LOCAL_TEST. CA is /etc/secrets/supabase-ca.pem. Neither code nor published
migration checksums changed. No paid plan, disk, IPv4 add-on or production database was used.

### Resolved setup failures

- Initial credential synchronization failed; a masked browser password value was rejected locally.
  The owner reset the unused DEMO DB credential and copied the generated value through Supabase's
  native Copy action. The final connection passed actual authentication and verified TLS.
- Initial automatic deployment dep-dbj0jb6tlv9c73btp6rg (tooling HEAD) was canceled before secrets.
- dep-dbj0qbjbc2fs73bhgpk0 built successfully but startup failed with a stale DATABASE_URL.
  Correcting the saved masked env field and verifying its value via Copy resolved it. No auth,
  TLS, migration, CSRF or timeout rule was weakened; both successful deployments use the original SHA.
- A supplementary unauthenticated backlog probe expected 503 but correctly received 401. The probe
  was corrected to authenticate and use the documented care-schedule route; actual authenticated
  requests returned 503. No server or contract expectation was changed to conceal a failure.

## Changes

- `npm run check:cloud-deployment -- --config-only|--before-migrations|--ready`:
  readonly preflight, production TLS/allowlists, exact migration checksums/UTF8, private schema
  restrictions and bucket limits. Does not migrate, seed, create objects or repair data.
- `scripts/cloud-https-acceptance.mjs create|verify <manifest>`: real HTTP synthetic scenario,
  explicit DEMO opt-in, fixed HTTPS origins and no redirects. Production CLI has no HTTP bypass.
  Its exported function permits explicit loopback-only HTTP for native integration tests.
- Login/zone/analysis/estimate/forecast/design approval/task assignment/photo and replay/report
  acceptance/linked Outcomes; viewer read-only, worker/foreman scope, CSRF and anonymous-photo denial.
  Verify compares saved immutable DTOs, history, versions, photo bytes/hash, replay receipts and nulls.
- Production and acceptance env templates contain no secret values. Private acceptance manifest
  contains no passwords, password hashes, service credentials, cookies or CSRF tokens.
- [Dashboard/commands checklist](cloud-provider-deployment.md) and updated [API contract](cloud-api-contract.md).

The runtime handlers, published migrations, auth rules, storage adapter, OpenAPI operations and
Render Blueprint are unchanged. New tools are optional CLI entrypoints. Existing Dockerfile
starts SQLite; the cloud target uses the Node Blueprint and external PostgreSQL/private Storage.

## Prior local verification on d167f17 (not provider tests)

Node 24.21.0, npm 11.19.0. Runs use isolated synthetic databases; provider access is not involved.

| Check | Result |
| --- | --- |
| Server typecheck / build | PASS |
| Full backend/SQLite npm test | 105/105 PASS; 0 failed/skipped |
| PostgreSQL HTTP complete rerun | **62/62 PASS**, 0 failed/skipped/cancelled; includes 2 new operator regressions |
| New readonly preflight regression | PASS: no row/object mutations, empty schema, bad checksum, client schema access, public/offline bucket, redacted CLI |
| New HTTPS runner local rehearsal | PASS over actual local HTTP: create, full workflow, backend/PG/storage restart, different-password reseed, verify |
| Isolated original persistence diagnostic repeat | 14/14 PASS, no code or expectation changes |
| Web typecheck / build / npm test | PASS; 192/192 tests, 0 failed/skipped |
| Web check:care / check:i18n / check:survival / check:zones | All PASS; KK 1927/1927, missing/extra/placeholders 0 |
| Worker npm test | 79/79 PASS, 0 failed/skipped |
| OpenAPI generator | PASS; 87 operations; snapshot unchanged |
| Render Blueprint | PASS against newly retrieved https://render.com/schema/render.yaml.json; not a Render build |
| Migration 1–5 | Published SQL unchanged; checksums match Stage D |
| Config-only synthetic configuration | PASS without network; DB/Storage explicitly NOT RUN |
| Secret pattern review / env ignore / protected module diff | PASS; no env, DB, upload, build output or credential added |

Web build retains its existing >500 kB chunk-size warning. This branch's web/worker counts differ
from unmerged #35; its owner-reported proxy 13/13 result is not claimed as a local rerun here.

First full native PostgreSQL run executed alongside SQLite/web checks: **54 PASS / 6 FAIL / 60
executed**, no skipped/cancelled. A failed planning step stopped two dependent cases, so this is
not a complete 62-case PASS. Errors were PostgreSQL connection timeout / backend failure to start
after restart and subsequent ECONNREFUSED; no checksum, authorization, data-diff or photo failure
was reported. A separate unchanged persistence repeat passed 14/14. The complete suite then
passed **62/62 in 331.2 seconds** without other test suites. No runtime timeout, old assertion or
test expectation was changed to obtain that result. The transient connection/startup failure is
retained as a local test-environment limitation; its underlying OS/resource cause is not established.

During development the new runner initially compared JSON key order and used an incomplete assign
DTO for viewer denial. Those runner errors were corrected: hashes canonicalize object keys while
preserving array order/values; denial requests now use valid DTOs. Backend behavior was not changed.

Local raw logs and migration/Blueprint/secret-review evidence are outside Git at
`../cloud-deployment-evidence-20261031/`; isolated native database evidence remains in OS temp
directories named in test diagnostics. Do not upload databases, env files or authenticated captures.
The final checked-in record and PR distinguish earlier failures, latest local results and CI.

## Remaining limits and handoff

Real Cloudflare same-origin proxy/frontend runtime and another-device acceptance: **NOT RUN**.
The published mock remains independent. A forced 15-minute idle/cold-start cycle was not measured;
Render warns that waking Free instances can take 50 seconds or more. Do not add automatic write retries
or claim an SLA. Free-tier limits and provider-managed backups remain release-planning constraints.

Render npm install and a separate local npm audit report **8 moderate, 0 high, 0 critical** advisories
in the existing ExcelJS/archive/glob/minimatch dependency chain (also rimraf). No npm audit fix/force,
dependency change or silent runtime SHA replacement was performed. Captain should schedule a separate
tested dependency update; this evidence is not a claim that the dependency tree has zero advisories.

Search/geocode, newly drawn zones, GIS import, care calendar, assistant/history and participant 1's
LLM/RAG/weather/images remain unsupported in cloud. See [route matrix](cloud-route-coverage.md).
The full cloud UI is not release-complete.

Owner: retain provider account access and private DEMO credentials; no further manual deployment
configuration is required for this tested backend slice. Do not publish the ignored env files.
Тәңірберді: use the actual origin and [proxy requirements](cloud-api-contract.md) to configure the
separate fixed same-origin API deployment; preserve mock. Add an approved new exact frontend Origin
if it differs from the current allowlist. No Supabase/database secrets go to Cloudflare.
Айдана: independent API/roles/another-device acceptance. Captain alone owns coordinator merge.
