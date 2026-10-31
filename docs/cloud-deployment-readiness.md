# Cloud deployment preparation — evidence, 31 October 2026

**Provider deployment BLOCKED; Render/Supabase HTTPS acceptance NOT RUN.**
Repository: foxfordkz-cyber/qadamxpavlodar; branch codex/cloud-api-persistence; existing Draft #39.
Agreed application SHA: `3b14927def04b35bf97782eae6b550da276c779f`.
This preparation adds operator commands/tests/docs, not a second implementation of A/B/C/D.
Preparation commit and CI are recorded in PR #39; no deployed commit exists in this evidence.

## Infrastructure observed

| Item | Actual observation |
| --- | --- |
| Render Dashboard | Redirect to login; approved service cannot be inspected |
| Supabase Dashboard | Redirect to sign-in; project, DB and bucket inaccessible |
| Cloudflare Dashboard | Redirect to login; no account settings or publication changed |
| Server credentials | Required provider env variables and project-local env files absent; owner reconfirmed no access |
| Render service name | green-pavlodar-api-demo is planned, not verified as created |
| Supabase project / bucket | green-pavlodar-demo / green-pavlodar-photos are planned |
| Public backend URL / deployed SHA | NOT AVAILABLE / NOT RUN |
| Public mock | Existing https://green-pavlodar-mock.pages.dev/ returned HTTP 200; not changed |
| Docker Compose | v5.0.1; config --quiet PASS |
| Docker Engine | BLOCKED: dockerDesktopLinuxEngine named pipe absent |
| Container build/start | NOT RUN; no installation, service settings or volumes changed |

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

## Fresh verification

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

## Provider acceptance not performed

All actual Render HTTPS login/workflow/role checks, Supabase PostgreSQL migrations/seed and
private bucket upload/read, cold start, real Render restart, same-SHA redeploy, post-redeploy
persistence and second-device/Pages API acceptance: **BLOCKED / NOT RUN**.
Local PostgreSQL and HTTP storage are real test processes, not Supabase or Render.
No paid service, account, bucket, database or public endpoint was created in this run.

Search/geocode, newly drawn zones, GIS import, care calendar, assistant/history and participant 1's
LLM/RAG/weather/images remain unsupported in cloud. See [route matrix](cloud-route-coverage.md).
The full cloud UI is not release-complete.

Owner: authenticate, select/provision approved free demo resources, enter secrets in Dashboards/private
env, run preflight/seed, deploy exact accepted SHA, record the real origin/deploy ID and execute
create → Dashboard restart → verify → same-SHA redeploy → verify → repeat seed → verify.
Тәңірберді: after provider PASS, configure the fixed same-origin proxy separately; preserve mock.
Айдана: independent API/roles/another-device acceptance. Captain alone owns coordinator merge.
