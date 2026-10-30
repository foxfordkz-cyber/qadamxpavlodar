import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decisionPlans, parseDecisionLabInput, seasonalWaterM3 } from '../src/shared/analytics/decisionLab';
import { analyzeZone, type ZoneAnalysis } from '../src/shared/analytics/plan';
import { ratesMap, DEFAULT_RATES } from '../src/shared/analytics/rates';
import { seed, catalog } from '../src/shared/api/mock/fixtures';
import { createApi } from '../src/shared/api/api';
import { createMockTransport, setMockControls } from '../src/shared/api/mock/server';

const sites = seed().sites;
const rates = ratesMap(DEFAULT_RATES);
const input = { sites, catalog, rates, budgetKzt: 50e6, waterLimitM3: null, watering: 'regular' as const };
const regular = decisionPlans(input);
const ids = (result: ReturnType<typeof decisionPlans>) => result.plans.map(p => p.zones.map(z => z.siteId));

test('decision lab: three distinct demo portfolios, budget respected and deterministic without mutation', () => {
  const before = JSON.stringify(input);
  assert.equal(regular.plans.length, 3);
  assert.equal(new Set(regular.plans.map(p => p.zones.map(z => z.siteId).sort().join(','))).size, 3);
  for (const p of regular.plans) {
    assert.ok(p.zones.length > 0);
    assert.ok(p.baseline.spentKzt <= input.budgetKzt);
    assert.equal(p.baseline.remainingKzt, input.budgetKzt - p.baseline.spentKzt);
    assert.equal(new Set(p.zones.map(z => z.siteId)).size, p.zones.length);
    assert.deepEqual(p.scenario, p.baseline);
    assert.equal(p.resilience, null);
  }
  assert.deepEqual(decisionPlans(input), regular);
  assert.deepEqual(decisionPlans({ ...input, sites: [...sites].reverse() }), regular);
  assert.equal(JSON.stringify(input), before);
});

test('decision lab: seasonal water uses tree/shrub norms even with flowers, independently calculated', () => {
  const analysis: Pick<ZoneAnalysis, 'scheme' | 'care'> = {
    scheme: [{ speciesId: 'tree', tier: 'tree', quantity: 10, locked: false },
      { speciesId: 'shrub', tier: 'shrub', quantity: 20, locked: false },
      { speciesId: 'flower', tier: 'flower', quantity: 100, locked: false }],
    care: [{ month: 5, operation: 'Полив', visits: 4, detail: '', waterLitersPerVisit: null },
      { month: 6, operation: 'Полив', visits: 6, detail: '', waterLitersPerVisit: null },
      { month: 10, operation: 'Влагозарядковый полив', visits: 1, detail: '', waterLitersPerVisit: null }],
  };
  // 10 visits × (10 trees × 50 L + 20 shrubs × 15 L) / 1000 = 8 m³.
  assert.equal(seasonalWaterM3(analysis, { 'care.water.tree': 50, 'care.water.shrub': 15 }), 8);
  assert.equal(seasonalWaterM3(analysis, { 'care.water.tree': null, 'care.water.shrub': 15 }), null);
  assert.equal(seasonalWaterM3({ ...analysis, care: [] }, {}), 0);
  assert.equal(seasonalWaterM3(analysis, { 'care.water.tree': 0, 'care.water.shrub': 0 }), 0);
});

test('decision lab: actual flowering schemes have nonzero known water', () => {
  const a = analyzeZone(sites[0], catalog, rates, { variant: 'optimal', watering: 'regular' });
  assert.ok(a.scheme.some(row => row.tier === 'flower'));
  assert.ok(a.care.some(row => row.operation === 'Полив' && row.waterLitersPerVisit === null));
  assert.ok(seasonalWaterM3(a, rates)! > 0);
});

test('decision lab: baseline water limit, zero limit, and missing norms never select over-limit zones', () => {
  for (const limit of [0, 100, 500, 1000]) {
    const result = decisionPlans({ ...input, waterLimitM3: limit });
    for (const p of result.plans) {
      assert.ok(p.baseline.spentKzt <= input.budgetKzt);
      assert.ok(p.baseline.waterM3 !== null && p.baseline.waterM3 <= limit);
    }
  }
  const missing = { ...input, rates: { ...rates, 'care.water.tree': null, 'care.water.shrub': null } };
  assert.ok(decisionPlans({ ...missing, waterLimitM3: 1000 }).plans.every(p => !p.zones.length));
  assert.ok(decisionPlans(missing).plans.every(p => p.scenario.waterM3 === null));
});

test('decision lab: rare/none preserve zone membership, recalculate water/survival, and report deltas', () => {
  for (const watering of ['rare', 'none'] as const) {
    const result = decisionPlans({ ...input, watering });
    assert.deepEqual(ids(result), ids(regular));
    for (const p of result.plans) {
      const b = regular.plans.find(item => item.id === p.id)!;
      assert.deepEqual(p.baseline, b.baseline);
      assert.ok(p.scenario.survivalY3! < b.baseline.survivalY3!);
      assert.ok(p.scenario.waterM3! < b.baseline.waterM3!);
      if (watering === 'none') { assert.equal(p.scenario.waterM3, 0); assert.equal(p.delta.waterPct, -100); }
      assert.equal(p.delta.survivalPp, p.scenario.survivalY3! - b.baseline.survivalY3!);
      assert.equal(p.delta.co2Pct, (p.scenario.co2t20 - b.baseline.co2t20) / b.baseline.co2t20 * 100);
      const analyses = p.zones.map(z => analyzeZone(sites.find(s => s.id === z.siteId)!, catalog, rates, { variant: 'optimal', watering }));
      const quantities = analyses.map(a => a.scheme.reduce((sum, row) => sum + row.quantity, 0));
      const weighted = analyses.reduce((sum, a, i) => sum + quantities[i] * a.survivalAvg.y3, 0) / quantities.reduce((a, b) => a + b, 0);
      assert.equal(p.scenario.survivalY3, weighted);
      assert.equal(p.scenario.spentKzt, analyses.reduce((sum, a) => sum + a.cost.total, 0));
    }
  }
});

test('decision lab: resilience compares losses, and nearly equal/identical plans are not crowned', () => {
  const changed = decisionPlans({ ...input, watering: 'none' });
  const ranked = [...changed.plans].sort((a, b) => b.delta.survivalPp! - a.delta.survivalPp!);
  if (ranked[0].delta.survivalPp! - ranked[1].delta.survivalPp! < 1) {
    assert.ok(changed.plans.every(p => p.resilience !== 'best'));
    assert.equal(ranked[0].resilience, 'similar');
  } else assert.equal(ranked[0].resilience, 'best');
  const same = decisionPlans({ ...input, sites: [sites[0]], budgetKzt: 1e12, watering: 'rare' });
  assert.ok(same.plans.every(p => p.resilience === 'similar'));
});

test('decision lab: empty/tiny budget yields null survival and no false resilience winner', () => {
  for (const result of [decisionPlans({ ...input, budgetKzt: 1 }), decisionPlans({ ...input, sites: [], watering: 'none' })]) {
    for (const p of result.plans) {
      assert.equal(p.zones.length, 0); assert.equal(p.scenario.survivalY3, null);
      assert.equal(p.resilience, null); assert.equal(p.delta.co2Pct, null); assert.equal(p.delta.waterPct, null);
    }
    assert.ok(!JSON.stringify(result).includes('NaN'));
  }
});

test('decision lab: strict input rejects nonfinite, negative, unsupported or extra fields', () => {
  const good = { budgetKzt: 1, waterLimitM3: null, watering: 'regular' };
  for (const body of [null, [], {}, { ...good, budgetKzt: 0 }, { ...good, budgetKzt: Infinity },
    { ...good, budgetKzt: '50' }, { ...good, waterLimitM3: -1 }, { ...good, waterLimitM3: NaN },
    { ...good, watering: 'winter' }, { ...good, watering: ['regular'] }, { ...good, extra: 1 }]) assert.throws(() => parseDecisionLabInput(body));
  assert.deepEqual(parseDecisionLabInput(good), good);
});

test('decision lab: mock method uses the same calculation and read-only role boundary', async () => {
  const api = createApi(createMockTransport());
  try {
    setMockControls({ role: 'viewer', latencyMs: 0 });
    assert.deepEqual(await api.decisionLab({ budgetKzt: 50e6, waterLimitM3: null, watering: 'regular' }), regular);
    setMockControls({ role: 'admin' });
    assert.equal((await api.decisionLab({ budgetKzt: 50e6, waterLimitM3: null, watering: 'rare' })).plans.length, 3);
    setMockControls({ role: 'worker' });
    await assert.rejects(api.decisionLab({ budgetKzt: 50e6, waterLimitM3: null, watering: 'regular' }), (e: any) => e.status === 403);
  } finally { setMockControls({ role: 'coordinator', latencyMs: 250 }); }
});
