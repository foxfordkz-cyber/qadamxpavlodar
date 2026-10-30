import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { seed } from '../src/shared/api/mock/fixtures';
import { ensureOutcomeDemo, outcomeRegistry, OUTCOME_DEMO_SITE, readMockOutcomes } from '../src/shared/api/mock/outcomes';
import { createOutcomeCohort, createOutcomeSnapshot } from '../src/shared/analytics/outcomes';
import { createOutcomesClient, type OutcomesClient } from '../src/shared/api/outcomesClient';
import { createApi } from '../src/shared/api/api';
import { ApiError, type Transport } from '../src/shared/api/transport';
import { loadOutcomePlans, outcomeDelta, outcomeError, outcomeNumber, selectOutcomeInspection } from '../src/features/coordinator/outcomes/pageModel';
import { outcomeRequest } from '../src/features/coordinator/outcomes/resource';
import { InspectionView, SnapshotView, VariantCard } from '../src/features/coordinator/outcomes/OutcomeViews';
import { getLang, setLang, t } from '../src/shared/i18n';
import { species } from '../src/shared/api/mock/species';
import { DEFAULT_RATES } from '../src/shared/analytics/rates';
import { createMockTransport, mockControls, resetMockDb, setMockControls } from '../src/shared/api/mock/server';

const fixture = () => readMockOutcomes(seed(), OUTCOME_DEMO_SITE, '2026-10-30');
const full = 'outcome-demo-full', partial = 'outcome-demo-partial', undated = 'outcome-demo-undated';
const inspect = (cohortId: string, suffix = 'annual') => selectOutcomeInspection(fixture(), OUTCOME_DEMO_SITE, cohortId, `${cohortId}-${suffix}`);
const renderInspection = (cohortId: string, suffix = 'annual') => renderToStaticMarkup(createElement(InspectionView, { data: fixture(), cohortId, inspectionId: `${cohortId}-${suffix}` }));
const tick = () => new Promise(resolve => setImmediate(resolve));
function fakeApi() {
  const db = seed();
  return { kind: 'mock' as const, site: async (id: string) => structuredClone(db.sites.find(s => s.id === id)!),
    species: async () => structuredClone(species), rates: async () => ({ rates: structuredClone(DEFAULT_RATES), version: 1 }) };
}

test('UI: null and zero remain different; positive deltas have a sign', () => {
  assert.equal(outcomeNumber(null), t('outcomePage.noData'));
  assert.equal(outcomeNumber(0), '0');
  assert.equal(outcomeNumber(NaN), t('outcomePage.noData'));
  assert.match(outcomeDelta(1.8), /^\+/);
  assert.doesNotMatch(outcomeDelta(0), /^\+/);
});
test('demo: all cohort plants exist in the shared registry and implemented projects', () => {
  const db = seed(); ensureOutcomeDemo(db);
  const data = readMockOutcomes(db, OUTCOME_DEMO_SITE, '2026-10-30');
  assert.equal(data.cohorts.length, 3);
  for (const cohort of data.cohorts) {
    assert.ok(cohort.provenance.isDemo);
    assert.ok(cohort.plants.every(link => db.plants.some(p => p.id === link.plantId && p.isDemo)));
    createOutcomeCohort(JSON.parse(JSON.stringify(cohort)), outcomeRegistry(db), data.asOf);
  }
  assert.ok(data.inspections.every(i => i.provenance.isDemo && i.observations.every(o => o.evidenceIds.includes('ev-demo-outcomes-history'))));
});
test('demo: seeding is additive and idempotent, including after JSON persistence', () => {
  const db = seed(), oldPlants = structuredClone(db.plants), oldProjects = structuredClone(db.projects);
  ensureOutcomeDemo(db);
  assert.deepEqual(db.plants.slice(0, oldPlants.length), oldPlants);
  assert.deepEqual(db.projects.slice(0, oldProjects.length), oldProjects);
  const saved = JSON.stringify(db);
  ensureOutcomeDemo(db); assert.equal(JSON.stringify(db), saved);
  const restored = JSON.parse(saved); ensureOutcomeDemo(restored); assert.equal(JSON.stringify(restored), saved);
});
test('complete annual inspection exposes comparison from shared analytics', () => {
  const result = inspect(full);
  assert.equal(result.summary.unknown, 0);
  assert.equal(result.comparison.comparable, true);
  assert.equal(result.comparison.horizonYears, 1);
  assert.equal(result.comparison.differencePp, result.summary.wholeCohortSurvivalPct! - result.comparison.expectedSurvivalPct!);
  assert.match(renderInspection(full), /data-testid="outcome-comparison"/);
});
test('partial inspection keeps explicit unknown and uninspected apart; no whole-party result', () => {
  const result = inspect(partial);
  assert.ok(result.summary.inspected > result.summary.assessed);
  assert.ok(result.summary.notInspected > 0);
  assert.ok(result.summary.inspectionCoveragePct! > result.summary.assessmentCoveragePct!);
  assert.equal(result.summary.wholeCohortSurvivalPct, null);
  assert.equal(result.comparison.differencePp, null);
  const html = renderInspection(partial);
  assert.doesNotMatch(html, /data-testid="outcome-comparison"/);
  assert.ok(html.includes(t('outcomePage.issue.incomplete_inspection')));
});
test('unknown planting date does not borrow the implementation date or reconstruct a forecast', () => {
  const result = inspect(undated);
  assert.equal(result.cohort.plantedOn, null); assert.equal(result.cohort.forecast, null);
  assert.equal(result.summary.dead, 0);
  assert.equal(result.summary.wholeCohortSurvivalPct, 100);
  assert.equal(result.comparison.differencePp, null);
  assert.ok(renderInspection(undated).includes(t('outcomePage.issue.missing_planting_date')));
  assert.match(renderInspection(undated), /data-testid="outcome-stat-dead"><dt>.*?<\/dt><dd>0<\/dd>/);
});
test('non-anniversary inspection cannot be compared with a yearly forecast', () => {
  const result = inspect(full, 'early');
  assert.equal(result.comparison.comparable, false); assert.equal(result.comparison.expectedSurvivalPct, null);
  assert.ok(renderInspection(full, 'early').includes(t('outcomePage.issue.unmatched_horizon')));
});
test('no inspection means all states unknown, not zero percent survival', () => {
  const data = fixture(), result = selectOutcomeInspection(data, OUTCOME_DEMO_SITE, full, null);
  assert.equal(result.summary.unknown, result.summary.total); assert.equal(result.summary.alive, 0);
  assert.equal(result.summary.survivalAmongAssessedPct, null); assert.equal(result.comparison.differencePp, null);
});
test('selection cannot display a previous zone or another cohort inspection', () => {
  const data = fixture();
  assert.throws(() => selectOutcomeInspection(data, 'another-site', full, `${full}-annual`));
  assert.throws(() => selectOutcomeInspection(data, OUTCOME_DEMO_SITE, partial, `${full}-annual`));
  assert.throws(() => selectOutcomeInspection(data, OUTCOME_DEMO_SITE, 'deleted-cohort', null));
});
test('tree-only comparison uses analyzeZone and identical data for all variants', async () => {
  const data = await loadOutcomePlans(fakeApi(), OUTCOME_DEMO_SITE, true);
  assert.equal(data.comparison.comparable, true);
  assert.ok(data.inputs.every(i => i.analysis.options.careYears === 3 && i.analysis.scheme.every(r => r.tier === 'tree')));
  assert.equal(new Set(data.variants.map(v => v.comparisonKey)).size, 1);
  assert.ok(data.variants.every(v => v.expectedTreesY3! > 0 && v.costPerExpectedTreeKzt! > 0));
  const wrongSite = fakeApi();
  const actual = await wrongSite.site(OUTCOME_DEMO_SITE);
  wrongSite.site = async () => ({ ...actual, id: 'another-zone' });
  await assert.rejects(loadOutcomePlans(wrongSite, OUTCOME_DEMO_SITE, true), /analysis_site_mismatch/);
});
test('mixed planting does not compete for cheapest surviving tree', async () => {
  const data = await loadOutcomePlans(fakeApi(), OUTCOME_DEMO_SITE, false);
  const mixed = data.variants.filter(v => v.cost.scope === 'unallocated-mixed-planting');
  assert.ok(mixed.length > 0);
  for (const v of mixed) {
    assert.equal(v.costPerExpectedTreeKzt, null);
    assert.ok(!data.comparison.bestVariantIds.includes(v.id));
    assert.ok(renderToStaticMarkup(createElement(VariantCard, { variant: v, best: false })).includes(t('outcomes.issue.mixed')));
  }
});
test('missing rate gives missing total and no winner, never a free service', async () => {
  const api = fakeApi(); api.rates = async () => ({ rates: DEFAULT_RATES.filter(r => r.key !== 'work.tree'), version: 1 });
  const data = await loadOutcomePlans(api, OUTCOME_DEMO_SITE, true);
  assert.equal(data.comparison.comparable, false); assert.deepEqual(data.comparison.bestVariantIds, []);
  assert.ok(data.variants.every(v => v.cost.totalKzt === null && v.costPerExpectedTreeKzt === null));
});
test('snapshot view is immutable when live rates and catalog change', async () => {
  const { inputs } = await loadOutcomePlans(fakeApi(), OUTCOME_DEMO_SITE, true);
  const snapshot = createOutcomeSnapshot(inputs[0]);
  const before = renderToStaticMarkup(createElement(SnapshotView, { snapshot }));
  inputs[0].rates[0].value = 999999; inputs[0].catalog[0].nameRu = 'Changed live catalog';
  assert.equal(renderToStaticMarkup(createElement(SnapshotView, { snapshot })), before);
});
test('RU/KK: same observations and numbers, translated service phrases and demo label', () => {
  const initial = getLang();
  try {
    setLang('ru'); const ru = renderInspection(full);
    setLang('kk'); const kk = renderInspection(full);
    assert.ok(kk.includes(t('outcomePage.demo'))); assert.ok(kk.includes(t('outcomePage.notAccuracy')));
    for (const phrase of ['Что показал осмотр', 'Приживаемость всей партии', 'Можно ли сравнить', 'Состояние неизвестно', 'Отклонение от прогноза', 'Источник осмотра']) assert.ok(!kk.includes(phrase), phrase);
    const stats = (html: string) => [...html.matchAll(/<dd>(.*?)<\/dd>/g)].map(m => m[1].replace(/п\.п\.|п\.т\.|\s/g, ''));
    assert.deepEqual(stats(kk), stats(ru));
  } finally { setLang(initial); }
});
test('provenance: demo forecast prices do not relabel real field observations', () => {
  const data = fixture();
  data.registry = data.registry.map(p => ({ ...p, isDemo: false }));
  data.cohorts = data.cohorts.map(c => ({ ...c, provenance: { ...c.provenance, source: 'api', dataClass: 'real', isDemo: false } }));
  data.inspections = data.inspections.map(i => ({ ...i, provenance: { ...i.provenance, source: 'api', dataClass: 'real', isDemo: false } }));
  const selected = selectOutcomeInspection(data, OUTCOME_DEMO_SITE, full, `${full}-annual`);
  assert.equal(selected.summary.isDemo, false); assert.equal(selected.summary.dataClass, 'real');
  assert.equal(selected.cohort.forecast!.outcome.isDemo, true);
});
test('production adapter uses the published read model; errors never become mock', async () => {
  const calls: string[] = [];
  const transport: Transport = { kind: 'api', async request(_method, path) { calls.push(path); throw new ApiError(503, 'offline', 'offline'); } };
  const client = createOutcomesClient(transport);
  assert.equal(client.available, true);
  await assert.rejects(client.list('site'), (e: ApiError) => e.status === 503);
  await assert.rejects(client.saveForecast('site', { options: {}, siteVersion: 1, ratesVersion: 1 }, 'key'), (e: ApiError) => e.code === 'outcomes_unsupported_plan');
  assert.deepEqual(calls, ['/outcomes/sites/site']);
});

test('inspection confirmation: only non-demo report-backed API observations receive the RU/KK manual label', () => {
  const initial = getLang();
  try {
    const apiData = fixture();
    apiData.registry = apiData.registry.map(p => ({ ...p, isDemo: false }));
    apiData.cohorts = apiData.cohorts.map(c => ({ ...c, provenance: { ...c.provenance, source: 'api', dataClass: 'real', isDemo: false } }));
    apiData.inspections = apiData.inspections.map(i => ({ ...i,
      provenance: { ...i.provenance, source: 'api', dataClass: 'real', isDemo: false },
      observations: i.observations.map(o => ({ ...o, reportId: 'accepted-inspect-report' })),
    }));
    const render = (data: typeof apiData, inspectionId: string | null = `${full}-annual`) =>
      renderToStaticMarkup(createElement(InspectionView, { data, cohortId: full, inspectionId }));
    for (const lang of ['ru', 'kk'] as const) {
      setLang(lang);
      const actual = render(apiData);
      assert.ok(actual.includes(t('outcomePage.manualConfirmation')));
      assert.ok(actual.includes(t('outcomePage.manualConfirmationNote')));
      const counts = (html: string) => [...html.matchAll(/<dd>(.*?)<\/dd>/g)].map(m => m[1]);
      assert.deepEqual(counts(actual), counts(render(fixture())), 'Explanation must not change counts');
      assert.ok(!render(fixture()).includes('outcome-manual-confirmation'), 'Synthetic mock is not expert confirmation');
      assert.ok(!render(apiData, null).includes('outcome-manual-confirmation'));
      for (const provenance of [
        { source: 'mock' as const, dataClass: 'real' as const, isDemo: false },
        { source: 'api' as const, dataClass: 'demo' as const, isDemo: true },
        { source: 'api' as const, dataClass: 'demo' as const, isDemo: false },
      ]) {
        const data = { ...apiData, inspections: apiData.inspections.map(i => ({ ...i, provenance: { ...i.provenance, ...provenance } })) };
        assert.ok(!render(data).includes('outcome-manual-confirmation'));
      }
      const noReports = { ...apiData, inspections: apiData.inspections.map(i => ({ ...i, observations: i.observations.map(o => ({ ...o, reportId: null })) })) };
      assert.ok(!render(noReports).includes('outcome-manual-confirmation'));
    }
  } finally { setLang(initial); }
});
test('API snapshot adapter sends stable ID and both versions, never a client-computed forecast', async () => {
  const calls: unknown[] = [];
  const client = createOutcomesClient({ kind: 'api', async request(method, path, options) { calls.push({ method, path, options }); return { data: null } as never; } });
  const plans = await loadOutcomePlans(fakeApi(), OUTCOME_DEMO_SITE, true);
  await client.saveForecast(OUTCOME_DEMO_SITE, { options: plans.inputs[0].analysis.options, siteVersion: 2, ratesVersion: 3 }, 'stable');
  assert.deepEqual(calls, [{ method: 'POST', path: '/outcomes/snapshots', options: { idempotencyKey: 'stable',
    body: { id: 'outcome-stable', siteId: OUTCOME_DEMO_SITE, expectedVersion: 2, expectedRatesVersion: 3, variant: 'econom' } } }]);
});
test('a connected backend failure propagates, without creating demo data', async () => {
  const error = new ApiError(503, 'network', 'not shown');
  const backend: OutcomesClient = { available: true, async list() { throw error; }, async saveForecast() { throw error; } };
  const client = createOutcomesClient({ kind: 'api', async request() { throw new Error('unexpected'); } }, backend);
  await assert.rejects(client.list('site'), e => e === error);
  assert.equal(outcomeError(error), t('state.network'));
});
test('cancelled requests cannot restore old-zone data or overwrite a new error', async () => {
  let resolve!: (value: string) => void;
  const published: unknown[] = [];
  const cancel = outcomeRequest(() => new Promise<string>(r => { resolve = r; }), state => published.push(state));
  await tick(); cancel();
  outcomeRequest(async () => { throw new Error('new zone failure'); }, state => published.push(state));
  await tick(); resolve('old zone'); await tick();
  assert.equal(published.length, 3);
  assert.equal((published.at(-1) as { data: unknown }).data, null);
});
test('reload clears previously successful data before a failed request', async () => {
  const states: { data: string | null; error: unknown; loading: boolean }[] = [];
  outcomeRequest(async () => 'old data', s => states.push(s)); await tick();
  outcomeRequest(async () => { throw new Error('offline'); }, s => states.push(s)); await tick();
  assert.deepEqual(states.map(s => s.data), [null, 'old data', null, null]);
});
test('mock forecast save: idempotent, unchanged after rate edit, and role checked', async () => {
  const previous = { ...mockControls };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const stored = new Map<string, string>();
  let rejectStorage = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { if (rejectStorage) throw new Error('quota'); stored.set(key, value); },
  } });
  try {
    resetMockDb(); setMockControls({ role: 'coordinator', networkDown: false, latencyMs: 0 });
    const api = createApi(createMockTransport());
    const plans = await loadOutcomePlans(api, OUTCOME_DEMO_SITE, true);
    const input = { options: plans.inputs[0].analysis.options, siteVersion: plans.inputs[0].site.version, ratesVersion: 1 };
    const first = await api.outcomes.saveForecast(OUTCOME_DEMO_SITE, input, 'test-save');
    const second = await api.outcomes.saveForecast(OUTCOME_DEMO_SITE, input, 'test-save');
    assert.deepEqual(second, first);
    assert.equal((await api.outcomes.list(OUTCOME_DEMO_SITE)).forecasts.filter(f => f.id === first.id).length, 1);
    rejectStorage = true;
    const count = (await api.outcomes.list(OUTCOME_DEMO_SITE)).forecasts.length;
    await assert.rejects(api.outcomes.saveForecast(OUTCOME_DEMO_SITE, input, 'quota'), (e: ApiError) => e.code === 'outcomes_storage');
    assert.equal((await api.outcomes.list(OUTCOME_DEMO_SITE)).forecasts.length, count);
    rejectStorage = false;
    setMockControls({ role: 'admin' });
    await api.patchRate({ key: 'work.tree', value: 12345, source: 'test', expectedVersion: 1 });
    assert.deepEqual((await api.outcomes.list(OUTCOME_DEMO_SITE)).forecasts.find(f => f.id === first.id), first);
    for (const role of ['admin', 'viewer', 'worker'] as const) {
      setMockControls({ role });
      await assert.rejects(api.outcomes.saveForecast(OUTCOME_DEMO_SITE, input, `test-${role}`), (e: ApiError) => e.status === 403);
    }
    setMockControls({ role: 'coordinator' });
    await assert.rejects(api.outcomes.saveForecast(OUTCOME_DEMO_SITE, input, 'stale'), (e: ApiError) => e.status === 409);
    setMockControls({ networkDown: true });
    await assert.rejects(api.outcomes.list(OUTCOME_DEMO_SITE), (e: ApiError) => e.status === 0);
  } finally {
    resetMockDb(); setMockControls(previous);
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
