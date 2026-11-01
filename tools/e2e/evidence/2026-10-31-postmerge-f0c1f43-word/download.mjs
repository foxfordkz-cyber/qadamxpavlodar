import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';

// Manual document generation for subsequent native Word review, not a new full
// Playwright acceptance run. No production calculation function is imported.
const directory = fileURLToPath(new URL('.', import.meta.url));
const e2e = resolve(directory, '../..');
const web = resolve(e2e, '../../apps/web');
const testSHA = 'f0c1f43eb424408ef0db7fad6e263bb17e34f995';
const applicationBase = 'fdc6e756be99dc5ba3a7a48ca1df17c4bfbef5ef';
const appsTree = 'f19500893c20ee19c170c393f2a8414b95e19255';
const siteId = 'site-osm-1569993037';
const options = { variant: 'optimal', careYears: 2, watering: 'regular' };
const port = 5178;
const baseURL = `http://127.0.0.1:${port}`;
const git = args => execFileSync('git', args, { cwd: e2e, encoding: 'utf8', windowsHide: true }).trim();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use Node 24');
assert.equal(git(['rev-parse', 'HEAD']), testSHA, 'Unexpected QA revision');
assert.equal(git(['rev-parse', 'HEAD:apps']), appsTree, 'Application tree changed');
assert.equal(git(['status', '--porcelain', '--untracked-files=normal']), '', 'Use the clean tested checkout');
git(['merge-base', '--is-ancestor', applicationBase, 'HEAD']);
mkdirSync(directory, { recursive: true });

const result = {
  schemaVersion: 1, startedAt: new Date().toISOString(), testSHA,
  applicationBase, appsTree, dirty: false, source: 'mock', siteId, options,
  baseURL, scope: 'Fresh UI DOCX exports and ZIP/XML validation only; native Microsoft Word review is separate.',
  nativeMicrosoftWordOpened: false, nativeMicrosoftWordVisualCheck: false,
  environment: { node: process.versions.node, platform: process.platform, browser: 'Chromium headless, SwiftShader', viewport: { width: 1280, height: 800 } },
  documents: [], status: 'running',
};
const env = { ...process.env, VITE_DATA_SOURCE: 'mock' };
delete env.E2E_PASSWORD;
delete env.DEMO_PASSWORD;

async function freePort() {
  const probe = createServer();
  await new Promise((resolvePromise, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolvePromise));
  });
}
let vite, browser, context, viteDone;
try {
  await freePort();
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: web, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  // Do not publish child stdout/stderr or environment values.
  vite.stdout.resume();
  vite.stderr.resume();
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
  context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 }, locale: 'ru-RU', timezoneId: 'Asia/Qyzylorda' });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  page.setDefaultNavigationTimeout(30_000);
  const encodedOptions = encodeURIComponent(Buffer.from(JSON.stringify(options), 'utf8').toString('base64'));
  result.route = `/?source=mock&lang=ru#/report?site=${siteId}&o=${encodedOptions}`;
  await page.goto(baseURL + result.route, { waitUntil: 'domcontentloaded' });
  const report = page.locator('.gp-report-doc');
  await expect(report.getByRole('heading', { name: '3. Смета', exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(report.locator('p').first()).toContainText(/уход\s+2\s+г\./);
  result.reportDescription = await report.locator('p').first().innerText();
  result.uiTotalKzt = Number((await report.locator('table').nth(2).locator('tbody tr').last().locator('td').nth(1).innerText()).replace(/\s/g, ''));
  assert(result.uiTotalKzt > 0, 'The rendered estimate must be complete');

  await page.getByRole('button', { name: /Служебная записка.*Word/ }).click();
  const panel = page.getByRole('region', { name: /Служебная записка.*Word/ });
  await expect(panel).toBeVisible();
  await panel.locator('select[multiple]').selectOption([siteId]);
  const tableNumbers = [];
  for (const { language, code, title } of [
    { language: 'Рус', code: 'ru', title: 'СЛУЖЕБНАЯ ЗАПИСКА' },
    { language: 'Қаз', code: 'kk', title: 'ҚЫЗМЕТТІК ЖАЗБА' },
  ]) {
    await panel.locator('label').filter({ hasText: new RegExp(`^${language}$`) }).click();
    await expect(panel.getByRole('radio', { name: language, exact: true })).toBeChecked();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      panel.getByRole('button', { name: /Скачать.*\.docx/i }).click(),
    ]);
    assert.match(download.suggestedFilename(), new RegExp(`-${code}-.*\\.docx$`));
    const filename = `memo-${code}-f0c1f43.docx`;
    await download.saveAs(join(directory, filename));
    const bytes = readFileSync(join(directory, filename));
    assert(bytes.length > 5 * 1024, 'DOCX must be larger than 5 KiB');
    assert.equal(bytes.subarray(0, 2).toString(), 'PK', 'DOCX must have a ZIP signature');
    const archive = unzipSync(bytes);
    for (const entry of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) assert(archive[entry], `Missing ${entry}`);
    const xml = strFromU8(archive['word/document.xml']);
    assert(!/<!DOCTYPE/i.test(xml), 'Unexpected XML doctype');
    const inspected = await page.evaluate(xmlText => {
      const document = new DOMParser().parseFromString(xmlText, 'application/xml');
      const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      const text = [...document.getElementsByTagNameNS(namespace, 't')].map(element => element.textContent).join('');
      const tables = [...document.getElementsByTagNameNS(namespace, 'tbl')].map(table =>
        [...table.getElementsByTagNameNS(namespace, 'tr')].map(row =>
          [...row.getElementsByTagNameNS(namespace, 'tc')].map(cell =>
            [...cell.getElementsByTagNameNS(namespace, 't')].map(element => element.textContent).join(''))));
      return { parserErrors: document.getElementsByTagName('parsererror').length, root: document.documentElement.localName, text, tables };
    }, xml);
    assert.equal(inspected.parserErrors, 0, 'DOCX document.xml must be valid XML');
    assert.equal(inspected.root, 'document');
    assert(inspected.text.includes(title), `Missing ${code} memo title`);
    assert(inspected.text.includes(code === 'ru' ? 'Смета по статьям' : 'Баптар бойынша смета'));
    const numbers = inspected.tables.map(table => table.slice(1).map(row => row.slice(1).map(cell =>
      cell.match(/[+−-]?\d+(?:[\s\u00a0\u202f]\d{3})*(?:[.,]\d+)?/g) ?? [])));
    tableNumbers.push(numbers);
    result.documents.push({ language: code, file: filename, suggestedFilename: download.suggestedFilename(), bytes: bytes.length,
      sha256: sha256(bytes), documentXmlSha256: sha256(archive['word/document.xml']), zipSignature: 'PK', requiredEntriesPresent: true,
      validDocumentXml: true, expectedTitle: title, expectedTitlePresent: true, tables: inspected.tables.length,
      nativeMicrosoftWordOpened: false, nativeMicrosoftWordVisualCheck: false });
  }
  assert.deepEqual(tableNumbers[0], tableNumbers[1], 'RU/KK table numeric data must match for identical inputs');
  result.numericTablesIdentical = true;
  result.status = 'downloaded-and-structure-checked';
} catch (error) {
  result.status = 'failed';
  result.error = { name: error.name, message: String(error.message).slice(0, 1500) };
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser?.close();
  if (vite && vite.exitCode === null) vite.kill();
  if (viteDone) await viteDone;
  result.endedAt = new Date().toISOString();
  writeFileSync(join(directory, 'download-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, testSHA, applicationBase, documents: result.documents.map(({ language, file, bytes, sha256 }) => ({ language, file, bytes, sha256 })), nativeMicrosoftWordOpened: false }));
}
