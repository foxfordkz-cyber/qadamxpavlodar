# Cloud route coverage — final release candidate, PR #39

Reviewed from the actual source in this worktree (PR #39 plus normal coordinator merge
`599a738`, incorporating `fdc6e75`), not from the
public mock: [DataProvider](../apps/web/src/shared/api/DataProvider.tsx),
[createApi](../apps/web/src/shared/api/api.ts),
[V2 compatibility transport](../apps/web/src/shared/api/v2compat.ts),
[Outcomes client](../apps/web/src/shared/api/outcomesClient.ts),
[worker gateway](../apps/web/src/features/worker/contract-v2.mjs),
[report export](../apps/web/src/features/coordinator/tz/ReportPage.tsx).
No frontend/map/worker/tools/e2e changes were authored here; upstream QA/onboarding changes
arrived through the requested merge. [Final candidate and exact gap table](cloud-final-release.md).
Standalone geocode `999f23a` is preserved on a separate branch and is NOT in this release.

API mode selects the V2 compatibility layer. Its logical `/projects`, `/brigades`, `/dashboard`
names are not literal backend calls. Mock-only Outcomes URLs are also not cloud requirements.
All backend paths below are relative to `/api/v1`.

HTTP evidence: **A** = native planning suite; **B** = workflow suite;
**C** = photos suite and fixed proxy; **D** = Outcomes/full linked workflow and current web adapters.
“503 yes” means an authenticated valid-CSRF request reaches an intentionally unimplemented domain,
not an outage. Any implemented route can still return explicit DB/storage 503 on failure.
Some response schemas remain permissive objects inherited from V2; successful schema validation
alone is not full semantic validation. Named suites also assert records, states, links and hashes.
For grouped rows the suite label denotes representative HTTP coverage of the group, not exhaustive
verification of every listed method; full HTTP traces are retained with the suites.

| Actual endpoint or frontend mapping | SQLite | PostgreSQL | Real HTTP tested | Unsupported 503 | Remaining / impact |
| --- | --- | --- | --- | --- | --- |
| POST /auth/login; GET /auth/me; POST /auth/logout | Yes | Yes | A/B/C/D | No | Real Render and production Cloudflare HTTP/cookies/CSRF PASS on backend 3b14927; viewer browser login/reload/logout PASS; full UI matrix separate |
| GET /sites; GET /sites/:id | Yes | Yes, canonical registry | A/B/D | No | Existing zones only |
| PATCH /sites/:id | Yes | Yes, versions/source checks | B/D | No | Current web adapter sends checks/water; full geometry lifecycle still incomplete |
| GET /zones/:id/context?radius=30/50/100/200 | Yes | Persisted context | A | No | 409 CONTEXT_STALE after site-version change; regeneration not implemented |
| GET /sites/:id/context | Yes | V2 persisted context | B | No | Worker/design source; no live geospatial claim |
| POST /zones (drawn zone) | Yes | No | D denial | Yes | New zone creation blocks drawing/save |
| GET /geocode?q=... | Yes, attributed snapshot | No | D denial | Yes | Search unavailable in cloud |
| GET /layers/sources | Yes | Persisted source metadata | A/D | No | No new live fetch |
| GET /layers/soils; /layers/greenery | Yes | Persisted display layers | A | No | Synthetic soil labelled; new import unavailable |
| GET /layers/city; /layers/zones | Yes | Persisted imported layer slots | A | No | Empty until actual supported import; no invented features |
| GET /species | Yes | Canonical planning catalog | A/D | No | Unverified nameKk remains null |
| GET /plant-catalog | Yes | V2 catalog | B | No | Assigned worker scope, not unrestricted city catalog |
| POST/PATCH /plant-catalog[/:id] | Yes | Yes | B | No | Planning species editor is a separate concern |
| GET /rates; PATCH /rates | Yes | Yes, history/version | A/D | No | Admin mutation; null mandatory coefficients give 422 |
| GET /evidence; POST /evidence | Yes | Yes | A/B/D | No | No secrets; worker list denied by V2 |
| GET /resources; POST /resources; PATCH /resources/:id | Yes | Yes | A/B | No | Native crew link |
| POST /zones/:id/analysis | Yes | Shared calculation | A/D | No | Recommendations, cost, care totals, survival, growth/effect estimates |
| POST /zones/:id/variants | Yes | Shared three variants | A | No | Same formulas |
| POST /zones/:id/snapshots; GET /analysis-snapshots/:id | Cloud addition | Immutable PostgreSQL inputs/results | A/D | No | This is not an Outcomes inspection |
| POST /sites/rank-preview | Yes, legacy rules route | No | D denial | Yes | Declared createApi method; use current priorities screen only where already wired |
| POST /sites/:id/plant-selection | Yes, legacy rules route | No | D denial | Yes | Declared createApi method; not an alias silently added |
| GET /problems; POST /priorities | Yes | Shared calculation | A | No | Missing measured data remains explicit |
| POST /decision-lab | Yes | Shared budget/water scenarios | A | No | No formula or Kazakh text changes |
| POST /zones/:id/care-schedule | Yes, draft calendar | No | D denial | Yes | Care calendar unavailable; manual persisted care tasks work |
| GET /plants; GET /plants/:id; GET /plants/geojson | Yes | Canonical registry | B/D | No | Role scope retained |
| POST /plants; PATCH /plants/:id | Yes | Yes | B/C | No | Coordinator, sourced DEMO registry edits |
| GET /care-policies; POST /care-policies | Yes | Yes | B | No | Different from care calendar generation |
| GET /workers | Yes | Public users/profiles | B/D | No | Viewer read; foreman scope |
| GET /crews; POST /crews; PATCH /crews/:id; POST /crews/:id/members | Yes | Yes | B/D | No | UI /brigades maps to crews + workers + resources |
| GET/POST /users; PATCH /users/:id; GET /users/:id/history | Yes | Yes | B/C | No | Admin; current role/session revocation |
| GET /tasks; GET /tasks/:id; GET /tasks/:id/history | Yes | Yes | B/C/D | No | Viewer reads; worker/foreman scope retained |
| POST /tasks | Yes | Yes | B/C/D | No | Planting requires approved design release |
| POST /tasks/:id/assign | Yes | Yes | B/C/D | No | Coordinator crew/time/resource checks |
| POST /tasks/:id/assign-workers | Yes | Yes | B/C/D | No | Own foreman; active qualified workers |
| POST /tasks/:id/start | Yes | Yes | B/C/D | No | Assigned actor/current version |
| GET/PUT /tasks/:id/report-draft; POST .../report-draft/contributions | Yes | Yes | B/C | No | Group contribution ownership |
| POST /tasks/:id/reports | Yes | Yes | B/C/D | No | Note, photos, worker IDs, planting facts |
| GET /reports; GET /reports/:id; POST /reports/:id/review | Yes | Yes | B/C/D | No | Review: accepted or changes_requested; not rejected |
| GET/POST /tasks/:id/issues | Yes | Yes | B | No | UI /issues aggregates task issue reads |
| GET /designs; GET /designs/:id; POST /designs; PATCH /designs/:id | Yes | Yes | B/D | No | UI /projects DTO converted by existing adapter |
| POST /designs/:id/submit; /withdraw; /review; /create-tasks | Yes | Yes | B/D | No | Admin approves; approved revision immutable |
| POST /uploads | Yes, local PhotoStorage | Yes, private remote storage | C/D | No when configured | 503 PHOTO_STORAGE_NOT_CONFIGURED otherwise |
| GET /uploads/:id | Yes, authenticated WebP | Yes, authenticated WebP | C/D | No when configured | Binary, never a JSON metadata endpoint |
| GET /dashboard/metrics | Yes | Real tasks/reports/projects | B/D adapter | No | UI /dashboard maps here; fixed array OpenAPI response |
| GET /plans (logical UI call) | Client summary | Client summary over tasks/crews | D adapter | No request | plan:null is explicit unapproved preview |
| POST /plans/:date/approve (logical UI call) | Adapter rejects | Adapter rejects before HTTP | D adapter | Client 503 | Persisted day-plan approval is outside this slice |
| POST /imports/preview; POST /imports/:id/commit | Yes | No | D denial | Yes | GIS preview/commit unavailable; repeat-import cloud acceptance NOT RUN |
| GET /imports/:id | Yes | No | Source reviewed, no separate HTTP case | Yes | Import status backlog |
| GET /reference/facts | Yes | Persisted verified references | A | No | Not live weather |
| POST /assistant; GET /assistant/history | SQLite rules / optional LLM | No | D denial | Yes | No cloud assistant/history, no hidden fallback |
| POST /observations/interpret | Local adapter/rules | No | D denial | Yes | Optional worker AI analysis unavailable; raw note/report remains usable |
| POST /outcomes/snapshots | Yes | Shared immutable full forecast | D | No | Input restrictions remain; forecast is an estimate |
| GET /outcomes/sites/:id | Yes | Full saved read model | D + web adapter | No | Manager/viewer only |
| GET/POST /outcomes/cohorts | Yes | Yes | D | No | Existing tree IDs; exact forecast composition |
| GET /outcomes/cohorts/:id | Yes | Yes | D + SQLite parity | No | Explicit task-based worker/foreman scope |
| GET/POST /outcomes/cohorts/:id/inspections | Yes | Append-only | D | No | Coordinator/admin manual attestation |
| GET /outcomes/cohorts/:id/summary?inspectionId=... | Yes | Shared comparison | D | No | Absent selection/inspection means unknown |
| GET /outcomes/openapi.json | Yes | Generated extension | D raw-response schema validation | No | Main generated spec includes all 9 Outcomes operations |
| Word export | Client DOCX builder | Real reads then same client builder | A | No new route | Do not invent /word |
| POST /zones/:id/export | Yes, PDF/XLSX | Existing renderer | A (XLSX) | No | Real PDF/font runtime acceptance remains operator check |

## Backend/DTO differences and owner handoff

- The existing web adapter already converts crew/project names, status `returned` to
  `changes_requested`, revision/version fields, checks.state to checks.status, and worker availability.
  Sending screen DTOs directly to cloud endpoints bypasses this required adapter.
- Report detail is `{data:Report}`; submission is `{data:{report,task}}`; review adds
  `plants,careTasks,warnings`. Task/report versions are separate.
- API Outcomes uses `/outcomes/sites/:id` and `/outcomes/snapshots`. Mock-only
  `/outcomes/:id` and `/outcomes/:id/forecasts` must not be routed to cloud.
- Current Outcomes client allows the existing tree-only 3-year regular-watering snapshot variant.
  Backend does not accept arbitrary UI options as a captured forecast.
- Context snapshot currently binds to the entire site version, including human check updates.
  It refuses stale reads with 409; there is no automatic context regeneration. Backend follow-up
  must define geometry-version regeneration before claiming full edit/map support.
- Existing web upload adapter constructs a private URL, not an HTTP JSON read. Its local
  `isDemo:false` UI field does not change the server's DEMO provenance; frontend owner should
  review that label separately. No UI changes were made here.
- UI “manual confirmation” is informational; no new inspection form was built in this task.

## Capability matrix / exact remaining owners

Provider columns below refer to the real, dated **3b14927** acceptance, not automatically to
any newer HEAD. Fresh candidate results/deployed SHA are recorded in PR #39 and the final handoff.
Tests against local HTTP Storage are distinct from real Supabase checks.

| Feature | Implemented | PostgreSQL local | Real Render/Supabase evidence | Remaining / owner |
| --- | --- | --- | --- | --- |
| Home/dashboard | Yes | PASS shared metrics | NOT RUN for complete dashboard UI | Frontend/QA acceptance |
| Existing zones/context | Partial | PASS stored reads; explicit stale refusal | Existing site read/analysis PASS; radius/context regeneration NOT RUN | Backend/map: version/context lifecycle |
| Tasks/workers/crews/designs | Yes, V2 | PASS | Full HTTPS creation/assignment/read PASS | Captain: final candidate; QA UI |
| Reports/acceptance/history | Yes | PASS | Acceptance/immutable history/replay/restart/redeploy PASS | Independent QA |
| Photos | Yes | PASS with test HTTP Storage | Real private Supabase upload/authorized read/hash/replay/private denial/persistence PASS | No public objects; bucket configuration retained |
| Outcomes | Yes | PASS linked HTTP/parity/restart | Forecast/cohort/accepted inspect/unknown summary/persistence PASS | Independent QA; no new inspection form |
| Search/drawing/import | No in this candidate | Explicit 503 | Authenticated unsupported responses; no successful provider implementation | Stage E follow-up; geocode 999f23a excluded |
| Care | Manual task workflow; calendar absent | PASS task workflow; calendar 503 | Real inspect task/report accepted; calendar 503 | Backend calendar follow-up |
| Assistant/interpretation | No cloud routes | Explicit 503 | Assistant history 503; no paid model calls | Captain/LLM owner + persistence integration |
| Recommendation/estimate | Shared calculation | PASS SQLite parity | Analysis + design + immutable forecast PASS | Shared formulas unchanged |
| Lab/growth/Word/PDF | Existing shared functions/renderers | Local representative A tests | NOT RUN for all exported/rendered provider outputs | QA/provider renderer acceptance |

The complete task/photo/report/Outcomes scenario passed real HTTPS acceptance at the recorded SHA.
Full cloud UI coverage is **not** complete. Search, new-zone save, GIS import, calendar and assistant
screens retain explicit errors. Do not convert missing data into successful empty results.
Тәңірберді owns the fixed same-origin proxy and preserving the independent public mock;
Айдана owns independent UI/another-device acceptance; the captain alone merges coordinator.

No exact organizer-file compliance is claimed here; this matrix audits repository contracts and
the user's Stage B–G task, not a re-labelled team transcription of an official specification.
