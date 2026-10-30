import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const directory = new URL('../fixtures/fonts/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
const verified = (file: string, hash: string) => {
  const bytes = readFileSync(new URL(file, directory));
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`QA font asset checksum mismatch: ${file}`);
  return bytes;
};
const css = verified('google-fonts.css', manifest.cssSha256);
const fonts = new Map<string, Buffer>(manifest.assets.filter((asset: { type: string }) => asset.type === 'font/woff2')
  .map((asset: { url: string; file: string; sha256: string }) => [asset.url, verified(asset.file, asset.sha256)]));

// Replay only the app's public, unchanged font assets. All application/API requests,
// photos and map tiles still use their normal source; no UI or response data is mocked here.
// Overriding context instead of an automatic fixture preserves passwordless API skips.
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route(/^https:\/\/fonts\.googleapis\.com\//, async route => {
      expect(route.request().url(), 'The app font stylesheet changed; review and update the recorded assets').toBe(manifest.source);
      await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css });
    });
    await context.route(/^https:\/\/fonts\.gstatic\.com\//, async route => {
      const body = fonts.get(route.request().url());
      expect(body, 'The font file is missing from the reviewed QA manifest').toBeDefined();
      await route.fulfill({ status: 200, contentType: 'font/woff2', headers: { 'access-control-allow-origin': '*' }, body: body! });
    });
    await use(context);
  },
});

export { expect };
export type { Page } from '@playwright/test';
