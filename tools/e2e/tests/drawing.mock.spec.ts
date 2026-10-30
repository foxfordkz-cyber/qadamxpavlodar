import { test, expect } from '@playwright/test';
import { openPage, dismissHint, mapReady, watchErrors } from '../support/helpers';

test('drawing: undo a vertex, save a named polygon and reopen it after reload', async ({ page }, info) => {
  const errors = watchErrors(page);
  // Replace only the external basemap. MapLibre, pointer events, geometry and saving stay real.
  await page.route('https://tiles.openfreemap.org/styles/*', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#edf2ed' } },
    ] }),
  }));
  await openPage(page, '/map');
  await dismissHint(page);
  if (info.project.name === 'mobile') await page.locator('.gp-sites__tabs').getByRole('tab', { name: /Карта/ }).click();
  await mapReady(page);
  await page.getByRole('button', { name: '✎ Нарисовать зону', exact: true }).click();
  const draw = page.locator('.gp-drawbar');
  const done = draw.getByRole('button', { name: 'Готово', exact: true });
  const undo = draw.getByRole('button', { name: 'Отменить точку', exact: true });
  await expect(done).toBeDisabled();
  await expect(undo).toBeDisabled();
  const canvas = page.locator('.gp-map__canvas canvas.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  // Relative positions keep the polygon away from map controls on both viewport sizes.
  const points = [[0.35, 0.35], [0.6, 0.35], [0.6, 0.55]];
  for (let i = 0; i < points.length; i++) {
    await canvas.click({ position: { x: box.width * points[i][0], y: box.height * points[i][1] } });
    await expect(draw).toContainText(i < 2 ? `(${i + 1} из минимум 3)` : 'Углов: 3');
  }
  await expect(done).toBeEnabled();
  await undo.click();
  await expect(done).toBeDisabled();
  await expect(draw).toContainText('(2 из минимум 3)');
  await canvas.click({ position: { x: box.width * 0.6, y: box.height * 0.55 } });
  await done.click();
  const name = `QA polygon ${info.project.name}`;
  await draw.getByRole('textbox', { name: 'Название зоны', exact: true }).fill(name);
  await draw.getByRole('button', { name: 'Сохранить зону', exact: true }).click();
  await expect(draw).toHaveCount(0);
  await expect(page.locator('.gp-sites__card')).toContainText(name);
  const id = new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('site');
  expect(id).toBeTruthy();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.gp-sites__card')).toContainText(name);
  expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('site')).toBe(id);
  await expect(page.locator('.gp-sites__items button').filter({ hasText: name })).toHaveCount(1);
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.client);
  expect(errors).toEqual([]);
});
