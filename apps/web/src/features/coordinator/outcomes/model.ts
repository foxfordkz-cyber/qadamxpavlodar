import { compareOutcomeForecast, compareOutcomeVariants, summarizeOutcomeInspection } from '../../../shared/analytics/outcomes';
import type { DeepReadonly, OutcomeCohort, OutcomeInspection, OutcomeVariant } from '../../../shared/api/outcomes';
import type { Species } from '../../../shared/api/types';

/** Component inputs, NOT an HTTP contract. Bind only to the published backend adapter.
 * The adapter selects the latest inspection, verifies accepted evidence and supplies
 * its authoritative UTC+5 calendar date. Never reconstruct a historical forecast. */
export interface OutcomesData {
  variants: OutcomeVariant[];
  cohorts: { cohort: DeepReadonly<OutcomeCohort>; latestInspection: DeepReadonly<OutcomeInspection> | null }[];
  catalog: Species[];
  asOf: string;
}
export type OutcomesLoader = (signal: AbortSignal) => Promise<OutcomesData>;

export function prepareOutcomes(siteId: string, data: OutcomesData) {
  if (data.variants.some(v => v.siteId !== siteId) || data.cohorts.some(c => c.cohort.siteId !== siteId)
    || new Set(data.cohorts.map(c => c.cohort.id)).size !== data.cohorts.length) {
    throw new Error('outcomes_site_or_cohort_mismatch');
  }
  return {
    ...data,
    comparison: compareOutcomeVariants(data.variants),
    cohorts: data.cohorts.map(({ cohort, latestInspection }) => ({
      cohort, latestInspection,
      summary: summarizeOutcomeInspection(cohort, latestInspection, data.asOf),
      comparison: compareOutcomeForecast(cohort, latestInspection, data.asOf),
    })),
  };
}
export type OutcomesView = ReturnType<typeof prepareOutcomes>;
