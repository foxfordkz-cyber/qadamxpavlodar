import { test, expect } from '../support/test';
import { apiLogin } from '../support/api-login';
import { crewKeyboardNavigation } from '../support/worker';

test.beforeEach(() => test.skip(!process.env.E2E_PASSWORD, 'E2E_PASSWORD is not set'));
for (const width of [375, 800, 801, 1280]) for (const lang of ['ru', 'kk']) for (const role of ['worker1', 'foreman1']) {
  test(`E2E-06 API: ${role}, ${width}px, ${lang}, direct route/reload and keyboard`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 812 });
    await apiLogin(page, role, '/worker');
    // Real session survives navigation/reload. Mock role reset is not used as a substitute.
    await page.goto(`/?source=api&lang=${lang}#/worker`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/#\/worker$/);
    await crewKeyboardNavigation(page, role === 'foreman1');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.gp-login')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/worker$/);
    await crewKeyboardNavigation(page, role === 'foreman1');
  });
}
