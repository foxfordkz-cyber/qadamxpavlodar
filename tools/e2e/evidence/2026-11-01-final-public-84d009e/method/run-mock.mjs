import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { directory, e2e, loadHandoff, fingerprint, stable, safeEnvironment, hash, noRawContexts, assertPinned, discardTemporaryBrowserOutput, preservePublisherManifests } from './guard.mjs';

const require = createRequire(import.meta.url);
if (process.argv.slice(2).some(arg => arg !== '--worker-locale') || process.argv.slice(2).length > 1) throw new Error('Expected no argument or --worker-locale');
const workerLocale = process.argv.includes('--worker-locale');
const expectedCount = workerLocale ? 8 : 16;
const suite = workerLocale ? 'worker-locale-regression.mock.spec.ts' : 'public-mock.public.spec.ts';
const config = workerLocale ? './worker-locale.config.mjs' : './public.config.mjs';
let binding;
try { binding = loadHandoff('mock'); } catch (error) {
  console.log(JSON.stringify({ status: 'BLOCKED', reason: /^BLOCKED_/.test(error.message) ? error.message : 'HANDOFF_INPUT_UNAVAILABLE' })); process.exit(2);
}
const output = join(directory, `${workerLocale ? 'worker-locale' : 'mock'}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(output);
preservePublisherManifests(binding, output);
const report = { kind: workerLocale ? 'post-publication-public-mock-worker-locale-8' : 'post-publication-public-mock-16', startedAt: new Date().toISOString(), binding,
  provenance: binding.publication.manifestProvenance === 'independent-qa-build'
    ? 'Independent clean pinned QA mock build compared byte-for-byte through SHA256 to every declared static file on production and immutable deployment before/after browser checks. Manifest is OUR reference build, not publisher-provided. Provider deployment IDs remain owner-reported; this does not verify backend source or storage.'
    : 'Publisher-reported frontend SHA and deployment IDs, independently compared to supplied manifests before/after. HTTP hashes do not independently prove a reproducible source build or backend identity.',
  suiteSha256: hash(readFileSync(join(e2e, 'tests', suite))),
  configSha256: hash(readFileSync(new URL(config, import.meta.url))),
  counts: { passed: 0, failed: 0, skipped: 0, fixme: 0, flaky: 0, notRun: expectedCount }, status: 'failed' };
try {
  report.before = await fingerprint(binding);
  if (!report.before.matchesHandoff) throw new Error('STATIC_IDENTITY_MISMATCH_BEFORE_BROWSER');
  const env = { ...safeEnvironment(), FINAL84_OUTPUT: output, FINAL84_ORIGIN: binding.publication.origin,
    E2E_MODE: 'mock', E2E_PROFILE: 'mock', E2E_RUN_KNOWN_BUGS: '0', E2E_BASE_URL: binding.publication.origin };
  const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', fileURLToPath(new URL(config, import.meta.url))],
    { cwd: e2e, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  // Do not retain stderr or raw assertion messages. The reporter writes safe per-case results.
  child.stdout.resume(); child.stderr.resume();
  report.exitCode = await new Promise(resolve => { child.on('error', () => resolve(1)); child.on('close', code => resolve(code ?? 1)); });
  const browser = JSON.parse(readFileSync(join(output, 'browser-results.json'), 'utf8'));
  report.counts = { ...browser.counts, notRun: expectedCount - browser.tests.length };
  report.browserGlobalErrors = browser.globalErrors;
  discardTemporaryBrowserOutput(output); noRawContexts(output);
  if (report.exitCode || report.counts.passed !== expectedCount || report.counts.failed || report.counts.skipped || report.counts.fixme || report.counts.flaky || report.counts.notRun || browser.globalErrors) throw new Error('BROWSER_ACCEPTANCE_FAILED');
  report.status = 'passed-pending-final-fingerprint';
} catch (error) { report.failure = /^[A-Z_]+$/.test(error.message) ? error.message : 'SETUP_OR_BROWSER_FAILURE'; }
finally {
  try { discardTemporaryBrowserOutput(output); noRawContexts(output); }
  catch { report.status = 'failed'; report.privacyFailure = 'TEMPORARY_OUTPUT_NOT_CLEARED_DO_NOT_ARCHIVE'; }
  try { report.after = await fingerprint(binding); report.staticStable = stable(report.before, report.after); assertPinned(); }
  catch { report.staticStable = false; report.fingerprintFailure = 'POST_RUN_IDENTITY_UNAVAILABLE'; }
  report.status = report.status === 'passed-pending-final-fingerprint' && report.staticStable ? 'passed' : 'failed';
  report.endedAt = new Date().toISOString();
  writeFileSync(join(output, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, status: report.status, counts: report.counts, staticStable: report.staticStable }));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
