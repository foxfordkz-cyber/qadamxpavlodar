import { defineConfig } from '@playwright/test';
import original from '../../playwright.config.ts';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute } from 'node:path';
const own = fileURLToPath(new URL('.', import.meta.url));
const output = resolve(process.env.FINAL84_OUTPUT ?? '');
const rel = relative(own, output);
if (!rel || rel.startsWith('..') || isAbsolute(rel) || process.env.FINAL84_ORIGIN !== 'https://green-pavlodar-mock.pages.dev') throw new Error('Invalid guarded public output or origin');
const match = '**/worker-locale-regression.mock.spec.ts';
export default defineConfig({ ...original,
  testDir: fileURLToPath(new URL('../../tests/', import.meta.url)), testMatch: match,
  projects: original.projects.filter(project => ['desktop', 'mobile'].includes(project.name)).map(project => ({ ...project, testMatch: match })),
  webServer: undefined, outputDir: resolve(output, 'temporary-browser'), preserveOutput: 'always',
  reporter: [[fileURLToPath(new URL('./safe-public-reporter.mjs', import.meta.url)), { output }]],
  use: { ...original.use, baseURL: process.env.FINAL84_ORIGIN, trace: 'off', video: 'off', screenshot: 'off', serviceWorkers: 'block' },
});
