import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { e2eDir } from '../environment.mjs';
import { expectedScreens } from '../report-model.mjs';

const folder = join(e2eDir, 'playwright-report/summary');
const reportModel = JSON.parse(readFileSync(join(folder, 'results.json'), 'utf8'));
const currentScreens = reportModel.screens.filter(screen => screen.fresh);

test('generated report and optional ZIP contain only current manifest-bound mock screenshots', () => {
  assert.deepEqual(reportModel.screens.map(screen => screen.name).sort(), [...expectedScreens].sort());
  for (const screen of currentScreens) {
    assert.equal(screen.revision, reportModel.revision);
    assert.match(screen.runId, /^[a-f0-9-]{36}$/);
    const bytes = readFileSync(join(folder, 'screens', screen.name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), screen.sha256);
  }
  if (reportModel.acceptance.ready) {
    assert.equal(currentScreens.length, expectedScreens.length);
    assert.ok(currentScreens.every(screen => screen.reviewed));
    assert.equal(reportModel.packageKind, 'accepted-local-build');
  } else assert.equal(reportModel.packageKind, 'diagnostic-not-accepted');
  // check:report is intentionally valid before packing, then validates the ZIP
  // as well if e2e:pack has already created it.
  const archive = join(folder, 'green-pavlodar-demo.zip');
  if (existsSync(archive)) {
    const entries = unzipSync(readFileSync(archive));
    const allowed = ['index.html', 'DAMIR.md', 'results.json', ...currentScreens.map(screen => `screens/${screen.name}`)].sort();
    assert.deepEqual(Object.keys(entries).sort(), allowed);
    const model = JSON.parse(new TextDecoder().decode(entries['results.json']));
    assert.deepEqual(model, reportModel);
    for (const screen of currentScreens) assert.equal(createHash('sha256').update(entries[`screens/${screen.name}`]).digest('hex'), screen.sha256);
  }
  for (const run of reportModel.runs) for (const result of run.tests ?? []) {
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
      const mobileScreens = currentScreens.filter(screen => screen.width === 375).length;
      await expect(page.locator('.screen:visible')).toHaveCount(mobileScreens);
      if (mobileScreens) {
        const first = page.locator('.screen:visible').first();
        await first.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect.poll(() => page.locator('dialog img').evaluate(img => img.naturalWidth)).toBe(375);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).not.toBeVisible();
      } else await expect(page.getByRole('dialog')).not.toBeVisible();
      await page.getByLabel('Размер', { exact: true }).selectOption('');
      await expect(page.locator('.screen:visible')).toHaveCount(currentScreens.length);
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
