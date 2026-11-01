import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

// Additional visual evidence, not a new full suite or native Word/pagination check.
// Intentionally not included in the standard 30-frame presentation manifest.
const directory = fileURLToPath(new URL('.', import.meta.url));
const e2e = resolve(directory, '../..');
const web = resolve(e2e, '../../apps/web');
const output = join(directory, 'methodology');
const testSHA = 'cdc3ec257726ef937b0bbf953253a755f2e225a9';
const applicationBase = '932574e630621a6bc9aeacc46703e6ade5e7bdfc';
const appsTree = '72b065f072e006dc35600da693036ccedefed265';
const siteId = 'site-osm-1569993037';
const port = 5178;
const baseURL = `http://127.0.0.1:${port}`;
const git = args => execFileSync('git', args, { cwd: e2e, encoding: 'utf8', windowsHide: true }).trim();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use Node 24');
assert.equal(git(['rev-parse', 'HEAD']), testSHA, 'Unexpected QA revision');
assert.equal(git(['rev-parse', 'HEAD:apps']), appsTree, 'Application tree changed');
assert.equal(git(['status', '--porcelain', '--untracked-files=normal']), '', 'Use the clean tested checkout');
git(['merge-base', '--is-ancestor', applicationBase, 'HEAD']);
mkdirSync(output, { recursive: true });
const result = { schemaVersion: 1, startedAt: new Date().toISOString(), testSHA, applicationBase, appsTree,
  dirty: false, source: 'mock', siteId, baseURL, status: 'running', captures: [],
  scope: 'RU/KK report methodology notices, collapsed and expanded. Element PNGs show the full notice without cropping its text; not full-page/slideshow frames. Native Word and print pagination are not tested.' };
const env = { ...process.env, VITE_DATA_SOURCE: 'mock' };
delete env.E2E_PASSWORD;
delete env.DEMO_PASSWORD;
let vite, viteDone, browser, context;
try {
  const probe = createServer();
  await new Promise((resolvePromise, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolvePromise));
  });
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: web, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  vite.stdout.resume(); vite.stderr.resume();
  viteDone = new Promise(resolvePromise => {
    vite.once('error', () => resolvePromise({ startFailed: true }));
    vite.once('exit', code => resolvePromise({ code }));
  });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (vite.exitCode !== null) throw new Error('Own Vite child stopped before becoming ready');
    try { ready = (await fetch(baseURL)).ok; } catch {}
    if (ready) break;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
  }
  assert(ready, 'Own Vite child did not become ready within 30 seconds');
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  for (const language of ['ru', 'kk']) for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
    context = await browser.newContext({ viewport, locale: 'ru-RU', timezoneId: 'Asia/Qyzylorda' });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    page.setDefaultNavigationTimeout(30_000);
    const route = `/?source=mock&lang=${language}#/report?site=${siteId}`;
    await page.goto(baseURL + route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.gp-report-doc')).toBeVisible({ timeout: 12_000 });
    await expect(page.locator('#main [aria-busy=true]:visible, #main .gp-spinner:visible')).toHaveCount(0, { timeout: 12_000 });
    const hint = page.locator('.gp-firstrun');
    if (await hint.isVisible()) await hint.getByRole('button', { name: /^(Понятно, начать|Түсінікті, бастау)$/ }).click();
    await page.keyboard.press('Alt+KeyP');
    await expect(page.locator('html')).toHaveClass(/\bgp-present\b/);
    const notice = page.getByRole('region', { name: language === 'ru' ? 'Как получен прогноз' : 'Болжам қалай есептелді', exact: true });
    const toggle = notice.locator('.gp-survival-method__toggle');
    await expect(notice).toBeVisible({ timeout: 12_000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => page.evaluate(() => document.fonts.status), { timeout: 12_000 }).toBe('loaded');
    await notice.scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'No horizontal page overflow');
    for (const state of ['collapsed', 'expanded']) {
      if (state === 'expanded') {
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(notice.locator('.gp-survival-method__details')).toBeVisible();
      }
      const filename = `methodology-${language}-${viewport.width}-${state}.png`;
      await notice.screenshot({ path: join(output, filename), animations: 'disabled' });
      const bytes = readFileSync(join(output, filename));
      result.captures.push({ file: filename, language, viewport, state, route, kind: 'element', target: '.gp-survival-method',
        width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length, sha256: sha256(bytes),
        capturedAt: new Date().toISOString(), readiness: 'settled-report-and-fonts', visualReview: 'pending' });
    }
    await context.close(); context = null;
  }
  assert.equal(result.captures.length, 8);
  result.status = 'captured-awaiting-visual-review';
} catch (error) {
  result.status = 'failed'; result.error = { name: error.name, message: String(error.message).slice(0, 1500) }; process.exitCode = 1;
} finally {
  await context?.close(); await browser?.close();
  if (vite && vite.exitCode === null) vite.kill();
  if (viteDone) await viteDone;
  result.endedAt = new Date().toISOString();
  writeFileSync(join(output, 'capture-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, testSHA, applicationBase, captures: result.captures.length }));
}
