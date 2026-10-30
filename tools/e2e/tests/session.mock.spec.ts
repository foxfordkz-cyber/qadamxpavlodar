import { test, expect } from '../support/test';
import { openPage } from '../support/helpers';
import { mockRole, switchLanguage, expectSignedOut, expectNoOverflow } from '../support/session';

for (const role of ['Специалист', 'Администратор', 'Просмотр']) {
  test(`language switcher: ${role} switches labels and persists language without changing route`, async ({ page }) => {
    await openPage(page, '/priorities');
    await mockRole(page, role);
    await page.locator('nav.gp-nav').getByRole('link', { name: 'Приоритеты', exact: true }).click();
    const route = new URL(page.url()).hash;
    await switchLanguage(page, 'Қаз');
    await expect(page.locator('nav.gp-nav').getByRole('link', { name: 'Басымдықтар', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(new URL(page.url()).hash).toBe(route);
    await expectNoOverflow(page);
    // Remove the explicit query parameter: verify persisted preference, not just ?lang=kk.
    await page.evaluate(() => { const url = new URL(location.href); url.searchParams.delete('lang'); history.replaceState(history.state, '', url); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Қаз', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('nav.gp-nav').getByRole('link', { name: 'Басымдықтар', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(new URL(page.url()).hash).toBe(route);
    await switchLanguage(page, 'Рус');
    await expect(page.locator('nav.gp-nav').getByRole('link', { name: 'Приоритеты', exact: true })).toBeVisible();
  });
}

for (const role of ['Специалист', 'Администратор', 'Просмотр', 'Работник', 'Бригадир']) {
  test(`logout: ${role} immediately clears the previous name, role and navigation`, async ({ page }) => {
    await openPage(page);
    await mockRole(page, role);
    const identity = page.locator('.gp-header__right > span');
    await expect(identity).not.toBeEmpty();
    const name = (await identity.innerText()).trim();
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expectSignedOut(page, name);
    await expectNoOverflow(page);
    // Mock intentionally starts a new coordinator demo session on reload.
    // Persistent logout is checked against the real API, not this in-memory role simulator.
  });
}

test('language switcher: login form translates and remembers the language while signed out', async ({ page }) => {
  await openPage(page);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expectSignedOut(page);
  await switchLanguage(page, 'Қаз');
  await expect(page.locator('.gp-login').getByRole('heading', { name: 'Үйлестірушінің кіруі', exact: true })).toBeVisible();
  await expectNoOverflow(page);
  await page.evaluate(() => { const url = new URL(location.href); url.searchParams.delete('lang'); history.replaceState(history.state, '', url); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Қаз', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Reload starts a new mock demo session; end it without changing the persisted language.
  await page.getByRole('button', { name: 'Шығу', exact: true }).click();
  await expectSignedOut(page);
  await expect(page.locator('.gp-login').getByRole('heading', { name: 'Үйлестірушінің кіруі', exact: true })).toBeVisible();
  await switchLanguage(page, 'Рус');
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
});
