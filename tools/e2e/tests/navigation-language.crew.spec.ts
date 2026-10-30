import { test } from '../support/test';
import { openPage } from '../support/helpers';
import { mockRole, switchLanguage } from '../support/session';
import { crewKeyboardNavigation } from '../support/worker';

for (const role of ['Работник', 'Бригадир']) {
  test(`E2E-06: ${role} keyboard navigation with Kazakh shell`, async ({ page }) => {
    await openPage(page);
    await mockRole(page, role);
    await switchLanguage(page, 'Қаз');
    await crewKeyboardNavigation(page, role === 'Бригадир');
  });
}
