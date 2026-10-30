# Kazakh decision-lab review

Base: `codex/coordinator`, `bfc2dfe09fec435daba2cea972e4011322adc572`.
This branch contains only Kazakh wording and its documentation. Server viewer permissions are a
separate PR from the same base.

23 existing `lab.*` values in `apps/web/src/shared/i18n/kk.ts` were refined:

- Canopy wording follows `docs/kk-glossary.md`: `ұшарбас`, not `тәж`; summed canopy area is not unique shade.
- Expected survival is explicitly a forecast. Weighted survival says `салмақталып есептеледі`, not measured field survival.
- Budget labels describe planting plus three years of care; the replacement reserve is explicitly money.
- Seasonal water limit, water-demand coverage and shortage are distinct from watering scenarios and mortality.
- Selection explanation retains the greedy ordering and the lack of an optimality guarantee.
- Care visits and monthly rounding are described naturally; delayed-care effects are not mislabelled simply as expenses.

The source diff preserves all keys, numeric literals, units, percentages and placeholder multisets.
No Russian dictionary, component, formula, API, botanical Latin, ID or plant data changed.
26 unverified `nameKk` values remain `null` with the existing Russian fallback. Completing those names
is not a release prerequisite and is not part of this editorial PR.

Fresh commands in `apps/web`: `npm run typecheck`, `npm run build`, `npm test`,
`npm run check:zones`, `npm run check:survival`, `npm run check:care`, `npm run check:i18n`.
All passed: web **192 passed / 0 failed / 0 skipped**, dictionary **1927/1927**, missing/extra/placeholder
mismatches 0; zone checks 7. Survival verification remains synthetic (AUC 0.732373 / Brier 0.177188).
Build still reports existing bundles over 500 kB; this language PR does not change bundling.

Browser acceptance covers `#/lab`, explicit mock and real API modes. API mode uses a real viewer
cookie session against the separate viewer-fix server branch and an isolated synthetic SQLite.

| Source | Language | 375 CSS px | 1280 CSS px |
| --- | --- | --- | --- |
| Mock | RU | PASS | PASS |
| Mock | KK | PASS | PASS |
| Real API | RU | PASS | PASS |
| Real API | KK | PASS | PASS |

Each combination loaded three plan cards without horizontal overflow. Focused KK/mock interactions
covered invalid budget and recovery, rare watering, selection explanations, delayed care and assumptions.
KK/API separately covered invalid budget and recovery to three real plan cards. This is eight layout
smoke checks plus focused interaction checks, not a claim that every control was exercised eight times.
Three browser-control timeouts during calculation/loading were followed by successful loaded-state
verification; they were tooling interruptions, not silently counted as successful assertions. Browser
snapshots and screenshots accompany the handoff. No API responses were intercepted or mocked.

Remaining language boundaries:

- Source place names, user text and unverified botanical names may remain Russian.
- Some catalogue/source notes elsewhere in the app remain RU/EN; no broad component/data translation is attempted.
- The lab uses modelled/demo assumptions and does not constitute validated climate or field-outcome prediction.
- The Outcomes manual-confirmation badge is informational. No inspection-creation form is introduced.
- Native number formatting is controlled by the existing formatter, not these strings.

Review the language PR independently; the captain performs the integration and Docker runtime acceptance.
