// Real browser -> frontend encoder -> HTTP -> shapefile decoder -> isolated SQLite.
// Uses the existing tools/e2e installation; does not change its suite.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { unzipSync, zipSync } from 'fflate';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON ?? new URL('../../../tools/e2e/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
process.env.DEMO_PASSWORD = randomBytes(24).toString('hex');
const { Store } = await import('../src/db.ts');
const { seed } = await import('../src/seed.ts');
const { seedV2 } = await import('../src/v2/seed.ts');
const { seedTz } = await import('../src/tz/seed.ts');
const { seedMunicipal, syncMunicipalZones } = await import('../src/municipal/data.ts');
const { createApp } = await import('../src/app.ts');
const dir = mkdtempSync(join(tmpdir(), 'gp-shp-import-'));
const store = new Store(join(dir, 'test.sqlite'));
const fixture = fileURLToPath(new URL('../../../fixtures/imports/synthetic-zones.zip', import.meta.url));
const expected = JSON.parse(readFileSync(join(dirname(fixture), 'synthetic-zones.expected.json'), 'utf8'));
const externalFixture = join(dirname(fixture), 'ne_110m_geography_regions_elevation_points.zip');
const externalExpected = JSON.parse(readFileSync(join(dirname(fixture), 'ne_110m_geography_regions_elevation_points.expected.json'), 'utf8'));
assert.equal(createHash('sha256').update(readFileSync(externalFixture)).digest('hex'), externalExpected.archiveSha256);
const lakeFixture = join(dirname(fixture), 'ne_110m_lakes.zip');
const lakeExpected = JSON.parse(readFileSync(join(dirname(fixture), 'ne_110m_lakes.expected.json'), 'utf8'));
assert.equal(createHash('sha256').update(readFileSync(lakeFixture)).digest('hex'), lakeExpected.archiveSha256);
const output = fileURLToPath(new URL('../../web/dist-tests/shp-import', import.meta.url));
mkdirSync(output, { recursive: true });
const base = 'http://127.0.0.1:5187';
const results: object[] = [];
let server, vite, browser;
try {
  seed(store); await seedV2(store); seedTz(store); await seedMunicipal(store);
  store.transaction(() => syncMunicipalZones(store));
  server = createApp(store, { uploadsPath: join(dir, 'uploads'), frontendOrigins: [base] }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  vite = spawn(process.execPath, [fileURLToPath(new URL('../../web/node_modules/vite/bin/vite.js', import.meta.url)), '--host', '127.0.0.1', '--port', '5187', '--strictPort'], {
    cwd: fileURLToPath(new URL('../../web', import.meta.url)), windowsHide: true,
    env: { ...process.env, VITE_API_PROXY: `http://127.0.0.1:${server.address().port}` }, stdio: ['ignore', 'ignore', 'ignore'],
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (vite.exitCode !== null) throw Error('Isolated Vite exited before readiness');
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(ready, 'Isolated Vite startup');
  browser = await chromium.launch();
  for (const mode of ['api', 'mock']) for (const width of [1280, 375]) for (const lang of ['ru', 'kk']) {
    // All removed rows belong exclusively to the temporary test database created above.
    store.run('DELETE FROM municipal_features');
    store.run('DELETE FROM municipal_imports');
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: lang === 'kk' ? 'kk-KZ' : 'ru-RU' });
    const page = await context.newPage();
    const errors: string[] = [];
    let importRequests = 0;
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/v1/imports')) importRequests++; });
    await page.goto(`${base}/?source=${mode}&lang=${lang}#/import`, { waitUntil: 'domcontentloaded' });
    if (mode === 'api') {
      await page.locator('input[autocomplete="username"]').fill('coordinator');
      try { await page.locator('input[autocomplete="current-password"]').fill(process.env.DEMO_PASSWORD); }
      catch { throw Error('Temporary test login could not be entered (redacted)'); }
      await page.locator('.gp-login button[type="submit"]').click();
    }
    const input = page.locator('input[type="file"]');
    await expect(input).toHaveCount(1);
    await expect(page.locator('#import-formats')).toContainText(mode === 'api' ? '.prj' : lang === 'ru' ? 'демо-режиме' : 'Демо режимінде');
    if (mode === 'api') {
      await expect(input).toHaveAttribute('accept', /\.zip/);
      await page.getByLabel(lang === 'ru' ? 'Источник и дата' : 'Дереккөз және күні', { exact: true }).fill('Synthetic SHP fixture; 2026-10-30');
      const previewResponse = page.waitForResponse(r => r.url().endsWith('/imports/preview') && r.request().method() === 'POST');
      await input.setInputFiles(fixture);
      const preview = await previewResponse;
      assert.equal(preview.status(), 200);
      const p = (await preview.json()).data;
      assert.deepEqual([p.total, p.valid, p.invalid, p.committed], [2, 2, 0, false]);
      assert.equal(store.get('SELECT count(*) AS n FROM municipal_features')!.n, 0, 'Preview must not persist features');
      const commitResponse = page.waitForResponse(r => r.url().endsWith(`/imports/${p.id}/commit`));
      await page.getByRole('button', { name: lang === 'ru' ? 'Подтвердить и сохранить слой' : 'Растау және қабатты сақтау', exact: true }).click();
      const committed = await commitResponse;
      assert.equal(committed.status(), 200);
      assert.equal((await committed.json()).data.committed, true);
      await expect(page.locator('.gp-import__res')).toContainText(lang === 'ru' ? 'Слой сохранён на сервере.' : 'Қабат серверде сақталды.');
      const rows = store.all('SELECT data FROM municipal_features').map(row => JSON.parse(String(row.data)));
      assert.equal(rows.length, expected.length);
      for (const row of rows) {
        const wanted = expected.find(x => x.name === row.properties.name);
        assert.ok(wanted, 'UTF-8 DBF names survive the complete path');
        assert.equal(row.geometry.type, 'Polygon');
        const actualRing = row.geometry.coordinates[0];
        assert.equal(actualRing.length, wanted.ring.length);
        // Projection decoding can round the last floating-point bit; tolerance is < 0.2 mm.
        assert.ok(wanted.ring.every(p => actualRing.some(q => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9)));
        assert.equal(row.properties.dataClass, 'demo');
      }
      await page.screenshot({ path: join(output, `${mode}-${lang}-${width}.png`), fullPage: true });
      await page.reload({ waitUntil: 'domcontentloaded' });
      const sites = await context.request.get(`${base}/api/v1/municipal/sites`);
      assert.equal(sites.status(), 200);
      const restored = (await sites.json()).data;
      assert.ok(expected.every(x => restored.some(s => s.name === x.name)), 'Saved zones survive a page reload');

      // A malformed archive and a valid archive without a projection must surface API errors.
      const entries = unzipSync(readFileSync(fixture)); delete entries['zones.prj'];
      for (const [name, bytes, code] of [
        ['missing-crs.zip', Buffer.from(zipSync(entries)), 'MISSING_CRS'],
        ['broken.zip', Buffer.from('This is not a ZIP archive'), 'INVALID_IMPORT'],
      ] as const) {
        await page.getByLabel(lang === 'ru' ? 'Источник и дата' : 'Дереккөз және күні', { exact: true }).fill('Synthetic rejection test; 2026-10-30');
        const rejectedResponse = page.waitForResponse(r => r.url().endsWith('/imports/preview'));
        await input.setInputFiles({ name, mimeType: 'application/zip', buffer: bytes });
        const rejected = await rejectedResponse;
        assert.equal(rejected.status(), 400);
        assert.equal((await rejected.json()).error.code, code);
        await expect(page.locator('[role="alert"]')).toBeVisible();
        await expect(page.locator('[role="alert"]')).toContainText(code === 'MISSING_CRS' ? (lang === 'ru' ? 'В ZIP отсутствуют' : 'ZIP ішінде') : (lang === 'ru' ? 'Не удалось прочитать файл' : 'Файлды оқу мүмкін болмады'));
        await expect(page.locator('.gp-import__res')).toHaveCount(0);
        assert.equal(store.get('SELECT count(*) AS n FROM municipal_features')!.n, 2);
      }

      // A second reader confirms duplicate consecutive points in the untouched lake file.
      // It must not bypass geometry validation or partially commit the invalid batch.
      await page.locator('.gp-import select').first().selectOption('city');
      await page.getByLabel(lang === 'ru' ? 'Источник и дата' : 'Дереккөз және күні', { exact: true }).fill('Natural Earth Lakes 5.0.0; public domain; validation test');
      const lakeResponse = page.waitForResponse(r => r.url().endsWith('/imports/preview'));
      await input.setInputFiles(lakeFixture);
      const lake = await lakeResponse;
      assert.equal(lake.status(), 200);
      const lakePreview = (await lake.json()).data;
      assert.equal(lakeExpected.features.filter(x => x.consecutiveDuplicate).length, 14);
      assert.deepEqual([lakePreview.total, lakePreview.valid, lakePreview.invalid, lakePreview.committed], [24, 10, 14, false]);
      await page.locator('.gp-import__res input[type="checkbox"]').check();
      await expect(page.locator('.gp-import__res button')).toBeDisabled();
      assert.equal(store.get("SELECT count(*) AS n FROM municipal_features WHERE layer='city'")!.n, 0);
      await page.screenshot({ path: join(output, `invalid-polygons-${lang}-${width}.png`), fullPage: true });

      // Independent, unmodified public-domain point archive (not Pavlodar planting data).
      // Keep it in the test database's city layer, explicitly marked demo.
      await page.locator('.gp-import select').first().selectOption('city');
      await page.getByLabel(lang === 'ru' ? 'Источник и дата' : 'Дереккөз және күні', { exact: true }).fill('Natural Earth Elevation Points 5.0.0; public domain; test only; accessed 2026-10-30');
      const externalResponse = page.waitForResponse(r => r.url().endsWith('/imports/preview'));
      await input.setInputFiles(externalFixture);
      const external = await externalResponse;
      assert.equal(external.status(), 200);
      const externalPreview = (await external.json()).data;
      assert.deepEqual([externalPreview.total, externalPreview.valid, externalPreview.invalid, externalPreview.committed], [19, 19, 0, false]);
      assert.ok(externalPreview.issues.some(x => x.text.includes('Outside Pavlodar')));
      assert.equal(store.get("SELECT count(*) AS n FROM municipal_features WHERE layer='city'")!.n, 0);
      const save = page.locator('.gp-import__res button');
      await expect(save).toBeDisabled();
      await page.locator('.gp-import__res input[type="checkbox"]').check();
      const externalCommit = page.waitForResponse(r => r.url().endsWith(`/imports/${externalPreview.id}/commit`));
      await save.click();
      assert.equal((await externalCommit).status(), 200);
      await expect(page.locator('.gp-import__res')).toContainText(lang === 'ru' ? 'Слой сохранён на сервере.' : 'Қабат серверде сақталды.');
      const externalRows = store.all("SELECT data FROM municipal_features WHERE layer='city'").map(row => JSON.parse(String(row.data)));
      assert.equal(externalRows.length, externalExpected.features.length);
      for (const row of externalRows) {
        const wanted = externalExpected.features.find(x => x.neId === row.properties.ne_id);
        assert.ok(wanted, 'Independent DBF names');
        assert.equal(row.properties.name, wanted.name);
        assert.equal(row.geometry.type, 'Point');
        const points: number[][] = [];
        const collect = x => typeof x[0] === 'number' ? points.push(x) : x.forEach(collect);
        collect(row.geometry.coordinates);
        assert.equal(points.length, wanted.vertices);
        const bbox = [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
        assert.ok(bbox.every((n, i) => Math.abs(n - wanted.bbox[i]) < 1e-9), 'Independent PyShp bounds; no axis swap');
        assert.equal(row.properties.dataClass, 'demo');
      }
      await page.screenshot({ path: join(output, `external-${lang}-${width}.png`), fullPage: true });
      await page.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(store.get("SELECT count(*) AS n FROM municipal_features WHERE layer='city'")!.n, 19);
    } else {
      assert.ok(!(await input.getAttribute('accept')).includes('.zip'));
      await input.setInputFiles(fixture); // Forced selection still produces the honest localized hint.
      await expect(page.locator('[role="alert"]')).toContainText(lang === 'ru' ? 'демо-режиме' : 'Демо режимінде');
      await expect(page.locator('.gp-import__res')).toHaveCount(0);
      await input.setInputFiles({ name: 'demo.csv', mimeType: 'text/csv', buffer: Buffer.from('name;lat;lng\nDemo;52.28;76.95') });
      await expect(page.locator('.gp-import__res')).toBeVisible();
      await expect(page.locator('.gp-import__res button')).toBeDisabled();
      assert.equal(importRequests, 0, 'Mock must not send imports to the API');
      await page.screenshot({ path: join(output, `${mode}-${lang}-${width}.png`), fullPage: true });
    }
    const dimensions = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, header: document.querySelector('.gp-header').scrollWidth }));
    assert.ok(dimensions.document <= width + 1 && dimensions.header <= width + 1, JSON.stringify(dimensions));
    assert.deepEqual(errors, []);
    results.push({ mode, lang, width, status: 'PASS', pageErrors: 0, overflow: false });
    console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }
} finally {
  writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
  if (browser) await browser.close();
  if (vite && vite.exitCode === null) { vite.kill(); await once(vite, 'exit').catch(() => {}); }
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  store.close();
  const absolute = resolve(dir);
  if (absolute.startsWith(resolve(tmpdir()) + sep) && absolute.includes('gp-shp-import-')) rmSync(absolute, { recursive: true, force: true });
}
