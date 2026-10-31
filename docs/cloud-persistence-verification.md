# Cloud persistence verification — 31 October 2026

Repository: `foxfordkz-cyber/qadamxpavlodar`.
Verified integration source: **`13519968547fb005e25f6470db40ad60433f12b7`**, branch
`codex/cloud-api-persistence`, based on coordinator **`98cf6c68d5370331d6f95aa9e749f82d504e5670`** by ordinary merge.
Original cloud source was `28a6db490fef80f7cccebba13be09ff781413b7c` on 55b8bde.
The new base includes captain-owned UI/defence/deployment work; server sources were unchanged by
that merge (`c18dc6d`). A subsequent cloud error-handler fix preserves HTTP 415 for unsupported
JSON charset/content encoding; both are now tested through HTTP. Checks were repeated after it.
The subsequent documentation
commit changes only these reports; historical run results retain their original source provenance.

Owner response: **no Render/Supabase access; prepare and test locally**. No public origin was
invented, no cloud resource was provisioned and no deploy was attempted. Main/coordinator and
other participants' branches were not modified. Merge remains captain-owned.

## Final checks

Environment: Windows, Node 24.21.0. Native PostgreSQL **18.6**, launched through the pinned
`embedded-postgres` test dependency with SCRAM credentials, loopback listening and a new temporary
data directory. This is a real PostgreSQL process, not pg-mem, PGlite, SQLite or a mock SQL adapter.
No PostgreSQL system service, OS user or Docker installation was created. Supabase's actual server
version/TLS/pooler has not been exercised.

| Command, from `apps/server` | Final result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run build` | PASS; compiled cloud entry point used by the HTTP test |
| `npm test` | **104/104**, 0 failed/skipped/cancelled; 147.904 s |
| `npm run test:postgres` after build | **14/14**, 0 failed/skipped/cancelled; 36.095 s |
| Viewer/deployment regressions | **7/7** dedicated run on c18dc6d; passed again within the final 104 |
| Network/private-storage unit checks | **3/3**, included in the final 104; Storage transport is simulated |
| Existing V2 OpenAPI snapshot vs live generator | PASS inside the full suite; no hand-edited snapshot |
| Render blueprint vs official JSON schema | PASS locally; no provider-side deployment |
| `git diff --check`, staged runtime/secret-pattern scan | PASS; `.env` and `.env.cloud` ignored |
| Changes to `apps/web` and `tools` vs coordinator | None |
| Docker Engine: desktop-linux and default | **BLOCKED**, both named pipes unavailable |
| Docker Compose | 5.0.1 available; Cases A/B config PASS on c18dc6d in isolated staging; container files unchanged |
| Docker image build/start/restart, public HTTPS | **NOT RUN / BLOCKED** |
| Render deploy/redeploy, another-device independence | **NOT RUN / BLOCKED** |

The 104-test suite contains the previous 101 tests plus three guard/storage unit tests; it does
not represent 104 cloud HTTP scenarios. PostgreSQL's 14 test-runner entries include the suite
parent, twelve sequential scenario subtests and the configuration test. Public cloud acceptance
is a separate uncompleted gate. Original pre-merge results on `28a6db4`: full suite 104/104
(158.735 s) and PostgreSQL 14/14 (60.082 s); these are not substituted for the post-merge runs.

GitHub CI on `13519968547fb005e25f6470db40ad60433f12b7`: **4/4 jobs PASS** � server,
PostgreSQL, web (types/build/tests/checks/coverage) and worker.
[Exact source CI run](https://github.com/foxfordkz-cyber/qadamxpavlodar/actions/runs/41181884049).
The final report-only commit has identical application/test/workflow files.

## What the real PostgreSQL test proves

1. Schema creation, repeat migration, changed/future migration rejection and readiness rejection
   of an unsupported schema, without a reset.
2. Repeat seed preserves all five existing account rows, password hashes, roles and versions.
3. Foreign keys and unique login constraints work. An awaited failure rolls back earlier writes.
4. Actual HTTP login for admin/coordinator/viewer/worker/foreman; secret-free DTOs, HttpOnly,
   SameSite and cookie path, duplicate-cookie rejection, session persistence and CSRF.
5. Host and Origin guards reject unauthorized requests; eight supported OpenAPI operations only.
6. Coordinator creates a synthetic/demo evidence source; admin creates a referenced resource;
   allowed readers see it, worker is denied, viewer/foreman/coordinator mutations are denied
   according to the existing resource/evidence contract.
7. Eight concurrent requests with the same key create exactly one resource; changed body conflicts,
   stale versions conflict, successful patch advances the version and replay returns the original response.
8. Invalid references and unsupported endpoints never become successful mutations or consume
   idempotency records. Non-null crew ownership is explicitly unsupported.
9. A deliberate late history constraint failure rolls back the HTTP document write, links and
   idempotency receipt; the same key succeeds after the test-only fault is removed.
10. A local trusted-ingress simulation rejects plain HTTP and sets Secure on the session cookie.
    This is **not** a real TLS certificate or Render ingress test.
11. Role revocation is enforced before replay. Logout invalidates the server-side session.
12. The compiled backend child process and PostgreSQL process both stop and restart. Records,
    null capacity, version 2, exact history, sessions and replay survive; repeat seed preserves the
    original password and produces no duplicate records.
13. Stopped PostgreSQL yields HTTP 503 for writes and readiness. No success/mock response appears.
    After recovery, the retained key supports one safe write and replay.

All created data are isolated test/demo records. They are not field observations. The test does
not import user SQLite files, backups, sessions or personal data. Synthetic Outcomes records in
the SQLite regression remain demo; unknown observations stay unknown/null.

## Acceptance matrix

| Check | SQLite local | PostgreSQL local | Render/Supabase cloud |
| --- | --- | --- | --- |
| Build | PASS | PASS, compiled HTTP process | BLOCKED: no deployment |
| Login/logout | PASS | PASS, five roles | BLOCKED |
| Read/write | PASS, existing domains | PASS for evidence/resources only | BLOCKED |
| RBAC | PASS, existing viewer/worker/foreman regressions | PASS for supported slice | BLOCKED |
| CSRF | PASS | PASS | BLOCKED |
| Versions/idempotency | PASS | PASS, concurrent retry and revoked privilege | BLOCKED |
| Migration / rollback | PASS, existing migrations | PASS, schema version 1 / real FK / late failure | BLOCKED |
| Repeat seed | PASS | PASS, passwords/versions unchanged | BLOCKED |
| Restart persistence | PASS, existing report/inspection/forecast/history/photo scenario | PASS, DB and backend processes restarted | BLOCKED |
| Photo persistence | PASS on local persistent files in disposable fixture | **NOT IMPLEMENTED on HTTP routes** | BLOCKED; no real bucket credentials |
| Secure cookie / HTTPS | Established local HTTP mode | Secure-cookie header tested with ingress simulation | HTTPS NOT RUN |
| Cold start / redeploy | Not a local hosting acceptance | Process recovery tested; not provider redeploy | NOT RUN |
| Independence from team computer | Local mode requires host | Local mode requires host | NOT PROVEN |

Supabase Storage primitive: fixed HTTPS/host, private bucket configuration, no overwrite/public URL,
bounded authenticated download and SHA-256 verification are covered by **controlled transport
tests**. There is no claim that a live Supabase object survived a redeploy. Photo ownership/report
linking, storage/DB failure reconciliation and the full worker → report → review → viewer scenario
remain implementation work, not just missing credentials.

## Failures preserved

- First PostgreSQL attempt: migration/seed/constraint tests passed; compiled backend startup failed
  because importing the route registry pulled in frontend TypeScript modules. Extracting the shared
  API generator into `v2/api-contract.ts` removed that runtime coupling. No frontend code changed.
- Next attempt: 10/12 runner entries passed; Host rejection test failed because fetch normalized the
  Host header. The expected rejection remained 403; the test now sends the actual header with Node's
  HTTP client. The subsequent run passed 12/12. Two additional scenarios then brought final coverage
  to 14/14, all passing.
- First complete SQLite suite after extraction passed **103/103**. After adding the network regression,
  the final full run passed **104/104**. No test timeout, assertion or test concurrency was loosened.
- The final encoding regression initially failed TypeScript checking because the two request-header
  objects inferred an optional undefined field. Explicit `Record<string,string>[]` typing fixed the
  test; HTTP 415 expectations and runtime behavior were not relaxed. The failed typecheck is retained
  in local evidence.
- Earlier a66d542 fake-LLM first-run failure remains in PR #36's historical acceptance report; it was
  not removed or converted to a current cloud integration success. No live LLM/RAG/weather/image
  provider was tested here.

## Remaining risks and responsibility

- **Bekzat:** migrate the rest of the domain before full cloud API acceptance: sites/projects,
  task/report/crew workflow, private photo metadata, planting registry and immutable Outcomes.
  The eight supported operations alone cannot serve the whole current frontend.
- **Captain/Damir:** provision approved free accounts; review the Draft; execute real Render/HTTPS
  and cloud runtime acceptance. Do not delete user volumes. #38 has now merged his E2E-09 fix;
  his reported Docker and complete mock/API acceptance on `20e642b` is recorded in deployment.md.
  This report does not claim an additional local Docker/browser run by Bekzat.
- **Tәңірберді:** bind a fixed same-origin proxy only after the actual origin/SHA/capability handoff;
  preserve cookie/CSRF/multipart/error semantics, and do not silently fallback to mock.
- **Aidana:** accept the final integrated public SHA independently, including restart/redeploy and
  another-device checks. Local PostgreSQL results cannot replace this.
- `npm audit` reports **8 moderate**, 0 high/critical, in the existing ExcelJS/archive dependency
  chain (archiver, archiver-utils, exceljs, glob, minimatch, readdir-glob, rimraf, zip-stream).
  No automatic force upgrade was applied. pg/embedded-postgres were not listed as vulnerable packages.
- No browser UI/translation changes were made. Web/worker CI runs on the Draft; prior web test totals are not presented as fresh local
  checks of this source SHA. See the linked final CI run for current web/worker validation.

Local raw evidence is outside Git under `work/cloud-persistence-evidence-20261031/`: final and
historical test logs, sanitized Docker/Render checks, GitHub metadata and npm audit JSON. No `.env`,
database, binary PostgreSQL runtime, node_modules, dist, uploads or test credentials is committed.
Reproduction and owner steps: [cloud-api-contract.md](cloud-api-contract.md).
