import { test, expect } from '../support/test';
import { openPage } from '../support/helpers';

for (const lang of ['ru', 'kk']) {
  test(`E2E-07: every coordinator menu destination fits the viewport (${lang})`, async ({ page }, info) => {
    await openPage(page, '/', 'mock', lang);
    await page.evaluate(async () => { await document.fonts.ready; });
    const nav = page.locator('nav.gp-nav');
    // A deliberate, labelled overflow menu is acceptable; invisible horizontal
    // scrolling is not. Open it as a user would, then check every destination.
    const more = nav.getByRole('button', { name: lang === 'kk' ? /Тағы/ : /Ещё/ });
    if (await more.count()) await more.click();
    const links = nav.locator('a');
    expect(await links.count()).toBeGreaterThanOrEqual(13);
    await expect(nav.locator('a[href="#/lab"]'), 'The complete shared build includes the laboratory').toBeVisible();
    await expect(nav.locator('a[href="#/outcomes"]'), 'The complete shared build includes Outcomes').toBeVisible();
    const bounds = await links.evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      return { label: node.textContent?.trim(), href: node.getAttribute('href'), left: box.left,
        right: box.right, top: box.top, bottom: box.bottom, width: box.width, viewport: innerWidth };
    }));
    await info.attach('navigation-bounds', { body: JSON.stringify(bounds, null, 2), contentType: 'application/json' });
    await info.attach('navigation', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    for (const [index, box] of bounds.entries()) {
      await expect.soft(links.nth(index), box.label).toBeVisible();
      expect.soft(box.width, `${box.label}: nonempty link`).toBeGreaterThan(0);
      expect.soft(box.left, `${box.label}: left edge`).toBeGreaterThanOrEqual(0);
      expect.soft(box.right, `${box.label}: right edge at ${info.project.name}/${lang}`).toBeLessThanOrEqual(box.viewport);
    }
  });
}
