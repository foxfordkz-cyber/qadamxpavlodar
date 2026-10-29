import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { e2eDir } from '../environment.mjs';
import { expectedScreens } from '../report-model.mjs';

const folder = join(e2eDir, 'playwright-report/summary');

test('demo ZIP has exactly the public report and 26 mock screenshots', () => {
  const entries = unzipSync(readFileSync(join(folder, 'green-pavlodar-demo.zip')));
  const allowed = ['index.html', 'DAMIR.md', 'results.json', ...expectedScreens.map(name => `screens/${name}`)].sort();
  assert.deepEqual(Object.keys(entries).sort(), allowed);
  const model = JSON.parse(new TextDecoder().decode(entries['results.json']));
  assert.equal(model.screens.filter(screen => screen.valid && screen.fresh).length, 26);
  for (const run of model.runs) for (const result of run.tests ?? []) {
    assert.equal('errors' in result, false);
    assert.equal('attachments' in result, false);
  }
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
  test(`offline report ${viewport.width}: search, filters, gallery and keyboard close work`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(join(folder, 'index.html')).href);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Приёмка и материалы демонстрации');
      const total = await page.locator('tbody tr').count();
      assert.ok(total > 0);
      await page.getByRole('searchbox', { name: 'Поиск по сценарию' }).fill('no-scenario-matches-this-phrase');
      await expect(page.locator('tbody tr:visible')).toHaveCount(0);
      await expect(page.locator('#no-results')).toBeVisible();
      await page.getByRole('searchbox').fill('');
      await page.getByLabel('Статус', { exact: true }).selectOption('fixme');
      const fixmes = await page.locator('tbody tr[data-status=fixme]').count();
      await expect(page.locator('tbody tr:visible')).toHaveCount(fixmes);
      await page.getByLabel('Статус', { exact: true }).selectOption('');
      await page.getByLabel('Прогон', { exact: true }).selectOption('smoke');
      await expect(page.locator('tbody tr:visible')).toHaveCount(await page.locator('tbody tr[data-run=smoke]').count());
      await page.getByLabel('Прогон', { exact: true }).selectOption('');
      await page.getByLabel('Размер', { exact: true }).selectOption('375');
      await expect(page.locator('.screen:visible')).toHaveCount(13);
      const first = page.locator('.screen:visible').first();
      await first.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect.poll(() => page.locator('dialog img').evaluate(img => img.naturalWidth)).toBe(375);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await page.getByLabel('Размер', { exact: true }).selectOption('');
      await expect(page.locator('.screen:visible')).toHaveCount(26);
      const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(size.scroll <= size.width, `Page overflow: ${size.scroll} > ${size.width}`);
      assert.deepEqual(errors, []);
      await page.evaluate(() => window.scrollTo(0, 0));
      const screens = join(e2eDir, 'test-results/report-ui');
      mkdirSync(screens, { recursive: true });
      await page.screenshot({ path: join(screens, `summary-${viewport.width}.png`) });
    } finally { await browser.close(); }
  });
}
