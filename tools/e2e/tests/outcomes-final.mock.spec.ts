import { test, expect } from '../support/test';
import { SITE } from '../support/helpers';
import { observed, reference } from '../support/outcomes-oracle';
import { checkObserved, installP4Mock, mockDb, openOutcomes, outcomeWords } from '../support/outcomes-ui';

for (const lang of ['ru', 'kk'] as const) {
  test(`outcomes final mock: ${lang} unknown is distinct from zero survival and demo history survives reload`, async ({ page }) => {
    await openOutcomes(page);
    await installP4Mock(page);
    await page.goto(`/?source=mock&lang=${lang}#/outcomes?site=${SITE}`, { waitUntil: 'domcontentloaded' });
    const words = outcomeWords[lang];
    await page.getByLabel(words.cohort, { exact: true }).selectOption('qa-p4');
    const before = (await mockDb(page)).outcomes;
    const inspection = page.getByLabel(words.inspection, { exact: true });
    await inspection.selectOption('');
    await checkObserved(page, observed(4, null), words.unknown);
    await expect(page.getByTestId('outcome-whole').locator('dd')).toHaveText(words.unknown);
    for (const id of ['I03', 'I06', 'I03']) {
      const c = reference.inspectionCases.find((item: any) => item.id === id);
      await inspection.selectOption(`qa-${id}`);
      await checkObserved(page, observed(4, c.observations), words.unknown);
      await expect(page.getByTestId('outcome-whole').locator('dd')).toHaveText(id === 'I06' ? '0%' : words.unknown);
      await expect(page.locator('section[aria-labelledby="outcome-observed"]')).toContainText(lang === 'ru' ? 'Демонстрационные данные' : 'Демонстрациялық деректер');
      await expect(page.getByTestId('outcome-comparison')).toHaveCount(0);
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByLabel(words.cohort, { exact: true }).selectOption('qa-p4');
    await expect(page.getByLabel(words.inspection, { exact: true }).locator('option')).toHaveCount(7);
    await page.getByLabel(words.inspection, { exact: true }).selectOption('qa-I06');
    await expect(page.getByTestId('outcome-whole').locator('dd')).toHaveText('0%');
    // Reading or changing the selected observation never rewrites immutable history.
    expect((await mockDb(page)).outcomes).toEqual(before);
  });
}
