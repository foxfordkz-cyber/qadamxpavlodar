import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openPage, dismissHint, watchErrors } from '../support/helpers';

const cards = (page: Page) => page.locator('.gp-lab-card');
async function ready(page: Page) {
  await expect(page.locator('.gp-lab-results')).toHaveAttribute('aria-busy', 'false');
  await expect(cards(page)).toHaveCount(3);
}
async function openLab(page: Page, lang = 'ru') { await openPage(page, '/lab', 'mock', lang); await ready(page); }
const composition = (page: Page) => cards(page).evaluateAll(nodes => nodes.map(node => [...node.querySelectorAll('[data-site-id]')].map(item => item.getAttribute('data-site-id'))));
const metric = (page: Page, name: string) => cards(page).locator(`[data-metric="${name}"]`).allTextContents();
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test('lab: three plans render without browser errors or horizontal overflow', async ({ page }) => {
  const errors = watchErrors(page);
  await openLab(page);
  await expect(page.getByRole('heading', { name: 'Лаборатория решений', exact: true })).toBeVisible();
  expect((await composition(page)).every(ids => ids.length > 0)).toBe(true);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('lab: rare/none change metrics, retain composition, and regular restores results', async ({ page }) => {
  await openLab(page);
  const before = await composition(page), water = await metric(page, 'water'), survival = await metric(page, 'survival');
  for (const name of ['Редкий', 'Без полива']) {
    await page.getByRole('radio', { name, exact: true }).check();
    await ready(page);
    expect(await composition(page)).toEqual(before);
    expect(await metric(page, 'water')).not.toEqual(water);
    expect(await metric(page, 'survival')).not.toEqual(survival);
    if (name === 'Без полива') expect(await metric(page, 'water')).toEqual(['0', '0', '0']);
    await noOverflow(page);
  }
  await page.getByRole('radio', { name: 'Обычный', exact: true }).check();
  await ready(page);
  expect(await metric(page, 'water')).toEqual(water);
  expect(await metric(page, 'survival')).toEqual(survival);
});

test('lab: show plan on map preserves IDs and opens numbered highlight list', async ({ page }) => {
  await openLab(page);
  const ids = (await composition(page))[0];
  await cards(page).first().getByRole('button', { name: 'Показать на карте' }).click();
  await expect(page).toHaveURL(/#\/map\?hl=/);
  await dismissHint(page);
  expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('hl')!.split(',')).toEqual(ids);
  await expect(page.locator('.gp-hl__item')).toHaveCount(Math.min(ids.length, 30));
  await expect(page.locator('.gp-hl')).toContainText('Больше выживет');
});

test('lab: Kazakh service phrases, scenario and reasons, names may retain source language', async ({ page }) => {
  await openLab(page, 'kk');
  await expect(page.getByRole('heading', { name: 'Шешімдер зертханасы', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Сирек', exact: true }).check();
  await ready(page);
  await cards(page).first().locator('summary').click();
  await page.locator('.gp-lab-assumptions summary').click();
  const text = await page.locator('.gp-lab').innerText();
  for (const phrase of ['Больше выживет', 'Меньше воды', 'Приживаемость', 'Показать на карте', 'Почему эти зоны', 'Социальные объекты рядом', 'Плотность застройки', 'Изменение к обычному поливу']) expect(text).not.toContain(phrase);
  await expect(cards(page).first()).toContainText('Картада көрсету');
  await noOverflow(page);
});

test('lab: all zones remain reachable when a portfolio exceeds the existing 30-zone map limit', async ({ page }) => {
  await openLab(page);
  const water = page.locator('.gp-lab-card[data-plan=water]');
  const all = (await composition(page))[1];
  expect(all.length).toBeGreaterThan(30);
  await water.getByRole('combobox').selectOption('1');
  await water.getByRole('button', { name: 'Показать на карте' }).click();
  await dismissHint(page);
  await expect(page.locator('.gp-hl__item')).toHaveCount(all.length - 30);
  expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('hl')!.split(',')).toEqual(all.slice(30));
});

test('lab: invalid, empty budget and zero water limit have honest recoverable states', async ({ page }) => {
  await openLab(page);
  const budget = page.getByRole('textbox', { name: 'Бюджет, млн ₸', exact: true });
  await budget.fill('-1');
  await expect(page.locator('.gp-lab-results [role=alert]').first()).toContainText('Введите бюджет');
  await expect(cards(page)).toHaveCount(0);
  await budget.fill('0.000001');
  await ready(page);
  await expect(page.locator('.gp-lab-results')).toContainText('Увеличьте бюджет');
  expect(await metric(page, 'survival')).toEqual(['нет данных', 'нет данных', 'нет данных']);
  await budget.fill('50');
  await page.getByRole('textbox', { name: /^Лимит воды/ }).fill('0');
  await ready(page);
  expect(await metric(page, 'zones')).toEqual(['0', '0', '0']);
  await page.getByRole('textbox', { name: /^Лимит воды/ }).fill('');
  await ready(page);
  expect((await composition(page)).every(ids => ids.length > 0)).toBe(true);
});

test('lab: request error/retry and late requests do not display stale scenario values', async ({ page }) => {
  await openLab(page);
  // Fault injection is limited to mock controls; this is not an API availability test.
  await page.evaluate(() => (globalThis as any).__gpMock.setMockControls({ networkDown: true }));
  await page.getByRole('radio', { name: 'Редкий', exact: true }).check();
  await expect(page.locator('.gp-lab-results [role=alert]').first()).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await page.evaluate(() => (globalThis as any).__gpMock.setMockControls({ networkDown: false }));
  await page.locator('.gp-lab-results').getByRole('button', { name: /Повторить/ }).click();
  await ready(page);
  await page.evaluate(() => (globalThis as any).__gpMock.setMockControls({ latencyMs: 1200 }));
  await page.getByRole('radio', { name: 'Обычный', exact: true }).check();
  await expect(page.locator('.gp-lab-results')).toHaveAttribute('aria-busy', 'true');
  // Let the 300ms debounce send the first request while its mock latency is still pending.
  await page.waitForTimeout(400);
  await page.getByRole('radio', { name: 'Без полива', exact: true }).check();
  await ready(page);
  expect(await metric(page, 'water')).toEqual(['0', '0', '0']);
  await page.waitForTimeout(1700);
  expect(await metric(page, 'water')).toEqual(['0', '0', '0']);
});

test('lab: presentation capture for review', async ({ page }, info) => {
  await openLab(page);
  await page.getByRole('radio', { name: 'Редкий', exact: true }).check();
  await ready(page);
  await page.keyboard.press('Alt+KeyP');
  await noOverflow(page);
  await page.evaluate(async () => { await document.fonts.ready; });
  await mkdir('test-results/lab-review', { recursive: true });
  const path = `test-results/lab-review/lab-${page.viewportSize()!.width}.png`;
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await info.attach('lab-review', { path, contentType: 'image/png' });
});
