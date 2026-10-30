import { expect, type Page } from '@playwright/test';

export async function apiLogin(page: Page, username: string, route = '/') {
  await page.goto(`/?source=api&lang=ru#${route}`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[autocomplete=username]').fill(username);
  await page.locator('input[type=password]').evaluate((input, password) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, password);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, process.env.E2E_PASSWORD!);
  await page.locator('.gp-login button[type=submit]').click();
  await expect(page.locator('.gp-login')).toHaveCount(0);
}

export async function apiCall(page: Page, path: string, method = 'GET', body?: unknown, key?: string) {
  // Keep cookies and CSRF in the browser; never attach authentication responses.
  return page.evaluate(async ({ path, method, body, key }) => {
    const session = await fetch('/api/v1/auth/me').then(r => r.json());
    const response = await fetch(`/api/v1${path}`, { method, credentials: 'include', headers: {
      'Content-Type': 'application/json', 'X-CSRF-Token': session.data.csrfToken,
      ...(key ? { 'Idempotency-Key': key } : {}),
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }, { path, method, body, key });
}
