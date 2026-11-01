# PR #39 — Stage A: PostgreSQL homepage and planning acceptance

Date: 31 October 2026. Repository: foxfordkz-cyber/qadamxpavlodar.
Branch: `codex/cloud-api-persistence`; base `98cf6c68d5370331d6f95aa9e749f82d504e5670`.
This continues PR #39, which stays **Draft**. Stages B/C/D and public deployment are not complete.
The exact committed SHA and CI link are recorded in the PR after publication; no claim about a newer SHA.

## What changed

Append-only migration 2 stores the original 114 OSM zones, 456 radius-specific contexts, geometry,
50 species/catalog entries, 27 rates, source metadata/version/settings, map layers and immutable
analysis inputs/results in PostgreSQL. IDs and source classifications remain unchanged.
Published migration 1 is byte-identical to the previous head. There is no user SQLite import/reset.

SQLite and PostgreSQL call `municipal.analyzeInputs`, the same cache/shared `analyzeZone`, variants,
priorities, decision-lab and document functions. Formulas and survival model were not edited.
JSONB reads use a consistent read transaction. Rate writes and snapshot capture serialize on the
planning transaction lock; permissions are revalidated before idempotent replay. Rate/history/receipt
are one transaction. Immutable snapshot UPDATE/DELETE is rejected at database level.

Existing request/DTO schemas and generated OpenAPI are used. Cloud has **31 implemented operations**.
`npm run openapi:cloud` captures the actual public HTTP generator into `openapi-cloud.json`;
the PostgreSQL suite compares the live specification to that snapshot.
The existing SQLite OpenAPI snapshot is unchanged and its regression passes.

## Actual frontend request matrix (read-only source trace)

Sources: `apps/web/src/shared/api/{api,transport,v2compat,DataProvider}.ts[x]`,
`features/coordinator/home/HomePage.tsx`, `features/coordinator/sites/SitesPage.tsx`,
`shared/export/{loadMemo,memo,memoData}.ts`, `features/coordinator/zone/timeMachine.ts`.
Paths below already include the compatibility transport's rewriting, with common `/api/v1` prefix.

| Frontend action | Actual HTTP endpoint | DTO / conversion | SQLite source | PostgreSQL status | Missing work |
| --- | --- | --- | --- | --- | --- |
| Login / restore session | POST `/auth/login`, GET `/auth/me` | `{user,csrfToken}` → Me | v2_users/sessions | Persistent five roles | Public HTTPS acceptance |
| Home overview | GET `/dashboard/metrics` | DashboardMetric[] | municipal sites + V2 workflow rows | Site counts calculated from PG | Workflow counts null, reason `CLOUD_WORKFLOW_NOT_MIGRATED` |
| Home/map zone list | GET `/sites?limit=200&offset=...`, GET `/layers/sources` | V2Site[] → siteFromV2; OSM meta | v2_documents + source fixtures | Persisted original sites and metadata | Drawing/import/edit writes not in A |
| Zone selection/details | GET `/sites/:id` | V2Site → CandidateSite | v2_documents kind site | Persistent, same DTO | Assignment-scoped worker reads in B |
| Zone context | GET `/zones/:id/context?radius=30|50|100|200` | SiteContext | shared siteContext + municipal candidate | Persisted radius snapshots with site-version check | Regeneration on future zone edits |
| V2 context consumers | GET `/sites/:id/context` | V2 Context | v2_documents kind context | Persisted original Context | Assignment scope in B |
| Plant species/prices | GET `/species` | Species[], original IDs/nameKk/null prices | tz_species + municipal_state + shared catalog | PG species with stable order | Catalog editing/import APIs later |
| V2 catalog | GET `/plant-catalog` | Paginated catalog DTO | v2_documents kind catalog | Shared catalog conversion, persistent | Worker-scoped access in B |
| Rate panel / Word | GET `/rates` | `{rates,version}` | municipal_state / tz_rates | Persistent | None for reading |
| Admin rate change | PATCH `/rates` | expectedVersion, source; `{rates,version}` | municipal_state + rate history | Transactional, audited, replay safe | No separate rate-history read endpoint yet |
| Source references | GET `/evidence?limit=...&offset=...` | EvidenceRef[]; client filters requested IDs | v2_documents kind evidence | Existing PG references plus original seed sources | None for reading |
| Verified facts | GET `/reference/facts` | `{data,meta}` | checked-in Pavlodar references | Persisted reference bundle | No live weather integration claim |
| Recommendation/planting composition | POST `/zones/:id/analysis` | `{options}` → ZoneAnalysis | municipal current inputs → shared analyzeZone | Same function on persisted inputs | No LLM required/claimed |
| Cost estimate | Same analysis call | `cost.items/total/perM2`, scheme | shared cost computation | Exact parity | No separate cost endpoint |
| Survival/ecology/crown growth | Same analysis call | survival/model/effect, years 5/10/20 | shared calculation | Exact parity, no rounding tolerance | Estimates, not calibrated field observations |
| Time machine/hero | Analysis + `/species` + context | Existing buildGrowthScene/growthFrame | frontend renderer over HTTP values | Inputs accepted; unchanged renderer compared at 0/5/10/20 | Browser WebGL/map tiles not exercised here |
| Variant comparison | POST `/zones/:id/variants` | VariantSummary[] | shared variants | Exact parity | None for calculation |
| Soil/greenery layers | GET `/layers/soils`, `/layers/greenery` | GeoJSON + meta | imported municipal features + attributed fixtures | Persisted; soil labelled synthetic | Upload/import UI flow later |
| Problem/priority layers | GET `/problems`, POST `/priorities` | problems + items/roadmap | shared analytics | HTTP shared calculations | None for calculation |
| Decision Lab | POST `/decision-lab` | DecisionPlans | shared analytics | Persistent inputs + existing model | No frontend edits |
| Word memo | Rates twice + site/analysis/species/evidence calls above | loadMemo → MemoInput → buildMemoDocx | same HTTP path | RU/KK OOXML created from real HTTP data | Native Microsoft Word/visual review NOT RUN |
| Saved calculation | POST `/zones/:id/snapshots`, GET `/analysis-snapshots/:id` | immutable result, inputs/hash | municipal_analyses | PG immutable snapshot and idempotency | Distinct from Outcomes forecast snapshot |
| Existing PDF/XLSX export | POST `/zones/:id/export` | `{options,format}` → binary | municipal exportAnalysis | Existing renderer on PG calculation | Provider PDF font availability not verified |
| Map ancillary tasks/plants/proposals | GET `/tasks`, `/plants`, `/designs` | Existing V2/compat DTO | V2 workflow tables | Explicit 503, no empty fake lists | Stage B; complete map screen not accepted |
| Map search, drawing, site edits, care calendar | `/geocode`, POST `/zones`, PATCH `/sites/:id`, POST `/zones/:id/care-schedule` | Existing local APIs | TZ/V2 modules | Not migrated | Backend follow-up after core workflow |
| Assistant | POST `/assistant` | Existing assistant response | provider/rules adapter | Not migrated | LLM/RAG/weather/image owners and credentials |

There is no `/recommendation`, `/cost`, `/growth` or `/word` HTTP route. The tests invoke the
**unchanged real frontend transport and compatibility mapper** against actual HTTP listeners.
Node's test-only cookie jar only persists Set-Cookie; it never fabricates a response.
This is API acceptance with frontend data/render functions, not browser E2E or native Word acceptance.

## Parity and persisted-data evidence

The isolated SQLite baseline is seeded from the same checked-in source records as the PG seed.
Public zone lists/details, all four context radii, species, rates and layers are deep-equal.
Complete analyses for default/econom/max options are compared with `deepStrictEqual`: recommendations,
plant IDs/quantities, areas, costs, survival, effects, model metadata, input snapshots and input hashes.
The persisted source order is used for problem/priority ties, separately from the public V2 list ordering.
Only `provenance.generatedAt` differs and is excluded from the comparison. **No numeric rounding or
comparison tolerance is introduced.** Word generation time is fixed solely when comparing renderer
outputs; all Word source data is loaded through HTTP. RU/KK memo blocks and growth frames are equal.

The test stops the separate compiled backend process and the native PostgreSQL process, restarts both,
repeats both explicit seeds, then compares complete persisted planning rows/contexts/snapshots/history,
reference rows and idempotency receipts. Password/account equality is asserted without printing values.
Rates remain at their updated version, snapshot inputs remain immutable and sessions remain valid.
A DB outage returns 503 even for a previously cached calculation.

Only new random temporary clusters and a new test SQLite file are used. Existing databases/volumes
are untouched. Test directories remain on disk; hashes/counts, HTTP trace, RU/KK DOCX and PDF/XLSX
are retained there. The database itself contains test authentication data and must not be published.
Log output does not contain passwords, hashes, cookies or connection credentials.

Retained comparison after both-process restart and reseed:

| Table | Rows | SHA-256 of before/after-equal rows |
| --- | ---: | --- |
| `planning_documents` | 338 | `f66c79f52ac864e2279c45b29d73791477a3984ff981639112df4452ab3d1844` |
| `zone_contexts` | 456 | `bd6cb45be488cf6ad0418aa43cb5e7ff9f7e3be4c3da1faa1799eef8ae55bc28` |
| `analysis_snapshots` | 1 | `b1455dd7fc53e01c50405f4c56c080dd801866d656676e0f3ef877a55d5e2bf8` |
| `planning_history` | 3 | `fc4a4b5d30d9d1a210cc303f475049b97968e3a09b7f6c89f91a3696496c9531` |
| `documents` | 50 | `9fada2c7dba2ac3bca0223aaa8072ac58cfa9d79ec37e790aa249cc1b107a44d` |
| `idempotency` | 4 | `2b893869134da3961872f2b5f6b0d169d1b6d9721cc61a450c502b3d037b0541` |


## Capability/acceptance matrix

| Capability | Code implemented | Local PostgreSQL | Render / Supabase | Remaining owner/work |
| --- | --- | --- | --- | --- |
| Auth, sessions, CSRF, resources/evidence | Yes, previous slice preserved | PASS | NOT RUN: no approved access | Captain provisioning, Aidana independent acceptance |
| Home zones/context/sources/catalog/rates | Yes | PASS core scenario | NOT RUN | Bekzat: remaining map write/overlay APIs |
| Recommendations/estimate/survival/growth | Shared model, yes | PASS exact parity | NOT RUN | No new model; provider runtime acceptance later |
| Word inputs and RU/KK OOXML | Existing frontend renderer, no changes | PASS HTTP inputs + generated archive | NOT RUN | Captain/Aidana: browser download/native Word review |
| Rate editing + immutable analysis inputs | Yes | PASS persistence/replay/rollback | NOT RUN | Public restart/redeploy acceptance later |
| B: tasks/workers/crews/reports/acceptance | No | NOT RUN | NOT RUN | Bekzat: async workflow, assignment scopes, concurrency, references |
| C: private photo HTTP/storage flow | Primitive only (historical controlled-transport tests) | HTTP flow NOT RUN | Real Supabase NOT RUN: credentials unavailable | Bekzat: ownership, multipart, metadata transaction, compensation/reconciliation |
| D: Outcomes cohorts/observations/history | Local SQLite exists; PG not migrated | NOT RUN | NOT RUN | Bekzat: accepted-report/plant links, immutable forecast, null/provenance |
| Complete report/photo/Outcomes scenario | No | NOT RUN | NOT RUN | B/C/D prerequisite |
| Docker | Compose available; Engine absent | Runtime BLOCKED | Captain-owned | No install/start/system changes performed |
| Public API / HTTPS / computer independence | No public origin | Not applicable | BLOCKED | Captain provisions; Aidana verifies exact deployed SHA |

## Commands and verification record

From `apps/server`: `npm run typecheck`, `npm run build`, `npm run test:postgres`, `npm test`.
The PostgreSQL suite additionally needs `npm ci --prefix ../web` to use the original Word/growth
renderers; the dedicated CI job now installs those dependencies. It does not build/change frontend source.
From `apps/web`: typecheck, build, test and every existing check:* script are run separately.

Final local checks on the application/test changes in this commit:

| Check | Result | Evidence |
| --- | --- | --- |
| Server typecheck / build | PASS / PASS | typecheck-order.log / build-order.log |
| Native PostgreSQL HTTP suite | **25/25 PASS**, 68.185 s runner time | postgres-order.log |
| Full npm test (no skipped cases) | **104/104 PASS**, 246.232 s runner time | server-full-bounded.log |
| Earlier full-suite runs | 104/104; then 103/104 ECONNRESET; final repeat 104/104 | All logs retained, not overwritten |
| Web typecheck / build | PASS / PASS | web-typecheck.log / web-build.log |
| Web tests | **192/192 PASS** | web-test.log |
| check:care, check:i18n, check:survival, check:zones | All PASS | web-check-*.log |
| Live OpenAPI equals generated snapshots | PASS for SQLite and cloud | Full server / PostgreSQL suites |
| Render blueprint official-schema validation | PASS; deployment NOT RUN | render-validation.json |
| Docker Compose | 5.0.1; config --quiet PASS | docker-status.json |
| Docker Engine (current and default contexts) | BLOCKED: named pipes absent | engine-current.log / engine-default.log |
| Protected frontend/model/lockfile paths, UTF8, runtime-file and known secret-pattern scan | PASS | source-manifest.json |

Workspace evidence: `work/cloud-stage-a-evidence-20261031/` (outside this worktree's Git tree).
Final retained isolated data: `C:/Users/user/AppData/Local/Temp/gp-cloud-planning-ufpJRm/`.
The evidence directory contains the HTTP trace, generated RU/KK DOCX and PDF/XLSX plus row hashes;
no database/authentication files are copied into the repository. GitHub CI is recorded separately
against the exact published SHA in PR #39; local results alone are not a claim of cloud-provider acceptance.
Historical failures remain recorded: initial TS2741/TS4078 types; first PostgreSQL run used Windows
WIN1251; second identified extra greenery DTO metadata and incorrect uppercase expectations after the
existing frontend mapper. The expanded route check then caught different source ordering in problem/priority lists; the original municipal order is now persisted without changing formulas or sorting away differences in the test. The dependent scenario now stops on first failure instead of cascading.
The final full-suite repeat also recorded one transient ECONNRESET in the old V2 design test (103/104). The npm test command now places --test-concurrency=2 before test paths, bounding process load without skipping tests, changing assertions or adding a write retry.
No CSRF/RBAC/formula was relaxed to obtain a pass. Earlier first-slice failures are retained in the old report.

## Release handoff

- Bekzat: finish B/C/D in this existing Draft PR, each as an independently verified commit. Append new
  migration versions after publication; never rewrite migration 1 or the now-published migration 2.
- Damir/captain: review Stage A; merge only after agreed scope and checks. Current branch is not yet a
  complete cloud replacement. Provision only approved resources and perform Docker/public HTTPS checks.
- Tәңірберді: keep existing fixed same-origin proxy semantics. The actual public backend origin is
  unavailable; do not call an assistant fallback or a Cloudflare mock publication a persistent API.
- Aidana: core HTTP scenario and replay commands are in the existing PostgreSQL tests. Independently
  accept the exact deployed SHA after B/C/D, including photos and persistence from another device.

Render keeps repository root because shared TS analytics live under apps/web; its former server-only
root would exclude them. This is verified against [Render's root-directory rules](https://render.com/docs/monorepo-support),
not a claim of deployment. No force push, rebase, coordinator merge, public deploy or paid resource.
