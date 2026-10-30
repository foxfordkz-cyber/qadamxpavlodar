import { test, expect, type Page } from '../support/test';
import { dismissHint } from '../support/helpers';
import { workerProfileButton } from '../support/worker';
import { expectSignedOut } from '../support/session';

test.beforeEach(() => test.skip(!process.env.E2E_PASSWORD, 'E2E_PASSWORD is not set'));

async function login(page: Page, username: string) {
    await page.getByRole('textbox', { name: /^Логин/ }).fill(username);
    // evaluate has no password-bearing fill step title; API reporter omits all step/error payloads.
    await page.locator('input[type=password]').evaluate((input, password) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, password);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, process.env.E2E_PASSWORD!);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
}

test('API: coordinator login, server data indicator, map, estimate, priorities, logout', async ({ page }) => {
  await page.goto('/?source=api#/', { waitUntil: 'domcontentloaded' });
  await login(page, 'coordinator');
  await expect(page.locator('.gp-kv').filter({ has: page.locator('dt', { hasText: /^Данные$/ }) })).toContainText('Сервер /api/v1');
  await page.getByRole('navigation').getByRole('link', { name: /Карта/ }).click();
  await dismissHint(page);
  await page.locator('.gp-sites__items button').first().click();
  await page.locator('.gp-sites__card').getByRole('tab', { name: 'Смета', exact: true }).click();
  await expect(page.locator('.gp-sites__card')).toContainText('₸');
  await page.getByRole('navigation').getByRole('link', { name: 'Приоритеты', exact: true }).click();
  await expect(page.locator('.gp-rank-list li').first()).toBeVisible();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expectSignedOut(page);
});

test('API: worker1 login opens shift cabinet and cabinet logout ends the session', async ({ page }) => {
  await page.goto('/?source=api#/', { waitUntil: 'domcontentloaded' });
  await login(page, 'worker1');
  await expect(page).toHaveURL(/#\/worker/);
  await expect(page.locator('green-worker')).toBeVisible();
  await expect(page.locator('green-worker').getByRole('heading', { name: 'Моя смена', exact: true })).toBeVisible();
  await (await workerProfileButton(page)).click();
  await page.locator('green-worker').getByRole('button', { name: 'Завершить сессию', exact: true }).click();
  await expectSignedOut(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectSignedOut(page);
  await expect(page.locator('green-worker')).toHaveCount(0);
});

test('API: foreman1 login opens the crew shift cabinet', async ({ page }) => {
  await page.goto('/?source=api#/', { waitUntil: 'domcontentloaded' });
  await login(page, 'foreman1');
  await expect(page).toHaveURL(/#\/worker$/);
  await expect(page.locator('green-worker')).toBeVisible();
  await expect(page.locator('green-worker').getByRole('heading', { name: 'Смена бригады', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expectSignedOut(page);
  await expect(page.locator('green-worker')).toHaveCount(0);
});

for (const username of ['viewer', 'admin']) {
  test(`API: ${username} reads the map, cannot draw or enter a crew cabinet, and logs out`, async ({ page }) => {
    await page.goto('/?source=api#/', { waitUntil: 'domcontentloaded' });
    await login(page, username);
    await page.locator('nav.gp-nav').getByRole('link', { name: 'Карта участков', exact: true }).click();
    await dismissHint(page);
    await expect(page.locator('.gp-sites__items button').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Нарисовать зону/ })).toHaveCount(0);
    await page.evaluate(() => { location.hash = '#/map?draw=1'; });
    await expect(page).toHaveURL(/#\/map$/);
    await expect(page.locator('.gp-drawbar')).toHaveCount(0);
    await page.evaluate(() => { location.hash = '#/worker'; });
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator('green-worker')).toHaveCount(0);
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expectSignedOut(page);
  });
}

test('API: coordinator cannot open the worker route and returns home', async ({ page }) => {
  await page.goto('/?source=api#/worker', { waitUntil: 'domcontentloaded' });
  await login(page, 'coordinator');
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('green-worker')).toHaveCount(0);
  await expect(page.locator('nav.gp-nav').getByRole('link', { name: 'Обзор', exact: true })).toHaveAttribute('aria-current', 'page');
  // Also attempt the route after authentication, not only on the initial sign-in.
  await page.evaluate(() => { location.hash = '#/worker'; });
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('green-worker')).toHaveCount(0);
});

test('API: worker1 header logout clears identity and remains signed out after reload', async ({ page }) => {
  await page.goto('/?source=api#/', { waitUntil: 'domcontentloaded' });
  await login(page, 'worker1');
  await expect(page.locator('green-worker').getByRole('heading', { name: 'Моя смена', exact: true })).toBeVisible();
  const name = (await page.locator('.gp-header__right > span').innerText()).trim();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expectSignedOut(page, name);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectSignedOut(page, name);
});
