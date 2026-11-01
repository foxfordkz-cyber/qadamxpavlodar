# Cloud assistant candidate and release gates — 1 November 2026

This is the authorized extension of Draft PR #39, not Stage E and not a deployment.
The new runtime uses PostgreSQL planning inputs, existing shared analytics and the
existing provider chain. No frontend, map, worker, tools/e2e or formula changes.

## Versions and actual provider observations

| Artifact | Version / status |
| --- | --- |
| Coordinator incorporated by ordinary merge | `21edf5761d689a3678545f15d4ad70b2c0d2448a`; merge `28d90f446fea33766079fb03010ac4b0d56036c4` |
| Published QA tooling/manifest | `a6e6260e114c0a76aae821ca7a2f534b26443a7b`; Quality CI PASS |
| New assistant runtime | The commit containing this file; exact candidate SHA/CI published in PR #39 after local checks |
| Actual Render Live, re-read in Dashboard | `3b14927def04b35bf97782eae6b550da276c779f`, `dep-dbj223h42hec73bqnttg`; schema v5 |
| Backend URL | https://green-pavlodar-api-demo.onrender.com |
| Actual API frontend (owner publication) | `c970264919de2f7a62d0e1ea8a28cc70c95a3864`, deployment `a26bd214-1c78-4a83-9536-74a35c85b49f`; https://green-pavlodar-api.pages.dev/?source=api |
| Supabase | Existing free DEMO `green-pavlodar-demo`, `dpkffzawhtbtlldckjhy`, private `green-pavlodar-photos` |

The operator auth/read preflight passed direct Render at 08:48:57 UTC+5 and through
production Pages at 09:02:32 UTC+5: four role logins, seven existing baseline DTO hashes,
private WebP hash and logout. This proves that process's HTTP access only. It is not
Aidana's independent QA, a new browser E2E, a new restart or cloud assistant acceptance.

## Implementation and local verification

- POST `/api/v1/assistant` retains the existing question/context and AssistantReply DTO.
  GET `/api/v1/assistant/history` returns the current user's latest 50 entries in
  chronological order, matching SQLite. No user selector or cross-user history.
- Admin/coordinator/viewer only; worker/foreman denied. Session and CSRF checks remain.
  Before committing history, the transaction rechecks the current role, user version,
  active state and live session. Logout during provider execution cannot save history.
- Append-only migration 6; migration SQL/checksums 1–5 unchanged. No down migration.
  History is outside public site documents; PUBLIC has no table privileges.
- Tools read a consistent PostgreSQL planning snapshot and persisted reference data.
  No SQLite Store fallback; missing zones remain errors. No employee profiles,
  sessions, cookies or private photos in provider input. Obvious pasted credentials
  are rejected; this is not a general-purpose personal-data classifier.
- Existing primary → reserve → rules chain, sanitized failures, bounded output/tool
  responses, redirects denied, explicit server host allowlist/enable flag. Provider
  keys are never returned. Rules replies have method=rules, omit model and include a reason.
- Four active requests/process, one/user; ten persisted answers/minute/user; 50 retained
  questions/user (prefix <=300 characters). Limits are not a provider billing quota.
  See the [contract](cloud-api-contract.md) for timeout/token/DTO limits.
- `CLOUD_ASSISTANT_ENABLED=0` disables the new routes while retaining v6 data;
  `CLOUD_LLM_ENABLED=0` disables external model calls while keeping PostgreSQL rules.

Local final checks are recorded below after completion. Temporary native PostgreSQL
clusters are isolated and synthetic; simulated Storage transport is not live Supabase.
The controlled HTTP model names `controlled-primary`/`controlled-reserve` are test
servers, never Gemini/Groq. No real LLM key was present in inspected local files or
Render variable names; no linked Render environment group. Real model calls NOT RUN.

| Check | Result |
| --- | --- |
| Server typecheck/build | PASS |
| Generated cloud OpenAPI | PASS, 89 operations (87 existing + 2 assistant) |
| Full backend/SQLite | PASS 111/111; includes six QA-preflight regressions |
| Full native PostgreSQL HTTP | PASS 71/71 before final optional-string DTO correction; exact final SHA full-suite CI recorded in PR |
| Target assistant native PostgreSQL | PASS 9/9 on final DTO/schema and fixture, 93.9 seconds; controlled providers only |
| Assistant regression scope | Upgrade v5→v6/repeat migration, unchanged prior rows, RU/KK rules, PG-only changed zone, chronological own history, CSRF/RBAC, controlled 429/timeout/invalid JSON/provider error, numeric tool parity, concurrency/rate limits, mid-request logout, restart/reseed, 50-row retention, disabled mode |
| `npm run check` | N/A: no root package.json or server script named check; PostgreSQL deployment-check CLI is exercised by its native suite |
| Real Gemini / real Groq | NOT RUN, approved credentials unavailable |
| Cloud v6 migration, new runtime restart/redeploy | NOT RUN, captain approval and QA window pending |

An initial SQLite LLM regression exposed a changed tool-error contract; that behavior
was restored without weakening expectations. An initial combined run exhausted the
multi-restart fixture deadline; another repeat exposed an intermittent compiled test
process startup failure (configuration remained redacted). Provider-mode switches now
restart only the application, while the dedicated native PostgreSQL restart/reseed
check remains. Controlled failover has an 8-second test budget and the suite has
360 seconds; production still caps the entire provider chain at 30 seconds. The helper
reports only allowlisted startup error codes, never raw configuration. Failed and
interrupted runs are excluded from PASS; no production defect is inferred from them.

Commands from `apps/server`:

```sh
npm run typecheck
npm run build
npm test
npm run test:postgres
npm run openapi:cloud
# Verify generator stability after its committed snapshot:
git diff --exit-code -- openapi-cloud.json
```

## Exact rollout gate and safe mitigation

The owner approved development, not immediate publication. Captain must approve the
exact candidate SHA; Aidana and captain must agree a short restart/redeploy window.
Until then preserve Render Live v5 and the current database, passwords and photos.

1. Securely inject `CLOUD_ACCEPTANCE_DEMO`, `CLOUD_ACCEPTANCE_ORIGIN`,
   `CLOUD_ACCEPTANCE_BROWSER_ORIGIN`, `CLOUD_ACCEPTANCE_PASSWORD` into Aidana's actual
   QA process. Destination unknown: **BLOCKED**. No shared password file was created.
2. Run the [scoped preflight](cloud-qa-access-2026-11-01.md) with existing
   `release-738f96b2` manifest. Agree exact task/site IDs before any workflow mutation.
3. Freeze the accepted SHA and record old Render deployment ID. Take an approved DEMO
   backup/snapshot and keep the existing manifest/private-photo hashes. Do not reset
   shared data or treat a new prefix as site isolation.
4. Deploy only in the agreed window using existing Render build/start configuration.
   New runtime applies additive v6 under the migration lock. Keep
   `CLOUD_LLM_ENABLED=0` until approved provider credentials/quota are configured.
   Do not run seed unnecessarily; existing records/passwords must remain unchanged.
5. Verify HTTPS readiness schemaVersion=6 and assistant capability, login/CSRF,
   selected-zone rules, own history, role denials and existing report/photo/Outcomes.
   Use the same baseline before/after the separately agreed restart/redeploy.
6. For real models set server-only `CLOUD_LLM_ENABLED=1`, `LLM_ALLOWED_HOSTS`,
   `LLM_TIMEOUT_MS`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, optional `LLM2_*` and
   `LLM3_*`. Confirm approved model names/quotas at the provider; no invented model
   availability or paid services. Verify RU/KK, tools/sources/numbers and real model
   identity before claiming Gemini/Groq success.
7. Repeat independent QA and send actual deployed SHA/results to the frontend owner.

**Rollback:** after v6 is committed, old 3b14927 refuses an unknown migration version.
Do not press rollback to that binary. Immediate mitigation uses the verified v6 runtime
with `CLOUD_ASSISTANT_ENABLED=0` (or rules-only via `CLOUD_LLM_ENABLED=0`). A true older
code rollback requires a separately tested v6-compatible registry build. Preserve the
history table; no migration deletion/checksum editing or destructive database restore.

## Transport handoff and remaining scope

Тәңірберді: unchanged fixed upstream and exact Origin allowlist; Cookie, distinct
Set-Cookie headers, X-CSRF-Token, JSON envelopes, multipart boundaries and binary WebP
must pass through. Assistant does not require a frontend rebuild for its DTO. Do not
auto-retry conversational POST: it records history and is not an idempotent domain
mutation. Existing upload/report idempotency remains unchanged. Live v5 still returns
503 for assistant/history until the approved new runtime is deployed.

| Function | Candidate / current live status |
| --- | --- |
| Existing-zone recommendations, cost, projects, tasks, photo reports, acceptance, Outcomes | Existing A/B/C/D retained; prior live acceptance plus fresh local regression |
| Assistant/history | Implemented in candidate; live 3b14927 still 503 |
| Address search / geocode | Explicit 503; not supplied by assistant |
| New drawn zones | Explicit 503 |
| Context refresh | Not implemented; persisted context can return 409 CONTEXT_STALE |
| GIS preview/commit/status | Explicit 503 |
| Generated care calendar | Explicit 503; existing manual care tasks remain available |
| Note interpretation | Explicit 503; original worker note/report remains usable |
| Legacy rank-preview/plant-selection | Explicit 503; existing supported analysis/priorities are separate routes |

RU/KK rules questions are tested. Retrieved source passages retain their persisted
language; this is not a new translation of reference texts. Real model RU/KK quality
remains unverified until approved provider calls. Unconfirmed botanical nameKk stays null.

Stage E stays on `codex/bekzat-cloud-api-stage-e`, outside this release. A partial
working scenario is not completion of the full cloud interface.

Айдана: credentials and an independent process login remain BLOCKED. Public manifest,
synthetic IDs, commands and freeze rules have been posted to PR #39 without secrets.
No new mutation/restart was run on the common dataset during this work.

Дамир: approve candidate/rollout window and the private QA destination. Jury delivery
also needs a private destination and evaluation duration: the current acceptance
password can log in as admin, so it must not be given out as limited jury access.
Create/verify separate limited identities through the existing API once those gates
are known. Keep PR Draft until the required independent/cloud gates are satisfied.
