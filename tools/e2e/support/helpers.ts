import { expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { recordScreenCapture } from '../scripts/screen-provenance.mjs';

export const SITE = 'site-osm-1569993037';
export const pages = [
  ['home', '/'], ['map', '/map'], ['problems', '/problems'], ['priorities', '/priorities'],
  ['species', '/species'], ['projects', '/projects'], ['rates', '/rates'], ['import', '/import'],
  ['guide', '/guide'], ['tasks', '/tasks'], ['reports', '/reports'],
  ['lab', '/lab'], ['outcomes', '/outcomes'],
] as const;

export async function openPage(page: Page, route = '/', mode = 'mock', lang = 'ru') {
  // External catalogue photos may load slowly; readiness is determined by the UI below.
  await page.goto(`/?source=${mode}&lang=${lang}#${route}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('nav.gp-nav a').first()).toBeVisible();
  await expect(page.locator('#main')).not.toBeEmpty();
  await expect(page.locator('#main .gp-state .gp-spinner')).toHaveCount(0);
  await settledPage(page);
}

/** Readiness is product data, not just a mounted shell or a resolved navigation. */
export async function settledPage(page: Page) {
  await expect(page.locator('#main [aria-busy=true]:visible, #main .gp-spinner:visible')).toHaveCount(0);
  await expect(page.locator('#main')).not.toContainText(/Считаем решение…|Учаске үшін шешім есептелуде…/);
  const route = new URL(page.url()).hash.split('?')[0];
  if (route === '#/' || route === '#') {
    const plan = page.locator('.gp-hero .gp-plansum:not(.gp-plansum--place)');
    await expect(plan).toBeVisible();
    await expect(plan).toContainText('₸');
    await expect(plan.locator('strong')).toHaveCount(3);
    return 'settled-plan' as const;
  }
  if (route === '#/lab') {
    await expect(page.locator('.gp-lab-results')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.gp-lab-card')).toHaveCount(3);
    await expect(page.locator('.gp-lab-card').first().locator('[data-metric=spent]')).not.toHaveText('');
    return 'settled-plan' as const;
  }
  if (route === '#/outcomes') {
    for (const variant of ['econom', 'optimal', 'max']) await expect(page.getByTestId(`outcome-${variant}`)).toBeVisible();
    await expect(page.locator('.gp-outcomes-page .gp-state[role=status]')).toHaveCount(0);
    return 'settled-outcomes' as const;
  }
  return route === '#/map' ? 'settled-map' as const : 'settled-page' as const;
}

export async function dismissHint(page: Page) {
  const hint = page.locator('.gp-firstrun');
  if (await hint.isVisible()) await hint.getByRole('button', { name: /^(Понятно, начать|Түсінікті, бастау)$/ }).click();
}

export async function selectZone(page: Page, siteId?: string) {
  await openPage(page, siteId ? `/map?site=${encodeURIComponent(siteId)}` : '/map');
  await dismissHint(page);
  if (!siteId) {
    const rows = page.locator('.gp-sites__items button');
    await expect(rows.first()).toBeVisible();
    await rows.first().click();
  }
  await expect(page).toHaveURL(/[#&?]site=/);
  const card = page.locator('.gp-sites__card');
  await expect(card.getByRole('tablist', { name: 'Разделы зоны' })).toBeVisible();
  return card;
}

export async function openEffect(page: Page, siteId?: string) {
  const card = await selectZone(page, siteId);
  await card.getByRole('tab', { name: 'Эффект', exact: true }).click();
  await expect(card.getByRole('heading', { name: 'Машина времени', exact: true })).toBeVisible();
  return card;
}

export async function presentation(page: Page) {
  if (!await page.locator('html').evaluate(el => el.classList.contains('gp-present'))) await page.keyboard.press('Alt+KeyP');
  await expect(page.locator('html')).toHaveClass(/\bgp-present\b/);
}

export async function screenshot(page: Page, name: string, info: TestInfo) {
  const readiness = await settledPage(page);
  if (name === 'map' && page.viewportSize()!.width === 375) {
    await page.locator('.gp-sites__tabs').getByRole('tab', { name: /Карта$/ }).click();
    await expect(page.locator('.gp-sites')).toHaveAttribute('data-tab', 'map');
    await expect(page.locator('.gp-sites__map')).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  }
  if (await page.locator('.gp-sites__map').count()) await mapReady(page);
  if (await page.locator('.gp-hero').count()) {
    await expect(page.locator('.gp-hero__map:not(.is-ready)')).toHaveCount(0, { timeout: 20_000 });
  }
  await presentation(page);
  await page.evaluate(async () => { await document.fonts.ready; });
  // The laboratory/Outcomes controls sit above their results: the defence frame
  // must show a calculated plan rather than only inputs or a loading shell.
  const route = new URL(page.url()).hash;
  const result = route.startsWith('#/lab') ? page.locator('.gp-lab-card').first()
    : route.startsWith('#/outcomes') ? page.getByTestId('outcome-econom') : null;
  if (result) {
    // Centering a card taller than the viewport cuts off its plan name. Use the
    // real page scroll, accounting for its sticky header; never hide page UI.
    await result.evaluate(element => {
      const header = document.querySelector<HTMLElement>('.gp-header');
      const offset = header && ['sticky', 'fixed'].includes(getComputedStyle(header).position) ? header.offsetHeight : 0;
      window.scrollTo({ top: Math.max(0, scrollY + element.getBoundingClientRect().top - offset - 12), behavior: 'instant' });
    });
    await expect(result.getByRole('heading').first()).toBeInViewport({ ratio: 1 });
  }
  if (name.startsWith('time-') && page.viewportSize()!.width === 375) {
    const card = page.locator('.gp-sites__card');
    await card.getByRole('button', { name: 'Развернуть карточку', exact: true }).click();
    await expect.poll(async () => (await card.boundingBox())!.height / page.viewportSize()!.height).toBeGreaterThan(0.85);
    await card.locator('.gp-tm').scrollIntoViewIfNeeded();
    await expect(card.locator('.gp-tm__stats')).toBeInViewport({ ratio: 1 });
  }
  // Lazy external photos may still be downloading after the page and fonts are ready.
  // Only images actually inside the captured viewport must finish; offscreen images
  // must not hold a screenshot hostage. A broken visible image is not a ready frame.
  await expect.poll(() => page.locator('img').evaluateAll(images => images.filter(image => {
    const rect = image.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0 &&
      rect.left < innerWidth && rect.right > 0 && (!image.complete || image.naturalWidth === 0);
  }).length), { message: 'Visible presentation photos must finish loading', timeout: 60_000 }).toBe(0);
  // Candidate captures are reviewed before replacing the presentation materials.
  const dir = resolve(process.env.E2E_SCREEN_REVIEW === '1' ? 'test-results/screen-review' : 'screens');
  await mkdir(dir, { recursive: true });
  const file = resolve(dir, `${name}-${page.viewportSize()!.width}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  recordScreenCapture({ file, name: `${name}-${page.viewportSize()!.width}.png`, width: page.viewportSize()!.width, height: page.viewportSize()!.height,
    readiness, source: 'mock', testIdentity: info.titlePath.join(' > ') });
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
