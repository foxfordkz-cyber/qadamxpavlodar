import { randomUUID } from 'node:crypto';
import { test, expect } from '../support/test';
import { apiLogin, apiCall } from '../support/api-login';
import { SITE } from '../support/helpers';
import { expectNoOverflow } from '../support/session';
import { observed, reference } from '../support/outcomes-oracle';
import { checkObserved, outcomeWords } from '../support/outcomes-ui';

test.describe.configure({ mode: 'default' }); // Shared disposable rates are changed and restored sequentially.
test.beforeEach(() => test.skip(!process.env.E2E_PASSWORD, 'E2E_PASSWORD is not set'));
const path = `/outcomes/sites/${SITE}`;
const sessions: Record<string, any[]> = {};
test.beforeAll(async ({ browser, baseURL }) => {
  if (!process.env.E2E_PASSWORD) return;
  // Outcome tests exercise records, not repeated password login. Reuse genuine
  // sessions in memory so this suite does not trip the 10-logins/account limiter.
  // No cookies/storageState are written to disk or attached to the report.
  for (const role of ['coordinator', 'admin', 'viewer']) {
    const context = await browser.newContext({ baseURL });
    try {
      const page = await context.newPage();
      await apiLogin(page, role, `/outcomes?site=${SITE}`);
      sessions[role] = await context.cookies();
    } finally { await context.close(); }
  }
});
async function outcomeLogin(page: import('@playwright/test').Page, role: string) {
  await page.context().addCookies(sessions[role]);
  await page.goto(`/?source=api&lang=ru#/outcomes?site=${SITE}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('outcome-econom')).toBeVisible();
  await expect(page.locator('.gp-login')).toHaveCount(0);
}

for (const width of [1280, 375]) for (const lang of ['ru', 'kk'] as const) {
  test(`outcomes API: ${lang}/${width}, today's partial demo is not an annual result`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await outcomeLogin(page, 'coordinator');
    await page.goto(`/?source=api&lang=${lang}#/outcomes?site=${SITE}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('outcome-econom')).toBeVisible();
    const read = await apiCall(page, path);
    expect(read.status).toBe(200);
    const data = read.body.data;
    const cohort = data.cohorts.find((c: any) => c.id === 'outcomes-demo-cohort');
    expect(cohort, 'Run seed:outcomes in the isolated database').toBeDefined();
    const inspection = data.inspections.find((i: any) => i.id === 'outcomes-demo-inspection');
    expect(cohort.plantedOn).toBe(data.asOf);
    expect(inspection.observedOn).toBe(data.asOf);
    expect(cohort.provenance.isDemo).toBe(true);
    expect(inspection.provenance.isDemo).toBe(true);
    expect(inspection.observations.map((o: any) => o.state)).toEqual(['alive', 'dead', 'unknown']);
    await checkObserved(page, observed(cohort.plants.length, inspection.observations), outcomeWords[lang].unknown);
    await expect(page.getByTestId('outcome-comparison')).toHaveCount(0);
    await expect(page.locator('.gp-outcomes-page')).toContainText(lang === 'ru' ? 'Демонстрационные данные' : 'Демонстрациялық деректер');
    await expect(page.locator('.gp-outcomes-page')).not.toContainText('outcome-demo-full');
    await expectNoOverflow(page);
    const summary = await apiCall(page, '/outcomes/cohorts/outcomes-demo-cohort/summary?inspectionId=outcomes-demo-inspection');
    expect(summary.status).toBe(200);
    expect(summary.body.data.comparison.comparable).toBe(false);
    expect(summary.body.data.comparison.issues.map((i: any) => i.code)).toContain('unmatched_horizon');
    expect(summary.body.data.summary).toMatchObject(observed(cohort.plants.length, inspection.observations));
  });
}

test('outcomes API: viewer is read-only in UI and HTTP', async ({ page }) => {
  await outcomeLogin(page, 'viewer');
  await expect(page.getByTestId('outcome-econom')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить прогноз', exact: true })).toHaveCount(0);
  const before = await apiCall(page, path);
  const source = before.body.data.forecasts[0].snapshot.provenance;
  const saved = await apiCall(page, '/outcomes/snapshots', 'POST', { id: `qa-viewer-${randomUUID()}`, siteId: SITE,
    expectedVersion: source.siteVersion, expectedRatesVersion: source.ratesVersion, variant: 'econom' }, randomUUID());
  expect(saved.status).toBe(403);
  expect((await apiCall(page, path)).body.data.forecasts).toEqual(before.body.data.forecasts);
});

test('outcomes API: save/reload, identical replay, conflicts, and immutable forecast after rate edit', async ({ page }) => {
  await outcomeLogin(page, 'admin');
  const card = page.getByTestId('outcome-econom');
  await expect(card).toBeVisible();
  const savedResponse = page.waitForResponse(r => r.url().endsWith('/outcomes/snapshots') && r.request().method() === 'POST');
  await card.getByRole('button', { name: 'Сохранить прогноз', exact: true }).click();
  const response = await savedResponse;
  expect(response.status()).toBe(201);
  const saved = (await response.json()).data;
  await expect(card.locator('[role=status]')).toContainText('Прогноз сохранён');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(card).toBeVisible();
  const read = await apiCall(page, path);
  expect(read.body.data.forecasts.find((f: any) => f.id === saved.id).snapshot).toEqual(saved.snapshot);
  const rates = await apiCall(page, '/rates');
  expect(rates.status).toBe(200);
  const body = { id: `qa-save-${randomUUID()}`, siteId: SITE, expectedVersion: saved.snapshot.provenance.siteVersion,
    expectedRatesVersion: rates.body.data.version, variant: 'econom' };
  const key = randomUUID();
  const first = await apiCall(page, '/outcomes/snapshots', 'POST', body, key);
  expect(first.status).toBe(201);
  const replay = await apiCall(page, '/outcomes/snapshots', 'POST', body, key);
  expect(replay.status).toBe(201);
  expect(replay.body).toEqual(first.body);
  expect((await apiCall(page, path)).body.data.forecasts.filter((f: any) => f.id === body.id)).toHaveLength(1);
  expect((await apiCall(page, '/outcomes/snapshots', 'POST', { ...body, variant: 'max' }, key)).status).toBe(409);
  expect((await apiCall(page, '/outcomes/snapshots', 'POST', { ...body, id: randomUUID(), expectedVersion: body.expectedVersion + 100 }, randomUUID())).status).toBe(409);
  const rate = rates.body.data.rates.find((r: any) => r.key === 'care.tree');
  try {
    const changed = await apiCall(page, '/rates', 'PATCH', { key: 'care.tree', value: rate.value + 123,
      source: 'QA isolated synthetic rate', expectedVersion: rates.body.data.version }, randomUUID());
    expect(changed.status).toBe(200);
    expect((await apiCall(page, '/outcomes/snapshots', 'POST', { ...body, id: randomUUID() }, randomUUID())).status).toBe(409);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(card).toBeVisible();
    expect((await apiCall(page, path)).body.data.forecasts.find((f: any) => f.id === saved.id).snapshot).toEqual(saved.snapshot);
    await page.getByLabel('Сохранённые прогнозы', { exact: true }).selectOption(saved.id);
    await expect(page.locator('.gp-outcome-snapshot').last()).toBeVisible();
  } finally {
    const current = await apiCall(page, '/rates');
    const restore = await apiCall(page, '/rates', 'PATCH', { key: rate.key, value: rate.value, source: rate.source,
      expectedVersion: current.body.data.version }, randomUUID());
    expect(restore.status).toBe(200);
  }
});

test('outcomes API: read failure stays an API error and retry restores real partial data', async ({ page }) => {
  await outcomeLogin(page, 'coordinator');
  await expect(page.getByTestId('outcome-stat-total')).toBeVisible();
  const pattern = '**/api/v1/outcomes/sites/**';
  await page.route(pattern, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'qa_unavailable', message: 'QA unavailable' } }) }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.gp-outcomes-page [role=alert]')).toBeVisible();
  await expect(page.getByTestId('outcome-stat-total')).toHaveCount(0);
  await expect(page.getByTestId('outcome-comparison')).toHaveCount(0);
  await expect(page.getByLabel('Партия растений', { exact: true })).toHaveCount(0);
  await page.unroute(pattern);
  await page.locator('.gp-outcomes-page').getByRole('button', { name: /Повторить/ }).click();
  await expect(page.getByTestId('outcome-stat-alive').locator('dd')).toHaveText('1');
  await expect(page.getByTestId('outcome-stat-dead').locator('dd')).toHaveText('1');
  await expect(page.getByTestId('outcome-comparison')).toHaveCount(0);
});

for (const c of reference.inspectionCases) {
  test(`outcomes API: P4 ${c.id} uses real registry/HTTP, independent counts, no duplicate saves`, async ({ page }) => {
    await outcomeLogin(page, 'coordinator');
    const cohortId = `qa-${c.id}-${randomUUID()}`;
    const plants = reference.cohortReference.plantIds.map((_: string, i: number) => `qa-api-${c.id}-p${i + 1}`);
    const cohort = await apiCall(page, '/outcomes/cohorts', 'POST', { id: cohortId, siteId: SITE, plantIds: plants,
      plantedOn: c.id === 'I01' ? null : reference.cohortReference.plantedOn, snapshotId: null, evidenceIds: ['outcomes-demo-evidence'], expectedVersion: 0 }, randomUUID());
    expect(cohort.status, 'P4 plants require scripts/isolated.mjs api --outcomes').toBe(201);
    if (c.id === 'I01') expect(cohort.body.data.plantedOn).toBeNull();
    let inspectionId = '';
    if (c.observations) {
      inspectionId = `qa-inspection-${randomUUID()}`;
      const body = { id: inspectionId, expectedVersion: 1, observedOn: reference.inspectionComparisonDefault.observedOn,
        evidenceIds: ['outcomes-demo-evidence'], observations: c.observations.map((o: any) => ({ ...o,
          plantId: plants[reference.cohortReference.plantIds.indexOf(o.plantId)], reportId: null, evidenceIds: ['outcomes-demo-evidence'] })) };
      const key = randomUUID(), url = `/outcomes/cohorts/${cohortId}/inspections`;
      expect((await apiCall(page, url, 'POST', { ...body, observations: [body.observations[0], body.observations[0]] }, randomUUID())).status).toBe(400);
      const first = await apiCall(page, url, 'POST', body, key);
      expect(first.status).toBe(201);
      expect((await apiCall(page, url, 'POST', body, key)).body).toEqual(first.body);
      expect((await apiCall(page, url)).body.data).toHaveLength(1);
      expect((await apiCall(page, url, 'POST', { ...body, id: randomUUID() }, randomUUID())).status).toBe(409);
    }
    const summary = await apiCall(page, `/outcomes/cohorts/${cohortId}/summary${inspectionId ? `?inspectionId=${inspectionId}` : ''}`);
    expect(summary.status).toBe(200);
    expect(summary.body.data.summary).toMatchObject(observed(4, c.observations));
    expect(summary.body.data.comparison.comparable).toBe(false); // No retrospective forecast for P4 API fixture.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByLabel('Партия растений', { exact: true }).selectOption(cohortId);
    await page.getByLabel('Контрольный осмотр', { exact: true }).selectOption(inspectionId);
    await checkObserved(page, observed(4, c.observations));
  });
}
