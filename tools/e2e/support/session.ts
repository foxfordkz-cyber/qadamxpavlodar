import { expect, type Page } from '@playwright/test';

export async function mockRole(page: Page, role: string) {
  await page.getByRole('button', { name: '⚙ Режим проверки', exact: true }).click();
  await page.getByRole('radio', { name: role, exact: true }).check();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
}

export async function switchLanguage(page: Page, language: 'Рус' | 'Қаз') {
  const group = page.getByRole('group', { name: 'Язык / Тіл', exact: true });
  await group.getByRole('button', { name: language, exact: true }).click();
  await expect(group.getByRole('button', { name: language, exact: true })).toHaveAttribute('aria-pressed', 'true');
}

export async function expectSignedOut(page: Page, previousName?: string) {
  await expect(page.locator('.gp-login input[type=password]')).toBeVisible();
  await expect(page.locator('.gp-header__right > span')).toHaveCount(0);
  if (previousName) await expect(page.locator('.gp-header')).not.toContainText(previousName);
  await expect(page.locator('.gp-status-row > .gp-kv').first().locator('dd')).toHaveText('—');
  await expect(page.locator('nav.gp-nav a')).toHaveCount(0);
  await expect(page.locator('green-worker')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Выйти|Шығу)$/ })).toHaveCount(0);
}

export async function expectNoOverflow(page: Page) {
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(size.scroll, `Document ${size.scroll}px, viewport ${size.client}px`).toBeLessThanOrEqual(size.client);
}
