// Decision Lab: deterministic, read-only portfolios. Shared by mock and the server.
import type { CandidateSite, Species } from '../api/types';
import { DEFAULT_PRIORITY_WEIGHTS, priorities, roadmap, type PriorityItem } from './city';
import { analyzeZone, type PlanOptions, type ZoneAnalysis } from './plan';
import type { Rates } from './rates';

export type Watering = PlanOptions['watering'];
export interface DecisionLabInput { budgetKzt: number; waterLimitM3: number | null; watering: Watering }
export interface PlanTotals {
  zones: number; plants: number; spentKzt: number; remainingKzt: number;
  waterM3: number | null; survivalY3: number | null; co2t20: number; canopyM2: number;
}
export interface Plan {
  id: 'survival' | 'water' | 'people';
  nameKey: 'lab.plan.survival' | 'lab.plan.water' | 'lab.plan.people';
  zones: { siteId: string; name: string; costKzt: number; waterM3: number | null; explanation: string[] }[];
  baseline: PlanTotals;
  scenario: PlanTotals;
  delta: { survivalPp: number | null; co2Pct: number | null; waterPct: number | null };
  resilience: 'best' | 'similar' | null;
}
export interface DecisionPlans { plans: Plan[]; assumptions: string[] }

/** Same strict boundary in mock; the HTTP route additionally publishes its Zod schema. */
export function parseDecisionLabInput(value: unknown): DecisionLabInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RangeError('lab.invalid');
  const b = value as Record<string, unknown>;
  if (Object.keys(b).some(k => !['budgetKzt', 'waterLimitM3', 'watering'].includes(k)) ||
      typeof b.budgetKzt !== 'number' || !Number.isFinite(b.budgetKzt) || b.budgetKzt <= 0 ||
      (b.waterLimitM3 != null && (typeof b.waterLimitM3 !== 'number' || !Number.isFinite(b.waterLimitM3) || b.waterLimitM3 < 0)) ||
      typeof b.watering !== 'string' || !['regular', 'rare', 'none'].includes(b.watering)) throw new RangeError('lab.invalid');
  return { budgetKzt: b.budgetKzt, waterLimitM3: b.waterLimitM3 == null ? null : b.waterLimitM3 as number, watering: b.watering as Watering };
}

/** Litres per visit × visits, converted to m³. Flowers and autumn recharge are excluded. */
export function seasonalWaterM3(a: Pick<ZoneAnalysis, 'scheme' | 'care'>, rates: Rates): number | null {
  const visits = a.care.filter(c => c.operation === 'Полив').reduce((sum, c) => sum + c.visits, 0);
  if (!visits) return 0;
  let litres = 0;
  for (const tier of ['tree', 'shrub'] as const) {
    const quantity = a.scheme.filter(row => row.tier === tier).reduce((sum, row) => sum + row.quantity, 0);
    if (!quantity) continue;
    const rate = rates[`care.water.${tier}`];
    if (rate == null || !Number.isFinite(rate) || rate < 0) return null;
    litres += quantity * rate;
  }
  return visits * litres / 1000;
}

type Zone = { site: CandidateSite; analysis: ZoneAnalysis; water: number | null; priority: PriorityItem; people: PriorityItem };
const plantCount = (a: ZoneAnalysis) => a.scheme.reduce((sum, row) => sum + row.quantity, 0);
const effect20 = (a: ZoneAnalysis) => a.effect.find(e => e.years === 20)!;
const percentChange = (current: number | null, baseline: number | null) =>
  current === null || baseline === null || baseline === 0 ? null : (current - baseline) / baseline * 100;

function totals(analyses: ZoneAnalysis[], budget: number, rates: Rates): PlanTotals {
  const plants = analyses.reduce((sum, a) => sum + plantCount(a), 0);
  const waters = analyses.map(a => seasonalWaterM3(a, rates));
  const spentKzt = analyses.reduce((sum, a) => sum + a.cost.total, 0);
  return {
    zones: analyses.length, plants, spentKzt, remainingKzt: budget - spentKzt,
    waterM3: waters.some(w => w === null) ? null : waters.reduce<number>((sum, w) => sum + w!, 0),
    survivalY3: plants ? analyses.reduce((sum, a) => sum + a.survivalAvg.y3 * plantCount(a), 0) / plants : null,
    co2t20: analyses.reduce((sum, a) => sum + effect20(a).co2t, 0),
    canopyM2: analyses.reduce((sum, a) => sum + effect20(a).canopyM2, 0),
  };
}

export function decisionPlans(input: DecisionLabInput & { sites: CandidateSite[]; catalog: Species[]; rates: Rates }): DecisionPlans {
  const { budgetKzt, waterLimitM3, watering } = parseDecisionLabInput({ budgetKzt: input.budgetKzt, waterLimitM3: input.waterLimitM3, watering: input.watering });
  const { catalog, rates } = input;
  // Resolve ties by ID, independent of database/HTTP row ordering. Do not mutate caller data.
  const sites = [...input.sites].filter(s => s.centroid && Number.isFinite(s.centroid.lat) && Number.isFinite(s.centroid.lng))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const ranked = new Map(priorities(sites, catalog, rates, DEFAULT_PRIORITY_WEIGHTS).map(p => [p.siteId, p]));
  const social = new Map(priorities(sites, catalog, rates, { deficit: 0.25, density: 0.25, social: 0.5, load: 0, soil: 0, benefit: 0 }).map(p => [p.siteId, p]));
  const zones: Zone[] = sites.map(site => {
    const analysis = analyzeZone(site, catalog, rates, { variant: 'optimal', watering: 'regular' });
    return { site, analysis, water: seasonalWaterM3(analysis, rates), priority: ranked.get(site.id)!, people: social.get(site.id)! };
  });
  const efficiency = (z: Zone) => z.water !== null && effect20(z.analysis).co2t > 0 ? z.water / effect20(z.analysis).co2t : Infinity;
  const order: Record<Plan['id'], (a: Zone, b: Zone) => number> = {
    survival: (a, b) => b.analysis.survivalAvg.y3 - a.analysis.survivalAvg.y3,
    water: (a, b) => efficiency(a) === efficiency(b) ? 0 : efficiency(a) < efficiency(b) ? -1 : 1,
    people: (a, b) => b.people.index - a.people.index,
  };
  const plans = (['survival', 'water', 'people'] as const).map((id): Plan => {
    const selected: Zone[] = [];
    let spent = 0, water = 0;
    for (const z of [...zones].sort((a, b) => order[id](a, b) || b.priority.index - a.priority.index || (a.site.id < b.site.id ? -1 : 1))) {
      if (!plantCount(z.analysis)) continue;
      // Reuse the existing budget eligibility/greedy step; add only the water constraint.
      if (!roadmap([{ ...z.priority, cost: z.analysis.cost.total }], budgetKzt - spent).chosen.length) continue;
      if (waterLimitM3 !== null && (z.water === null || water + z.water > waterLimitM3)) continue;
      selected.push(z); spent += z.analysis.cost.total; water += z.water ?? 0;
    }
    const baseline = totals(selected.map(z => z.analysis), budgetKzt, rates);
    const analyses = selected.map(z => watering === 'regular' ? z.analysis : analyzeZone(z.site, catalog, rates, { variant: 'optimal', watering }));
    const scenario = totals(analyses, budgetKzt, rates);
    return { id, nameKey: `lab.plan.${id}`, baseline, scenario,
      zones: selected.map((z, i) => ({ siteId: z.site.id, name: z.site.name, costKzt: z.analysis.cost.total,
        waterM3: seasonalWaterM3(analyses[i], rates), explanation: (id === 'people' ? z.people : z.priority).explanation })),
      delta: { survivalPp: baseline.survivalY3 === null || scenario.survivalY3 === null ? null : scenario.survivalY3 - baseline.survivalY3,
        co2Pct: percentChange(scenario.co2t20, baseline.co2t20), waterPct: percentChange(scenario.waterM3, baseline.waterM3) },
      resilience: null };
  });
  const compared = plans.filter(p => p.delta.survivalPp !== null && p.baseline.plants > 0)
    .sort((a, b) => b.delta.survivalPp! - a.delta.survivalPp!);
  if (watering !== 'regular' && compared.length >= 2) {
    const best = compared[0].delta.survivalPp!;
    if (best - compared[1].delta.survivalPp! < 1) {
      for (const p of compared) if (best - p.delta.survivalPp! < 1) p.resilience = 'similar';
    } else compared[0].resilience = 'best';
  }
  return { plans, assumptions: ['lab.assumption.estimate', 'lab.assumption.water', 'lab.assumption.greedy', 'lab.assumption.fixed',
    'lab.assumption.cost', 'lab.assumption.rare', 'lab.assumption.survival',
    ...(zones.some(z => z.water === null) ? ['lab.assumption.missingWater'] : []),
    ...(sites.length !== input.sites.length ? ['lab.assumption.missingSite'] : [])] };
}
