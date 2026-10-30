import { test, expect } from '@playwright/test';
import { openPage } from '../support/helpers';
import { mockRole, expectNoOverflow } from '../support/session';
import { workerProfileButton, workerReady } from '../support/worker';

for (const role of ['Работник', 'Бригадир']) {
  test(`E2E-06: ${role} can switch Shift, Journal and Profile without navigation covering content`, async ({ page }) => {
    await openPage(page);
    await mockRole(page, role);
    await expect(page).toHaveURL(/#\/worker/);
    const cabinet = page.locator('green-worker');
    await expect(cabinet.getByRole('heading', { name: role === 'Работник' ? 'Моя смена' : 'Смена бригады', exact: true })).toBeVisible();
    await workerProfileButton(page); // Retain the original strict regression on every width/role.
    for (const [name, heading] of [
      ['Журнал', 'Журнал работ'], ['Профиль', 'Карточка сотрудника'],
      ['Смена', role === 'Работник' ? 'Моя смена' : 'Смена бригады'],
    ]) {
      const button = cabinet.getByRole('button', { name: new RegExp(`${name}$`) }).filter({ visible: true });
      await expect(button).toHaveCount(1);
      await button.click();
      await expect(cabinet.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await workerReady(page);
      await expect(button).toHaveCount(1);
      await expect(button).toHaveAttribute('aria-current', 'page');
      const footer = cabinet.locator('.page-footer');
      await footer.scrollIntoViewIfNeeded();
      // A fixed bottom menu may overlap the scrollport. Verify the final content can be
      // fully uncovered by scrolling to the actual end, including the reserved padding.
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      const layout = await cabinet.evaluate(node => {
        const root = node.shadowRoot!;
        const footer = root.querySelector('.page-footer')!.getBoundingClientRect();
        const menus = [...root.querySelectorAll('nav')].filter(nav => nav.getClientRects().length > 0);
        return { footer: { top: footer.top, bottom: footer.bottom }, height: innerHeight,
          overlapping: menus.some(nav => { const r = nav.getBoundingClientRect();
            return r.left < footer.right && r.right > footer.left && r.top < footer.bottom && r.bottom > footer.top;
          }) };
      });
      expect(layout.overlapping, `${name}: navigation overlaps the last content after scrolling`).toBe(false);
      expect(layout.footer.top).toBeGreaterThanOrEqual(0);
      expect(layout.footer.bottom).toBeLessThanOrEqual(layout.height + 1);
      await expectNoOverflow(page);
    }
  });
}
