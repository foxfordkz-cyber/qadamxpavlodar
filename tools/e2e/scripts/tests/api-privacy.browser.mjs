import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('failed API matcher retains neither its password snapshot nor secret output', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const outputRoot = join(root, 'test-results');
  mkdirSync(outputRoot, { recursive: true });
  const fixture = mkdtempSync(join(outputRoot, 'api-privacy-'));
  const secret = randomBytes(24).toString('hex');
  const require = createRequire(import.meta.url);
  try {
    writeFileSync(join(fixture, 'playwright.config.ts'), `import base from '../../playwright.config';
export default { ...base, testDir: '.', outputDir: './output', webServer: undefined,
  reporter: [['../../support/api-reporter.ts']], workers: 1, retries: 0,
  projects: [{ name: 'api-privacy', testMatch: 'privacy.api.spec.ts' }] };
`);
    writeFileSync(join(fixture, 'privacy.api.spec.ts'), `import { test, expect } from '@playwright/test';
test('synthetic login failure', async ({ page }) => {
  await page.setContent('<label>Password<input type="password"></label>');
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!);
  await expect(page.locator('main')).toHaveCount(1, { timeout: 100 });
});
`);
    const child = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test'], {
      cwd: fixture, windowsHide: true, encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, E2E_MODE: 'api', E2E_PASSWORD: secret, PLAYWRIGHT_NO_COPY_PROMPT: '1', E2E_BASE_URL: 'http://localhost:1' },
    });
    assert.equal(child.status, 1, 'The synthetic browser assertion must fail');
    assert.equal(`${child.stdout}${child.stderr}`.includes(secret), false, 'Console must omit the synthetic secret');
    const report = JSON.parse(readFileSync(join(fixture, 'playwright-report/api/results.json'), 'utf8'));
    assert.equal(report.tests.length, 1);
    assert.equal(report.tests[0].status, 'failed');
    function inspect(directory) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) inspect(path);
        else {
          assert.notEqual(entry.name, 'error-context.md', 'API failure context must not be retained');
          assert.equal(readFileSync(path).includes(Buffer.from(secret)), false, 'Artifact must omit the synthetic secret');
        }
      }
    }
    inspect(fixture);
  } finally {
    const target = realpathSync(fixture);
    assert.equal(dirname(target), realpathSync(outputRoot));
    assert.match(basename(target), /^api-privacy-/);
    rmSync(target, { recursive: true, force: true });
  }
});
