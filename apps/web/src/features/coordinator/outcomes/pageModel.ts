import { analyzeZone, type PlanOptions, type Variant } from '../../../shared/analytics/plan';
import { calculateOutcomeVariant, compareOutcomeForecast, compareOutcomeVariants, createOutcomeCohort, summarizeOutcomeInspection } from '../../../shared/analytics/outcomes';
import { ratesMap } from '../../../shared/analytics/rates';
import type { Api } from '../../../shared/api/api';
import type { OutcomeSiteData } from '../../../shared/api/outcomesClient';
import type { OutcomeIssueCode, OutcomeVariantInput } from '../../../shared/api/outcomes';
import { ApiError } from '../../../shared/api/transport';
import { getLang, t, type Key } from '../../../shared/i18n';

export const ISSUE_KEYS = {
  empty_scheme: 'outcomePage.issue.empty_scheme', invalid_quantity: 'outcomePage.issue.invalid_quantity',
  missing_species: 'outcomePage.issue.missing_species', species_tier_mismatch: 'outcomePage.issue.species_tier_mismatch',
  invalid_probability: 'outcomePage.issue.invalid_probability', missing_survival: 'outcomePage.issue.missing_survival',
  duplicate_survival: 'outcomePage.issue.duplicate_survival', invalid_rate: 'outcomePage.issue.invalid_rate',
  missing_rate: 'outcomePage.issue.missing_rate', duplicate_rate: 'outcomePage.issue.duplicate_rate',
  invalid_price: 'outcomePage.issue.invalid_price', missing_area: 'outcomePage.issue.missing_area',
  invalid_cost: 'outcomePage.issue.invalid_cost', cost_mismatch: 'outcomePage.issue.cost_mismatch',
  analysis_site_mismatch: 'outcomePage.issue.analysis_site_mismatch', mixed_planting: 'outcomePage.issue.mixed_planting',
  no_trees: 'outcomePage.issue.no_trees', wrong_horizon: 'outcomePage.issue.wrong_horizon',
  zero_expected_trees: 'outcomePage.issue.zero_expected_trees', incomplete_cost: 'outcomePage.issue.incomplete_cost',
  incompatible_basis: 'outcomePage.issue.incompatible_basis', insufficient_variants: 'outcomePage.issue.insufficient_variants',
  missing_planting_date: 'outcomePage.issue.missing_planting_date', missing_forecast: 'outcomePage.issue.missing_forecast',
  no_inspection: 'outcomePage.issue.no_inspection', unmatched_horizon: 'outcomePage.issue.unmatched_horizon',
  incomplete_inspection: 'outcomePage.issue.incomplete_inspection', cohort_mismatch: 'outcomePage.issue.cohort_mismatch',
} as const satisfies Record<OutcomeIssueCode, Key>;

export function outcomeNumber(value: number | null | undefined, suffix = '', digits = 1): string {
  return value == null || !Number.isFinite(value) ? t('outcomePage.noData')
    : new Intl.NumberFormat(getLang() === 'kk' ? 'kk-KZ' : 'ru-RU', { maximumFractionDigits: digits }).format(value) + suffix;
}
export function outcomeDelta(value: number | null): string {
  return value == null ? t('outcomePage.noData') : `${value > 0 ? '+' : ''}${outcomeNumber(value)} ${t('outcomePage.pp')}`;
}
export function outcomeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'outcomes_not_connected') return t('outcomePage.notConnected');
    if (error.code === 'outcomes_storage') return t('outcomePage.storageError');
    if (error.status === 401) return t('state.unauthenticated');
    if (error.status === 403) return t('state.forbidden');
    if (error.status === 409) return t('outcomePage.conflict');
    if (error.status === 0 || error.status === 503) return t('state.network');
  }
  return t('outcomePage.invalidData');
}

/** One catalog/rate snapshot per comparison; no formula or fallback price lives in the view. */
export async function loadOutcomePlans(api: Pick<Api, 'site' | 'species' | 'rates' | 'kind'>, siteId: string, treesOnly: boolean) {
  const [site, catalog, rateData] = await Promise.all([api.site(siteId), api.species(), api.rates()]);
  const provenance = { source: api.kind, capturedAt: new Date().toISOString(), dataClass: 'estimate' as const,
    isDemo: api.kind === 'mock' || site.isDemo, evidenceIds: [...site.evidenceIds],
    siteVersion: site.version, ratesVersion: rateData.version };
  const inputs: OutcomeVariantInput[] = (['econom', 'optimal', 'max'] as Variant[]).map(variant => {
    const options: Partial<PlanOptions> = { variant, careYears: 3, excluded: treesOnly ? catalog.filter(s => s.form !== 'tree').map(s => s.id) : [] };
    return { id: variant, site, catalog, rates: rateData.rates, provenance,
      analysis: analyzeZone(site, catalog, ratesMap(rateData.rates), options) };
  });
  const variants = inputs.map(calculateOutcomeVariant);
  return { inputs, variants, comparison: compareOutcomeVariants(variants) };
}

/** A stale selection never falls back to another party's observations. */
export function selectOutcomeInspection(data: OutcomeSiteData, siteId: string, cohortId: string, inspectionId: string | null) {
  if (data.siteId !== siteId) throw new Error('site_mismatch');
  const candidate = data.cohorts.find(c => c.id === cohortId && c.siteId === siteId);
  if (!candidate) throw new Error('cohort_not_found');
  const cohort = createOutcomeCohort({ ...candidate, plants: candidate.plants.map(p => ({ ...p })),
    provenance: { ...candidate.provenance, evidenceIds: [...candidate.provenance.evidenceIds] } }, data.registry, data.asOf);
  const inspection = inspectionId === null ? null : data.inspections.find(i => i.id === inspectionId && i.cohortId === cohort.id);
  if (inspection === undefined) throw new Error('inspection_not_found');
  return { cohort, inspection, summary: summarizeOutcomeInspection(cohort, inspection, data.asOf),
    comparison: compareOutcomeForecast(cohort, inspection, data.asOf) };
}
