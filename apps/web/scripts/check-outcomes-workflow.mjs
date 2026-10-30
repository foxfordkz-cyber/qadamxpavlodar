// Runs against the application, not an isolated component. Reuses tools/e2e's Playwright installation.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const require = createRequire(new URL('../../../tools/e2e/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const base = process.env.OUTCOMES_UI_BASE ?? 'http://127.0.0.1:5181';
const root = new URL('../dist-tests/outcomes-workflow/', import.meta.url);
const DEMO_SITE = 'site-osm-1569993037';
const full = 'outcome-demo-full', partial = 'outcome-demo-partial', undated = 'outcome-demo-undated';
const labels = {
  ru: { zone: 'Зона', cohort: 'Партия растений', inspection: 'Контрольный осмотр', save: 'Сохранить прогноз', retry: 'Повторить', empty: 'Для этой зоны ещё нет партий растений.', unknown: 'Нет данных', date: 'Дата посадки не подтверждена.', unavailable: 'Хранение партий и осмотров на сервере ещё не подключено.', saveDone: 'Прогноз сохранён.', logout: 'Выйти' },
  kk: { zone: 'Аймақ', cohort: 'Өсімдіктер партиясы', inspection: 'Бақылау мақсатындағы қарап тексеру', save: 'Болжамды сақтау', retry: 'Қайталау', empty: 'Бұл аймақта әзірге өсімдіктер партиялары жоқ.', unknown: 'Дерек жоқ', date: 'Отырғызу күні расталмаған.', unavailable: 'Сервердегі өсімдіктер партиялары мен қарап тексерулер қоймасы әлі қосылмаған.', saveDone: 'Болжам сақталды.', logout: 'Шығу' },
};
const geometry = async page => {
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, header: document.querySelector('.gp-header').scrollWidth }));
  assert.ok(widths.document <= widths.viewport + 1 && widths.header <= widths.viewport + 1, JSON.stringify(widths));
};
const login = async (page, account, password) => {
  await expect(page.locator('.gp-login')).toBeVisible();
  await page.locator('input[autocomplete="username"]').fill(account);
  try { await page.locator('input[autocomplete="current-password"]').fill(password); }
  catch { throw new Error('Could not enter temporary test credential (redacted)'); }
  await page.locator('.gp-login button[type="submit"]').click();
  await expect(page.locator('.gp-login')).toHaveCount(0);
};
export async function runOutcomeWorkflow(source = 'mock', password) {
  await mkdir(root, { recursive: true });
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const results = [];
  try {
    for (const width of [1280, 375]) for (const lang of ['ru', 'kk']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, locale: lang === 'kk' ? 'kk-KZ' : 'ru-RU', reducedMotion: 'reduce' });
      const page = await context.newPage(), errors = [], apiPaths = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { const url = new URL(r.url()); if (url.pathname.startsWith('/api/')) apiPaths.push(url.pathname); });
      const words = labels[lang];
      await page.goto(`${base}/?source=${source}&lang=${lang}#/outcomes?site=${DEMO_SITE}`);
      if (source === 'api') await login(page, 'coordinator', password);
      await expect(page.locator('[data-testid="outcome-econom"]')).toBeVisible();
      await geometry(page);
      if (source === 'mock') {
        await expect(page.locator('[data-testid="outcome-comparison"]')).toBeVisible();
        await expect(page.locator('[data-testid="outcome-stat-total"] dd')).toHaveText('32');
        await expect(page.locator('[data-testid="outcome-stat-alive"] dd')).toHaveText('27');
        await expect(page.locator('[data-testid="outcome-stat-dead"] dd')).toHaveText('5');
        const cohort = page.getByLabel(words.cohort, { exact: true });
        await cohort.selectOption(partial);
        await expect(page.locator('[data-testid="outcome-comparison"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="outcome-whole"] dd')).toHaveText(words.unknown);
        await expect(page.locator('[data-testid="outcome-stat-notInspected"] dd')).toHaveText('16');
        await cohort.selectOption(undated);
        await expect(page.locator('[data-testid="outcome-stat-dead"] dd')).toHaveText('0');
        await expect(page.locator('#outcome-compare').locator('..')).toContainText(words.date);
        await cohort.selectOption(full);
        await page.getByLabel(words.inspection, { exact: true }).selectOption(`${full}-early`);
        await expect(page.locator('[data-testid="outcome-comparison"]')).toHaveCount(0);
        await page.getByLabel(words.inspection, { exact: true }).selectOption('');
        await expect(page.locator('[data-testid="outcome-stat-alive"] dd')).toHaveText('0');
        await expect(page.locator('[data-testid="outcome-whole"] dd')).toHaveText(words.unknown);
        await page.getByLabel(words.inspection, { exact: true }).selectOption(`${full}-annual`);
        await page.getByRole('button', { name: lang === 'ru' ? 'Қаз' : 'Рус', exact: true }).click();
        await expect(page.locator('select').filter({ has: page.locator(`option[value="${full}"]`) })).toHaveValue(full);
        await page.getByRole('button', { name: lang === 'ru' ? 'Рус' : 'Қаз', exact: true }).click();
        await page.getByRole('button', { name: words.save, exact: true }).first().click();
        await expect(page.locator('.gp-outcome-save [role="status"]')).toContainText(words.saveDone);
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gp-mock-db-v4')).outcomes.forecasts.at(-1));
        assert.ok(saved.id.startsWith('forecast-'));
        await page.reload();
        await expect(page.locator('[data-testid="outcome-comparison"]')).toBeVisible();
        const after = await page.evaluate(id => JSON.parse(localStorage.getItem('gp-mock-db-v4')).outcomes.forecasts.find(f => f.id === id), saved.id);
        assert.deepEqual(after, saved);
        await page.locator('.gp-outcome-toggle input').uncheck();
        await expect(page.locator('[data-testid="outcome-max"]')).toBeVisible();
        await expect(page.locator('.gp-outcomes-page .gp-outcomes__card--best')).toHaveCount(0);
        await page.locator('.gp-outcome-toggle input').check();
        await expect(page.locator('.gp-outcomes-page .gp-outcomes__card--best')).toHaveCount(1);
        const zone = page.getByLabel(words.zone, { exact: true });
        const other = await zone.locator('option').evaluateAll((options, demoId) => options.find(o => o.value && o.value !== demoId).value, DEMO_SITE);
        await zone.selectOption(other);
        await expect(page.locator('.gp-outcomes-page')).toContainText(words.empty);
        await expect(page.locator('[data-testid="outcome-comparison"]')).toHaveCount(0);
        // Dev-only failure injection exercises the real application's loader and retry.
        await page.evaluate(() => globalThis.__gpMock.setMockControls({ networkDown: true }));
        await zone.selectOption(DEMO_SITE);
        await expect(page.locator('.gp-outcomes-page [role="alert"]').first()).toBeVisible();
        await expect(page.locator('[data-testid="outcome-econom"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="outcome-comparison"]')).toHaveCount(0);
        await page.evaluate(() => globalThis.__gpMock.setMockControls({ networkDown: false }));
        const retryButtons = page.locator('.gp-outcomes-page').getByRole('button', { name: words.retry, exact: true });
        for (const button of await retryButtons.elementHandles()) await button.click();
        await expect(page.locator('[data-testid="outcome-comparison"]')).toBeVisible();
        await expect(page.locator('[data-testid="outcome-econom"]')).toBeVisible();
      } else {
        await expect(page.locator('.gp-outcomes-page [role="alert"]')).toContainText(words.unavailable);
        await expect(page.locator('[data-testid="outcome-comparison"]')).toHaveCount(0);
        await expect(page.getByRole('button', { name: words.save, exact: true })).toHaveCount(0);
        assert.ok(apiPaths.some(p => p.endsWith('/sites')) && apiPaths.some(p => p.endsWith('/rates')) && apiPaths.some(p => p.endsWith('/species')));
        assert.ok(!apiPaths.some(p => p.includes('/outcomes')));
        await page.reload(); await expect(page.locator('[data-testid="outcome-econom"]')).toBeVisible();
      }
      await geometry(page);
      await page.screenshot({ path: fileURLToPath(new URL(`${source}-${lang}-${width}.png`, root)) });
      await page.screenshot({ path: fileURLToPath(new URL(`${source}-${lang}-${width}-full.png`, root)), fullPage: true });
      if (source === 'mock') {
        await page.locator('.gp-header').getByRole('button', { name: words.logout, exact: true }).click();
        await login(page, 'viewer', randomBytes(12).toString('hex'));
        await expect(page.locator('[data-testid="outcome-comparison"]')).toBeVisible();
        await expect(page.getByRole('button', { name: words.save, exact: true })).toHaveCount(0);
      }
      assert.deepEqual(errors, []);
      results.push({ source, width, lang, status: 'PASS', apiRequests: apiPaths.length, overflow: false, pageErrors: 0 });
      console.log(JSON.stringify(results.at(-1)));
      await context.close();
    }
  } finally {
    await browser.close();
    await writeFile(new URL(`${source}-results.json`, root), JSON.stringify(results, null, 2));
  }
  return results;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await runOutcomeWorkflow('mock');
