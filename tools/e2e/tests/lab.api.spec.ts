import { test, expect } from '@playwright/test';

test.beforeEach(() => test.skip(!process.env.E2E_PASSWORD, 'E2E_PASSWORD is not set'));

for (const role of ['coordinator', 'viewer']) {
  test(`API lab: ${role} reads real server plans, fixed composition and no-watering scenario`, async ({ page }) => {
    await page.goto('/?source=api&lang=ru#/lab', { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: /^Логин/ }).fill(role);
    await page.locator('input[type=password]').evaluate((input, password) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, password);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, process.env.E2E_PASSWORD!);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByRole('navigation').getByRole('link', { name: 'Лаборатория решений', exact: true }).click();
    const cards = page.locator('.gp-lab-card');
    await expect(cards).toHaveCount(3);
    const before = await cards.evaluateAll(nodes => nodes.map(node => [...node.querySelectorAll('[data-site-id]')].map(el => el.getAttribute('data-site-id'))));
    expect(before.every(ids => ids.length > 0)).toBe(true);
    const response = page.waitForResponse(r => r.url().endsWith('/api/v1/decision-lab') && r.request().method() === 'POST');
    await page.getByRole('radio', { name: 'Без полива', exact: true }).check();
    expect((await response).status()).toBe(200);
    await expect(page.locator('.gp-lab-results')).toHaveAttribute('aria-busy', 'false');
    await expect(cards).toHaveCount(3);
    expect(await cards.locator('[data-metric=water]').allTextContents()).toEqual(['0', '0', '0']);
    expect(await cards.evaluateAll(nodes => nodes.map(node => [...node.querySelectorAll('[data-site-id]')].map(el => el.getAttribute('data-site-id'))))).toEqual(before);
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(page.locator('input[type=password]')).toBeVisible();
    await expect(cards).toHaveCount(0);
  });
}
