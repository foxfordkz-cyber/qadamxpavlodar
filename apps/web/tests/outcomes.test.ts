import { test } from 'node:test';
import assert from 'node:assert/strict';
import osm from '../../../fixtures/osm/sites.json';
import { species } from '../src/shared/api/mock/species';
import type { CandidateSite, Species } from '../src/shared/api/types';
import type { OutcomeCohort, OutcomeInspection, OutcomeProvenance, OutcomeVariantInput, RegisteredOutcomePlant } from '../src/shared/api/outcomes';
import { analyzeZone, costEstimate } from '../src/shared/analytics/plan';
import { DEFAULT_RATES, ratesMap } from '../src/shared/analytics/rates';
import { calculateOutcomeVariant, compareOutcomeVariants, createOutcomeSnapshot, createOutcomeCohort,
  summarizeOutcomeInspection, compareOutcomeForecast, OutcomeValidationError } from '../src/shared/analytics/outcomes';
import { buildOutcomeExample } from '../scripts/example-outcomes';

const close = (actual: number | null, expected: number) => {
  assert.notEqual(actual, null); assert.ok(Math.abs(actual! - expected) < 1e-8, `${actual} != ${expected}`);
};
const provenance = (capturedAt = '2023-10-30T00:00:00Z'): OutcomeProvenance => ({
  source: 'mock', capturedAt, dataClass: 'demo', isDemo: true,
  evidenceIds: ['test-evidence'], siteVersion: 1, ratesVersion: 1,
});
function refreshCost(input: OutcomeVariantInput) {
  input.analysis.cost = costEstimate(input.site, input.analysis.scheme, new Map(input.catalog.map(s => [s.id, s])),
    input.analysis.survival, input.analysis.options, ratesMap(input.rates), input.analysis.facts.soil);
  return input;
}
function sample(): OutcomeVariantInput {
  const site = { ...structuredClone(osm.sites[0]) as unknown as CandidateSite, id: 'test-site', areaM2: 100, isDemo: true };
  site.checks.utilities.state = 'cleared';
  const template = species.find(s => s.form === 'tree')!;
  const catalog: Species[] = [{ ...structuredClone(template), id: 'tree-a', pricePerUnitKzt: 100 },
    { ...structuredClone(template), id: 'tree-b', pricePerUnitKzt: 200 }];
  const rates = structuredClone(DEFAULT_RATES);
  const values: Record<string, number> = { 'soil.prep': 10, 'soil.salinity': 4, 'work.tree': 20, 'delivery.share': 10, 'care.tree': 30 };
  rates.forEach(r => { if (Object.hasOwn(values, r.key)) r.value = values[r.key]; });
  const analysis = analyzeZone(site, catalog, ratesMap(rates), { variant: 'optimal', careYears: 3 });
  analysis.facts.soil.salinity = 'none';
  analysis.scheme = [{ speciesId: 'tree-a', tier: 'tree', quantity: 10, locked: false }, { speciesId: 'tree-b', tier: 'tree', quantity: 5, locked: false }];
  analysis.survival = [{ speciesId: 'tree-a', y1: 80, y2: 70, y3: 60, low: 70, high: 90, risks: [] },
    { speciesId: 'tree-b', y1: 90, y2: 85, y3: 80, low: 80, high: 95, risks: [] }];
  return refreshCost({ id: 'test-optimal', site, catalog, rates, analysis, provenance: provenance() });
}
const codes = (input: OutcomeVariantInput) => calculateOutcomeVariant(input).issues.map(i => i.code);

test('outcomes: independent cost arithmetic, percentages and quantity-weighted expected trees', () => {
  const outcome = calculateOutcomeVariant(sample());
  // 100×10 + 200×5; 100×0.6×10; 15×20 + 2000×0.1; 3×15×30; 1000×0.2 + 1000×0.1.
  [2000, 600, 500, 1350, 300].forEach((expected, i) => close(outcome.cost.items[i].amountKzt, expected));
  close(outcome.cost.totalKzt, 4750);
  close(outcome.expectedTreesY3, 10 * 0.6 + 5 * 0.8);
  close(outcome.costPerExpectedTreeKzt, 475);
  assert.equal(outcome.treeCount, 15); assert.equal(outcome.cost.complete, true);
  assert.deepEqual(outcome.issues, []); assert.equal(outcome.dataClass, 'estimate'); assert.equal(outcome.isDemo, true);
});

test('outcomes: repeated scheme rows of the same species are summed, not lost or given duplicate forecasts', () => {
  const input = sample();
  input.analysis.scheme[0].quantity = 6;
  input.analysis.scheme.push({ ...input.analysis.scheme[0], quantity: 4 });
  refreshCost(input);
  close(calculateOutcomeVariant(input).expectedTreesY3, 10);
  close(calculateOutcomeVariant(input).costPerExpectedTreeKzt, 475);
});

for (const key of ['soil.prep', 'work.tree', 'delivery.share', 'care.tree']) {
  test(`outcomes: missing ${key} remains unknown even when legacy costEstimate substitutes zero`, () => {
    const input = sample(); input.rates.find(r => r.key === key)!.value = null; refreshCost(input);
    const result = calculateOutcomeVariant(input);
    assert.ok(Number.isFinite(input.analysis.cost.total));
    assert.equal(result.cost.complete, false); assert.equal(result.cost.totalKzt, null);
    assert.equal(result.costPerExpectedTreeKzt, null);
    assert.ok(result.issues.some(i => i.code === 'missing_rate' && i.field === key));
    assert.ok(result.cost.items.some(i => i.amountKzt === null));
  });
}

test('outcomes: price fallback and salinity surcharge are required only when actually used', () => {
  const input = sample(); input.catalog[0].pricePerUnitKzt = null;
  input.rates.find(r => r.key === 'price.tree')!.value = 70; refreshCost(input);
  assert.equal(calculateOutcomeVariant(input).cost.complete, true);
  input.rates.find(r => r.key === 'price.tree')!.value = null; refreshCost(input);
  assert.ok(codes(input).includes('missing_rate'));
  const salty = sample(); salty.rates.find(r => r.key === 'soil.salinity')!.value = null;
  assert.equal(calculateOutcomeVariant(salty).cost.complete, true);
  salty.analysis.options.improveSoil = true; refreshCost(salty);
  assert.ok(calculateOutcomeVariant(salty).issues.some(i => i.field === 'soil.salinity'));
  const large = sample(); large.analysis.options.variant = 'max'; large.catalog[0].pricePerUnitKzt = null;
  large.rates.find(r => r.key === 'price.tree.large')!.value = null; refreshCost(large);
  assert.ok(calculateOutcomeVariant(large).issues.some(i => i.field === 'price.tree.large'));
});

test('outcomes: known zero costs are valid, unlike missing costs', () => {
  const input = sample(); input.catalog.forEach(s => { s.pricePerUnitKzt = 0; });
  input.rates.forEach(r => { r.value = 0; }); refreshCost(input);
  const result = calculateOutcomeVariant(input);
  assert.equal(result.cost.complete, true); assert.equal(result.cost.totalKzt, 0); assert.equal(result.costPerExpectedTreeKzt, 0);
});

for (const value of [-1, NaN, Infinity]) test(`outcomes: invalid price/rate ${value} cannot yield a cheap plan`, () => {
  const price = sample(); price.catalog[0].pricePerUnitKzt = value; refreshCost(price);
  assert.equal(calculateOutcomeVariant(price).costPerExpectedTreeKzt, null); assert.ok(codes(price).includes('invalid_price'));
  const rate = sample(); rate.rates.find(r => r.key === 'care.tree')!.value = value; refreshCost(rate);
  assert.equal(calculateOutcomeVariant(rate).costPerExpectedTreeKzt, null); assert.ok(codes(rate).includes('invalid_rate'));
});

for (const value of [-1, 101, NaN, Infinity, null]) test(`outcomes: invalid y3 ${value} produces unknown expected count`, () => {
  const input = sample(); input.analysis.survival[0].y3 = value as number;
  const result = calculateOutcomeVariant(input);
  assert.equal(result.expectedTreesY3, null); assert.equal(result.costPerExpectedTreeKzt, null);
  assert.ok(result.issues.some(i => i.code === 'invalid_probability'));
});

test('outcomes: zero expected trees gives null, without Infinity or fabricated lower bound', () => {
  const input = sample(); input.analysis.survival.forEach(s => { s.y3 = 0; });
  const result = calculateOutcomeVariant(input);
  assert.equal(result.expectedTreesY3, 0); assert.equal(result.costPerExpectedTreeKzt, null);
  assert.ok(codes(input).includes('zero_expected_trees'));
});

test('outcomes: missing/duplicated forecasts and rates are not silently selected', () => {
  const absent = sample(); absent.analysis.survival.pop();
  assert.equal(calculateOutcomeVariant(absent).costPerExpectedTreeKzt, null); assert.ok(codes(absent).includes('missing_survival'));
  const dup = sample(); dup.analysis.survival.push({ ...dup.analysis.survival[0] });
  assert.equal(calculateOutcomeVariant(dup).expectedTreesY3, null); assert.ok(codes(dup).includes('duplicate_survival'));
  const rate = sample(); rate.rates.push({ ...rate.rates.find(r => r.key === 'care.tree')! });
  assert.equal(calculateOutcomeVariant(rate).cost.totalKzt, null); assert.ok(codes(rate).includes('duplicate_rate'));
});

test('outcomes: mixed planting is not allocated to trees by an invented share', () => {
  const input = sample();
  input.catalog.push({ ...input.catalog[0], id: 'shrub', form: 'shrub' });
  input.analysis.scheme.push({ speciesId: 'shrub', tier: 'shrub', quantity: 2, locked: false });
  input.analysis.survival.push({ ...input.analysis.survival[0], speciesId: 'shrub' }); refreshCost(input);
  const result = calculateOutcomeVariant(input);
  assert.equal(result.cost.complete, true); close(result.expectedTreesY3, 10);
  assert.equal(result.cost.scope, 'unallocated-mixed-planting'); assert.equal(result.costPerExpectedTreeKzt, null);
  assert.ok(codes(input).includes('mixed_planting'));
});

test('outcomes: one/two-year care is not multiplied into a three-year estimate', () => {
  for (const careYears of [1, 2] as const) {
    const input = sample(); input.analysis.options.careYears = careYears; refreshCost(input);
    const result = calculateOutcomeVariant(input);
    assert.equal(result.cost.totalKzt, input.analysis.cost.total); assert.equal(result.costPerExpectedTreeKzt, null);
    assert.ok(codes(input).includes('wrong_horizon'));
  }
});

test('outcomes: invalid quantities, wrong tier, unknown species and missing area are not valid estimates', () => {
  for (const n of [0, -1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const input = sample(); input.analysis.scheme[0].quantity = n;
    assert.equal(calculateOutcomeVariant(input).costPerExpectedTreeKzt, null); assert.ok(codes(input).includes('invalid_quantity'));
  }
  const tier = sample(); tier.analysis.scheme[0].tier = 'flower'; assert.ok(codes(tier).includes('species_tier_mismatch'));
  const missing = sample(); missing.catalog.shift(); assert.ok(codes(missing).includes('missing_species'));
  for (const area of [null, 0]) {
    const input = sample(); input.site.areaM2 = area; input.analysis.facts.areaM2 = area; refreshCost(input);
    assert.equal(calculateOutcomeVariant(input).cost.totalKzt, null); assert.ok(codes(input).includes('missing_area'));
  }
});

test('outcomes: changed rates, corrupt total, omitted/extra articles and wrong site invalidate the cost', () => {
  const stale = sample(); stale.rates.find(r => r.key === 'care.tree')!.value = 99;
  assert.ok(codes(stale).includes('cost_mismatch')); assert.equal(calculateOutcomeVariant(stale).cost.totalKzt, null);
  const total = sample(); total.analysis.cost.total -= 100; assert.ok(codes(total).includes('invalid_cost'));
  for (const mutate of [(i: OutcomeVariantInput) => i.analysis.cost.items.pop(),
    (i: OutcomeVariantInput) => i.analysis.cost.items.push({ ...i.analysis.cost.items[0], key: 'extra' })]) {
    const input = sample(); mutate(input);
    assert.equal(calculateOutcomeVariant(input).costPerExpectedTreeKzt, null);
  }
  const site = sample(); site.analysis.siteId = 'other-site'; assert.ok(codes(site).includes('analysis_site_mismatch'));
});

test('outcomes: ranking compares only eligible common-basis variants and preserves ties', () => {
  const a = calculateOutcomeVariant(sample());
  const cheaper = sample(); cheaper.id = 'econom'; cheaper.analysis.options.variant = 'econom'; refreshCost(cheaper);
  const b = calculateOutcomeVariant(cheaper);
  assert.equal(compareOutcomeVariants([a, b]).comparable, true);
  assert.deepEqual(compareOutcomeVariants([a, b]).bestVariantIds, ['econom']);
  assert.deepEqual(compareOutcomeVariants([a, { ...a, id: 'tie' }]).bestVariantIds, [a.id, 'tie']);
  const short = sample(); short.id = 'short'; short.analysis.options.careYears = 1; refreshCost(short);
  assert.equal(compareOutcomeVariants([a, calculateOutcomeVariant(short)]).comparable, false);
  const changed = sample(); changed.id = 'changed'; changed.rates.find(r => r.key === 'care.tree')!.value = 31; refreshCost(changed);
  const incompatible = compareOutcomeVariants([a, calculateOutcomeVariant(changed)]);
  assert.equal(incompatible.comparable, false); assert.deepEqual(incompatible.bestVariantIds, []);
  assert.deepEqual(incompatible.issues, [{ code: 'incompatible_basis' }]);
  assert.throws(() => compareOutcomeVariants([a, a]), OutcomeValidationError);
});

function cohortFixture(plantedOn: string | null = '2023-10-30') {
  const input = sample(); input.analysis.scheme.forEach(s => { s.quantity = 2; }); refreshCost(input);
  if (plantedOn) input.provenance.capturedAt = `${plantedOn}T00:00:00Z`;
  const forecast = createOutcomeSnapshot(input);
  const registry: RegisteredOutcomePlant[] = ['tree-a', 'tree-a', 'tree-b', 'tree-b'].map((speciesId, i) => ({
    plantId: `plant-${i}`, speciesId, siteId: input.site.id, kind: 'tree', plantedOn, isDemo: true,
  }));
  const cohort: OutcomeCohort = { id: 'cohort-test', siteId: input.site.id, plantedOn,
    plants: registry.map(({ plantId, speciesId }) => ({ plantId, speciesId })), forecast, provenance: provenance(), version: 1 };
  const inspection = (states: ('alive' | 'dead' | 'unknown')[], observedOn = '2026-10-30'): OutcomeInspection => ({
    id: 'inspection-test', cohortId: cohort.id, observedOn, version: 1, provenance: provenance('2026-10-30T12:00:00Z'),
    observations: states.map((state, i) => ({ plantId: `plant-${i}`, state, reportId: 'test-accepted-report', evidenceIds: [] })),
  });
  return { input, cohort, registry, inspection };
}
const AS_OF = '2026-10-30';
const rejectsCode = (run: () => unknown, code: string) => assert.throws(run, (e: unknown) => e instanceof OutcomeValidationError && e.code === code);

test('outcomes: forecast snapshot is detached, deeply frozen and unchanged after catalog/rate/model edits', () => {
  const input = sample(), before = structuredClone(input);
  const snapshot = createOutcomeSnapshot(input), saved = JSON.stringify(snapshot);
  assert.deepEqual(input, before); assert.equal(Object.isFrozen(input.analysis), false);
  assert.equal(Object.isFrozen(snapshot.analysis.options.excluded), true);
  assert.equal(Object.isFrozen(snapshot.catalog[0]), true);
  input.rates[0].value = 123; input.catalog[0].pricePerUnitKzt = 987;
  input.analysis.survival[0].y3 = 1; input.analysis.survivalModel = { ...input.analysis.survivalModel, version: 'changed' };
  input.provenance.evidenceIds.push('new-evidence');
  assert.equal(JSON.stringify(snapshot), saved);
  assert.deepEqual(JSON.parse(saved).outcome.expectedTreesY3, 10);
});

test('outcomes: cohort validates registry, full composition, dates and demo origin without mutating input', () => {
  const { cohort, registry } = cohortFixture(); const before = JSON.stringify({ cohort, registry });
  const created = createOutcomeCohort(cohort, registry, AS_OF);
  assert.equal(Object.isFrozen(created.plants[0]), true); assert.equal(JSON.stringify({ cohort, registry }), before);
  const duplicate = structuredClone(cohort); duplicate.plants.push(duplicate.plants[0]);
  rejectsCode(() => createOutcomeCohort(duplicate, registry, AS_OF), 'duplicate_id');
  rejectsCode(() => createOutcomeCohort(cohort, registry.slice(1), AS_OF), 'plant_not_registered');
  const wrong = structuredClone(registry); wrong[0].siteId = 'other';
  rejectsCode(() => createOutcomeCohort(cohort, wrong, AS_OF), 'plant_mismatch');
  const partial = structuredClone(cohort); partial.plants.pop();
  rejectsCode(() => createOutcomeCohort(partial, registry, AS_OF), 'cohort_mismatch');
  const date = structuredClone(registry); date[0].plantedOn = '2023-10-29';
  rejectsCode(() => createOutcomeCohort(cohort, date, AS_OF), 'planting_date_mismatch');
  date[0].plantedOn = null;
  rejectsCode(() => createOutcomeCohort(cohort, date, AS_OF), 'unconfirmed_planting_date');
  const retro = structuredClone(cohort); retro.plantedOn = '2023-10-29';
  rejectsCode(() => createOutcomeCohort(retro, registry, AS_OF), 'retrospective_forecast');
});

test('outcomes: partial inspection reports both coverage measures, not whole-cohort survival', () => {
  const { cohort, inspection } = cohortFixture();
  const result = summarizeOutcomeInspection(cohort, inspection(['alive', 'alive', 'dead', 'unknown']), AS_OF);
  assert.equal(result.total, 4); assert.equal(result.inspected, 4); assert.equal(result.assessed, 3);
  assert.equal(result.alive, 2); assert.equal(result.dead, 1); assert.equal(result.unknown, 1);
  close(result.inspectionCoveragePct, 100); close(result.assessmentCoveragePct, 75);
  close(result.survivalAmongAssessedPct, 200 / 3); assert.equal(result.wholeCohortSurvivalPct, null);
  const incomplete = summarizeOutcomeInspection(cohort, inspection(['alive', 'alive']), AS_OF);
  close(incomplete.inspectionCoveragePct, 50); close(incomplete.survivalAmongAssessedPct, 100);
  assert.equal(incomplete.notInspected, 2); assert.equal(incomplete.unknown, 2); assert.equal(incomplete.wholeCohortSurvivalPct, null);
});

test('outcomes: absent/unknown/empty inspections never produce fabricated 0% or 100% survival', () => {
  const { cohort, inspection } = cohortFixture();
  for (const check of [null, inspection([]), inspection(['unknown', 'unknown', 'unknown', 'unknown'])]) {
    const result = summarizeOutcomeInspection(cohort, check, AS_OF);
    assert.equal(result.unknown, 4); assert.equal(result.survivalAmongAssessedPct, null); assert.equal(result.wholeCohortSurvivalPct, null);
  }
  cohort.plants = []; cohort.forecast = null;
  const empty = summarizeOutcomeInspection(cohort, null, AS_OF);
  assert.equal(empty.total, 0); assert.equal(empty.inspectionCoveragePct, null); assert.equal(empty.wholeCohortSurvivalPct, null);
});

test('outcomes: repeated inspection is pure, duplicates/foreign plants and unsupported states are rejected', () => {
  const { cohort, inspection } = cohortFixture(); const check = inspection(['alive', 'dead']);
  const before = JSON.stringify({ cohort, check });
  assert.deepEqual(summarizeOutcomeInspection(cohort, check, AS_OF), summarizeOutcomeInspection(cohort, check, AS_OF));
  assert.equal(JSON.stringify({ cohort, check }), before);
  check.observations.push(check.observations[0]);
  rejectsCode(() => summarizeOutcomeInspection(cohort, check, AS_OF), 'duplicate_id');
  const foreign = inspection(['alive']); foreign.observations[0].plantId = 'foreign';
  rejectsCode(() => summarizeOutcomeInspection(cohort, foreign, AS_OF), 'foreign_plant');
  const status = inspection(['alive']); status.observations[0].state = 'overdue' as 'alive';
  rejectsCode(() => summarizeOutcomeInspection(cohort, status, AS_OF), 'invalid_observation_state');
});

test('outcomes: state requires a source and observations cannot precede planting or occur in the future', () => {
  const { cohort, inspection } = cohortFixture(); const check = inspection(['alive']); check.observations[0].reportId = null;
  rejectsCode(() => summarizeOutcomeInspection(cohort, check, AS_OF), 'missing_observation_source');
  check.observations[0].evidenceIds = ['evidence']; assert.equal(summarizeOutcomeInspection(cohort, check, AS_OF).alive, 1);
  rejectsCode(() => summarizeOutcomeInspection(cohort, inspection(['alive'], '2023-10-29'), AS_OF), 'inspection_before_planting');
  rejectsCode(() => summarizeOutcomeInspection(cohort, inspection(['alive'], '2026-10-31'), AS_OF), 'future_date');
  rejectsCode(() => summarizeOutcomeInspection(cohort, inspection(['alive'], '2026-02-30'), AS_OF), 'invalid_date');
});

test('outcomes: forecast uses the matching year, exact cohort and complete inspection', () => {
  const { cohort, inspection } = cohortFixture();
  for (const [year, expected] of [[2024, 85], [2025, 77.5], [2026, 70]]) {
    const check = inspection(['alive', 'alive', 'alive', 'dead'], `${year}-10-30`);
    const result = compareOutcomeForecast(cohort, check, AS_OF);
    assert.equal(result.comparable, true); assert.equal(result.horizonYears, year - 2023);
    close(result.expectedSurvivalPct, expected); close(result.expectedAlive, 4 * expected / 100);
    close(result.observedSurvivalPct, 75); close(result.differencePp, 75 - expected);
  }
});

test('outcomes: short-term or incomplete observations do not become model validation', () => {
  const { cohort, inspection } = cohortFixture();
  for (const date of ['2023-11-30', '2026-10-29']) {
    const r = compareOutcomeForecast(cohort, inspection(['alive', 'alive', 'alive', 'alive'], date), AS_OF);
    assert.equal(r.comparable, false); assert.equal(r.expectedAlive, null); assert.equal(r.differencePp, null);
    assert.deepEqual(r.issues, [{ code: 'unmatched_horizon' }]);
  }
  const partial = compareOutcomeForecast(cohort, inspection(['alive', 'alive']), AS_OF);
  close(partial.expectedAlive, 2.8); assert.equal(partial.observedSurvivalPct, null); assert.equal(partial.differencePp, null);
  assert.deepEqual(partial.issues, [{ code: 'incomplete_inspection' }]);
});

test('outcomes: missing date/forecast/inspection leaves facts available without a comparison', () => {
  const { cohort, inspection } = cohortFixture(null); cohort.forecast = null;
  const check = inspection(['alive', 'alive', 'alive', 'dead']);
  close(summarizeOutcomeInspection(cohort, check, AS_OF).wholeCohortSurvivalPct, 75);
  assert.equal(compareOutcomeForecast(cohort, check, AS_OF).comparable, false);
  assert.equal(compareOutcomeForecast(cohort, null, AS_OF).expectedAlive, null);
});

test('outcomes: February 29 anniversary is February 28 in a non-leap year', () => {
  const { cohort, inspection } = cohortFixture('2024-02-29');
  const result = compareOutcomeForecast(cohort, inspection(['alive', 'alive', 'dead', 'dead'], '2025-02-28'), AS_OF);
  assert.equal(result.horizonYears, 1); assert.equal(result.comparable, true); close(result.differencePp, -35);
});

test('outcomes: invalid stored probabilities cannot be hidden by a complete inspection', () => {
  const { cohort, inspection } = cohortFixture();
  const stored = JSON.parse(JSON.stringify(cohort)) as OutcomeCohort;
  (stored.forecast!.analysis.survival[0] as { y3: number | null }).y3 = null;
  const result = compareOutcomeForecast(stored, inspection(['alive', 'alive', 'alive', 'alive']), AS_OF);
  assert.equal(result.expectedAlive, null); assert.equal(result.differencePp, null);
  assert.ok(result.issues.some(i => i.code === 'invalid_probability'));
});

test('outcomes: mock provenance cannot claim real data or an invented version', () => {
  const input = sample(); input.provenance.isDemo = false;
  rejectsCode(() => calculateOutcomeVariant(input), 'demo_flag_required');
  input.provenance.isDemo = true; input.provenance.ratesVersion = -1;
  rejectsCode(() => calculateOutcomeVariant(input), 'invalid_version');
  input.provenance.ratesVersion = null; input.provenance.capturedAt = '2026-10-30';
  rejectsCode(() => calculateOutcomeVariant(input), 'invalid_timestamp');
});

test('outcomes: demonstration uses unmodified analyzeZone totals for three real tree-only scenarios', () => {
  const example = buildOutcomeExample();
  assert.equal(example.provenance.isDemo, true); assert.equal(example.provenance.ratesVersion, null);
  assert.equal(example.variants.length, 3); assert.equal(example.comparison.comparable, true);
  for (const { analysis, outcome } of example.variants) {
    assert.ok(analysis.scheme.length > 0 && analysis.scheme.every(r => r.tier === 'tree'));
    assert.equal(analysis.options.careYears, 3);
    assert.equal(outcome.cost.totalKzt, analysis.cost.total);
    assert.ok(outcome.costPerExpectedTreeKzt !== null && Number.isFinite(outcome.costPerExpectedTreeKzt));
  }
});

test('outcomes: demo cost assumptions do not reclassify genuine registered plants or field observations', () => {
  const { cohort, registry, inspection } = cohortFixture();
  cohort.provenance = { ...cohort.provenance, source: 'api', dataClass: 'real', isDemo: false };
  registry.forEach(p => { p.isDemo = false; });
  const stored = createOutcomeCohort(cohort, registry, AS_OF);
  assert.equal(stored.forecast!.outcome.isDemo, true); assert.equal(stored.provenance.isDemo, false);
  const check = inspection(['alive', 'alive', 'alive', 'dead']);
  check.provenance = { ...check.provenance, source: 'api', dataClass: 'real', isDemo: false };
  const result = summarizeOutcomeInspection(stored, check, AS_OF);
  assert.equal(result.isDemo, false); assert.equal(result.dataClass, 'real');
});
