// Isolated synthetic test data. Never imported by the application or its mock API.
import osm from '../../../../fixtures/osm/sites.json';
import { species } from '../../src/shared/api/mock/species';
import type { CandidateSite } from '../../src/shared/api/types';
import type { OutcomeCohort, OutcomeInspection, OutcomeProvenance, OutcomeVariantInput } from '../../src/shared/api/outcomes';
import { analyzeZone, type Variant } from '../../src/shared/analytics/plan';
import { DEFAULT_RATES, ratesMap } from '../../src/shared/analytics/rates';
import { calculateOutcomeVariant, createOutcomeCohort, createOutcomeSnapshot } from '../../src/shared/analytics/outcomes';
import type { OutcomesData } from '../../src/features/coordinator/outcomes/model';

export const fixtureSite = (osm.sites as unknown as CandidateSite[]).find(s => s.id === 'site-osm-1569993037')!;
const provenance: OutcomeProvenance = { source: 'mock', capturedAt: '2023-10-30T00:00:00+05:00', dataClass: 'demo',
  isDemo: true, evidenceIds: ['test-outcomes-evidence'], siteVersion: fixtureSite.version, ratesVersion: null };
export function fixtureInput(variant: Variant = 'econom', mixed = false): OutcomeVariantInput {
  const catalog = structuredClone(species), rates = structuredClone(DEFAULT_RATES), site = structuredClone(fixtureSite);
  return { id: variant, site, catalog, rates, provenance: structuredClone(provenance),
    analysis: analyzeZone(site, catalog, ratesMap(rates), { variant, careYears: 3,
      excluded: mixed ? [] : catalog.filter(s => s.form !== 'tree').map(s => s.id) }) };
}
export function outcomesFixture(): OutcomesData {
  const inputs = (['econom', 'optimal', 'max'] as const).map(v => fixtureInput(v));
  const forecast = createOutcomeSnapshot(inputs[0]);
  const plants = forecast.analysis.scheme.flatMap(row => Array.from({ length: row.quantity }, (_, i) => ({ plantId: `test-${row.speciesId}-${i}`, speciesId: row.speciesId })));
  const raw: OutcomeCohort = { id: 'test-cohort-3y', siteId: fixtureSite.id, plantedOn: '2023-10-30', plants, forecast, provenance: structuredClone(provenance), version: 1 };
  const registry = plants.map(p => ({ ...p, siteId: fixtureSite.id, kind: 'tree' as const, plantedOn: raw.plantedOn, isDemo: true }));
  const cohort = createOutcomeCohort(raw, registry, '2026-10-30');
  const inspection: OutcomeInspection = { id: 'test-inspection-3y', cohortId: cohort.id, observedOn: '2026-10-30',
    observations: plants.map((p, i) => ({ plantId: p.plantId, state: i < 24 ? 'alive' : 'dead', reportId: 'test-report-only', evidenceIds: ['test-outcomes-evidence'] })),
    provenance: { ...provenance, capturedAt: '2026-10-30T09:00:00+05:00' }, version: 1 };
  const monthCohort = { ...cohort, id: 'test-cohort-month' }, noForecastCohort = { ...cohort, id: 'test-cohort-no-forecast', forecast: null };
  return { variants: inputs.map(calculateOutcomeVariant), catalog: structuredClone(species), asOf: '2026-10-30', cohorts: [
    { cohort, latestInspection: inspection },
    { cohort: monthCohort, latestInspection: { ...inspection, id: 'test-inspection-month', cohortId: monthCohort.id, observedOn: '2023-11-30' } },
    { cohort: noForecastCohort, latestInspection: { ...inspection, cohortId: noForecastCohort.id } },
  ] };
}
