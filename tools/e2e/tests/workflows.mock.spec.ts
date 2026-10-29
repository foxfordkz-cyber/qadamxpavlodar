import { test, expect } from '@playwright/test';
import { openPage, dismissHint, selectZone, openEffect, chooseYear, mapReady } from '../support/helpers';

test('zone list, six tabs, time machine statistics and hide', async ({ page }, info) => {
  const card = await openEffect(page);
  await expect(card.getByRole('tab')).toHaveCount(6);
  await chooseYear(page, '10 лет');
  await expect(card.locator('.gp-tm__stats')).toContainText('м²');
  await expect(card.locator('.gp-tm__stats')).toContainText('т/год');
  // The mobile design intentionally hides the map bar behind the bottom sheet.
  await expect(page.locator('.gp-tm-bar')).toHaveCount(1);
  if (info.project.name === 'desktop') await expect(page.locator('.gp-tm-bar')).toBeVisible();
  await card.getByRole('button', { name: 'Скрыть с карты', exact: true }).click();
  await expect(page.locator('.gp-tm-bar')).toHaveCount(0);
});

test('priorities highlight a numbered queue and clear it', async ({ page }) => {
  await openPage(page, '/priorities');
  await page.getByRole('button', { name: 'Показать очередь на карте' }).click();
  await expect(page).toHaveURL(/[?&]hl=/);
  await dismissHint(page);
  await expect(page.locator('.gp-hl__item').first()).toBeVisible();
  await expect(page.locator('.gp-hl__item .gp-hl__n').first()).toHaveText('1');
  await page.getByRole('button', { name: '✕ Убрать с карты', exact: true }).click();
  await expect(page).not.toHaveURL(/[?&]hl=/);
  await expect(page.locator('.gp-hl__item')).toHaveCount(0);
});

test('assistant: budget answer uses rules and highlights zones automatically; Escape closes', async ({ page }) => {
  await openPage(page, '/map');
  await dismissHint(page);
  await page.getByRole('button', { name: 'Открыть ассистента', exact: true }).click();
  await page.getByRole('textbox', { name: 'Вопрос ассистенту' }).fill('Что можно озеленить на 50 млн?');
  await page.getByRole('button', { name: 'Спросить', exact: true }).click();
  const reply = page.locator('.gp-assist__msg--bot').last();
  await expect(reply).toContainText(/50|бюджет/i);
  await expect(reply.locator('.gp-assist__proof')).toContainText('Правила');
  await expect(page).toHaveURL(/[?&]hl=/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Ассистент по озеленению' })).toHaveCount(0);
});

test('assistant: without a selected zone explains the nearest zone', async ({ page }) => {
  await openPage(page, '/map');
  await dismissHint(page);
  await mapReady(page);
  await expect(page).not.toHaveURL(/[?&]site=/);
  await page.getByRole('button', { name: 'Открыть ассистента', exact: true }).click();
  await page.getByRole('textbox', { name: 'Вопрос ассистенту' }).fill('подбери растения здесь');
  await page.getByRole('button', { name: 'Спросить', exact: true }).click();
  await expect(page.locator('.gp-assist__msg--bot').last()).toContainText('ближайшую');
});

test('first visit hint stays dismissed after reload; Alt+P toggles presentation', async ({ page }) => {
  // Every Playwright test starts in its own context with empty localStorage.
  await openPage(page, '/map');
  await expect(page.getByRole('heading', { name: 'Три шага, чтобы начать' })).toBeVisible();
  await dismissHint(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.gp-sites__items button').first()).toBeVisible();
  await expect(page.locator('.gp-firstrun')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveClass(/\bgp-present\b/);
  await page.keyboard.press('Alt+KeyP');
  await expect(page.locator('html')).toHaveClass(/\bgp-present\b/);
  await page.keyboard.press('Alt+KeyP');
  await expect(page.locator('html')).not.toHaveClass(/\bgp-present\b/);
});

test('mobile: bottom sheet expands from under 60% to about 90%', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Only the 375×812 layout has a bottom sheet');
  const card = await selectZone(page);
  const height = page.viewportSize()!.height;
  await expect.poll(async () => (await card.boundingBox())!.height / height).toBeLessThan(0.6);
  const before = (await card.boundingBox())!;
  expect(Math.abs(before.y + before.height - height)).toBeLessThanOrEqual(2);
  await card.getByRole('button', { name: 'Развернуть карточку', exact: true }).click();
  await expect.poll(async () => (await card.boundingBox())!.height / height).toBeGreaterThan(0.85);
  expect((await card.boundingBox())!.height / height).toBeLessThan(0.96);
});

test('mock roles: worker opens shift cabinet, specialist returns home', async ({ page }) => {
  await openPage(page);
  await page.getByRole('button', { name: '⚙ Режим проверки', exact: true }).click();
  await page.getByRole('radio', { name: 'Работник', exact: true }).check();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  await expect(page).toHaveURL(/#\/worker/);
  await expect(page.locator('green-worker')).toBeVisible();
  // Playwright CSS/text locators pierce the component's open shadow root.
  await expect(page.locator('green-worker').getByRole('heading', { name: 'Моя смена', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '⚙ Режим проверки', exact: true }).click();
  await page.getByRole('radio', { name: 'Специалист', exact: true }).check();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('green-worker')).toHaveCount(0);
});
