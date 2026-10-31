import { test, expect } from '../support/test';
import { expectNoOverflow } from '../support/session';
import { expectNoReportMutations, expectNoTaskMutations, expectViewerNavigation, mockViewer } from '../support/permissions-final';

for (const lang of ['ru', 'kk'] as const) {
  test(`final viewer mock: ${lang}, navigation includes work, reports, lab and outcomes`, async ({ page }) => {
    await mockViewer(page, '/', lang);
    await expectViewerNavigation(page, lang);
    await expectNoOverflow(page);
  });

  test(`final viewer mock: ${lang}, existing tasks remain visible and changes unavailable`, async ({ page }) => {
    await mockViewer(page, '/tasks', lang);
    await expectNoTaskMutations(page, lang);
    await expect(page.locator('.gp-tasks')).toBeVisible();
    // Fixed synthetic fixture IDs, not an empty page that merely returns 200.
    for (const id of ['t-101', 't-104']) await expect(page.locator('.gp-tasks')).toContainText(id);
    await expect(page.locator('#main [role=alert]')).toHaveCount(0);
    await expectNoOverflow(page);
  });

  test(`final viewer mock: ${lang}, brigades and employees are readable`, async ({ page }) => {
    await mockViewer(page, '/tasks', lang);
    await expect(page.locator('.gp-tasks__workers .gp-worker')).toHaveCount(2);
    for (const name of ['Бригада №1', 'Бригада №2', 'Айгерим С.', 'Дмитрий К.', 'Нурлан Б.']) {
      await expect(page.locator('.gp-tasks__workers')).toContainText(name);
    }
    await expectNoOverflow(page);
  });

  test(`final viewer mock: ${lang}, existing report details are readable without review actions`, async ({ page }) => {
    await mockViewer(page, '/reports?report=r-201', lang);
    await expect(page.locator('.gp-reports__list .gp-list-item')).toHaveCount(2);
    await expect(page.locator('.gp-report h2')).toHaveText('r-201');
    await expect(page.locator('.gp-report .gp-quote')).toContainText('Часть участка огорожена');
    await expectNoReportMutations(page, lang);
    await expect(page.locator('#main [role=alert]')).toHaveCount(0);
    await expectNoOverflow(page);
  });
}
