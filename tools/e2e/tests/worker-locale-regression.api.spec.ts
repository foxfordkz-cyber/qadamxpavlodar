import { test, expect, type Page } from '../support/test';
import type { BrowserContext } from '@playwright/test';
import { apiLogin } from '../support/api-login';
import { workerReady } from '../support/worker';
import { expectNoOverflow } from '../support/session';

test.describe.configure({ mode: 'default' });
test.beforeEach(() => test.skip(!process.env.E2E_PASSWORD, 'E2E_PASSWORD is not set'));
const sessions: Record<string, Awaited<ReturnType<BrowserContext['cookies']>>> = {};

test.beforeAll(async ({ browser, baseURL }) => {
  if (!process.env.E2E_PASSWORD) return;
  expect(process.env.E2E_ISOLATED, 'Worker locale API acceptance requires the isolated local runner').toBe('1');
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL!).hostname);
  // Real sessions stay in memory, as in navigation.api.spec.ts. Do not write
  // storageState, cookies, authentication responses or password-bearing artifacts.
  // Login once per role for this matrix; retain the real server's login limit.
  for (const role of ['worker1', 'foreman1']) {
    const context = await browser.newContext({ baseURL });
    try {
      const page = await context.newPage();
      await apiLogin(page, role, '/worker');
      await workerReady(page);
      sessions[role] = await context.cookies();
    } finally { await context.close(); }
  }
});

async function expectKazakhCabinet(page: Page, role: 'worker' | 'foreman') {
  await expect(page).toHaveURL(/#\/worker$/);
  await expect(page.locator('.gp-login')).toHaveCount(0);
  await workerReady(page);
  const selected = page.getByRole('group', { name: 'Язык / Тіл', exact: true }).getByRole('button', { name: 'Қаз', exact: true });
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  // Return only the role, never a session/CSRF response, to assertions/reporters.
  const actualRole = await page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
    return response.ok ? (await response.json()).data.user.role : `HTTP ${response.status}`;
  });
  expect(actualRole).toBe(role);
  const cabinet = page.locator('green-worker');
  // Soft assertions still fail the regression and let the same authenticated
  // session reach reload. Check existing kk-draft phrases, not all Russian text.
  await expect.soft(cabinet.locator('.date-tools button[data-action=refresh]'),
    'Authenticated KK shell must update the embedded cabinet language').toHaveAccessibleName('Жаңарту');
  for (const [id, label] of [['current', 'Бүгінге'], ['submitted', 'Тексеруде'], ['confirmed', 'Расталған']]) {
    const text = await cabinet.locator(`button[data-action=tab][data-id=${id}]`).innerText();
    expect.soft(text, `Authenticated ${role}: ${id} service filter must use Kazakh`).toContain(label);
  }
  await expectNoOverflow(page);
}

for (const width of [375, 1280]) for (const username of ['worker1', 'foreman1']) {
  test(`E2E-11 API: ${username}, ${width}px, authenticated direct KK entry and reload`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 812 });
    await page.context().addCookies(sessions[username]);
    await page.goto('/?source=api&lang=kk#/worker', { waitUntil: 'domcontentloaded' });
    const role = username === 'worker1' ? 'worker' : 'foreman';
    await expectKazakhCabinet(page, role);
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Unlike mock, this must retain the real authenticated role without re-entry.
    await expectKazakhCabinet(page, role);
  });
}
