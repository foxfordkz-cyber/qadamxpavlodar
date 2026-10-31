# Shared API acceptance, 31.10.2026

Repository: `foxfordkz-cyber/qadamxpavlodar`. Application source tested:
`a66d542c63c527d608400c84b34d49f982855369`, fresh `origin/codex/coordinator`.
This follow-up changes documentation only; runtime code, tests, translations, contracts and `tools/e2e`
are unchanged from that exact SHA. No old 30.10 test result is being attributed to this run.

| Existing work | Verified GitHub status |
| --- | --- |
| #33, `fa762f0b4f009e8cad9c55f53efa59b89192a324` | Merged as `3eedceecdcf6e199784e666b833032293b923391` |
| #34, `85d2eb6b2a3bb05aab5531da70c0401a4a6be711` | Merged as `c08efea51900e11cdea63944bddb79a078712db5` |
| #32, `ebb6c4fd0094452d7610b441c1cf7b9936ff1dea` | Open Draft; Git ancestry does not contain #33 |

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

- **Aidana:** update the existing QA branch by ordinary merge of fresh `origin/codex/coordinator`,
  then rerun independent API/browser acceptance. The QA branch and its E2E tools were not edited here.
- **Damir/Claude:** merge documentation if accepted, pin the release SHA and rebuild new isolated
  Docker projects; check actual image contents, all roles, viewer writes, SQLite/uploads restart,
  repeat seed and restore. An old healthy image without Outcomes is insufficient.
- **Captain:** approve hosting/TLS separately and verify real HTTPS cookie/CSRF/logout behavior.
  No public deploy, paid resources, Docker installation or system setting changes occurred here.

The existing 8080 project, user volumes, renamed zones/history and private `C:\gp-backups` were not
modified or copied. Engine absence prevented independent inspection of the reported old containers.
