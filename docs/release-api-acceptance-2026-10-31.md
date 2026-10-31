# Shared API acceptance, 31.10.2026

## Captain integration/runtime result

Application SHA `20e642b3ea2283aeda931fd4342178a0059a9163`: web 192/192, server 101/101,
worker 79/79, i18n 1927/1927, typechecks/builds and four web checks passed. Complete mock
repeat: 244 passed / 0 failed / 2 desktop-only skips; API: 74 passed / 0 failed / 0 skipped,
privacy scan passed. E2E-09 is fixed. The first full mock attempt had two network-interruption
timeouts; the unchanged viewer repeat passed 8/8 before the complete repeat.

Actual Docker A/B passed, including nginx photo upload and accepted report linked to an
inspection. Sixteen tables, photo, forecast, history and sessions survived restart/reseed
and container recreation. A tested private backup preceded the 8080 update; all 47 checked
tables and 117 zones were preserved, integrity/FK passed. Both test projects used separate
volumes and were stopped afterwards. The subsequent documentation merge leaves application,
test and container sources unchanged. See [PR #38](https://github.com/foxfordkz-cyber/qadamxpavlodar/pull/38)
for exact run IDs, image hashes, initial failures and final integration status.

This is captain/integrator acceptance, not Aidana's independent final run. Cloudflare mock
HTTPS passed on the separately published a66d542; full public API/persistent hosting and
opening the new documents in native Microsoft Word are not claimed.

## Bekzat handoff status on 55b8bde (before captain runtime acceptance)

Verified coordinator: `55b8bde315ba6f295e33fad263aa802d16cc4b5b`.
PR #32 is merged and includes #33/#34. Its independent API acceptance recorded
**74 passed on 82b2246**; this is historical evidence, not a new run on this documentation SHA.
The independent mock run recorded 240 passed / 4 failed / 2 skipped. All four failures
were E2E-09 (mobile assistant overlapping weights/sliders); Damir/Claude owns the UI fix,
and no confirmed fix is claimed here.

This branch incorporated coordinator with an ordinary merge. No source-code changes are
introduced by this documentation update. The results below retain their original tested SHA,
including the first failed fake-LLM run. Docker Engine and real HTTPS remain **BLOCKED / NOT RUN**;
Compose configuration or a healthy old container does not establish current runtime acceptance.
Cloud persistence implementation belongs to the separate `codex/cloud-api-persistence` branch,
not PR #36. PR #35 remains frontend-owned; #37 contains defence material.

Damir: review and merge this documentation refresh when ready. Aidana: perform acceptance on
the final integrated SHA, including viewer/report/photo persistence; do not rerun the old
#32 head as if it contained the merged fixes. Public API acceptance still requires real hosting.

## Historical local acceptance on a66d542


Repository: `foxfordkz-cyber/qadamxpavlodar`. Application source tested:
`a66d542c63c527d608400c84b34d49f982855369`, fresh `origin/codex/coordinator`.
This follow-up changes documentation only; runtime code, tests, translations, contracts and `tools/e2e`
are unchanged from that exact SHA. No old 30.10 test result is being attributed to this run.

| Existing work | Verified GitHub status |
| --- | --- |
| #33, `fa762f0b4f009e8cad9c55f53efa59b89192a324` | Merged as `3eedceecdcf6e199784e666b833032293b923391` |
| #34, `85d2eb6b2a3bb05aab5531da70c0401a4a6be711` | Merged as `c08efea51900e11cdea63944bddb79a078712db5` |
| #32, `30fdbb798c4525d633a9148417b762495f8f2d49` | Merged as `55b8bde315ba6f295e33fad263aa802d16cc4b5b`; contains #33/#34 |

Integration update: Aidana's completed browser run on `82b2246` recorded API **74 passed** and
mock **240 passed / 4 failed / 2 skipped**. Four failures reproduce E2E-09 (the assistant launcher
covers mobile priority controls). Merging the QA report did not fix that UI defect or constitute
full release acceptance. The historical local test results below still describe `a66d542`.

All three recorded CI checks on #33/#34 heads are successful; no review comments or requested changes
were returned. No duplicate implementation or PR for those fixes was created.

## Fresh local checks

Node 24.21.0; fresh worktree, matching checked-in dependency lockfiles, no user database or `.env`.
Credentials are randomly generated for temporary test databases and never included in evidence.

| Command / scope | Result |
| --- | --- |
| Server `npm run typecheck`, `npm run build` | PASS |
| Existing `viewer-read.test.ts` + `deployment.test.ts` | **7 passed**, 0 failed/skipped |
| Full ordinary server `npm test`, final run | **101 passed**, 0 failed/skipped; 113.05 s runner duration |
| Web `npm run typecheck`, `npm run build` | PASS; existing large-chunk warning remains |
| Web `npm test` | **192 passed**, 0 failed/skipped |
| Web `check:zones`, `check:survival`, `check:care`, `check:i18n` | All PASS; dictionary 1927/1927, zero missing/extra/placeholder mismatches |
| Compose 5.0.1 `config --quiet`, isolated Cases A/B | Both PASS; mock/API choice, private env, loopback, health dependency and separate `/data` volume verified |
| Docker Engine, both local contexts | **BLOCKED**, named pipes unavailable |
| Container build/start/restart/restore; HTTPS | **NOT RUN**, captain acceptance required |

The first complete server run, concurrent with web build/tests, was **100/101**: the existing local
fake-provider LLM test returned `rules` instead of `model`. Its fixture has a 5-second budget; load
sensitivity is a possible cause, not a proven production defect. The full normal package command was
rerun after web checks ended and passed 101/101 without changing any source, assertion, timeout or
concurrency setting. This does not prove a live external LLM integration. An earlier setup attempt
also lacked TypeScript while dependency copying was incomplete; it was rerun after setup completed.

## Viewer and durable data evidence

Real HTTP/session regressions verify populated `GET /api/v1/tasks`, `/tasks/:id`, `/reports`,
`/reports/:id`, `/uploads/:id`, `/crews`, `/workers`; missing IDs remain 404 and private fields stay absent.
Sixteen mutation attempts are denied with 403 and unchanged business/history/idempotency data.
Foreign worker/foreman reads stay restricted; own photo reads work. Missing CSRF is 403,
stale versions are 409, authorized idempotent replays do not duplicate records.

An ordinary accepted HTTP report is linked to an Outcomes inspection and immutable forecast.
Closing/reopening SQLite and the HTTP server, then repeating all seeds, preserves all 16 checked
business-table fingerprints, IDs/versions/history, viewer session, photo bytes and summary. Integrity/FK
checks pass. Separate deployment tests verify all five logins, logout and backup/restore of test data/files.
The fixture remains **demo/synthetic**: 32 trees, 1 inspected/alive, 31 unknown, coverage 3.125%,
whole-cohort survival **null**. Neither field validation nor container persistence is inferred from it.

Reproduce from `apps/server`:

```sh
npm run typecheck
npm run build
node --import ./scripts/local-network-guard.mjs --import ./tests/setup-env.mjs --import tsx --test tests/viewer-read.test.ts tests/deployment.test.ts
npm test
```

Endpoint matrix: [viewer-read-fix.md](viewer-read-fix.md). Updated Docker Cases A/B and image
fingerprint checks: [deployment.md](deployment.md#captain-docker-acceptance-two-isolated-cases-final-handoff).

## Remaining owners

- **Aidana:** after the UI owner fixes E2E-09, start a new QA branch from fresh
  `origin/codex/coordinator` and rerun independent API/browser acceptance. #32 is already merged;
  its test results and artifacts keep their original SHA. E2E tools were not edited here.
- **Damir/Claude:** merge documentation if accepted, pin the release SHA and rebuild new isolated
  Docker projects; check actual image contents, all roles, viewer writes, SQLite/uploads restart,
  repeat seed and restore. An old healthy image without Outcomes is insufficient.
- **Captain:** approve hosting/TLS separately and verify real HTTPS cookie/CSRF/logout behavior.
  No public deploy, paid resources, Docker installation or system setting changes occurred here.

The existing 8080 project, user volumes, renamed zones/history and private `C:\gp-backups` were not
modified or copied. Engine absence prevented independent inspection of the reported old containers.
