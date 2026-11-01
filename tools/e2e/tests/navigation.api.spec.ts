import { test, expect } from '../support/test';
import type { BrowserContext } from '@playwright/test';
import { apiLogin } from '../support/api-login';
import { crewKeyboardNavigation } from '../support/worker';

test.describe.configure({ mode: 'default' });
test.beforeEach(() => test.skip(!process.env.E2E_PASSWORD, 'E2E_PASSWORD is not set'));
const sessions: Record<string, Awaited<ReturnType<BrowserContext['cookies']>>> = {};
test.beforeAll(async ({ browser, baseURL }) => {
  if (!process.env.E2E_PASSWORD) return;
  // This matrix tests navigation, not sixteen repeated password submissions.
  // Reuse genuine server sessions in memory; fresh login/logout is covered by
  // session.api.spec.ts. No storageState or authentication values go to disk.
  for (const role of ['worker1', 'foreman1']) {
    const context = await browser.newContext({ baseURL });
    try {
      const page = await context.newPage();
      await apiLogin(page, role, '/worker');
      await expect(page.locator('green-worker')).toBeVisible();
      sessions[role] = await context.cookies();
    } finally { await context.close(); }
  }
});

for (const width of [375, 800, 801, 1280]) for (const lang of ['ru', 'kk'] as const) for (const role of ['worker1', 'foreman1']) {
  test(`E2E-06 API: ${role}, ${width}px, ${lang}, direct route/reload and keyboard`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 812 });
    await page.context().addCookies(sessions[role]);
    // Real session survives navigation/reload. Mock role reset is not used as a substitute.
    await page.goto(`/?source=api&lang=${lang}#/worker`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/#\/worker$/);
    await crewKeyboardNavigation(page, role === 'foreman1', lang);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.gp-login')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/worker$/);
    await crewKeyboardNavigation(page, role === 'foreman1', lang);
  });
}
