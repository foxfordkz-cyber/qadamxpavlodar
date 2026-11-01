import { test, expect } from '../support/test';
import { openPage, mapReady } from '../support/helpers';
import { expectHitTarget } from '../support/assistant-clearance';

const locales = [
  { lang: 'ru', title: 'Три шага, чтобы начать', location: '✦ в верхней панели', obsolete: 'внизу справа', start: 'Понятно, начать' },
  { lang: 'kk', title: 'Бастау үшін үш қадам', location: '✦ жоғарғы панельде', obsolete: 'төменгі оң жақта', start: 'Түсінікті, бастау' },
] as const;

for (const locale of locales) {
  test(`E2E-10 ${locale.lang}: first-run directions match the usable header assistant`, async ({ page }, info) => {
    await openPage(page, '/map', 'mock', locale.lang);
    const hint = page.locator('.gp-firstrun');
    await expect(hint.getByRole('heading', { name: locale.title, exact: true })).toBeVisible();
    await expect(hint.locator('li').last()).toContainText(locale.location);
    await expect(hint).not.toContainText(locale.obsolete);
    await mapReady(page);

    const launcher = page.locator('.gp-header .gp-assist-fab');
    await expect(launcher).toHaveCount(1);
    await expectHitTarget(launcher, 'The first-run instruction points to the visible header button');
    const geometry = await launcher.evaluate(element => {
      const header = element.closest('.gp-header')!.getBoundingClientRect();
      const button = element.getBoundingClientRect();
      return { header: header.toJSON(), button: button.toJSON(), insideHeader: button.left >= header.left && button.right <= header.right && button.top >= header.top && button.bottom <= header.bottom };
    });
    expect(geometry.insideHeader).toBe(true);
    await info.attach('onboarding-header-location', { body: JSON.stringify(geometry), contentType: 'application/json' });
    await info.attach(`onboarding-${locale.lang}-${page.viewportSize()!.width}`, { body: await page.screenshot(), contentType: 'image/png' });

    await hint.getByRole('button', { name: locale.start, exact: true }).click();
    await launcher.focus();
    await expect(launcher).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#gp-assistant-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#gp-assistant-panel')).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.gp-sites__items button').first()).toBeVisible();
    await expect(hint).toHaveCount(0);
    await expectHitTarget(launcher, 'Header assistant after reload');
    const widths = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(widths.content).toBeLessThanOrEqual(widths.viewport);
  });
}
