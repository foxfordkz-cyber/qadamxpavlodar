# Viewer read scope and durable Outcomes acceptance

Base: `codex/coordinator`, `bfc2dfe09fec435daba2cea972e4011322adc572`.
Addresses [issue #10](https://github.com/foxfordkz-cyber/qadamxpavlodar/issues/10).
The viewer navigation correction for [#11](https://github.com/foxfordkz-cyber/qadamxpavlodar/issues/11)
is already in this base (`8a24aef`); this PR changes no frontend components.

## Read contract

The fix adds viewer only to the existing task, crew and worker **read** scopes. Reports and protected
photos reuse the task check. All mutations retain their independent role/assignment authorization.

| API, relative to `/api/v1` | Viewer | Worker / foreman |
| --- | --- | --- |
| `GET /tasks`, `GET /reports` | Existing records, filters and pagination | Existing assignment/crew scope |
| `GET /tasks/:id`, `GET /reports/:id` | Existing detail and report revisions | Foreign task/report remains 404 |
| `GET /uploads/:id` | Task-authorized normalized photo | Foreign task remains 404; worker ownership for unattached photos unchanged |
| `GET /crews`, `GET /workers` | Public crews, membership and employee/profile DTOs | Existing crew/self scope |
| Task/report creation, assignment, start, draft/contribution, acceptance/return, photo upload | 403 | Existing permitted roles and workflow |
| Crew/user/plant changes | 403 | Existing permitted roles |
| `GET /users` | 403 (admin endpoint) | Existing restrictions |

No request/response shape changed. `userDto` still excludes login and credential fields; upload metadata
does not expose storage filenames/paths. Public Report DTO still contains its already-declared
`idempotencyKey`; it is not a session credential. Cookie, password/hash, CSRF and storage internals are
not added to read responses. Seven GET summaries were updated and `openapi-v2.json` was regenerated
from the existing `GET /api/v1/openapi.json` generator, not edited by hand. The snapshot regression
checks equality with the live generator. CSRF, versions, replay authorization and write routes are unchanged.

## Regression reproduction and verification

`apps/server/tests/viewer-read.test.ts` creates a new temporary SQLite and synthetic registry input.
The task is created by coordinator, assigned to crew 1, assigned to worker1 by foreman1, started by
worker1, given a real normalized test-image upload and submitted through real HTTP/session endpoints.
No SQL shortcut creates or accepts the report.

Before the fix: four list endpoints returned empty data; existing task/report/photo returned 404.
After the fix: viewer/coordinator public responses match, including two crews and six employees;
nonexistent records stay 404. Sixteen viewer mutation attempts are rejected without changing business
rows, versions, history or idempotency storage. Foreign worker3/foreman2 access remains restricted;
own worker1/foreman1 photo reads work. Missing CSRF is 403 and stale review version is 409.

The old municipal regression asserted that viewer's crew list must be empty. It now compares the
public crew DTOs with coordinator's already-asserted nonempty list, matching the requested read contract.
No snapshot expectations or security assertions were loosened to hide a failure.

Fresh acceptance on Node 24.21.0: server typecheck/build PASS; targeted regressions **3/3**;
ordinary full `npm test` **101 passed / 0 failed / 0 skipped** (149.6 s test-runner duration).
Earlier full runs exposed a test transport race (`ECONNRESET`) in the existing decision-lab
shared/mock parity test, which passed in isolation. Its fixture now requests `Connection: close`
for both login and API calls: long synchronous calculations cannot leave a reused test socket
closing underneath the next request. Sessions, CSRF, server settings, formulas and assertions
are unchanged; the final full run uses the normal package script and default concurrency.

## Accepted report → inspection → restart

The third new regression captures a forecast, constructs a separately labelled synthetic cohort with
the exact forecast species/counts, accepts a normal HTTP inspection report and records a linked Outcomes
inspection through the existing API. It checks `outcome_sources`, reviewer identity, task/report states,
cohort version, audit history, summary and idempotent replays. **All fixture records remain demo, not field evidence.**

Observed summary: 32 trees, one inspected/alive, 31 unknown; inspection coverage 3.125%; whole-cohort
survival remains `null`. Unknown trees are not silently counted as alive. A same-day synthetic inspection
does not validate the three-year forecast.

The server and SQLite are closed and reopened. Repeating base/V2/TZ/municipal/Outcomes seed preserves
all 16 sampled business-table fingerprints, including the accepted report, photo reference, immutable
forecast, source link, cohort, inspection, versions, user credentials and history. The existing viewer session
still reads the same HTTP payloads and image bytes. SQLite integrity and foreign-key checks pass.

From `apps/server`:

```sh
npm run typecheck
npm run build
node --import ./scripts/local-network-guard.mjs --import ./tests/setup-env.mjs --import tsx --test tests/viewer-read.test.ts
npm test
```

Test credentials are randomly generated by the existing setup module, never printed or committed.
No real database or Docker volume is used. The UI's manual-confirmation label remains informational;
this PR adds no inspection form. Docker runtime acceptance remains with the captain.

## Joint check for Damir

Review this server branch together with the existing #11 menu fix. Sign in as viewer, open Work plan
and Reports using the menu, inspect a real test task/report/photo, and verify that creation, assignment
and accept/return controls cannot change state. Use the same public records as coordinator. Server-side
403 remains mandatory even if a write request is crafted outside the UI. Repeat team acceptance after
the captain integrates the server and separate Kazakh language PR; this PR does not merge or deploy.

Local browser verification with the real API and #11 base menu: at 375 px viewer opened Work plan,
saw both crews and their people, then opened Reports → Reviewed → the synthetic accepted report.
The report includes its task reference, worker, acceptance and normalized image (loaded successfully).
No accept/return/edit controls are present. At 1280 px the More menu exposes Work plan and Reports.
Report layout has no horizontal overflow. The lab was additionally checked in RU/KK, 375/1280 px,
mock/API (eight combinations), with real cookie authentication for API mode.

Nonblocking follow-up for Damir: the existing Work plan/Reports introductory text still describes
coordinator write actions even for viewer. Actual write controls are absent and HTTP writes are
forbidden. This server PR deliberately leaves those owner-controlled frontend components unchanged.
