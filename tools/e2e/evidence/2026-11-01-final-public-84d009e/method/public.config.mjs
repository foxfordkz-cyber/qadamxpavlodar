import { defineConfig } from '@playwright/test';
import original from '../../playwright.public.config.ts';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute } from 'node:path';
const own = fileURLToPath(new URL('.', import.meta.url));
const output = resolve(process.env.FINAL84_OUTPUT ?? '');
const rel = relative(own, output);
if (!rel || rel.startsWith('..') || isAbsolute(rel) || process.env.FINAL84_ORIGIN !== 'https://green-pavlodar-mock.pages.dev') throw new Error('Invalid guarded public output or origin');
export default defineConfig({ ...original,
  testDir: fileURLToPath(new URL('../../tests/', import.meta.url)),
  // Retain intentional attachments until the safe reporter copies them. The
  // runner removes this verified temporary directory before recording acceptance.
  outputDir: resolve(output, 'temporary-browser'), preserveOutput: 'always',
  reporter: [[fileURLToPath(new URL('./safe-public-reporter.mjs', import.meta.url)), { output }]],
  use: { ...original.use, baseURL: process.env.FINAL84_ORIGIN, trace: 'off', video: 'off', screenshot: 'off', serviceWorkers: 'block' },
});
