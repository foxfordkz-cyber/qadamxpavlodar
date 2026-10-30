import { test, expect } from '../support/test';
import { openPage } from '../support/helpers';
import { workerProfileButton } from '../support/worker';

test('E2E-06: embedded worker cabinet exposes Profile navigation at desktop and phone widths', async ({ page }) => {
  await openPage(page);
  await page.getByRole('button', { name: '⚙ Режим проверки', exact: true }).click();
  await page.getByRole('radio', { name: 'Работник', exact: true }).check();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  await expect(page).toHaveURL(/#\/worker/);
  await expect(page.locator('green-worker').getByRole('heading', { name: 'Моя смена', exact: true })).toBeVisible();
  await (await workerProfileButton(page)).click();
  await expect(page.locator('green-worker .profile')).toBeVisible();
  await expect(page.locator('green-worker').getByRole('button', { name: 'Завершить сессию', exact: true })).toBeVisible();
});
