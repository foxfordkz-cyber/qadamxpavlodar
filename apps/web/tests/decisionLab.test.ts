import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decisionPlans, parseDecisionLabInput, seasonalWaterM3, selectDecisionZones, waterStress, evaluateDecisionPlans, labAlternatives, applyLabAlternative } from '../src/shared/analytics/decisionLab';
import { analyzeZone, type ZoneAnalysis } from '../src/shared/analytics/plan';
import { ratesMap, DEFAULT_RATES } from '../src/shared/analytics/rates';
import { seed, catalog } from '../src/shared/api/mock/fixtures';
import { createApi } from '../src/shared/api/api';
import { createMockTransport, setMockControls } from '../src/shared/api/mock/server';

import { decisionLabData } from '../src/shared/api/decisionLabData';
const sites = seed().sites;
const rates = ratesMap(DEFAULT_RATES);
const input = { ...decisionLabData(sites, catalog, DEFAULT_RATES, 'mock', 1, '2026-10-30T12:00:00+05:00'), budgetKzt: 50e6, waterLimitM3: null, watering: 'regular' as const };
const withRates = (values: Record<string, number | null>) => ({ ...input, rateEntries: input.rateEntries.map(r => Object.hasOwn(values, r.key) ? { ...r, value: values[r.key] } : r) });
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
  const missing = withRates({ 'care.water.tree': null, 'care.water.shrub': null });
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
      const analyses = p.zones.map(z => analyzeZone(sites.find(s => s.id === z.siteId)!, catalog, rates, { variant: 'optimal', careYears: 3, watering }));
      const treeRows = analyses.flatMap(a => a.scheme.filter(r => r.tier === 'tree').map(row => ({quantity: row.quantity, y3: a.survival.find(s => s.speciesId === row.speciesId)!.y3})));
      const expected = treeRows.reduce((sum, row) => sum + row.quantity * row.y3 / 100, 0);
      const treeCount = treeRows.reduce((sum, row) => sum + row.quantity, 0);
      assert.ok(Math.abs(p.scenario.expectedTreesY3! - expected) < 1e-9);
      assert.ok(Math.abs(p.scenario.survivalY3! - expected / treeCount * 100) < 1e-9);
      assert.deepEqual(p.zones.map(z => z.analysis.scheme), b.zones.map(z => z.analysis.scheme));
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
  assert.deepEqual(parseDecisionLabInput(good), { ...good, goal: 'balanced' });
});

test('decision lab: mock method uses the same calculation and read-only role boundary', async () => {
  const api = createApi(createMockTransport());
  try {
    setMockControls({ role: 'viewer', latencyMs: 0 });
    assert.deepEqual((await api.decisionLab({ budgetKzt: 50e6, waterLimitM3: null, watering: 'regular' })).plans, regular.plans);
    setMockControls({ role: 'admin' });
    assert.equal((await api.decisionLab({ budgetKzt: 50e6, waterLimitM3: null, watering: 'rare' })).plans.length, 3);
    setMockControls({ role: 'worker' });
    await assert.rejects(api.decisionLab({ budgetKzt: 50e6, waterLimitM3: null, watering: 'regular' }), (e: any) => e.status === 403);
  } finally { setMockControls({ role: 'coordinator', latencyMs: 250 }); }
});

test('decision lab: independent A+B selection, expected trees and 30% water deficit', () => {
  const rows = [
    {siteId:'A',cost:10e6,water:100,expectedTrees:100*.8,co2:1,social:50,priority:50,goalRank:0},
    {siteId:'B',cost:8e6,water:60,expectedTrees:80*.9,co2:1,social:50,priority:50,goalRank:0},
    {siteId:'C',cost:12e6,water:140,expectedTrees:120*.6,co2:1,social:50,priority:50,goalRank:0},
  ];
  const result = selectDecisionZones(rows, 'survival', 18e6, 160);
  assert.deepEqual(new Set(result.selected), new Set(['A','B']));
  const chosen = rows.filter(r => result.selected.includes(r.siteId));
  assert.equal(chosen.reduce((s,r)=>s+r.cost,0),18e6);
  assert.equal(chosen.reduce((s,r)=>s+r.expectedTrees,0),152);
  assert.deepEqual(waterStress(160,160,30), {availableM3:112,deficitM3:48,coveragePct:70});
  assert.equal(waterStress(0,0,30).coveragePct,null);
  assert.equal(waterStress(null,160,30).deficitM3,null);
  assert.equal(waterStress(160,null,30).availableM3,null);
  assert.throws(()=>waterStress(100,100,101));
  assert.deepEqual(selectDecisionZones([...rows].reverse(),'survival',18e6,160), result);
  assert.deepEqual(rows.map(r=>r.water),[100,60,140]);
});

test('decision lab: three-year line items and tree expectations independently audited', () => {
  for (const p of regular.plans) {
    let expected = 0, total = 0;
    for (const z of p.zones) {
      const a = z.analysis;
      assert.equal(a.options.careYears,3);
      let material=0, work=0, care=0, reserve=0;
      for(const row of a.scheme) {
        const sp = catalog.find(s=>s.id===row.speciesId)!;
        const price = sp.pricePerUnitKzt ?? rates[`price.${row.tier}`]!;
        material += row.quantity*price;
        work += row.quantity*rates[`work.${row.tier}`]!;
        care += 3*row.quantity*rates[`care.${row.tier}`]!;
        const prediction = a.survival.find(s=>s.speciesId===row.speciesId)!;
        reserve += row.quantity*price*(1-prediction.y1/100);
        if(row.tier==='tree') expected += row.quantity*prediction.y3/100;
      }
      const salinity = ['medium','high'].includes(a.facts.soil.salinity);
      const prep = a.facts.areaM2!*.6*(rates['soil.prep']!+(salinity?rates['soil.salinity']!:0));
      total += material+work+material*rates['delivery.share']!/100+care+reserve+prep;
    }
    assert.ok(Math.abs(expected-p.baseline.expectedTreesY3!)<1e-8);
    assert.ok(Math.abs(total-p.baseline.spentKzt!)<.005);
    assert.equal(p.baseline.costPerExpectedTreeKzt,null); // Real mixed scheme: never attribute flowers' costs to trees.
  }
});

test('decision lab: missing prices exclude zones; zero expected/unknown cost never win', () => {
  const missing = decisionPlans(withRates({'care.tree':null}));
  assert.ok(missing.plans.every(p=>p.zones.length===0 && p.excluded.some(e=>e.reason==='missingCost')));
  const row = {siteId:'x',cost:null,water:1,expectedTrees:10,co2:1,social:100,priority:100,goalRank:0};
  assert.deepEqual(selectDecisionZones([row],'survival',100,null).selected,[]);
  assert.deepEqual(selectDecisionZones([{...row,cost:0,expectedTrees:0}],'survival',100,null).selected,[]);
  assert.deepEqual(selectDecisionZones([{...row,cost:0}],'survival',100,null).selected,['x']);
});

test('decision lab: stress uses the frozen rates/catalogue and does not mutate the response', () => {
  const json=JSON.stringify(regular);
  const changed=structuredClone(input); changed.rateEntries.find(r=>r.key==='care.tree')!.value=999999;
  const scenario=evaluateDecisionPlans(regular,'rare');
  assert.equal(JSON.stringify(regular),json);
  assert.deepEqual(scenario.plans.map(p=>p.zones.map(z=>z.analysis.scheme)),regular.plans.map(p=>p.zones.map(z=>z.analysis.scheme)));
  assert.deepEqual(scenario.basis,regular.basis);
  assert.notDeepEqual(decisionPlans(changed).plans,regular.plans);
});

test('decision lab: school names are not evidence, typed OSM proof is deduplicated and common to all strategies', () => {
  const site = {...sites[0], context:{...sites[0].context,socialWithin400m:['School 123']}};
  const noProof=decisionPlans({...input,sites:[site],social:{},goal:'schools'});
  assert.ok(noProof.assumptions.includes('lab.noSchools'));
  assert.ok(noProof.plans.every(p=>p.zones[0].social.length===0));
  const proof={id:'osm-school',kind:'school' as const,name:null,distanceM:100,source:'https://www.openstreetmap.org'};
  const yes=decisionPlans({...input,sites:[site],social:{[site.id]:[proof,proof]},goal:'schools'});
  assert.ok(yes.plans.every(p=>p.zones[0].social.length===1));
  assert.ok(!yes.assumptions.includes('lab.noSchools'));
  assert.equal(yes.identical,true);
});

test('decision lab: alternative is explicit, same tier and quantity, with independently reported cost difference', () => {
  const plan=regular.plans[0];
  const found=plan.zones.map(z=>({z,a:labAlternatives(z,regular.basis,'dry')[0]})).find(v=>v.a);
  assert.ok(found,'demo must offer a real eligible alternative');
  const before=JSON.stringify(regular);
  const next=applyLabAlternative(regular,plan.id,found.z.siteId,found.a);
  const updated=next.plans[0].zones.find(z=>z.siteId===found.z.siteId)!;
  assert.equal(updated.analysis.scheme.reduce((s,r)=>s+r.quantity,0),found.z.analysis.scheme.reduce((s,r)=>s+r.quantity,0));
  assert.ok(Math.abs(updated.costKzt!-found.z.costKzt!-found.a.extraKzt!)<.005);
  assert.equal(JSON.stringify(regular),before);
  assert.deepEqual(labAlternatives(found.z,regular.basis,'delay'),[]);
});
