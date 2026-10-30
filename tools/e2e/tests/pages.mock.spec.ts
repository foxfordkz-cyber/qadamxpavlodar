import { test, expect } from '../support/test';
import { pages, openPage, dismissHint, screenshot, openEffect, watchErrors, chooseYear, mapReady } from '../support/helpers';

for (const [name, route] of pages) {
  test(`${route}: opens without JavaScript errors or horizontal overflow`, async ({ page }) => {
    const errors = watchErrors(page);
    await openPage(page, route);
    await dismissHint(page);
    if (name === 'map') await mapReady(page);
    // A full render, not just an empty root or navigation shell.
    await expect(page.locator('#main')).not.toContainText('Не удалось загрузить');
    const sizes = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
    }));
    expect(errors, `${route}: browser errors`).toEqual([]);
    expect(sizes.scroll, `${route}: document width ${sizes.scroll}, viewport ${sizes.client}`).toBeLessThanOrEqual(sizes.client);
  });

  test(`${route}: presentation screenshot`, async ({ page }, info) => {
    // Real external fonts can take 30–50s on a cold connection; still wait for
    // document.fonts.ready instead of accepting an unfinished screenshot.
    test.setTimeout(90_000);
    await openPage(page, route);
    await dismissHint(page);
    if (name === 'map') await expect(page.locator('.gp-sites__items button').first()).toBeVisible();
    await screenshot(page, name, info);
  });
}

for (const [label, name] of [['Посадка', 'time-planting'], ['20 лет', 'time-20-years']] as const) {
  test(`time machine: ${label} presentation screenshot`, async ({ page }, info) => {
    test.setTimeout(90_000);
    const card = await openEffect(page);
    await chooseYear(page, label);
    await expect(card.getByRole('radio', { name: label, exact: true })).toBeChecked();
    await screenshot(page, name, info);
  });
}
