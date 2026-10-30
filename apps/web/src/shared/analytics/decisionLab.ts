// One deterministic model for API, mock and frozen browser scenario evaluation.
import type { CandidateSite, Species } from '../api/types';
import type { OutcomeProvenance, OutcomeVariant } from '../api/outcomes';
import { priorities, DEFAULT_PRIORITY_WEIGHTS } from './city';
import { analyzeZone, survivalForecast, costEstimate, careCalendar, ecoEffect, type PlanOptions, type ZoneAnalysis } from './plan';
import { calculateOutcomeVariant } from './outcomes';
import { ratesMap, type Rates, type RateEntry } from './rates';

export type Watering = PlanOptions['watering'];
export type Goal = 'balanced' | 'schools' | 'deficit' | 'social';
export interface DecisionLabInput { budgetKzt: number; waterLimitM3: number | null; watering: Watering; goal?: Goal }
export interface SocialProof { id: string; kind: 'school' | 'kindergarten' | 'social'; name: string | null; distanceM: number; source: string }
export interface DecisionData { sites: CandidateSite[]; catalog: Species[]; rates: Rates; rateEntries: RateEntry[]; provenance: OutcomeProvenance; social?: Record<string, SocialProof[]> }
export interface PlanTotals {
  zones: number; plants: number; trees: number; expectedTreesY3: number | null;
  spentKzt: number | null; remainingKzt: number | null; costPerExpectedTreeKzt: number | null;
  costItems: { key: string; amountKzt: number | null }[];
  waterM3: number | null; survivalY3: number | null; co2t20: number | null; canopyM2: number | null;
}
export interface PlanZone {
  siteId: string; name: string; costKzt: number | null; waterM3: number | null;
  expectedTreesY3: number | null; explanation: { key: string; value: number }[];
  social: SocialProof[]; issues: string[]; site: CandidateSite; analysis: ZoneAnalysis;
}
export interface Plan {
  id: 'survival' | 'water' | 'people'; nameKey: 'lab.plan.survival' | 'lab.plan.water' | 'lab.plan.people';
  zones: PlanZone[]; baseline: PlanTotals; scenario: PlanTotals;
  delta: { survivalPp: number | null; co2Pct: number | null; waterPct: number | null; expectedTrees: number | null };
  resilience: 'best' | 'similar' | null;
  excluded: { siteId: string; name: string; reason: string }[];
}
export interface DecisionPlans {
  plans: Plan[]; assumptions: string[]; input: DecisionLabInput; identical: boolean;
  basis: { catalog: Species[]; rateEntries: RateEntry[]; provenance: OutcomeProvenance };
}
export function parseDecisionLabInput(value: unknown): DecisionLabInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RangeError('lab.invalid');
  const b = value as Record<string, unknown>;
  if (Object.keys(b).some(k => !['budgetKzt', 'waterLimitM3', 'watering', 'goal'].includes(k)) ||
      typeof b.budgetKzt !== 'number' || !Number.isFinite(b.budgetKzt) || b.budgetKzt <= 0 ||
      (b.waterLimitM3 != null && (typeof b.waterLimitM3 !== 'number' || !Number.isFinite(b.waterLimitM3) || b.waterLimitM3 < 0)) ||
      !['regular', 'rare', 'none'].includes(b.watering as string) ||
      (b.goal !== undefined && !['balanced', 'schools', 'deficit', 'social'].includes(b.goal as string))) throw new RangeError('lab.invalid');
  return { budgetKzt: b.budgetKzt, waterLimitM3: b.waterLimitM3 == null ? null : b.waterLimitM3 as number, watering: b.watering as Watering, goal: (b.goal ?? 'balanced') as Goal };
}
export function seasonalWaterM3(a: Pick<ZoneAnalysis, 'scheme' | 'care'>, rates: Rates): number | null {
  const visits = a.care.filter(c => c.operation === 'Полив').reduce((s, c) => s + c.visits, 0);
  if (!visits) return 0;
  let litres = 0;
  for (const tier of ['tree', 'shrub'] as const) {
    const n = a.scheme.filter(r => r.tier === tier).reduce((s, r) => s + r.quantity, 0);
    if (!n) continue;
    const rate = rates[`care.water.${tier}`];
    if (rate == null || !Number.isFinite(rate) || rate < 0) return null;
    litres += n * rate;
  }
  return visits * litres / 1000;
}
export function waterStress(demandM3: number | null, baselineLimitM3: number | null, reductionPct: number) {
  if (!Number.isFinite(reductionPct) || reductionPct < 0 || reductionPct > 100 ||
      [demandM3, baselineLimitM3].some(v => v !== null && (!Number.isFinite(v) || v < 0))) throw new RangeError('lab.invalid');
  const availableM3 = baselineLimitM3 === null ? null : baselineLimitM3 * (1 - reductionPct / 100);
  return { availableM3, deficitM3: availableM3 === null || demandM3 === null ? null : Math.max(0, demandM3 - availableM3),
    coveragePct: availableM3 === null || demandM3 === null || demandM3 === 0 ? null : Math.min(100, availableM3 / demandM3 * 100) };
}
export const percentChange = (current: number | null, baseline: number | null) =>
  current === null || baseline === null || baseline === 0 ? null : (current - baseline) / baseline * 100;
const sum = (values: (number | null)[]) => values.some(v => v === null) ? null : values.reduce<number>((s, v) => s + v!, 0);
const count = (a: ZoneAnalysis, tier?: string) => a.scheme.filter(r => !tier || r.tier === tier).reduce((s, r) => s + r.quantity, 0);
function outcome(site: CandidateSite, analysis: ZoneAnalysis, basis: DecisionPlans['basis']) {
  return calculateOutcomeVariant({ id: site.id, site, analysis, catalog: basis.catalog, rates: basis.rateEntries,
    provenance: { ...basis.provenance, siteVersion: site.version } });
}
/** Re-evaluate the exact scheme; never run selection or buildScheme during a stress test. */
export function fixedZoneScenario(zone: Pick<PlanZone, 'site' | 'analysis'>, basis: DecisionPlans['basis'], watering: Watering): ZoneAnalysis {
  const a = zone.analysis, opt = { ...a.options, watering }, byId = new Map(basis.catalog.map(s => [s.id, s]));
  const rates = ratesMap(basis.rateEntries), soil = a.facts.soil;
  const survival = survivalForecast(zone.site, a.scheme, byId, opt, soil, rates);
  const calendar = careCalendar(a.scheme, byId, soil, opt, rates);
  return { ...a, options: opt, survival, cost: costEstimate(zone.site, a.scheme, byId, survival, opt, rates, soil),
    care: calendar.care, careWarnings: calendar.warnings, effect: ecoEffect(zone.site, a.scheme, byId, survival, rates) };
}
function totals(zones: { site: CandidateSite; analysis: ZoneAnalysis }[], budget: number, basis: DecisionPlans['basis']): PlanTotals {
  const values = zones.map(z => outcome(z.site, z.analysis, basis)), rates = ratesMap(basis.rateEntries);
  const trees = zones.reduce((s, z) => s + count(z.analysis, 'tree'), 0), expected = sum(values.map(o => o.expectedTreesY3));
  const spent = sum(values.map(o => o.cost.totalKzt));
  const effects = zones.map(z => z.analysis.effect.find(e => e.years === 20)!);
  const co2Known = ['eff.co2.tree', 'eff.co2.shrub'].every(k => rates[k] !== null && rates[k] !== undefined && Number.isFinite(rates[k]) && rates[k]! >= 0);
  return { zones: zones.length, plants: zones.reduce((s, z) => s + count(z.analysis), 0), trees, expectedTreesY3: expected,
    spentKzt: spent, remainingKzt: spent === null ? null : budget - spent,
    costPerExpectedTreeKzt: values.length && values.every(v => v.cost.scope === 'whole-tree-planting' && v.cost.complete) && expected && spent !== null ? spent / expected : null,
    costItems: ['material', 'prep', 'work', 'care', 'reserve'].map(key => ({ key, amountKzt: sum(values.map(v => v.cost.items.find(i => i.key === key)!.amountKzt)) })),
    waterM3: sum(zones.map(z => seasonalWaterM3(z.analysis, rates))), survivalY3: trees && expected !== null ? expected / trees * 100 : null,
    co2t20: co2Known ? sum(effects.map(e => e.co2t)) : null, canopyM2: sum(effects.map(e => e.canopyM2)) };
}
/** Also used directly by the browser with the original immutable response snapshot. */
export function evaluateDecisionPlans(original: DecisionPlans, watering: Watering): DecisionPlans {
  if (!['regular', 'rare', 'none'].includes(watering)) throw new RangeError('lab.invalid');
  const plans = original.plans.map(p => {
    const scenario = watering === 'regular' ? p.baseline : totals(p.zones.map(z => ({ site: z.site, analysis: fixedZoneScenario(z, original.basis, watering) })), original.input.budgetKzt, original.basis);
    return { ...p, scenario, resilience: null as Plan['resilience'], delta: {
      survivalPp: scenario.survivalY3 === null || p.baseline.survivalY3 === null ? null : scenario.survivalY3 - p.baseline.survivalY3,
      co2Pct: percentChange(scenario.co2t20, p.baseline.co2t20), waterPct: percentChange(scenario.waterM3, p.baseline.waterM3),
      expectedTrees: scenario.expectedTreesY3 === null || p.baseline.expectedTreesY3 === null ? null : scenario.expectedTreesY3 - p.baseline.expectedTreesY3 } };
  });
  const compared = plans.filter(p => p.baseline.trees > 0 && p.delta.survivalPp !== null).sort((a, b) => b.delta.survivalPp! - a.delta.survivalPp!);
  if (watering !== 'regular' && compared.length >= 2) {
    const best = compared[0].delta.survivalPp!;
    if (best - compared[1].delta.survivalPp! < 1) { for (const p of compared) if (best - p.delta.survivalPp! < 1) p.resilience = 'similar'; }
    else compared[0].resilience = 'best';
  }
  return { ...original, plans, input: { ...original.input, watering } };
}
export interface LabAlternative { from: string; to: string; extraKzt: number | null; analysis: ZoneAnalysis }
/** Suggest only suitable, same-tier species with stronger catalogue risk tolerance. */
export function labAlternatives(zone: PlanZone, basis: DecisionPlans['basis'], risk: 'dry' | 'winter' | 'delay'): LabAlternative[] {
  if (risk === 'delay') return [];
  const key = risk === 'dry' ? 'droughtTolerance' : 'frostHardiness';
  const levels = { low: 0, medium: 1, high: 2 };
  const byId = new Map(basis.catalog.map(s => [s.id, s]));
  const result: LabAlternative[] = [];
  for (const row of zone.analysis.scheme.filter(r => r.tier === 'tree')) {
    const from = byId.get(row.speciesId)!;
    const candidate = zone.analysis.ranked.find(r => !r.excludedBy && r.score >= 50 && !zone.analysis.scheme.some(s => s.speciesId === r.speciesId)
      && byId.get(r.speciesId)?.form === row.tier && levels[byId.get(r.speciesId)![key]] > levels[from[key]]);
    if (!candidate) continue;
    const scheme = zone.analysis.scheme.map(r => r.speciesId === row.speciesId ? { ...r, speciesId: candidate.speciesId, replacedFrom: row.speciesId } : r);
    const analysis = fixedZoneScenario({ site: zone.site, analysis: { ...zone.analysis, scheme } }, basis, 'regular');
    const cost = outcome(zone.site, analysis, basis).cost.totalKzt;
    result.push({ from: row.speciesId, to: candidate.speciesId, analysis, extraKzt: cost === null || zone.costKzt === null ? null : cost - zone.costKzt });
  }
  return result;
}
export function applyLabAlternative(original: DecisionPlans, planId: Plan['id'], siteId: string, alternative: LabAlternative): DecisionPlans {
  const plan = original.plans.find(p => p.id === planId)!;
  const zone = plan.zones.find(z => z.siteId === siteId)!;
  const verified = (['dry', 'winter'] as const).flatMap(r => labAlternatives(zone, original.basis, r)).find(a => a.from === alternative.from && a.to === alternative.to);
  if (!verified) throw new RangeError('lab.invalid');
  const value = outcome(zone.site, verified.analysis, original.basis);
  const updated: PlanZone = { ...zone, analysis: verified.analysis, costKzt: value.cost.totalKzt, expectedTreesY3: value.expectedTreesY3,
    waterM3: seasonalWaterM3(verified.analysis, ratesMap(original.basis.rateEntries)), issues: value.issues.map(i => i.code) };
  const zones = plan.zones.map(z => z.siteId === siteId ? updated : z);
  const baseline = totals(zones, original.input.budgetKzt, original.basis);
  return evaluateDecisionPlans({ ...original, plans: original.plans.map(p => p.id === planId ? { ...p, zones, baseline } : p), identical: false }, original.input.watering);
}
export interface SelectionCandidate { siteId: string; cost: number | null; water: number | null; expectedTrees: number | null; co2: number | null; social: number; priority: number; goalRank: number }
/** Stable heuristic, exposed separately for independent small arithmetic examples. */
export function selectDecisionZones(items: SelectionCandidate[], strategy: Plan['id'], budget: number, limit: number | null) {
  const efficiency = (i: SelectionCandidate) => strategy === 'survival' ? (i.expectedTrees ?? 0) / (i.cost === 0 ? Number.MIN_VALUE : i.cost ?? Infinity)
    : strategy === 'water' ? (i.water !== null && i.co2 !== null && i.co2 > 0 ? -i.water / i.co2 : -Infinity) : i.social;
  const selected: string[] = [], excluded: { siteId: string; reason: string }[] = [];
  let spent = 0, water = 0;
  for (const i of [...items].sort((a, b) => b.goalRank - a.goalRank || (efficiency(b) === efficiency(a) ? 0 : efficiency(b) > efficiency(a) ? 1 : -1) || b.priority - a.priority || a.siteId.localeCompare(b.siteId))) {
    const reason = i.cost === null || !Number.isFinite(i.cost) || i.cost < 0 ? 'missingCost'
      : i.expectedTrees === null || i.expectedTrees <= 0 ? 'missingResult'
      : i.cost + spent > budget ? 'budget'
      : limit !== null && i.water === null ? 'missingWater'
      : limit !== null && water + i.water! > limit ? 'water' : null;
    if (reason) { excluded.push({ siteId: i.siteId, reason }); continue; }
    selected.push(i.siteId); spent += i.cost!; water += i.water ?? 0;
  }
  return { selected, excluded };
}
export function decisionPlans(data: DecisionLabInput & DecisionData): DecisionPlans {
  const input = parseDecisionLabInput({ budgetKzt: data.budgetKzt, waterLimitM3: data.waterLimitM3, watering: data.watering, ...(data.goal ? { goal: data.goal } : {}) });
  const basis = structuredClone({ catalog: data.catalog, rateEntries: data.rateEntries, provenance: data.provenance });
  const rates = ratesMap(basis.rateEntries);
  const sites = [...new Map(data.sites.filter(s => s.centroid && Number.isFinite(s.centroid.lat) && Number.isFinite(s.centroid.lng)).map(s => [s.id, s])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const proofs = (site: CandidateSite) => [...new Map((data.social?.[site.id] ?? []).map(p => [p.id, p])).values()].sort((a, b) => a.id.localeCompare(b.id));
  // Typed OSM evidence replaces name-based social counts for this feature only.
  const contextSites = sites.map(s => ({ ...s, context: { ...s.context, socialWithin400m: proofs(s).map(p => p.id) } }));
  const priority = new Map(priorities(contextSites, data.catalog, rates, DEFAULT_PRIORITY_WEIGHTS).map(p => [p.siteId, p]));
  const social = new Map(priorities(contextSites, data.catalog, rates, { deficit: .25, density: .25, social: .5, load: 0, soil: 0, benefit: 0 }).map(p => [p.siteId, p]));
  const zones = sites.map(site => {
    const analysis = analyzeZone(site, data.catalog, rates, { variant: 'optimal', careYears: 3, watering: 'regular' });
    const o: OutcomeVariant = outcome(site, analysis, basis), people = proofs(site);
    const goalRank = input.goal === 'schools' ? Number(people.some(p => ['school', 'kindergarten'].includes(p.kind)))
      : input.goal === 'social' ? people.length : input.goal === 'deficit' ? (site.context?.greenShare200m == null ? -1 : 1 - site.context.greenShare200m) : 0;
    const score: SelectionCandidate = { siteId: site.id, cost: o.cost.totalKzt, water: seasonalWaterM3(analysis, rates), expectedTrees: o.expectedTreesY3,
      co2: rates['eff.co2.tree'] == null || rates['eff.co2.shrub'] == null ? null : analysis.effect.find(e => e.years === 20)!.co2t,
      social: social.get(site.id)!.index, priority: priority.get(site.id)!.index, goalRank };
    return { site, analysis, o, people, score };
  });
  const plans = (['survival', 'water', 'people'] as const).map(id => {
    const selection = selectDecisionZones(zones.map(z => z.score), id, input.budgetKzt, input.waterLimitM3);
    const chosen = selection.selected.map(key => zones.find(z => z.site.id === key)!);
    const baseline = totals(chosen, input.budgetKzt, basis);
    return { id, nameKey: `lab.plan.${id}` as Plan['nameKey'], baseline, scenario: baseline, resilience: null,
      delta: { survivalPp: null, co2Pct: null, waterPct: null, expectedTrees: null },
      zones: chosen.map(z => ({ siteId: z.site.id, name: z.site.name, site: z.site, analysis: z.analysis,
        costKzt: z.o.cost.totalKzt, waterM3: z.score.water, expectedTreesY3: z.o.expectedTreesY3, social: z.people, issues: z.o.issues.map(i => i.code),
        explanation: Object.entries((id === 'people' ? social : priority).get(z.site.id)!.factors).filter(([key]) => ['deficit','density','social'].includes(key))
          .map(([key, value]) => ({ key: `lab.factor.${key}`, value })) })),
      excluded: selection.excluded.map(e => ({ ...e, name: sites.find(s => s.id === e.siteId)!.name })) };
  });
  return evaluateDecisionPlans(structuredClone({ input, basis, plans, identical: new Set(plans.map(p => p.zones.map(z => z.siteId).sort().join(','))).size < 3,
    assumptions: ['lab.assumption.estimate', 'lab.assumption.water', 'lab.assumption.greedy', 'lab.assumption.fixed', 'lab.assumption.cost', 'lab.assumption.rare', 'lab.assumption.survival', 'lab.assumption.social', 'lab.assumption.canopy',
      ...(sites.length !== data.sites.length ? ['lab.assumption.missingSite'] : []),
      ...(zones.some(z => z.score.water === null) ? ['lab.assumption.missingWater'] : []),
      ...(input.goal === 'schools' && !zones.some(z => z.score.goalRank > 0) ? ['lab.noSchools'] : [])] }), input.watering);
}
