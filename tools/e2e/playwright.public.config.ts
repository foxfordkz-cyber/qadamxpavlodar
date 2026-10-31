import { defineConfig } from '@playwright/test';

// Independent, read-only acceptance of a deployed mock. Never shares the local
// acceptance reports, API credentials, webServer or screenshot provenance.
export default defineConfig({
  testDir: './tests', testMatch: '**/*.public.spec.ts',
  timeout: 45_000, expect: { timeout: 12_000 }, workers: 2, retries: 0,
  outputDir: './test-results/public-mock/browser',
  reporter: [['list'], ['json', { outputFile: './test-results/public-mock/raw-results.json' }]],
  use: { baseURL: 'https://green-pavlodar-mock.pages.dev', browserName: 'chromium',
    locale: 'ru-RU', timezoneId: 'Asia/Qyzylorda', actionTimeout: 12_000, navigationTimeout: 30_000,
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] },
    trace: 'off', video: 'off', screenshot: 'only-on-failure' },
  projects: [1280, 375].flatMap(width => ['ru', 'kk'].map(lang => ({
    name: `public-${lang}-${width}`, metadata: { lang },
    use: { viewport: { width, height: width === 375 ? 812 : 800 }, isMobile: width === 375, hasTouch: width === 375 },
  }))),
});
