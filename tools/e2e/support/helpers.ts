import { expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export const SITE = 'site-osm-1569993037';
export const pages = [
  ['home', '/'], ['map', '/map'], ['problems', '/problems'], ['priorities', '/priorities'],
  ['species', '/species'], ['projects', '/projects'], ['rates', '/rates'], ['import', '/import'],
  ['guide', '/guide'], ['tasks', '/tasks'], ['reports', '/reports'],
] as const;

export async function openPage(page: Page, route = '/', mode = 'mock', lang = 'ru') {
  // External catalogue photos may load slowly; readiness is determined by the UI below.
  await page.goto(`/?source=${mode}&lang=${lang}#${route}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('nav.gp-nav a').first()).toBeVisible();
  await expect(page.locator('#main')).not.toBeEmpty();
  await expect(page.locator('#main .gp-state .gp-spinner')).toHaveCount(0);
}

export async function dismissHint(page: Page) {
  const hint = page.locator('.gp-firstrun');
  if (await hint.isVisible()) await hint.getByRole('button', { name: 'Понятно, начать' }).click();
}

export async function selectZone(page: Page) {
  await openPage(page, '/map');
  await dismissHint(page);
  const rows = page.locator('.gp-sites__items button');
  await expect(rows.first()).toBeVisible();
  await rows.first().click();
  await expect(page).toHaveURL(/[#&?]site=/);
  const card = page.locator('.gp-sites__card');
  await expect(card.getByRole('tablist', { name: 'Разделы зоны' })).toBeVisible();
  return card;
}

export async function openEffect(page: Page) {
  const card = await selectZone(page);
  await card.getByRole('tab', { name: 'Эффект', exact: true }).click();
  await expect(card.getByRole('heading', { name: 'Машина времени', exact: true })).toBeVisible();
  return card;
}

export async function presentation(page: Page) {
  if (!await page.locator('html').evaluate(el => el.classList.contains('gp-present'))) await page.keyboard.press('Alt+KeyP');
  await expect(page.locator('html')).toHaveClass(/\bgp-present\b/);
}

export async function screenshot(page: Page, name: string, info: TestInfo) {
  if (await page.locator('.gp-sites__map').count()) await mapReady(page);
  if (await page.locator('.gp-hero').count()) {
    await expect(page.locator('.gp-hero__map:not(.is-ready)')).toHaveCount(0, { timeout: 20_000 });
  }
  await presentation(page);
  await page.evaluate(async () => { await document.fonts.ready; });
  const dir = resolve('screens');
  await mkdir(dir, { recursive: true });
  const file = resolve(dir, `${name}-${page.viewportSize()!.width}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  await info.attach(`${name}-${page.viewportSize()!.width}`, { path: file, contentType: 'image/png' });
}

export async function mapReady(page: Page) {
  // The service indicator resolves on MapLibre load OR on the app's 12s fallback.
  await expect(page.locator('.gp-svc').last()).not.toHaveClass(/gp-svc--unknown/, { timeout: 20_000 });
}

export async function chooseYear(page: Page, label: string) {
  const group = page.locator('.gp-sites__card').getByRole('radiogroup', { name: 'Год после посадки' });
  // Custom segments visually hide the native radio. Click its visible label as a user does.
  await group.locator('label').filter({ hasText: new RegExp(`^${label}$`) }).click();
  await expect(group.getByRole('radio', { name: label, exact: true })).toBeChecked();
}

export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    // Only an explicitly identified style warning from MapLibre is permitted.
    const styleWarning = /maplibre/i.test(message.location().url + message.text()) &&
      /^(?:Warning:\s*)?(?:Style specification warning|Style warning)/i.test(message.text());
    if (!styleWarning) errors.push(`console.error: ${message.text()}`);
  });
  return errors;
}
