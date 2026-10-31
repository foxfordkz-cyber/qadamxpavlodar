import { expect, type Page } from '@playwright/test';
import { SITE } from './helpers';
import { reference } from './outcomes-oracle';
import { outcomeWords } from './outcomes-ui';

export const parityPlantIds = [1, 2, 3, 4].map(n => `qa-parity-p${n}`);
export const parityInspections = ['I03', 'I04', 'I05'].map((id, index) => ({
  ...reference.inspectionCases.find((c: any) => c.id === id),
  observedOn: `${2024 + index}-10-30`,
}));

// Adapt wire-format V2 checks to the documented UI data shape. This fixture
// conversion contains no cost, selection, survival or Outcomes calculation.
export function uiSite(raw: any) {
  return { ...raw, checks: Object.fromEntries(['landPermission', 'utilities', 'access', 'siteSuitability'].map(key => {
    const c = raw.checks?.[key];
    return [key, c ? { state: c.status === 'not_applicable' ? 'cleared' : c.status ?? 'unknown',
      comment: c.comment ?? null, checkedBy: c.reviewedByName ?? c.reviewedBy ?? null, checkedAt: c.reviewedAt ?? null } : { state: 'unknown' }];
  })), missingData: (raw.missingData ?? []).map((v: unknown) => typeof v === 'string' ? { field: 'site', reason: v } : v),
  evidenceIds: raw.evidenceIds ?? [], isDemo: !!raw.isDemo };
}

export async function installComparableMockInputs(page: Page, site: any, rates: any[], version: number) {
  await page.evaluate(({ site, rates, version }) => {
    const db = JSON.parse(localStorage.getItem('gp-mock-db-v4')!);
    db.sites = db.sites.map((s: any) => s.id === site.id ? site : s);
    db.rates = rates; db.ratesVersion = version;
    localStorage.setItem('gp-mock-db-v4', JSON.stringify(db));
  }, { site, rates, version });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('outcome-econom')).toBeVisible();
}

export async function installComparableMockHistory(page: Page, cohortId: string, inspectionIds: string[]) {
  await page.evaluate(({ siteId, cohortId, ids, cases, inspectionIds, plantedOn }) => {
    const db = JSON.parse(localStorage.getItem('gp-mock-db-v4')!);
    const original = db.outcomes.cohorts.find((c: any) => c.siteId === siteId);
    const template = db.plants.find((p: any) => p.id === original.plants[0].plantId);
    const project = db.projects.find((p: any) => p.id === template.projectId);
    const projectId = `${cohortId}-project`;
    const plants = ids.map(id => ({ ...template, id, projectId, speciesId: 'sp-pinus-sylvestris',
      name: 'QA synthetic parity tree; not a field observation', isDemo: true, plantedAt: `${plantedOn}T12:00:00+05:00` }));
    const items = plants.map(p => ({ ...project.items[0], id: `item-${p.id}`, speciesId: p.speciesId, quantity: 1 }));
    db.plants.push(...plants);
    db.projects.push({ ...project, id: projectId, title: 'QA synthetic parity fixture', items, approved: { ...project.approved, items } });
    const provenance = { ...original.provenance, source: 'mock', isDemo: true, dataClass: 'demo', ratesVersion: null };
    db.outcomes.cohorts.push({ ...original, id: cohortId, plants: plants.map(p => ({ plantId: p.id, speciesId: p.speciesId })),
      plantedOn, forecast: null, provenance, version: 4 });
    for (const [index, c] of cases.entries()) db.outcomes.inspections.push({ id: inspectionIds[index], cohortId,
      observedOn: c.observedOn, version: 1, provenance: { ...provenance, capturedAt: `${c.observedOn}T12:00:00+05:00` },
      observations: c.observations.map((o: any) => ({ plantId: ids[Number(o.plantId.slice(-1)) - 1], state: o.state,
        reportId: null, evidenceIds: [...provenance.evidenceIds] })),
    });
    localStorage.setItem('gp-mock-db-v4', JSON.stringify(db));
  }, { siteId: SITE, cohortId, ids: parityPlantIds, cases: parityInspections, inspectionIds,
    plantedOn: reference.cohortReference.plantedOn });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('outcome-econom')).toBeVisible();
}

export async function selectParityHistory(page: Page, lang: 'ru' | 'kk', cohortId: string, inspectionId: string) {
  await page.getByLabel(outcomeWords[lang].cohort, { exact: true }).selectOption(cohortId);
  await page.getByLabel(outcomeWords[lang].inspection, { exact: true }).selectOption(inspectionId);
  await expect(page.getByTestId('outcome-stat-total').locator('dd')).toHaveText('4');
}

export const observedTexts = (page: Page) => page.locator('section[aria-labelledby="outcome-observed"] dd').allTextContents();
export async function browserNumbers(page: Page, values: string[], lang: 'ru' | 'kk') {
  // Chromium's kk grouping is comma/decimal dot; ru uses NBSP/decimal comma.
  // Infer separators in the actual browser rather than replacing every comma.
  // Unknown text stays invalid; it must never become a numeric zero.
  return page.evaluate(({ values, lang }) => {
    const locale = lang === 'kk' ? 'kk-KZ' : 'ru-RU';
    const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
    const group = parts.find(p => p.type === 'group')?.value;
    const decimal = parts.find(p => p.type === 'decimal')?.value;
    return values.map(text => {
      let number = text.replace(/[\s\u00a0\u202f₸%]/g, '');
      if (group) number = number.split(group).join('');
      if (decimal && decimal !== '.') number = number.split(decimal).join('.');
      return /^-?\d+(?:\.\d+)?$/.test(number) ? Number(number) : null;
    });
  }, { values, lang });
}
export const forecastNumbers = (snapshot: any) => ({
  facts: snapshot.analysis.facts, options: snapshot.analysis.options, scheme: snapshot.analysis.scheme,
  survival: snapshot.analysis.survival, model: snapshot.analysis.survivalModel,
  treeCount: snapshot.outcome.treeCount, expectedTreesY3: snapshot.outcome.expectedTreesY3,
  horizonYears: snapshot.outcome.horizonYears, cost: snapshot.outcome.cost,
  costPerExpectedTreeKzt: snapshot.outcome.costPerExpectedTreeKzt,
});
