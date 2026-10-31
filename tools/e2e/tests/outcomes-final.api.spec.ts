import { randomUUID } from 'node:crypto';
import type { Cookie, Page } from '@playwright/test';
import { test, expect } from '../support/test';
import { apiCall, apiLogin } from '../support/api-login';
import { SITE } from '../support/helpers';
import { auditForecast, observed, reference } from '../support/outcomes-oracle';
import { checkObserved, mockDb, openOutcomes, outcomeWords } from '../support/outcomes-ui';
import { browserNumbers, forecastNumbers, installComparableMockHistory, installComparableMockInputs, observedTexts,
  parityInspections, parityPlantIds, selectParityHistory, uiSite } from '../support/outcomes-parity';

test.beforeEach(() => test.skip(!process.env.E2E_PASSWORD, 'E2E_PASSWORD is not set'));
let cookies: Cookie[] = [];
// Stable only inside the runner's disposable database: a worker restart must
// validate/reuse this fixture instead of trying to claim the same plants twice.
const cohortId = 'qa-final-parity-cohort';
const inspectionIds = parityInspections.map(c => `${cohortId}-${c.id}`);

test.beforeAll(async ({ browser, baseURL }) => {
  if (!process.env.E2E_PASSWORD) return;
  expect(process.env.E2E_ISOLATED, 'Outcome writes require scripts/isolated.mjs api --outcomes').toBe('1');
  expect(['localhost', '127.0.0.1', '[::1]'], 'Outcome writes are limited to the disposable loopback API').toContain(new URL(baseURL!).hostname);
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await apiLogin(page, 'coordinator', `/outcomes?site=${SITE}`);
    cookies = await context.cookies(); // In-memory only; no storageState or auth artifacts.
    let fixture = await apiCall(page, `/outcomes/cohorts/${cohortId}`);
    if (fixture.status === 404) {
      fixture = await apiCall(page, '/outcomes/cohorts', 'POST', { id: cohortId, siteId: SITE,
        plantIds: parityPlantIds, plantedOn: reference.cohortReference.plantedOn, snapshotId: null,
        evidenceIds: ['outcomes-demo-evidence'], expectedVersion: 0 }, randomUUID());
      expect(fixture.status, 'Parity trees require the isolated --outcomes QA seed').toBe(201);
    } else expect(fixture.status).toBe(200);
    expect(fixture.body.data.provenance.isDemo).toBe(true);
    expect(fixture.body.data.plantedOn).toBe(reference.cohortReference.plantedOn);
    expect(fixture.body.data.plants.map((p: any) => p.plantId)).toEqual(parityPlantIds);
    expect(fixture.body.data.forecast).toBeNull();
    const previous = await apiCall(page, `/outcomes/cohorts/${cohortId}/inspections`);
    expect(previous.status).toBe(200);
    let version = fixture.body.data.version;
    for (const [index, c] of parityInspections.entries()) {
      const observations = c.observations.map((o: any) => ({ plantId: parityPlantIds[reference.cohortReference.plantIds.indexOf(o.plantId)],
        state: o.state, reportId: null, evidenceIds: ['outcomes-demo-evidence'] }));
      const existing = previous.body.data.find((row: any) => row.data.id === inspectionIds[index])?.data;
      if (existing) {
        expect(existing.observedOn).toBe(c.observedOn);
        expect(existing.observations).toEqual(observations);
        continue;
      }
      const saved = await apiCall(page, `/outcomes/cohorts/${cohortId}/inspections`, 'POST', {
        id: inspectionIds[index], expectedVersion: version, observedOn: c.observedOn, evidenceIds: ['outcomes-demo-evidence'], observations,
      }, randomUUID());
      expect(saved.status).toBe(201);
      expect(saved.body.data.provenance.isDemo).toBe(true);
      version++;
    }
  } finally { await context.close(); }
});

async function enter(page: Page, lang: 'ru' | 'kk') {
  await page.context().addCookies(cookies);
  await page.goto(`/?source=api&lang=${lang}#/outcomes?site=${SITE}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('outcome-econom')).toBeVisible();
  await expect(page.locator('.gp-login')).toHaveCount(0);
}

for (const [lang, width] of [['ru', 1280], ['kk', 375]] as const) {
  test(`outcomes final API: ${lang}/${width} identical tree inputs have identical mock/API estimates and independent sums`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await enter(page, lang);
    const [site, rates, catalog] = await Promise.all([apiCall(page, `/sites/${SITE}`), apiCall(page, '/rates'), apiCall(page, '/species')]);
    for (const result of [site, rates, catalog]) expect(result.status).toBe(200);
    const mock = await page.context().newPage();
    try {
      await mock.setViewportSize({ width, height: 812 });
      await openOutcomes(mock, lang);
      await installComparableMockInputs(mock, uiSite(site.body.data), rates.body.data.rates, rates.body.data.version);
      for (const variant of ['econom', 'optimal', 'max']) {
        const saved = await apiCall(page, '/outcomes/snapshots', 'POST', { id: `qa-parity-${variant}-${randomUUID()}`,
          siteId: SITE, expectedVersion: site.body.data.version, expectedRatesVersion: rates.body.data.version, variant }, randomUUID());
        expect(saved.status).toBe(201);
        const apiSnapshot = saved.body.data.snapshot;
        const mockCard = mock.getByTestId(`outcome-${variant}`), apiCard = page.getByTestId(`outcome-${variant}`);
        await mockCard.getByRole('button', { name: outcomeWords[lang].save, exact: true }).click();
        await expect(mockCard.locator('[role=status]')).toContainText(outcomeWords[lang].saved);
        const mockSnapshot = (await mockDb(mock)).outcomes.forecasts.at(-1).snapshot;
        // Equality of inputs is checked before parity; unequal historic/current demos are never compared.
        expect(mockSnapshot.catalog).toEqual(catalog.body.data);
        expect(apiSnapshot.catalog).toEqual(catalog.body.data);
        expect(mockSnapshot.rates).toEqual(rates.body.data.rates);
        expect(apiSnapshot.rates).toEqual(rates.body.data.rates);
        expect(mockSnapshot.analysis.facts).toEqual(apiSnapshot.analysis.facts);
        expect(mockSnapshot.analysis.options).toEqual(apiSnapshot.analysis.options);
        expect(forecastNumbers(mockSnapshot)).toEqual(forecastNumbers(apiSnapshot));
        const independent = auditForecast(apiSnapshot);
        expect(apiSnapshot.outcome.cost.totalKzt).toBeCloseTo(independent.total, 8);
        expect(apiSnapshot.outcome.expectedTreesY3).toBeCloseTo(independent.expected, 8);
        expect(apiSnapshot.outcome.costPerExpectedTreeKzt).toBeCloseTo(independent.unit!, 8);
        const expected = [independent.unit, independent.expected, independent.trees, independent.total];
        const apiValues = await apiCard.locator('.gp-outcomes__metrics').first().locator('dd').allTextContents();
        const mockValues = await mockCard.locator('.gp-outcomes__metrics').first().locator('dd').allTextContents();
        expect(mockValues).toEqual(apiValues);
        const parsed = await browserNumbers(page, apiValues, lang);
        for (const [index, value] of expected.entries()) {
          const actual = parsed[index];
          expect(Number.isFinite(actual), `${variant} metric ${index} must display a number: ${JSON.stringify(apiValues[index])}`).toBe(true);
          expect(actual).toBeCloseTo(value!, 2);
        }
      }
      await expect(page).toHaveURL(/source=api/);
      await expect(mock).toHaveURL(/source=mock/);
    } finally { await mock.close(); }
  });

  test(`outcomes final API: ${lang}/${width} identical P4 observations match mock, HTTP and visible history`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await enter(page, lang);
    const mock = await page.context().newPage();
    try {
      await mock.setViewportSize({ width, height: 812 });
      await openOutcomes(mock, lang);
      await installComparableMockHistory(mock, cohortId, inspectionIds);
      for (const [index, c] of [null, ...parityInspections].entries()) {
        const inspectionId = index === 0 ? '' : inspectionIds[index - 1];
        const independent = observed(4, c?.observations ?? null);
        for (const target of [page, mock]) {
          await selectParityHistory(target, lang, cohortId, inspectionId);
          await checkObserved(target, independent, outcomeWords[lang].unknown);
          await expect(target.getByTestId('outcome-comparison')).toHaveCount(0); // No retrospective forecast invented.
          if (inspectionId) await expect(target.locator('section[aria-labelledby="outcome-observed"]')).toContainText(lang === 'ru' ? 'Демонстрационные данные' : 'Демонстрациялық деректер');
        }
        expect(await observedTexts(mock)).toEqual(await observedTexts(page));
        const summary = await apiCall(page, `/outcomes/cohorts/${cohortId}/summary${inspectionId ? `?inspectionId=${inspectionId}` : ''}`);
        expect(summary.status).toBe(200);
        expect(summary.body.data.summary).toMatchObject(independent);
        expect(summary.body.data.comparison.comparable).toBe(false);
      }
      const history = await apiCall(page, `/outcomes/cohorts/${cohortId}/inspections`);
      expect(history.status).toBe(200);
      expect(history.body.data).toHaveLength(3);
      expect(history.body.data.map((i: any) => i.data.observedOn)).toEqual(parityInspections.map(c => c.observedOn));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await selectParityHistory(page, lang, cohortId, inspectionIds[0]);
      await expect(page.getByTestId('outcome-whole').locator('dd')).toHaveText(outcomeWords[lang].unknown);
      await selectParityHistory(page, lang, cohortId, inspectionIds[2]);
      await expect(page.getByTestId('outcome-whole').locator('dd')).toHaveText('50%');
      expect((await apiCall(page, `/outcomes/cohorts/${cohortId}/inspections`)).body.data).toEqual(history.body.data);
    } finally { await mock.close(); }
  });
}
