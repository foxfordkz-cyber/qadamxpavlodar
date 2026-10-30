import { test, expect } from '../support/test';
import { expectNoOverflow, mockRole } from '../support/session';
import { SITE } from '../support/helpers';
import { auditForecast, expectedTrees, numericText, observed, reference } from '../support/outcomes-oracle';
import { checkObserved, checkReference, installP4Mock, mockDb, openOutcomes, outcomeWords } from '../support/outcomes-ui';

for (const lang of ['ru', 'kk'] as const) {
  test(`outcomes mock: ${lang} real demo history, annual/early/partial/undated selections and no stale zone`, async ({ page }) => {
    await openOutcomes(page, lang);
    const words = outcomeWords[lang];
    await expect(page.getByRole('heading', { name: words.title, exact: true })).toBeVisible();
    if (lang === 'kk') {
      const text = await page.locator('.gp-outcomes-page').innerText();
      for (const phrase of ['Сохранить прогноз', 'Контрольный осмотр', 'Партия растений', 'Приживаемость всей партии']) expect(text).not.toContain(phrase);
    }
    const db = await mockDb(page), full = db.outcomes.cohorts.find((c: any) => c.id === 'outcome-demo-full');
    const annual = db.outcomes.inspections.find((i: any) => i.id === 'outcome-demo-full-annual');
    expect(full.provenance.isDemo).toBe(true);
    expect(annual.provenance.isDemo).toBe(true);
    await checkObserved(page, observed(full.plants.length, annual.observations), words.unknown);
    await expect(page.getByTestId('outcome-comparison')).toBeVisible();
    const expectedPct = full.plants.reduce((s: number, p: any) => s + full.forecast.analysis.survival.find((r: any) => r.speciesId === p.speciesId).y1, 0) / full.plants.length;
    expect(numericText(await page.getByTestId('outcome-delta').locator('dd').innerText().then(s => s.replace(/п\.п\.|п\.т\./g, '')))).toBeCloseTo(observed(full.plants.length, annual.observations).wholeCohortSurvivalPct! - expectedPct, 0);
    await expect(page.locator('.gp-outcomes-page')).toContainText(lang === 'ru' ? 'посадки и осмотры вымышлены' : 'ойдан');
    const cohort = page.getByLabel(words.cohort, { exact: true }), inspection = page.getByLabel(words.inspection, { exact: true });
    await inspection.selectOption('outcome-demo-full-early');
    await expect(page.getByTestId('outcome-comparison')).toHaveCount(0);
    await inspection.selectOption('');
    await checkObserved(page, observed(full.plants.length, null), words.unknown);
    await cohort.selectOption('outcome-demo-partial');
    const partial = db.outcomes.cohorts.find((c: any) => c.id === 'outcome-demo-partial');
    await checkObserved(page, observed(partial.plants.length, db.outcomes.inspections.find((i: any) => i.cohortId === partial.id).observations), words.unknown);
    await expect(page.getByTestId('outcome-comparison')).toHaveCount(0);
    await cohort.selectOption('outcome-demo-undated');
    await expect(page.locator('#outcome-compare').locator('..')).toContainText(lang === 'ru' ? 'Дата посадки не подтверждена' : 'Отырғызу күні расталмаған');
    await expect(page.getByTestId('outcome-comparison')).toHaveCount(0);
    const zone = page.getByLabel(words.zone, { exact: true });
    const other = await zone.locator('option').evaluateAll((options, site) => (options as HTMLOptionElement[]).find(o => o.value && o.value !== site)!.value, SITE);
    await zone.selectOption(other);
    await expect(page.locator('.gp-outcomes-page')).toContainText(words.empty);
    await expect(page.getByTestId('outcome-stat-total')).toHaveCount(0);
    await expect(page.getByTestId('outcome-comparison')).toHaveCount(0);
    await expectNoOverflow(page);
  });
}

test('outcomes mock: P4 reference cases I01–I07 are calculated in the application, unknown is not dead', async ({ page }) => {
  checkReference();
  await openOutcomes(page);
  await installP4Mock(page);
  for (const c of reference.inspectionCases) {
    await page.getByLabel('Контрольный осмотр', { exact: true }).selectOption(c.observations ? `qa-${c.id}` : '');
    await checkObserved(page, observed(4, c.observations));
    await expect(page.getByTestId('outcome-comparison')).toHaveCount(0); // Explicitly no saved forecast for this QA party.
  }
  await expectNoOverflow(page);
});

test('outcomes mock: independent prices, common basis, durable snapshots and unchanged saved rates', async ({ page }) => {
  for (const c of reference.costCases) expect(expectedTrees(c.rows)).toBe(c.expected.expectedTreesY3);
  await openOutcomes(page);
  const snapshots: any[] = [];
  for (const variant of ['econom', 'optimal', 'max']) {
    const card = page.getByTestId(`outcome-${variant}`);
    await card.getByRole('button', { name: 'Сохранить прогноз', exact: true }).click();
    await expect(card.locator('[role=status]')).toContainText('Прогноз сохранён');
    const saved = (await mockDb(page)).outcomes.forecasts.at(-1);
    snapshots.push(saved);
    const checked = auditForecast(saved.snapshot);
    const metrics = card.locator('.gp-outcomes__metrics').first().locator('dd');
    for (const [index, value] of [checked.unit, checked.expected, checked.trees, checked.total].entries())
      expect(numericText(await metrics.nth(index).innerText())).toBeCloseTo(value!, 2);
  }
  for (const { snapshot } of snapshots.slice(1)) {
    expect(snapshot.rates).toEqual(snapshots[0].snapshot.rates);
    expect(snapshot.catalog).toEqual(snapshots[0].snapshot.catalog);
    expect(snapshot.analysis.facts).toEqual(snapshots[0].snapshot.analysis.facts);
    expect(snapshot.provenance.siteVersion).toBe(snapshots[0].snapshot.provenance.siteVersion);
    expect(snapshot.provenance.ratesVersion).toBe(snapshots[0].snapshot.provenance.ratesVersion);
    expect(snapshot.analysis.options.careYears).toBe(3);
  }
  const prices = snapshots.map(s => auditForecast(s.snapshot).unit!);
  for (const [i, variant] of ['econom', 'optimal', 'max'].entries())
    await expect(page.getByTestId(`outcome-${variant}`).locator('article')).toHaveClass(prices[i] === Math.min(...prices) ? /gp-outcomes__card--best/ : /^(?!.*gp-outcomes__card--best)/);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('outcome-econom')).toBeVisible();
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('gp-mock-db-v4')!);
    db.rates.find((r: any) => r.key === 'care.tree').value *= 2;
    db.ratesVersion++;
    localStorage.setItem('gp-mock-db-v4', JSON.stringify(db));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('outcome-econom')).toBeVisible();
  const db = await mockDb(page);
  for (const saved of snapshots) expect(db.outcomes.forecasts.find((f: any) => f.id === saved.id)).toEqual(saved);
  const before = auditForecast(snapshots[0].snapshot).unit!;
  expect(numericText(await page.getByTestId('outcome-econom').locator('.gp-outcomes__main-metric dd').innerText())).not.toBeCloseTo(before, 2);
});

test('outcomes mock: mixed or unknown cost never wins or becomes zero', async ({ page }) => {
  await openOutcomes(page);
  await page.locator('.gp-outcome-toggle input').uncheck();
  await expect(page.locator('.gp-outcomes__card--best')).toHaveCount(0);
  for (const variant of ['econom', 'optimal', 'max']) await expect(page.getByTestId(`outcome-${variant}`).locator('.gp-outcomes__main-metric dd')).toHaveText('Неизвестно');
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('gp-mock-db-v4')!);
    db.rates.find((r: any) => r.key === 'care.tree').value = null;
    db.ratesVersion++;
    localStorage.setItem('gp-mock-db-v4', JSON.stringify(db));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('outcome-econom')).toBeVisible();
  await expect(page.locator('.gp-outcomes__card--best')).toHaveCount(0);
  for (const variant of ['econom', 'optimal', 'max']) await expect(page.getByTestId(`outcome-${variant}`).locator('.gp-outcomes__main-metric dd')).toHaveText('Неизвестно');
});

test('outcomes mock: viewer cannot save; loading/error/retry never retain previous values', async ({ page }) => {
  await openOutcomes(page);
  await mockRole(page, 'Просмотр');
  await expect(page.getByTestId('outcome-econom')).toBeVisible();
  await expect(page.getByLabel('Зона', { exact: true }).locator(`option[value="${SITE}"]`)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Сохранить прогноз', exact: true })).toHaveCount(0);
  await page.evaluate(() => (globalThis as any).__gpMock.setMockControls({ networkDown: true, latencyMs: 1200 }));
  const zone = page.getByLabel('Зона', { exact: true });
  const other = await zone.locator('option').evaluateAll((options, site) => (options as HTMLOptionElement[]).find(o => o.value && o.value !== site)!.value, SITE);
  await zone.selectOption(other);
  await expect(page.locator('.gp-outcomes-page [role=status]').first()).toBeVisible();
  await expect(page.locator('.gp-outcomes-page [role=alert]').first()).toBeVisible();
  await expect(page.getByTestId('outcome-econom')).toHaveCount(0);
  await expect(page.getByTestId('outcome-comparison')).toHaveCount(0);
  await page.evaluate(() => (globalThis as any).__gpMock.setMockControls({ networkDown: false, latencyMs: 250 }));
  const retry = page.locator('.gp-outcomes-page').getByRole('button', { name: /Повторить/ });
  for (let i = 0; i < 2 && await retry.count(); i++) {
    const before = await retry.count();
    await retry.first().click();
    await expect.poll(() => retry.count()).toBeLessThan(before);
  }
  await expect(page.locator('.gp-outcomes-page [role=alert]')).toHaveCount(0);
  await expect(page.getByTestId('outcome-econom')).toBeVisible();
  await expectNoOverflow(page);
});
