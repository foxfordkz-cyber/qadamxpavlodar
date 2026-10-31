import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const api = process.env.E2E_MODE === 'api';
const requestedRun = process.env.E2E_PROFILE;
const mockRun = process.env.E2E_RUN_KNOWN_BUGS === '1' ? 'bugs' :
  requestedRun === 'smoke' || requestedRun === 'screens' ? requestedRun : 'mock';
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5174';
const launchOptions = { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] };
export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: true,
  // API cases share a disposable registry and one test edits/restores rates.
  // Serialize API files so another test cannot observe that temporary edit.
  workers: api ? 1 : 2,
  retries: 0,
  forbidOnly: !!process.env.CI,
  outputDir: api ? 'test-results/api' : `test-results/${mockRun}`,
  // Playwright may create error-context.md with locator ARIA snapshots even when
  // trace/video/screenshots are off. Never retain API output directories.
  preserveOutput: api ? 'never' : 'always',
  reporter: api ? [['./support/api-reporter.ts']] : [
    ['list'], ['html', { outputFolder: `playwright-report/${mockRun}`, open: 'never' }],
    ['json', { outputFile: `test-results/${mockRun}/results.json` }],
  ],
  use: {
    baseURL, browserName: 'chromium', launchOptions,
    locale: 'ru-RU', timezoneId: 'Asia/Qyzylorda',
    actionTimeout: 12_000, navigationTimeout: 30_000,
    // API credentials must never enter traces, videos or automatic screenshots.
    trace: api ? 'off' : 'retain-on-failure',
    screenshot: api ? 'off' : 'only-on-failure', video: 'off',
  },
  projects: api ? [{ name: 'api', testMatch: '**/*.api.spec.ts', use: { viewport: { width: 1280, height: 800 } } }] : [
    { name: 'desktop', testMatch: '**/*.mock.spec.ts', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', testMatch: '**/*.mock.spec.ts', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
    ...[375, 800, 801, 1280].map(width => ({
      name: `crew-${width}`, testMatch: '**/*.crew.spec.ts',
      use: { viewport: { width, height: width === 1280 ? 800 : 812 }, isMobile: width === 375, hasTouch: width <= 800 },
    })),
    ...[1280, 1440].map(width => ({
      name: `nav-${width}`, testMatch: '**/*.wide.spec.ts',
      use: { viewport: { width, height: 900 } },
    })),
  ],
  // An explicit URL means an already running server (including Docker).
  // Without a password API tests skip without requiring even a local web server.
  webServer: process.env.E2E_BASE_URL || (api && !process.env.E2E_PASSWORD) ? undefined : {
    command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
    cwd: fileURLToPath(new URL('../../apps/web', import.meta.url)),
    url: baseURL, reuseExistingServer: !process.env.CI, timeout: 60_000,
    stdout: 'ignore', stderr: 'pipe',
  },
});
