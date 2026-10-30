import { test, expect } from '../support/test';
import { ru } from '../../../apps/web/src/shared/i18n/ru';
import { kk } from '../../../apps/web/src/shared/i18n/kk';
import { pages, openPage } from '../support/helpers';
import { expectNoOverflow } from '../support/session';

// Exact UI labels from the maintained Russian dictionary, never OSM street/zone data.
const forbidden: string[] = Object.entries(ru)
  .filter(([key, value]) => /(^nav\.|^common\.|\.(title|heading|submit|cancel|save|close|reset|add|create|delete|retry|logout|devPanel)$)/.test(key)
    && /[А-Яа-яЁё]/.test(value) && !value.includes('{') && value.length <= 80
    && kk[key as keyof typeof kk] !== value) // e.g. «Импорт» is the approved label in both dictionaries.
  .map(([, value]) => value);

test('Kazakh navigation is enabled with ?lang=kk', async ({ page }) => {
  await openPage(page, '/', 'mock', 'kk');
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Шолу', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Басымдықтар', exact: true })).toBeVisible();
});

for (const [, route] of pages) {
  test(`${route}: Kazakh controls have no Russian service labels`, async ({ page }) => {
    await openPage(page, route, 'mock', 'kk');
    const labels = await page.locator('button:visible, nav a:visible, [role=tab]:visible, h1:visible, h2:visible, h3:visible').allTextContents();
    const normalize = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ').trim();
    const leaks = [...new Set(labels.map(normalize).filter(label => forbidden.includes(label)))];
    expect(leaks, `Russian controls on ${route} with ?lang=kk`).toEqual([]);
    await expectNoOverflow(page);
  });
}
