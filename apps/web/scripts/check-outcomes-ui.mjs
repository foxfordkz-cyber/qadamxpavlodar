// Run with a local Vite server. Reuses Playwright installed for tools/e2e; does not change that suite.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const packagePath = process.env.OUTCOMES_PLAYWRIGHT_PACKAGE ?? path.resolve('../../tools/e2e/node_modules/@playwright/test/index.mjs');
const { chromium, expect } = await import(pathToFileURL(packagePath).href);
const base = process.env.OUTCOMES_UI_BASE ?? 'http://127.0.0.1:5182';
const output = path.resolve(process.env.OUTCOMES_UI_OUTPUT ?? 'dist-tests/outcomes-ui-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const labels = {
  ru: { heading: 'Цена результата', retry: 'Повторить', loading: 'Загружаем варианты и партии…', empty: 'Вариантов пока нет.', separate: 'Результат осмотра показан отдельно от прогноза.', delta: 'Расхождение' },
  kk: { heading: 'Нәтиженің құны', retry: 'Қайталау', loading: 'Нұсқалар мен партиялар жүктелуде…', empty: 'Нұсқалар әзірге жоқ.', separate: 'Тексеру нәтижесі болжамнан бөлек көрсетілген.', delta: 'Айырма' },
};
try {
  for (const width of [375, 1280]) for (const lang of ['ru', 'kk']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/')) requests.push(req.url()); });
    const words = labels[lang];
    const open = async scenario => {
      await page.goto(`${base}/tests/fixtures/outcomes-ui.html?case=${scenario}&lang=${lang}`);
      await expect(page.getByRole('heading', { name: words.heading, exact: true })).toBeVisible();
    };
    const overflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await open('ready');
    await expect(page.locator('.gp-outcomes__card--best')).toHaveCount(1);
    await expect(page.locator('.gp-outcomes__card--best')).toHaveAttribute('data-variant', 'econom');
    await expect(page.locator('.gp-outcomes__comparison')).toContainText('75%');
    await overflow();
    await page.screenshot({ path: path.join(output, `ready-${lang}-${width}.png`), fullPage: true });
    const select = page.locator('.gp-outcomes__history > select');
    await select.focus();
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      const style = getComputedStyle(el);
      return { tag: el.tagName, href: el.getAttribute('href'), focusVisible: el.matches(':focus-visible'), outline: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    expect(focused.tag).toBe('A'); expect(focused.href).toBe('#/reports?report=test-report-only');
    expect(focused.focusVisible).toBeTruthy(); expect(focused.outline).toBe('solid'); expect(focused.outlineWidth).toBe('3px');
    await page.screenshot({ path: path.join(output, `keyboard-${lang}-${width}.png`) });
    await select.selectOption('test-cohort-month');
    await expect(page.locator('.gp-outcomes__comparison')).toContainText(words.separate);
    await expect(page.locator('.gp-outcomes__comparison')).not.toContainText(words.delta);
    await select.selectOption('test-cohort-no-forecast');
    await expect(page.locator('.gp-outcomes__comparison')).toContainText(words.separate);
    await page.getByRole('button', { name: lang === 'ru' ? 'Қаз' : 'Рус', exact: true }).click();
    await expect(select).toHaveValue('test-cohort-no-forecast');
    await overflow();
    await open('loading'); await expect(page.locator('.gp-outcomes')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('status')).toContainText(words.loading);
    await open('empty'); await expect(page.locator('.gp-outcomes')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('status')).toContainText(words.empty); await overflow();
    await open('retry'); await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('.gp-outcomes__card')).toHaveCount(0);
    await page.getByRole('button', { name: words.retry, exact: true }).click();
    await expect(page.locator('.gp-outcomes__card--best')).toHaveCount(1);
    await open('invalid'); await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('.gp-outcomes__card')).toHaveCount(0);
    await open('incomplete'); await expect(page.locator('[data-variant]')).toHaveCount(1);
    await expect(page.locator('.gp-outcomes__card--best')).toHaveCount(0); await overflow();
    await page.screenshot({ path: path.join(output, `incomplete-${lang}-${width}.png`), fullPage: true });
    await open('partial'); await expect(page.locator('.gp-outcomes__cohort')).toContainText('50%');
    await expect(page.locator('.gp-outcomes__comparison')).not.toContainText(words.delta);
    await open('unavailable'); await expect(page.locator('.gp-outcomes')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.gp-outcomes__card')).toHaveCount(0);
    await open('race'); await page.getByRole('button', { name: 'Switch request' }).click();
    await expect(page.getByRole('status')).toContainText(words.empty);
    // Let the first request settle; it must not resurrect data from the previous selection.
    await page.waitForTimeout(2200);
    await expect(page.getByRole('status')).toContainText(words.empty);
    await expect(page.locator('.gp-outcomes__card')).toHaveCount(0);
    expect(errors).toEqual([]); expect(requests).toEqual([]);
    results.push({ width, lang, result: 'PASS', checks: ['values', 'ranking', 'no-page-overflow', 'keyboard-focus', 'cohort-selection', 'language-preserves-selection', 'monthly-separate', 'missing-forecast', 'loading', 'empty', '503-retry', 'invalid-input', 'missing-cost', 'partial-coverage', 'unavailable', 'late-response-ignored'], apiRequests: 0 });
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ scope: 'Isolated UI fixtures only; no backend/mock outcomes adapter is available.', results }, null, 2));
}
console.log(JSON.stringify({ result: 'PASS', configurations: results.length, checksPerConfiguration: 16, output }));
