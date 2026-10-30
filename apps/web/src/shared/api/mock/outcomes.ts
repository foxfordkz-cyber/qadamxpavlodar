import { analyzeZone } from '../../analytics/plan';
import { ratesMap } from '../../analytics/rates';
import { createOutcomeCohort, createOutcomeSnapshot } from '../../analytics/outcomes';
import type { OutcomeCohort, OutcomeInspection, OutcomeProvenance, RegisteredOutcomePlant } from '../outcomes';
import type { OutcomeSiteData, SavedOutcomeForecast } from '../outcomesClient';
import type { MockDb } from './fixtures';
import { species } from './species';

export const OUTCOME_DEMO_SITE = 'site-osm-1569993037';
export interface MockOutcomeStore {
  schemaVersion: 1;
  cohorts: OutcomeSiteData['cohorts'];
  inspections: OutcomeSiteData['inspections'];
  forecasts: SavedOutcomeForecast[];
}
export const pavlodarDay = (now = new Date()) => new Date(now.getTime() + 5 * 3600000).toISOString().slice(0, 10);

/** Resolve membership by implemented project, never by spatial proximity. No parallel plant registry. */
export function outcomeRegistry(db: MockDb): RegisteredOutcomePlant[] {
  return db.plants.flatMap(p => {
    const project = db.projects.find(pr => pr.id === p.projectId && pr.implementedAt && pr.approved);
    if (!project || !p.speciesId || p.kind === 'flowerbed') return [];
    return [{ plantId: p.id, speciesId: p.speciesId, siteId: project.siteId, kind: p.kind,
      plantedOn: p.plantedAt ? pavlodarDay(new Date(p.plantedAt)) : null, isDemo: p.isDemo }];
  });
}

/** Lazy, idempotent addition to the EXISTING mock registry. Historical dates and observations are fictional. */
export function ensureOutcomeDemo(db: MockDb): MockOutcomeStore {
  if (db.outcomes) return db.outcomes;
  const store: MockOutcomeStore = { schemaVersion: 1, cohorts: [], inspections: [], forecasts: [] };
  const site = db.sites.find(s => s.id === OUTCOME_DEMO_SITE);
  if (!site?.centroid) { db.outcomes = store; return store; }
  const evidenceId = 'ev-demo-outcomes-history';
  db.evidence.push({ id: evidenceId, sourceType: 'fixture', dataClass: 'demo',
    sourceLabel: 'Демо: вымышленная история посадки и осмотров',
    note: 'Посадка 2025 года и осмотры 2026 года созданы для демонстрации. Прогноз рассчитан нынешней моделью; это не историческая проверка её качества.' });
  const provenance = (capturedAt: string): OutcomeProvenance => ({ source: 'mock', capturedAt, dataClass: 'demo',
    isDemo: true, evidenceIds: [evidenceId], siteVersion: site.version, ratesVersion: db.ratesVersion });
  const analysis = analyzeZone(site, species, ratesMap(db.rates), { variant: 'econom', careYears: 3,
    excluded: species.filter(s => s.form !== 'tree').map(s => s.id) });
  const snapshot = createOutcomeSnapshot({ id: 'demo-history', site, analysis, catalog: species, rates: db.rates,
    provenance: provenance('2025-10-14T12:00:00+05:00') });
  if (!analysis.scheme.length) { db.outcomes = store; return store; }
  for (const scenario of ['full', 'partial', 'undated'] as const) {
    const id = `outcome-demo-${scenario}`;
    const plantedOn = scenario === 'undated' ? null : '2025-10-15';
    const forecast = scenario === 'undated' ? null : snapshot;
    const scheme = scenario === 'undated' ? [{ ...analysis.scheme[0], quantity: 3 }] : analysis.scheme;
    const plants: OutcomeCohort['plants'] = [];
    for (const row of scheme) for (let i = 0; i < row.quantity; i++) {
      const plantId = `${id}-${plants.length + 1}`;
      plants.push({ plantId, speciesId: row.speciesId });
      db.plants.push({ id: plantId, name: 'Дерево: демонстрационная история', kind: 'tree', speciesId: row.speciesId,
        plantedAt: plantedOn ? `${plantedOn}T12:00:00+05:00` : null, lat: site.centroid.lat, lng: site.centroid.lng,
        condition: 'unknown', projectId: id, evidenceIds: [evidenceId], isDemo: true, version: 1 });
    }
    const items = plants.map(p => ({ id: `item-${p.plantId}`, speciesId: p.speciesId, kind: 'point' as const,
      geometry: { type: 'Point' as const, coordinates: [site.centroid!.lng, site.centroid!.lat] as [number, number] },
      quantity: 1, origin: 'manual' as const, conflicts: [] }));
    db.projects.push({ id, siteId: site.id, title: `Демо: история посадки (${scenario})`, version: 1, designVersion: 1,
      status: 'approved', items, season: 'Демонстрационная история', createdBy: 'demo',
      createdAt: '2025-10-14T12:00:00+05:00', updatedAt: '2026-10-15T12:00:00+05:00', reviews: [],
      approved: { designVersion: 1, items, approvedAt: '2025-10-14T12:00:00+05:00', by: 'demo' },
      // Implementation recorded in 2026; it does not substitute for an unknown planting date.
      implementedAt: '2026-10-15T12:00:00+05:00', isDemo: true });
    const cohort = createOutcomeCohort({ id, siteId: site.id, plants, plantedOn, forecast,
      provenance: provenance('2026-10-15T12:00:00+05:00'), version: 1 }, outcomeRegistry(db), '2026-10-30');
    store.cohorts.push(cohort);
    const observations = (scenario === 'partial' ? plants.slice(0, Math.max(2, Math.floor(plants.length / 2))) : plants)
      .map((p, i) => ({ plantId: p.plantId,
        state: (scenario === 'partial' && i === 0 ? 'unknown' : scenario !== 'undated' && i % 7 === 0 ? 'dead' : 'alive') as 'unknown' | 'dead' | 'alive',
        reportId: null, evidenceIds: [evidenceId] }));
    const inspection: OutcomeInspection = { id: `${id}-annual`, cohortId: id, observedOn: '2026-10-15', observations,
      provenance: provenance('2026-10-15T12:00:00+05:00'), version: 1 };
    store.inspections.push(inspection);
    if (scenario === 'full') store.inspections.push({ ...inspection, id: `${id}-early`, observedOn: '2026-10-01',
      provenance: provenance('2026-10-01T12:00:00+05:00') });
  }
  store.forecasts.push({ id: 'demo-history', snapshot });
  db.outcomes = store;
  return store;
}

export function readMockOutcomes(db: MockDb, siteId: string, asOf = pavlodarDay()): OutcomeSiteData {
  const store = ensureOutcomeDemo(db);
  const cohorts = store.cohorts.filter(c => c.siteId === siteId);
  return { siteId, asOf, cohorts, inspections: store.inspections.filter(i => cohorts.some(c => c.id === i.cohortId)),
    forecasts: store.forecasts.filter(f => f.snapshot.analysis.siteId === siteId),
    registry: outcomeRegistry(db).filter(p => p.siteId === siteId) };
}
