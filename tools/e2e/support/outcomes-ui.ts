import { expect, type Page } from '@playwright/test';
import { openPage, SITE } from './helpers';
import { fraction, numericText, observed, reference } from './outcomes-oracle';

export const outcomeWords = {
  ru: { title: 'Прогноз и факт', cohort: 'Партия растений', inspection: 'Контрольный осмотр', zone: 'Зона', save: 'Сохранить прогноз', saved: 'Прогноз сохранён.', snapshots: 'Сохранённые прогнозы', unknown: 'Нет данных', empty: 'Для этой зоны ещё нет партий растений.' },
  kk: { title: 'Болжам және нақты нәтиже', cohort: 'Өсімдіктер партиясы', inspection: 'Бақылау мақсатындағы қарап тексеру', zone: 'Аймақ', save: 'Болжамды сақтау', saved: 'Болжам сақталды.', snapshots: 'Сақталған болжамдар', unknown: 'Дерек жоқ', empty: 'Бұл аймақта әзірге өсімдіктер партиялары жоқ.' },
};
export async function openOutcomes(page: Page, lang: 'ru' | 'kk' = 'ru') {
  await openPage(page, `/outcomes?site=${SITE}`, 'mock', lang);
  await expect(page.getByTestId('outcome-econom')).toBeVisible();
  await expect(page.getByTestId('outcome-stat-total')).toBeVisible();
}
export const mockDb = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('gp-mock-db-v4')!));
export async function checkObserved(page: Page, expected: ReturnType<typeof observed>, unknown = 'Нет данных') {
  for (const name of ['total', 'inspected', 'assessed', 'alive', 'dead', 'unknown', 'notInspected'] as const)
    await expect(page.getByTestId(`outcome-stat-${name}`).locator('dd')).toHaveText(String(expected[name]));
  const values = page.locator('.gp-outcome-stats--wide').first().locator('dd');
  for (const [index, value] of [[7, expected.inspectionCoveragePct], [8, expected.assessmentCoveragePct], [9, expected.survivalAmongAssessedPct], [10, expected.wholeCohortSurvivalPct]] as const) {
    if (value === null) await expect(values.nth(index)).toHaveText(unknown);
    else expect(numericText(await values.nth(index).innerText())).toBeCloseTo(value, 0);
  }
}

export async function installP4Mock(page: Page) {
  // Labelled synthetic data in the app's EXISTING mock registry, not a fake API
  // response or proof of server persistence. P4 has no retrospective forecast.
  await page.evaluate(ref => {
    const db = JSON.parse(localStorage.getItem('gp-mock-db-v4')!);
    const original = db.outcomes.cohorts[0];
    const template = db.plants.find((p: any) => p.id === original.plants[0].plantId);
    const project = db.projects.find((p: any) => p.id === template.projectId);
    const projectId = 'qa-p4-demo-project';
    const plants = ref.cohortReference.plantIds.map((id: string) => ({ ...template, id, projectId, isDemo: true,
      name: 'QA synthetic P4 tree', plantedAt: `${ref.cohortReference.plantedOn}T12:00:00+05:00` }));
    const items = plants.map((p: any) => ({ ...project.items[0], id: `item-${p.id}`, speciesId: p.speciesId, quantity: 1 }));
    db.plants.push(...plants);
    db.projects.push({ ...project, id: projectId, title: 'QA synthetic P4', items, approved: { ...project.approved, items } });
    const provenance = { ...original.provenance, isDemo: true, dataClass: 'demo',
      capturedAt: `${ref.inspectionComparisonDefault.observedOn}T12:00:00+05:00` };
    db.outcomes.cohorts.push({ ...original, id: 'qa-p4', plants: plants.map((p: any) => ({ plantId: p.id, speciesId: p.speciesId })),
      plantedOn: ref.cohortReference.plantedOn, forecast: null, provenance });
    for (const c of ref.inspectionCases.filter((c: any) => c.observations)) db.outcomes.inspections.push({
      id: `qa-${c.id}`, cohortId: 'qa-p4', observedOn: ref.inspectionComparisonDefault.observedOn, version: 1, provenance,
      observations: c.observations.map((o: any) => ({ ...o, reportId: null, evidenceIds: provenance.evidenceIds })),
    });
    localStorage.setItem('gp-mock-db-v4', JSON.stringify(db));
  }, reference);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByLabel('Партия растений', { exact: true }).selectOption('qa-p4');
}

export function checkReference() {
  for (const c of reference.inspectionCases) {
    const actual = observed(4, c.observations);
    for (const [name, value] of Object.entries(actual)) {
      const expected = fraction(c.expected[name]);
      if (expected === null) expect(value).toBeNull();
      else expect(value).toBeCloseTo(expected, 10);
    }
  }
}
