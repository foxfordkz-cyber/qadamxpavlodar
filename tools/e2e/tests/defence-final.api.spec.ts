import { test, expect } from '../support/test';
import { apiLogin } from '../support/api-login';
import { zoneToDocument } from '../support/final-journey';
let cookies: Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>> = [];
test.beforeEach(() => test.skip(!process.env.E2E_PASSWORD, 'E2E_PASSWORD is not set'));
test.beforeAll(async ({browser,baseURL}) => {
  if (!process.env.E2E_PASSWORD) return;
  const context=await browser.newContext({baseURL});
  try { await apiLogin(await context.newPage(),'coordinator'); cookies=await context.cookies(); }
  finally { await context.close(); }
});
for (const lang of ['ru','kk'] as const) for (const width of [1280,375]) test(`defence API: ${lang}/${width}, real site → analysis → growth → DOCX/XML`, async ({page}) => {
  await page.setViewportSize({width,height:812});
  await page.context().addCookies(cookies);
  await zoneToDocument(page,'api',lang);
  expect(new URL(page.url()).searchParams.get('source')).toBe('api');
});
