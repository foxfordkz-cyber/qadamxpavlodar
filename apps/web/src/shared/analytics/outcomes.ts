import type {
  DeepReadonly, OutcomeCohort, OutcomeComparison, OutcomeForecastComparison, OutcomeForecastSnapshot,
  OutcomeInspection, OutcomeInspectionSummary, OutcomeIssue, OutcomeIssueCode, OutcomeProvenance,
  OutcomeVariant, OutcomeVariantInput, RegisteredOutcomePlant,
} from '../api/outcomes';
import { costEstimate } from './plan';
import { ratesMap } from './rates';

const COST_KEYS = ['material', 'prep', 'work', 'care', 'reserve'] as const;
type CostKey = typeof COST_KEYS[number];
const finiteNonnegative = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const probability = (n: unknown): n is number => finiteNonnegative(n) && n <= 100;
const quantity = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
// Half a tiyn: permit presentation-level currency rounding, not stale estimates.
const sameMoney = (a: number, b: number) => Math.abs(a - b) < 0.005;

export class OutcomeValidationError extends Error {
  constructor(public code: string, public field: string) {
    super(`${code}: ${field}`);
    this.name = 'OutcomeValidationError';
  }
}
function requireValue(condition: unknown, code: string, field: string): asserts condition {
  if (!condition) throw new OutcomeValidationError(code, field);
}
const id = (value: unknown, field: string) => requireValue(typeof value === 'string' && value.trim().length > 0, 'invalid_id', field);
function uniqueIds(values: readonly string[], field: string) {
  values.forEach(value => id(value, field));
  requireValue(new Set(values).size === values.length, 'duplicate_id', field);
}
function calendarDate(value: string, field: string): string {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'invalid_date', field);
  const parsed = new Date(`${value}T00:00:00Z`);
  requireValue(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, 'invalid_date', field);
  return value;
}
function timestampDay(value: string, field: string) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value), 'invalid_timestamp', field);
  calendarDate(value.slice(0, 10), field);
  const time = Date.parse(value);
  requireValue(Number.isFinite(time), 'invalid_timestamp', field);
  return new Date(time + 5 * 3600000).toISOString().slice(0, 10);
}
function validateProvenance(value: DeepReadonly<OutcomeProvenance>, field = 'provenance', asOf?: string) {
  const day = timestampDay(value.capturedAt, `${field}.capturedAt`);
  requireValue(['mock', 'api'].includes(value.source), 'invalid_source', field);
  requireValue(['real', 'estimate', 'demo'].includes(value.dataClass), 'invalid_data_class', field);
  requireValue(typeof value.isDemo === 'boolean', 'invalid_demo_flag', field);
  requireValue((value.source !== 'mock' && value.dataClass !== 'demo') || value.isDemo, 'demo_flag_required', field);
  for (const key of ['siteVersion', 'ratesVersion'] as const) {
    requireValue(value[key] === null || quantity(value[key]), 'invalid_version', `${field}.${key}`);
  }
  uniqueIds(value.evidenceIds, `${field}.evidenceIds`);
  if (asOf) requireValue(day <= asOf, 'future_date', `${field}.capturedAt`);
}
function freezeCopy<T>(value: T): DeepReadonly<T> {
  const copy = structuredClone(value);
  const freeze = (node: unknown) => {
    if (node && typeof node === 'object') {
      Object.values(node).forEach(freeze);
      Object.freeze(node);
    }
  };
  freeze(copy);
  return copy as DeepReadonly<T>;
}

/** Validate the existing estimate, never replace the survival/cost model. */
export function calculateOutcomeVariant(input: OutcomeVariantInput): OutcomeVariant {
  const { analysis: a, site, catalog, rates, provenance } = input;
  id(input.id, 'id');
  validateProvenance(provenance);
  const issues: OutcomeIssue[] = [];
  const issue = (code: OutcomeIssueCode, field?: string) => {
    if (!issues.some(i => i.code === code && i.field === field)) issues.push({ code, ...(field ? { field } : {}) });
  };
  const blocked = new Set<CostKey>();
  const blockAll = () => COST_KEYS.forEach(k => blocked.add(k));
  const bySpecies = new Map(catalog.map(sp => [sp.id, sp]));
  const counts = { tree: 0, shrub: 0, flower: 0 };
  let validScheme = true;
  if (!a.scheme.length) { issue('empty_scheme'); blockAll(); }
  if (a.siteId !== site.id || a.facts.areaM2 !== site.areaM2) { issue('analysis_site_mismatch'); blockAll(); }
  for (const row of a.scheme) {
    if (!quantity(row.quantity) || !Object.hasOwn(counts, row.tier)) {
      issue('invalid_quantity', row.speciesId); validScheme = false; blockAll(); continue;
    }
    counts[row.tier] += row.quantity;
    const sp = bySpecies.get(row.speciesId);
    if (!sp || catalog.filter(s => s.id === row.speciesId).length !== 1) {
      issue('missing_species', row.speciesId); validScheme = false; blockAll();
    } else if (sp.form !== row.tier) {
      issue('species_tier_mismatch', row.speciesId); validScheme = false; blockAll();
    }
  }
  if (!Object.values(counts).every(Number.isSafeInteger)) { issue('invalid_quantity'); validScheme = false; blockAll(); }
  const survival = (speciesId: string, year: 'y1' | 'y3') => {
    const rows = a.survival.filter(r => r.speciesId === speciesId);
    if (rows.length !== 1) { issue(rows.length ? 'duplicate_survival' : 'missing_survival', speciesId); return null; }
    const value = rows[0][year];
    if (!probability(value)) { issue('invalid_probability', `${speciesId}.${year}`); return null; }
    return value;
  };
  let expectedTreesY3: number | null = validScheme ? 0 : null;
  for (const row of a.scheme.filter(r => r.tier === 'tree')) {
    const pct = survival(row.speciesId, 'y3');
    expectedTreesY3 = expectedTreesY3 !== null && pct !== null ? expectedTreesY3 + row.quantity * pct / 100 : null;
  }
  const needRate = (key: string, articles: CostKey[]) => {
    const entries = rates.filter(r => r.key === key);
    const value = entries[0]?.value;
    const bad = entries.length > 1 ? 'duplicate_rate' : value == null ? 'missing_rate' : !finiteNonnegative(value) ? 'invalid_rate' : null;
    if (bad) { issue(bad, key); articles.forEach(k => blocked.add(k)); }
  };
  if (!finiteNonnegative(a.facts.areaM2) || a.facts.areaM2 === 0) { issue('missing_area'); blocked.add('prep'); }
  needRate('soil.prep', ['prep']);
  if (a.facts.soil.salinity === 'medium' || a.facts.soil.salinity === 'high' || a.options.improveSoil) needRate('soil.salinity', ['prep']);
  for (const row of a.scheme) {
    const price = bySpecies.get(row.speciesId)?.pricePerUnitKzt;
    if (price == null) {
      needRate(row.tier === 'tree' && a.options.variant === 'max' ? 'price.tree.large' : `price.${row.tier}`, ['material', 'work', 'reserve']);
    } else if (!finiteNonnegative(price)) {
      issue('invalid_price', row.speciesId); ['material', 'work', 'reserve'].forEach(k => blocked.add(k as CostKey));
    }
    if (survival(row.speciesId, 'y1') === null) blocked.add('reserve');
  }
  for (const tier of ['tree', 'shrub', 'flower'] as const) if (counts[tier]) {
    needRate(`work.${tier}`, ['work']); needRate(`care.${tier}`, ['care']);
  }
  needRate('delivery.share', ['work']);
  if (![1, 2, 3].includes(a.options.careYears)) { issue('invalid_cost', 'careYears'); blocked.add('care'); }
  const recomputed = validScheme ? costEstimate(site, a.scheme, bySpecies, a.survival, a.options, ratesMap(rates), a.facts.soil) : null;
  for (const key of COST_KEYS) {
    const items = a.cost.items.filter(i => i.key === key);
    if (items.length !== 1 || !finiteNonnegative(items[0]?.amount)) { issue('invalid_cost', key); blocked.add(key); }
    else if (recomputed && !blocked.has(key)) {
      const check = recomputed.items.find(i => i.key === key)!.amount;
      if (!finiteNonnegative(check) || !sameMoney(check, items[0].amount)) { issue('cost_mismatch', key); blocked.add(key); }
    }
  }
  if (a.cost.items.length !== COST_KEYS.length || a.cost.items.some(i => !COST_KEYS.includes(i.key as CostKey))) {
    issue('invalid_cost', 'items'); blockAll();
  }
  const sum = a.cost.items.reduce((s, i) => s + i.amount, 0);
  const validTotal = finiteNonnegative(a.cost.total) && Number.isFinite(sum) && sameMoney(sum, a.cost.total);
  if (!validTotal) issue('invalid_cost', 'total');
  const complete = blocked.size === 0 && validTotal;
  const mixed = counts.shrub > 0 || counts.flower > 0;
  if (mixed) issue('mixed_planting');
  if (!counts.tree) issue('no_trees');
  if (a.options.careYears !== 3) issue('wrong_horizon');
  if (expectedTreesY3 === 0 && counts.tree > 0) issue('zero_expected_trees');
  if (!complete) issue('incomplete_cost');
  const totalKzt = complete ? a.cost.total : null;
  const canCalculate = complete && validScheme && !mixed && a.options.careYears === 3 && expectedTreesY3 !== null && expectedTreesY3 > 0;
  const costPerExpectedTreeKzt = canCalculate ? totalKzt! / expectedTreesY3! : null;
  if (canCalculate && !finiteNonnegative(costPerExpectedTreeKzt)) issue('invalid_cost', 'costPerExpectedTreeKzt');
  const comparisonKey = JSON.stringify({ basis: 'plan-cost-v1', source: provenance.source,
    siteId: site.id, siteVersion: provenance.siteVersion, ratesVersion: provenance.ratesVersion,
    facts: a.facts, model: a.survivalModel, careYears: a.options.careYears,
    rates: [...rates].sort((x, y) => x.key.localeCompare(y.key)), catalog: [...catalog].sort((x, y) => x.id.localeCompare(y.id)) });
  return structuredClone({
    id: input.id, siteId: site.id, variant: a.options.variant, horizonYears: 3,
    treeCount: validScheme ? counts.tree : null, expectedTreesY3,
    cost: { basis: 'plan-cost-v1', scope: mixed ? 'unallocated-mixed-planting' : 'whole-tree-planting', currency: 'KZT',
      careYears: a.options.careYears, complete, totalKzt,
      items: COST_KEYS.map(key => ({ key, amountKzt: blocked.has(key) ? null : a.cost.items.find(i => i.key === key)!.amount,
        dataClass: a.cost.items.find(i => i.key === key)?.dataClass ?? 'estimate' })) },
    costPerExpectedTreeKzt: finiteNonnegative(costPerExpectedTreeKzt) ? costPerExpectedTreeKzt : null,
    dataClass: 'estimate', isDemo: provenance.isDemo || site.isDemo || a.cost.items.some(i => i.dataClass === 'demo'),
    provenance, model: a.survivalModel, comparisonKey, issues, assumptions: a.assumptions,
  });
}

export function compareOutcomeVariants(variants: readonly OutcomeVariant[]): OutcomeComparison {
  uniqueIds(variants.map(v => v.id), 'variants.id');
  const eligible = variants.filter(v => finiteNonnegative(v.costPerExpectedTreeKzt) && v.expectedTreesY3 !== null && v.expectedTreesY3 > 0
    && v.cost.complete && v.cost.scope === 'whole-tree-planting' && v.cost.careYears === 3 && v.horizonYears === 3);
  const result: OutcomeComparison = { comparable: false, eligibleVariantIds: eligible.map(v => v.id), bestVariantIds: [], issues: [] };
  if (eligible.length < 2) result.issues.push({ code: 'insufficient_variants' });
  else if (new Set(eligible.map(v => v.comparisonKey)).size !== 1) result.issues.push({ code: 'incompatible_basis' });
  else {
    result.comparable = true;
    const minimum = Math.min(...eligible.map(v => v.costPerExpectedTreeKzt!));
    result.bestVariantIds = eligible.filter(v => v.costPerExpectedTreeKzt === minimum).map(v => v.id);
  }
  return result;
}

export function createOutcomeSnapshot(input: OutcomeVariantInput): OutcomeForecastSnapshot {
  const outcome = calculateOutcomeVariant(input);
  return freezeCopy({ schemaVersion: 1 as const, analysis: input.analysis, catalog: input.catalog,
    rates: input.rates, provenance: input.provenance, outcome });
}

function sameComposition(cohort: DeepReadonly<OutcomeCohort>) {
  if (!cohort.forecast) return false;
  const expected = new Map<string, number>();
  for (const row of cohort.forecast.analysis.scheme) {
    if (!quantity(row.quantity)) return false;
    expected.set(row.speciesId, (expected.get(row.speciesId) ?? 0) + row.quantity);
  }
  const actual = new Map<string, number>();
  for (const plant of cohort.plants) actual.set(plant.speciesId, (actual.get(plant.speciesId) ?? 0) + 1);
  return expected.size === actual.size && [...expected].every(([key, count]) => actual.get(key) === count);
}
function validateCohort(cohort: DeepReadonly<OutcomeCohort>, asOf: string) {
  calendarDate(asOf, 'asOf'); id(cohort.id, 'cohort.id'); id(cohort.siteId, 'cohort.siteId');
  requireValue(quantity(cohort.version), 'invalid_version', 'cohort.version');
  validateProvenance(cohort.provenance, 'cohort.provenance', asOf);
  uniqueIds(cohort.plants.map(p => p.plantId), 'cohort.plants');
  cohort.plants.forEach(p => id(p.speciesId, 'cohort.speciesId'));
  if (cohort.plantedOn !== null) requireValue(calendarDate(cohort.plantedOn, 'cohort.plantedOn') <= asOf, 'future_date', 'cohort.plantedOn');
  const f = cohort.forecast;
  if (f) {
    requireValue(f.schemaVersion === 1, 'unsupported_snapshot', 'forecast.schemaVersion');
    validateProvenance(f.provenance, 'forecast.provenance', asOf);
    requireValue(f.analysis.siteId === cohort.siteId, 'forecast_site_mismatch', 'forecast.analysis.siteId');
    requireValue(sameComposition(cohort), 'cohort_mismatch', 'forecast.analysis.scheme');
    if (cohort.plantedOn) requireValue(timestampDay(f.provenance.capturedAt, 'forecast.capturedAt') <= cohort.plantedOn, 'retrospective_forecast', 'forecast.capturedAt');
  }
}

export function createOutcomeCohort(input: OutcomeCohort, registry: readonly RegisteredOutcomePlant[], asOf: string): DeepReadonly<OutcomeCohort> {
  validateCohort(input, asOf);
  uniqueIds(registry.map(p => p.plantId), 'registry.plantId');
  for (const link of input.plants) {
    const plant = registry.find(p => p.plantId === link.plantId);
    requireValue(plant, 'plant_not_registered', link.plantId);
    requireValue(plant.siteId === input.siteId && plant.speciesId === link.speciesId, 'plant_mismatch', link.plantId);
    requireValue(['tree', 'shrub', 'flower'].includes(plant.kind), 'invalid_kind', link.plantId);
    if (input.plantedOn) requireValue(plant.plantedOn !== null, 'unconfirmed_planting_date', link.plantId);
    if (plant.plantedOn !== null) {
      requireValue(calendarDate(plant.plantedOn, 'registry.plantedOn') <= asOf, 'future_date', link.plantId);
      if (input.plantedOn) requireValue(plant.plantedOn === input.plantedOn, 'planting_date_mismatch', link.plantId);
    }
    if (input.forecast) requireValue(input.forecast.analysis.scheme.some(r => r.speciesId === link.speciesId && r.tier === plant.kind), 'plant_kind_mismatch', link.plantId);
    requireValue(!plant.isDemo || input.provenance.isDemo, 'demo_flag_required', 'cohort.provenance');
  }
  return freezeCopy(input);
}

export function summarizeOutcomeInspection(cohort: DeepReadonly<OutcomeCohort>, inspection: DeepReadonly<OutcomeInspection> | null, asOf: string): OutcomeInspectionSummary {
  validateCohort(cohort, asOf);
  let alive = 0, dead = 0;
  if (inspection) {
    id(inspection.id, 'inspection.id');
    requireValue(inspection.cohortId === cohort.id, 'inspection_cohort_mismatch', 'inspection.cohortId');
    requireValue(quantity(inspection.version), 'invalid_version', 'inspection.version');
    validateProvenance(inspection.provenance, 'inspection.provenance', asOf);
    const day = calendarDate(inspection.observedOn, 'inspection.observedOn');
    requireValue(day <= asOf, 'future_date', 'inspection.observedOn');
    requireValue(!cohort.plantedOn || day >= cohort.plantedOn, 'inspection_before_planting', 'inspection.observedOn');
    requireValue(day <= timestampDay(inspection.provenance.capturedAt, 'inspection.capturedAt'), 'inspection_after_recording', 'inspection.observedOn');
    requireValue(!cohort.provenance.isDemo || inspection.provenance.isDemo, 'demo_flag_required', 'inspection.provenance');
    uniqueIds(inspection.observations.map(o => o.plantId), 'inspection.observations');
    for (const o of inspection.observations) {
      requireValue(cohort.plants.some(p => p.plantId === o.plantId), 'foreign_plant', o.plantId);
      requireValue(['alive', 'dead', 'unknown'].includes(o.state), 'invalid_observation_state', o.plantId);
      uniqueIds(o.evidenceIds, 'observation.evidenceIds');
      if (o.reportId !== null) id(o.reportId, 'observation.reportId');
      requireValue(o.state === 'unknown' || o.reportId !== null || o.evidenceIds.length > 0, 'missing_observation_source', o.plantId);
      if (o.state === 'alive') alive++;
      if (o.state === 'dead') dead++;
    }
  }
  const total = cohort.plants.length, assessed = alive + dead, inspected = inspection?.observations.length ?? 0;
  return { cohortId: cohort.id, inspectionId: inspection?.id ?? null, total, inspected, assessed, alive, dead,
    unknown: total - assessed, notInspected: total - inspected,
    inspectionCoveragePct: total ? inspected / total * 100 : null,
    assessmentCoveragePct: total ? assessed / total * 100 : null,
    survivalAmongAssessedPct: assessed ? alive / assessed * 100 : null,
    wholeCohortSurvivalPct: total && assessed === total ? alive / total * 100 : null,
    dataClass: inspection?.provenance.dataClass ?? cohort.provenance.dataClass,
    isDemo: cohort.provenance.isDemo || (inspection?.provenance.isDemo ?? false) };
}

function anniversary(date: string, years: number) {
  const [year, month, day] = date.split('-').map(Number);
  const nextYear = year + years;
  const lastDay = new Date(Date.UTC(nextYear, month, 0)).getUTCDate();
  return `${String(nextYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function compareOutcomeForecast(cohort: DeepReadonly<OutcomeCohort>, inspection: DeepReadonly<OutcomeInspection> | null, asOf: string): OutcomeForecastComparison {
  const summary = summarizeOutcomeInspection(cohort, inspection, asOf);
  const result: OutcomeForecastComparison = { comparable: false, horizonYears: null, expectedAlive: null,
    expectedSurvivalPct: null, observedSurvivalPct: summary.wholeCohortSurvivalPct, differencePp: null, issues: [] };
  if (!cohort.plantedOn) result.issues.push({ code: 'missing_planting_date' });
  if (!cohort.forecast) result.issues.push({ code: 'missing_forecast' });
  if (!inspection) result.issues.push({ code: 'no_inspection' });
  if (result.issues.length) return result;
  const years = ([1, 2, 3] as const).find(y => anniversary(cohort.plantedOn!, y) === inspection!.observedOn);
  if (!years) { result.issues.push({ code: 'unmatched_horizon' }); return result; }
  result.horizonYears = years;
  let expected = 0;
  for (const row of cohort.forecast!.analysis.scheme) {
    const forecasts = cohort.forecast!.analysis.survival.filter(s => s.speciesId === row.speciesId);
    if (forecasts.length !== 1) { result.issues.push({ code: forecasts.length ? 'duplicate_survival' : 'missing_survival', field: row.speciesId }); continue; }
    const pct = forecasts[0][`y${years}` as 'y1' | 'y2' | 'y3'];
    if (!probability(pct)) result.issues.push({ code: 'invalid_probability', field: `${row.speciesId}.y${years}` });
    else expected += row.quantity * pct / 100;
  }
  if (!result.issues.length && summary.total) {
    result.expectedAlive = expected;
    result.expectedSurvivalPct = expected / summary.total * 100;
  }
  if (summary.wholeCohortSurvivalPct === null) result.issues.push({ code: 'incomplete_inspection' });
  if (!result.issues.length && result.expectedSurvivalPct !== null) {
    result.comparable = true;
    result.differencePp = summary.wholeCohortSurvivalPct! - result.expectedSurvivalPct;
  }
  return result;
}
