import { test, expect } from '@playwright/test';
import { species } from '../support/catalogue';
import { inspectDocx } from '../support/docx';
import { openPage, SITE } from '../support/helpers';

test('zone report downloads Russian and Kazakh Word memos through export settings', async ({ page }) => {
  await openPage(page, `/report?site=${SITE}`);
  const report = page.locator('.gp-report-doc');
  await expect(report.getByRole('heading', { name: '3. Смета', exact: true })).toBeVisible();
  // The rendered analysis of this same zone supplies expectations, not fixed numeric snapshots.
  const planting = await report.locator('table').nth(1).locator('tbody tr').evaluateAll(rows => rows.map(row =>
    [...row.querySelectorAll('td')].map(cell => cell.textContent!.trim())));
  const survival = await report.locator('table').nth(3).locator('tbody tr').evaluateAll(rows => rows.map(row =>
    [...row.querySelectorAll('td')].map(cell => cell.textContent!.trim())));
  expect(planting.length).toBeGreaterThan(0);
  expect(survival.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: /Служебная записка.*Word/ }).click();
  const panel = page.getByRole('region', { name: /Служебная записка.*Word/ });
  await expect(panel).toBeVisible();
  const zones = panel.locator('select[multiple]');
  await expect(zones.locator(`option[value="${SITE}"]`)).toHaveCount(1);
  await zones.selectOption([]);
  await expect(panel.getByRole('button', { name: /Скачать.*\.docx/i })).toBeDisabled();
  await zones.selectOption([SITE]);
  const docs: Awaited<ReturnType<typeof inspectDocx>>[] = [];
  for (const language of ['Рус', 'Қаз']) {
    await panel.locator('label').filter({ hasText: new RegExp(`^${language}$`) }).click();
    await expect(panel.getByRole('radio', { name: language, exact: true })).toBeChecked();
    const [file] = await Promise.all([
      page.waitForEvent('download'), panel.getByRole('button', { name: /Скачать.*\.docx/i }).click(),
    ]);
    expect(file.suggestedFilename()).toMatch(language === 'Рус' ? /-ru-.*\.docx$/ : /-kk-.*\.docx$/);
    const doc = await inspectDocx(page, (await file.path())!);
    docs.push(doc);
    const kk = language === 'Қаз';
    for (const phrase of kk
      ? ['ҚЫЗМЕТТІК ЖАЗБА', 'Негіздеме', 'Баптар бойынша смета', 'Жылдар бойынша жерсіну', 'Дереккөздер', 'аралықтар есептелмеген']
      : ['СЛУЖЕБНАЯ ЗАПИСКА', 'Основание', 'Смета по статьям', 'Приживаемость по годам', 'Источники данных']) expect(doc.text).toContain(phrase);
    if (kk) for (const phrase of ['СЛУЖЕБНАЯ ЗАПИСКА', 'Смета по статьям', 'Приживаемость по годам', 'Дата формирования', 'Решение / замечания']) expect(doc.text).not.toContain(phrase);
    for (const row of planting) {
      const plant = species.find(s => s.latin === row[2]);
      expect(plant, `Catalogue entry for ${row[2]}`).toBeDefined();
      expect(doc.text).toContain(kk ? plant!.nameKk || plant!.nameRu : plant!.nameRu);
      expect(doc.text).toContain(plant!.latin);
    }
    const table = doc.tables.find(table => table[0]?.includes(kk ? '1 жыл, %' : '1 год, %'));
    expect(table, 'Survival table with years 1–3').toBeDefined();
    expect(table!.length).toBe(survival.length + 1);
    const number = (value: string) => Number(value.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
    for (let i = 0; i < survival.length; i++) {
      const cells = table![i + 1];
      // Only year 1 has a range; years 2/3 must be scalar values from the analysis.
      expect(cells).toHaveLength(5);
      for (const [docIndex, uiIndex] of [[3, 2], [4, 3]]) {
        expect(cells[docIndex]).toMatch(/^\d+(?:[.,]\d+)?$/);
        // The current HTML report displays zero as an em dash; DOCX preserves zero.
        expect(number(cells[docIndex])).toBe(survival[i][uiIndex] === '—' ? 0 : number(survival[i][uiIndex]));
      }
      expect(number(cells[1])).toBe(number(survival[i][1]));
      expect(cells[2].replace(/\s/g, '')).toBe(survival[i][4].replace(/\s/g, ''));
    }
    await expect(page.locator('nav.gp-nav').getByRole('link', { name: 'Приоритеты', exact: true })).toBeVisible();
    await expect(report.getByRole('heading', { name: '3. Смета', exact: true })).toBeVisible();
  }
  const numbers = (doc: typeof docs[number]) => doc.tables.map(table => table.slice(1)
    .map(row => row.slice(1).map(cell => cell.match(/[+−-]?\d+(?:[\s\u00a0\u202f]\d{3})*(?:[.,]\d+)?/g) ?? [])));
  expect(numbers(docs[1]), 'Quantities, costs, forecasts and ecological effects across languages').toEqual(numbers(docs[0]));
});
