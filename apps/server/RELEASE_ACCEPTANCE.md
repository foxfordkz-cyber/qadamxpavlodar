# PR #13 — release acceptance

This report supersedes earlier test counts for the changes in its own commit. Execution continued from `feature/backend-municipal` at `b7176bf5df7517ce5df1d6c640ed73173eb04064`; the repository was not recreated.

## Git baseline

- Fresh coordinator: `f6ad7950171f2b8005811f20ace877fdc20a936a`, also the checked `ui/differentiators` HEAD.
- The actual coordinator merge is already `b7176bf`; a fresh ordinary merge returned `Already up to date`.
- Only the personal backend branch is published. PR #13 targets `codex/coordinator` and remains **Draft**.
- `src/tz/llm.ts`, `tests/llm.test.ts`, owner React components and shared branches are unchanged by this acceptance fix.
- New optional PR work from the earlier request remains local and unpublished. The updated captain request restricted subsequent implementation/publication to PR #13.

## Assistant: precise finding and fix

`POST /api/v1/assistant` previously invoked `municipal.analyze` before invoking the assistant, discarding the calculation result. The route now checks `municipal.site` instead. Session authentication, CSRF, the reader role guard and 404 for invalid/non-zone IDs remain in place. No LLM code changed.

The reported drawn-zone **404 did not reproduce on the actual `b7176bf` source**: `municipal.sites` already includes `v2_documents`. The new real HTTP regression for `POST /zones → POST /assistant` passed before the fix and remains protected. We do not claim a failed reproduction that did not happen.

A related defect **did reproduce**: selecting a committed point import and asking about greening norms failed with `422 MISSING_AREA`, because the unrelated cost calculation ran first. It now returns a sourced rules answer with HTTP 200. Explicit `/zones/:id/analysis` still rejects missing measured area with 422. Unknown IDs, private import IDs used as zone IDs, and worker/foreman access remain rejected. City zones are shared among the existing reader roles; this change does not invent per-coordinator private-zone ownership.

Three new tests in `tests/release-acceptance.test.ts` use a real Express listener and isolated SQLite:

1. Drawn polygon creation/replay → selected-zone answer, response schemas, OSM zone, repeat question, user-scoped history, map view, nonexistent ID and wrong-object ID.
2. Norms answer without forced area calculation; private import ownership, 401, missing-CSRF 403, worker/foreman 403 and viewer read-only behavior.
3. All nine existing demo accounts, seed replay, preserved rows/password hashes/sessions, municipal login alias, canonical roles and planning snapshot, admin-only rate writes.

The initial regression run was **1 PASS / 2 FAIL** (unnecessary area calculation and sixth role). The targeted run after fixes was **8/8 PASS**, including all five municipal tests. The final full suite below includes all subsequent assertions.

## Roles and API contract

Public identities and planning snapshots expose exactly `admin`, `coordinator`, `viewer`, `foreman`, `worker`. The existing login `specialist` remains usable and now has role `coordinator`. New municipal seed/user writes do not create a separate specialist role. Legacy role inputs and old alias rows remain readable as compatibility aliases; old databases/passwords are not rewritten to normalize them.

Existing municipal and planning tests were updated to assert this required canonical behavior. No tests were removed or disabled. Existing V2 role changes still revoke sessions; optimistic versions, permissions and replay checks remain active.

The actual public OpenAPI endpoint was regenerated and all **101 operations / 1263 request-response schemas** compiled with AJV. Published user responses enumerate five roles. `/assistant` retains `message`, `siteId`, `history`, `view`; `find_place` remains in the unchanged LLM module. `/zones` now documents its already-enforced **required Idempotency-Key**; the new HTTP test checks refusal without it and successful replay with it. Schema compilation is not a claim that every possible response value has been exercised.

## Fresh verification

| Check | Actual result |
|---|---|
| Server full runtime suite | **63 passed / 0 failed / 0 skipped**, final run 130.05 seconds |
| Server build | PASS |
| Server typecheck | **FAIL**, only incoming `tests/llm.test.ts:130`, TS18049 twice: nullable `site.centroid` |
| Owner patch | `patches/assistant-centroid-owner.patch`: `git apply --check` PASS; deliberately not applied to the owner's test |
| Main frontend typecheck/build | PASS; existing >500 kB chunk warnings |
| Local `.env` credentials | PASS: 10 real HTTP logins, five canonical roles, all nine original test accounts preserved |
| Local process restart | PASS: all 10 session cookies, selected-zone history, CSRF and role boundaries |
| Municipal real HTTP | PASS: actual React transport plus handoff client, 32 requests, 114 OSM zones + one synthetic import |
| Import/rates/calculation persistence | PASS after restart; replay and repeat seed do not duplicate records |
| PDF/XLSX | PASS: real exports generated by the municipal HTTP scenario |
| V2 real HTTP | PASS: design approval → crew/workers → private photo → report acceptance → restart/replay; exactly two new plants, two care drafts, 32 total plants |
| Legacy `npm run smoke` | PASS: compiled startup, SQLite, tasks/reports/history, durable idempotency, restart and repeat seed |
| OpenAPI | PASS: generated from actual HTTP router; 101 operations / 1263 schemas |
| SQLite v4→v5 | PASS, details below |
| Docker CLI / Compose / config | PASS: 29.1.5 / v5.0.1 / `compose config --quiet` exit 0 |
| Docker Engine/runtime | **BLOCKED**: `dockerDesktopLinuxEngine` named pipe absent, `docker info` exit 1 |
| Docker volume migration/Nginx/proxy | **BLOCKED**; no container acceptance claim |
| Browser API mode / six Kazakh screens | **NOT RUN / BLOCKED** by Computer Use URL-policy enforcement on Windows |

The standalone assistant mode in these process checks is **rules**, not live LLM. Existing LLM transport tests use a controlled local provider; they are not proof of a live external provider, production RAG, weather or image integration.

Initial local harness attempts exposed a blank timeout in the newly generated test configuration and slow cold TypeScript imports. The test `.env` timeout was corrected. Existing demo runners now use a bounded 60-second startup wait with request timeouts and failure diagnostics. The legacy runner also loads `tsx` and isolates uploads/SQLite under its own temporary storage root. All three final process scenarios passed; backend authorization was not relaxed.

## Migration evidence

The existing `scripts/accept-migration-v4-v5.mjs` was reused with a fresh archive of coordinator `f6ad795`. It builds a real v4 database with that revision's migrations and synthetic acceptance records, takes a WAL-safe SQLite backup, and starts the current backend against the isolated copy. This is not a migration of the team's Docker volume.

- Schema 4 → 5; all original rows in **38 tables** unchanged.
- **114 zones, 1 task, 1 report, 9 accounts, 50 species, 27 rates**, catalog and rate version retained.
- All nine old passwords and the pre-migration session verified through HTTP; all five roles retained.
- Saved calculation snapshot and replay survive restart; second startup leaves schema unchanged.
- `integrity_check = ok`, `foreign_key_check = []` before/after/restart.
- Network guard preserved; current server listens successfully with `HOST=0.0.0.0` in the local acceptance harness. Container behavior remains unverified without Engine.
- Final health startup times: old v4 4.99 s, migrated v5 12.80 s, reopened v5 14.01 s.

## Reproduce without exposing credentials

From `apps/server`, use a local ignored `.env` with a newly generated password and separate test `DB_PATH`/`UPLOADS_PATH`. Do not point acceptance scenarios at a user database. This workspace's `.env` was created with explicit authorization and uses only isolated `release-env-*` directories. Its password/hash were neither printed nor committed. Seed preserves existing credentials; it does not reset user passwords.

```powershell
npm run typecheck # known owner error above remains visible
npm run build
node --env-file=.env --run test # same package test script, with the local test password
node --env-file=.env --import ./scripts/local-network-guard.mjs --import tsx --test tests/release-acceptance.test.ts
node --env-file=.env --import ./scripts/local-network-guard.mjs --import tsx scripts/demo-municipal.mjs UNIQUE_RUN_NAME
node --env-file=.env --import ./scripts/local-network-guard.mjs --import tsx scripts/demo-v2.mjs UNIQUE_RUN_NAME
npm run smoke
```

Use a new run name each time for the two demo scripts. Local evidence is retained outside Git in workspace `work/release-acceptance/` and ignored `apps/server/data/*/release-verified-f6ad795/`. The committed regression tests and migration harness are reproducible; private evidence databases, account hashes, uploads and `.env` are excluded from publication.

## PR #14 review

Reviewed the updated glossary and dictionary at **`dfc81c4c677850de324e0a5062edadbfcd0af308`** in a clean detached checkout. Current lockfile dependencies installed there; no owner source edits.

- **1457/1457 keys**, zero missing/extra/placeholder errors.
- **46/46 tests**, typecheck/build PASS.
- [New review comment](https://github.com/foxfordkz-cyber/qadamxpavlodar/pull/14#issuecomment-6501638224): document-date grammar and clearer wording for the first-year survival range. Earlier feedback was not duplicated.
- Browser review and Word/PDF visual review NOT RUN; no screenshots claimed. Raw API/source descriptions still retain their original language as documented in the glossary.

## Remaining release gates and ownership

| Blocker / work | Owner / next step |
|---|---|
| Nullable centroid typecheck | Damir/test owner: apply the supplied assertion or equivalent, then rerun typecheck and integration |
| Docker runtime and volume migration | Environment owner: make installed Engine available; then backend/captain run isolated Compose, health, Nginx `/api`, cookies/CSRF and volume restart checks |
| Real API-mode browser acceptance | Frontend owners/captain: login, 114 zones, analysis, assistant, drawn zone → assistant, reload |
| Kazakh six-screen acceptance | PR #14 owner and Bekzat: render all six screens and resolve language feedback; static checks are not visual acceptance |
| Live LLM/RAG/weather/images | Integration owner/participant 1 and Damir: credentials/adapters and separate live acceptance; rules fallback is already explicit |
| Merge decision | Captain after all required gates; intended order **#13 → #9 → #14** |

**Keep PR #13 Draft.** Backend runtime PASS does not override typecheck FAIL or Docker/browser BLOCKED. No force push, shared-branch merge, production deployment, shared-volume deletion or existing user-database modification is part of this work. Feature freeze remains 31 October 18:00 UTC+5; delivery deadline is 1 November 12:00 UTC+5.
