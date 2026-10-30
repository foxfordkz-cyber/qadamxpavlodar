# Kazakh final review — 2026-10-30

Base: [PR #27](https://github.com/foxfordkz-cyber/qadamxpavlodar/pull/27),
`codex/integration-2026-10-30`, `6e5de2efb7d21e45e9b13072476162640dec2fec`.
Language branch: `codex/kk-final-review`; depends on #27 and must remain a separate Draft PR.
Application code tested after the final text correction:
`3f714ef4786c8447d41a88376c75ece71dd96562`. Subsequent changes in this branch add this report only.

## Scope and terminology

36 values corrected: 26 in `kk.ts`, 10 in the Kazakh section of `outcomes.ts`.
The only other changed existing file is `docs/kk-glossary.md`.

| Context | Correction / reason |
| --- | --- |
| Survival after planting | `жерсіну`, `жерсіну үлесі`; forecast remains an estimate, not an observed result |
| Canopy area, zone and Word | `ұшарбас ауданы`; preserved m² and the temperature placeholder |
| Outcomes / coverage | Explicitly distinguish inspected plants, plants with known state and live plants in the entire cohort |
| Unknown state | `жай-күйі белгісіз`; uninspected/unknown plants are neither alive nor dead |
| Control inspection | `бақылау мақсатындағы қарап тексеру`; observational evidence stays distinct from forecast |
| Manual checks | Specialist records checks; neither AI nor an estimate grants planting permission |
| SHP import | Clear archive/encoding hint and first-person `Ескертулерді тексердім` confirmation |
| Care | Natural validation, duration and visit-limit wording; no change to validation bounds |
| Survival horizon | `ui.344`: prefix `Мерзімі:` fits the existing year-label order; the previous prefix `кейін` had incorrect Kazakh word order |

Key sets, placeholder multisets, numbers and unit symbols were compared with the base and preserved.
The Russian `outcomesRu` section is byte-for-byte unchanged. No component, CSS, API, model,
formula, identifier, Latin name or botanical data file changed. All 26 unverified `nameKk = null`
values and their Russian fallback remain unchanged. This is editorial review, not newly certified
botanical nomenclature. Context choices are recorded in [the glossary](kk-glossary.md).

## Fresh automated checks

All commands below were run again after the last application-text correction. Counts refer to
this run, not the captain's previously reported results.

| Directory / command | Passed | Failed | Skipped | Evidence |
| --- | ---: | ---: | ---: | --- |
| `apps/web`: `npx tsc -b` | 1 command | 0 | 0 | Exit 0 |
| `apps/web`: `npm run build` | 1 command | 0 | 0 | Exit 0; existing chunks over 500 kB warning remains |
| `apps/web`: `npm test` | 177 tests | 0 | 0 | Actual full web test command |
| `apps/web`: `npm run check:zones` | 7 checks | 0 | 0 | SRV-02 |
| `apps/web`: `npm run check:survival` | 1 command | 0 | 0 | Synthetic n=12000, holdout=2400, AUC=0.732373, Brier=0.177188 |
| `apps/web`: `npm run check:care` | 1 command | 0 | 0 | Calendar, missing data, roles, validation and replay; script does not print an assertion count |
| `apps/web`: `npm run check:i18n` | 1787 keys | 0 | 0 | Missing 0, extra 0, placeholder mismatches 0 |

These are all four `check:*` scripts in `apps/web/package.json`. Worker tests, the captain's full
E2E suites and CI were not rerun by this language PR; their earlier results are not claimed as fresh PASS.

## Browser and real HTTP

Local frontend `127.0.0.1:15184`; real backend `127.0.0.1:13111`, through a local transparent
status-only observation proxy. API mode sent real HTTP to a disposable SQLite database.
Mock mode was tested separately and is explicitly labelled mock. Provider keys were absent;
this does not validate external LLM/RAG/weather/image integrations.

On application SHA `3f714ef`, each cell below opened Overview and Outcomes and waited for loaded
data: **16 functional page checks passed, 0 failed, 0 skipped**. This is not a claim of zero visual defects.

| Mode | RU 375×812 | RU 1280×812 | KK 375×812 | KK 1280×812 |
| --- | --- | --- | --- | --- |
| Mock | 2/2 | 2/2 | 2/2 | 2/2 |
| Real API | 2/2 | 2/2 | 2/2 | 2/2 |

Additional focused browser review on `7c6a4ff` (the following text correction only changed the
survival horizon prefix):

| Scenario | Result and boundary |
| --- | --- |
| Overview → Газон, улица Толстого → growth / zone / recommendation / cost / survival / care | Real API pages opened and text inspected; final survival-prefix correction also rechecked in mock at 375 and 1280 |
| Plant catalogue | API KK at 375 and 1280; 50 records, verified Kazakh names and Russian fallback distinguishable |
| Forecast and fact / cost of result / inspection coverage / unknown states | Both modes and languages; forecast, demo provenance and unknown state remain distinct |
| Manual specialist confirmation | Term and source conditional reviewed; non-demo manual-confirmation badge browser scenario **SKIPPED (1)**: the isolated seed supplies a demo inspection, not a real accepted specialist report |
| SHP preview | Actual fixture `synthetic-zones.zip`: 2 total / 2 valid / 0 invalid; localized preview |
| SHP save | Checked warning acknowledgement and saved through real API; UI showed saved state, persisted import record |
| SHP error | Archive missing `.prj`: expected HTTP 400 and localized explanation; not a server failure |
| Word | Selected the same Tolstogo zone, actual `viewer` role, downloaded KK DOCX; see visual results below |

Independent real HTTP role checks: **32 passed / 0 failed / 0 skipped** across coordinator,
admin and viewer. Login/me, sites, analysis, context, species, rates, dashboard and logout passed;
viewer write and missing-CSRF requests returned the expected 403. No mock success substituted for API errors.

After stopping and restarting the actual local backend and repeating `seed:tz` / `seed:outcomes`,
all ten sampled table fingerprints/counts were unchanged. This includes one imported SHP layer,
one forecast snapshot, one cohort, 32 cohort members, one inspection, three sources, 376 V2 documents
and five history records. SQLite integrity and foreign keys passed. `v2_reports` contained zero rows:
this run does **not** prove persistence of a non-empty accepted-report table.

## Reproducible UI findings for Damir / Claude

### A. Assistant launcher covers cost text in both languages — FAIL

Tested application SHA: `7c6a4ffca4666430287afc996437e93680f45c0f`.
Route: `/?source=mock&lang=ru#/` or `/?source=mock&lang=kk#/`.
Viewport: **375×812**, default zoom, assistant closed.

1. Open Overview and wait for the city totals.
2. RU: stay at `scrollY=0`. KK: scroll about 41 CSS px (`scrollY=40.8` observed).
3. The fixed launcher covers part of the cost caption:
   RU `9,97 млн ₸ посадка и уход, оценка`; KK `9,97 млн ₸ отырғызу және күтім, бағалау`.

RU launcher rectangle: x=208.375…342, y=696.25…742; cost block y=725.225…755.675.
KK launcher: x=217.3125…342, y=696.25…742; cost block y=700.675…750.700 at the reported scroll position.
Both captions therefore intersect the launcher. Genuine screenshots:
`final-ru-mock-375-home.jpg`, `final-kk-375-overlap.jpg`.

Scrolling works. The assistant opens and closes in both languages; the growth link can be clicked
after scrolling and opens the selected zone. **No permanently unavailable action was reproduced.**
The reproducible issue is obscured text, not a proven complete interaction block. Opening the assistant
also displays its panel; that intentional overlay must not be conflated with this closed-launcher defect.
Owner: Damir / Claude (Shell / AssistantPanel / responsive layout); no UI implementation changed here.

### B. KK More menu extends outside the viewport — FAIL

Same SHA, KK Overview, **1280×900**. Click `Тағы`; the `Нұсқаулық` entry extends to
x=1307.588, beyond viewport x=1280 by about 27.6 CSS px. Screenshot: `final-kk-menu-1280.jpg`.
Owner: Damir / Claude. External QA comments on other SHAs are not counted as this run's evidence.

### C. Mixed-language source content — remaining integration work

In KK API mode the care results still contain Russian operation names/details (for example `Полив`,
`Обрезка санитарная`). The document preview includes source explanations in Russian and an English
forecast note. Template labels are Kazakh; incoming data is not universally localized.
Screenshots/DOM evidence: `final-api-kk-care-russian-content.jpg`, `final-api-kk-1280-care.txt`.
The expected Russian fallback for 26 unverified botanical names is **not** the same issue.
Damir and the care/data provider owner should agree locale-aware fields or dictionary wiring;
this language PR cannot change their components or invent botanical/source translations.

## Viewer Word visual verification

Microsoft Word was available. Both actual downloaded viewer documents were opened read-only in
Protected View and visually inspected: title, selected zone, species/cost/effect tables, line wrapping,
page breaks and signature. **2 visual documents passed / 0 failed / 0 skipped**.
Files were unchanged after opening; this is actual Word verification, not merely XML validation.

| File | Role / zone | DOCX/XML | Word | SHA-256 |
| --- | --- | --- | --- | --- |
| `green-pavlodar-memo-kk-2026-10-30.docx` | viewer / `site-osm-1569993037`, Газон, улица Толстого | PASS, 263 paragraphs, 5 tables, `kk-KZ` | PASS | `6afd45abfa32fa08d3eb8ba59e862f617a700d7a86886599acc3b4fe83538166` |
| `green-pavlodar-memo-ru-2026-10-30 (2).docx` | viewer / same zone | PASS, 263 paragraphs, 5 tables, `ru-RU` | PASS | `72457cee204cd6a5242a0d86fb5269a286e7c748641e2da8a28e647ee44418e3` |

The KK document retains Russian unverified species fallback and source assumptions; full localization
of source data is not claimed. Native Word screenshots include `final-word-viewer-kk-page1.png`,
`final-word-viewer-kk-species.png`, `final-word-viewer-kk-cost.png`, `final-word-viewer-kk-effect.png`,
`final-word-viewer-kk-signature.png` and corresponding RU evidence.

## Evidence and release boundary

Local evidence supplied with the handoff: `final-review-web-checks-latest.json`,
`final-review-language-invariants.json`, `final-review-browser-matrix-final.json`,
`final-review-overlap.json`, `final-review-http-evidence.json`,
`final-review-persistence-before.json`, `final-review-persistence-after.json`,
`final-review-docx-xml.json`, `final-review-word-visual.json`, screenshots and command logs.
They are outside this PR so that the diff contains only the four authorized language/documentation files;
image filenames above are evidence references, not links to nonexistent repository assets.

Separate work: [PR #29](https://github.com/foxfordkz-cyber/qadamxpavlodar/pull/29)
`83f88b89345384b253f89e37560f803ccbddd9bb` passed 14 migration tests and full backend `npm test`
79/79 on its own branch; Ready means ready for review, not permission to migrate user data.
Those 79 tests are not the distinct integration branch's previously reported 80 tests.
[PR #22](https://github.com/foxfordkz-cyber/qadamxpavlodar/pull/22)
`ee6f9dd38a92b6e7b595e9a91c6ef0c68db5e95b` has updated isolated Case A/B Docker instructions;
4 local deployment tests and 2 Compose configurations passed, container runtime remains captain-owned.
PR #22 подготовлен к Docker acceptance капитаном. It remains Draft.

**PR #29 и последнее обновление PR #22 необходимо включить в итоговую интеграционную сборку
перед повторной общей приёмкой.** Only the captain merges. No merge to coordinator, force push,
rebase, real-database migration, volume deletion or public deployment was performed.
