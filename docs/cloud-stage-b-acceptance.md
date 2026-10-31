# Stage B acceptance — PostgreSQL workflow

31 October 2026. Existing branch `codex/cloud-api-persistence`, Draft PR #39. Stage A is retained at `3e25d3dd49498afdf879c92770f74c0cdba06b03`. This checkpoint adds migration 3 and 45 operations (76 total); published migrations 1/2 are unchanged. No frontend/map/worker/E2E source was edited.

## Implementation and invariants

- Existing SQLite domain functions now yield database effects in `src/v2/flows`. SQLite drives them synchronously; PostgreSQL awaits each statement on one transaction client. No SQLite is instantiated by the cloud runtime. Schemas, state transitions, geometry checks, scheduling rules and calculations are shared.
- Canonical zones/context/catalog move transactionally from the Stage A planning table into the one domain documents registry. Zone-context/snapshot foreign keys follow the same IDs. Linked planning history is retained. Species/settings/layers stay in their planning table.
- Profiles, crews/memberships, projects/revisions, tasks/assignments, drafts/contributions, reports/issues, planting receipts/care events and history have persistent PostgreSQL tables. Approved revisions cannot be updated or deleted. User roles are canonical, including viewer; legacy SQLite viewer aliases remain readable.
- Global advisory write lock, then actor lock: recheck current rights before replay, await all changes, history and receipt, then commit. Reader flows use repeatable-read snapshots. Conservative global serialization is a throughput limitation.
- Review decisions are accepted and changes_requested (the original contract). No rejected state was invented. Viewer has no writes; worker/foreman ownership remains enforced. Synthetic DEMO records are not field observations.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Server typecheck/build | PASS | Fresh Stage B source |
| Full native PostgreSQL suite | PASS 37/37 | Final serial `npm run test:postgres`; 337.7 s, zero skipped/cancelled |
| Expanded Stage B real HTTP | PASS 12/12 | `tests/postgres/workflow.test.ts` |
| Full SQLite/backend npm test | PASS 104/104 | Fresh full backend run after the Stage B changes |
| Group draft/contribution/foreman submit | PASS | HTTP PUT and current draft versions |
| Viewer/worker/foreman RBAC, CSRF | PASS | Valid denied bodies, secret-free DTOs, foreign task/report scope |
| Retry/conflicting key/lost response/concurrent version | PASS | Real HTTP, PostgreSQL receipt/assignment counts |
| Planting rollback/repeated acceptance | PASS | Late history-trigger failure rolls back all rows; retry inserts exactly two plants |
| SQLite/PostgreSQL HTTP parity | PASS | Identical persisted rows copied only into a new test SQLite; all four reader scopes |
| Published v2 upgrade/repeated migrations | PASS | Linked zone, context, snapshot, history and password retained; FK and checksums |
| Backend + native PostgreSQL restart/reseed | PASS | Row-count/SHA256 evidence; original passwords and sessions remain valid |
| Fixed /api proxy contract | PASS locally | Loopback ingress simulation, Origin/CSRF/PUT and foreign forwarding headers; not public TLS |
| Render/Supabase/Cloudflare runtime | NOT RUN | No approved access/backend origin; PR #35 still Draft |

## Added endpoint matrix

The PostgreSQL bindings reuse the SQLite schemas and shared domain operations. Every row is implemented; HTTP coverage is concentrated in the acceptance chain and actor/security tests, not a claim that every possible input was tested. Full existing SQLite tests cover the shared workflow.

| SQLite endpoint | PostgreSQL implementation | Authorization / contract | Tests / status |
| --- | --- | --- | --- |
| GET `/users` | workflow-routes + shared flow | Admin: public users and availability | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/users` | workflow-routes + shared flow | Admin: create account | Implemented; shared SQLite regression + Stage B HTTP suite |
| PATCH `/users/{id}` | workflow-routes + shared flow | Admin: versioned user update; revoke sessions | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/workers` | workflow-routes + shared flow | Viewer reads public employee DTOs; assignment scope retained | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/crews` | workflow-routes + shared flow | Scoped crews and membership history; viewer reads all | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/crews` | workflow-routes + shared flow | Admin: create crew | Implemented; shared SQLite regression + Stage B HTTP suite |
| PATCH `/crews/{id}` | workflow-routes + shared flow | Admin: update crew | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/crews/{id}/members` | workflow-routes + shared flow | Admin: effective membership with history | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/users/{id}/history` | workflow-routes + shared flow | Admin: privilege audit | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/plants` | workflow-routes + shared flow | V2 plants; workers see only assigned object context | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/plants` | workflow-routes + shared flow | Coordinator: register a sourced DEMO plant | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/plants/geojson` | workflow-routes + shared flow | V2 map points, coordinates [lng,lat] | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/plants/{id}` | workflow-routes + shared flow | Plant detail | Implemented; shared SQLite regression + Stage B HTTP suite |
| PATCH `/plants/{id}` | workflow-routes + shared flow | Coordinator: update a plant with expectedVersion | Implemented; shared SQLite regression + Stage B HTTP suite |
| PATCH `/sites/{id}` | workflow-routes + shared flow | Record human site checks with server reviewer and time | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/plant-catalog` | workflow-routes + shared flow | Create catalog | Implemented; shared SQLite regression + Stage B HTTP suite |
| PATCH `/plant-catalog/{id}` | workflow-routes + shared flow | Update catalog with expectedVersion | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/care-policies` | workflow-routes + shared flow | Read care_policy with sources; worker catalog is scoped to assigned approved revisions | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/care-policies` | workflow-routes + shared flow | Create care_policy | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/designs` | workflow-routes + shared flow | Coordinator/admin/viewer: design proposals | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/designs` | workflow-routes + shared flow | Coordinator: create a design draft | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/designs/{id}` | workflow-routes + shared flow | Design with immutable approved revisions | Implemented; shared SQLite regression + Stage B HTTP suite |
| PATCH `/designs/{id}` | workflow-routes + shared flow | Edit; approved design creates a new revision | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/designs/{id}/submit` | workflow-routes + shared flow | Coordinator: submit exact design version | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/designs/{id}/withdraw` | workflow-routes + shared flow | Coordinator: withdraw a submitted design back to draft | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/designs/{id}/review` | workflow-routes + shared flow | Admin: approve or request changes with comment | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/designs/{id}/create-tasks` | workflow-routes + shared flow | Coordinator: release approved revision once | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/tasks` | workflow-routes + shared flow | Viewer reads all assignments; workers/foremen retain scope; date uses scheduledStart or dueAt in UTC+5 [start,end) | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/tasks` | workflow-routes + shared flow | Coordinator: create a manual care/inspection draft | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/tasks/{id}` | workflow-routes + shared flow | Task detail with reports; viewer reads all, workers/foremen retain assignment scope | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/tasks/{id}/history` | workflow-routes + shared flow | Task change history with actor, time and snapshots | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/tasks/{id}/assign` | workflow-routes + shared flow | Coordinator: assign crew and interval, clear unconfirmed composition | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/tasks/{id}/assign-workers` | workflow-routes + shared flow | Own foreman: confirm active workers, skills and availability | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/tasks/{id}/start` | workflow-routes + shared flow | Assigned executor or own foreman: start after revalidation | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/tasks/{id}/report-draft` | workflow-routes + shared flow | Read group materials and draft version | Implemented; shared SQLite regression + Stage B HTTP suite |
| PUT `/tasks/{id}/report-draft` | workflow-routes + shared flow | Own foreman: save group report summary | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/tasks/{id}/report-draft/contributions` | workflow-routes + shared flow | Assigned participant: edit only own materials | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/tasks/{id}/reports` | workflow-routes + shared flow | Submit one report: own foreman for a group, assigned executor for solo task | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/reports` | workflow-routes + shared flow | Viewer reads all reports; workers/foremen retain task scope | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/reports/{id}` | workflow-routes + shared flow | Read report within task scope; viewer allowed | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/reports/{id}/review` | workflow-routes + shared flow | Coordinator: accept or return; planting and care drafts committed atomically | Implemented; shared SQLite regression + Stage B HTTP suite |
| POST `/tasks/{id}/issues` | workflow-routes + shared flow | Record a field issue separately from completion | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/tasks/{id}/issues` | workflow-routes + shared flow | Read issues and explicitly confirmed observations | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/plants/{id}/care-history` | workflow-routes + shared flow | Accepted care events; inspection is not watering | Implemented; shared SQLite regression + Stage B HTTP suite |
| GET `/dashboard` | workflow-routes + shared flow | Counts by accepted report reviewedAt; empty sample is explicit | Implemented; shared SQLite regression + Stage B HTTP suite |

A parallel repeat hit the original persistence suite's backend readiness timeout during restart,
then dependent checks failed with ECONNREFUSED; the expanded Stage B and Stage A suites passed.
The failed log is retained; the final serial run passed 37/37. Native cluster suites now run with `--test-concurrency=1` and the older
startup poll allows at most 60 seconds; this does not change application authorization or assertions.

## Remaining boundaries

- Stage C upload/download and private-storage recovery are still pending in this checkpoint; `/uploads` returns 503.
- Stage D Outcomes remains pending. Saved Stage A analysis is not an Outcomes snapshot.
- GIS imports, search/geocode, new drawn zones, care schedule and assistant remain on the explicit unsupported backlog.
- Current proxy owner PR #35 HEAD `1916d199b62ee6416502b4aac3244b5aa47d37d9`; fixed upstream/Origin/cookie behavior was reviewed from its source, without editing that PR. Its reported public mock QA is separate evidence.
- Captain still needs approved credentials, an actual Render origin, private provider storage, real HTTPS/Cloudflare runtime, cold-start, redeploy and another-device acceptance. No public backend URL is invented.

Final local evidence: `work/cloud-workflow-evidence-20261031/b-pg-final-serial.log`, `b-sqlite-final.log`, `b-typecheck-final.log`, `b-build-3.log`. Isolated database/row hashes and HTTP trace: `%LOCALAPPDATA%/Temp/gp-cloud-workflow-EX9i6a`; Stage A evidence `%LOCALAPPDATA%/Temp/gp-cloud-planning-kik0Nb`. These are local artifacts, not committed databases or cloud provider claims.
