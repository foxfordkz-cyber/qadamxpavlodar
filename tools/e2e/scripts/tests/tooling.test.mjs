import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { apiPassword, baseUrl, redact } from '../environment.mjs';
import { selectRun } from '../profiles.mjs';
import { acceptance, collectRuns, normalizeReport, runIsComplete } from '../report-model.mjs';
import { renderHtml } from '../report-html.mjs';
import { generateSummary } from '../summary.mjs';

const revision = 'a'.repeat(40);
const json = tests => ({ stats: { duration: 100 }, suites: [{ specs: tests.map(({ title = 'scenario', status = 'expected', result = 'passed', annotations = [], projectName = 'desktop' }) =>
  ({ title, tests: [{ status, projectName, annotations, results: result ? [{ status: result, duration: 50 }] : [] }] })) }] });
function run(profile, data) {
  return { profile, available: true, current: true, ...normalizeReport(data, profile),
    meta: { state: 'finished', exitCode: 0, selection: 'full', revision, dirty: false } };
}
function folder(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gp-e2e-tools-'));
  t.after(() => {
    const target = realpathSync(dir);
    assert.equal(dirname(target), realpathSync(tmpdir()));
    assert.match(basename(target), /^gp-e2e-tools-/);
    rmSync(target, { recursive: true, force: true });
  });
  return dir;
}

test('smoke and screenshots have isolated profiles and fixed selections', () => {
  const smoke = selectRun('smoke');
  assert.equal(smoke.profile, 'smoke');
  assert.equal(smoke.mode, 'mock');
  assert.equal(smoke.selection, 'subset');
  assert.deepEqual(smoke.args.slice(-2), ['--project', 'desktop']);
  assert.deepEqual(selectRun('smoke', ['--project=mobile']).args.slice(-1), ['--project=mobile']);
  assert.equal(selectRun('screens').profile, 'screens');
  assert.equal(selectRun('mock', ['--known-bugs']).profile, 'bugs');
  assert.equal(selectRun('mock', ['--project', 'mobile']).selection, 'subset');
  assert.equal(selectRun('mock', ['--list']).executesTests, false);
  assert.throws(() => selectRun('screens', ['--grep', 'x']));
});

test('API cannot opt into credential-bearing traces or arbitrary reporters', () => {
  for (const option of ['--trace=on', '--reporter=html', '--config=other.ts', '-c', '--output=shared', '--ui']) {
    assert.throws(() => selectRun('api', [option]));
  }
  assert.equal(selectRun('api', ['--known-bugs']).knownBugs, true);
});

test('password precedence and absent .env never expose contents in errors', () => {
  assert.equal(apiPassword({ E2E_PASSWORD: 'environment-value' }, () => { throw Error('should not read'); }).source, 'E2E_PASSWORD');
  assert.equal(apiPassword({}, () => 'DEMO_PASSWORD="quoted local value"\nUNRELATED_KEY=ignored').value, 'quoted local value');
  assert.equal(apiPassword({}, () => { throw Object.assign(Error(), { code: 'ENOENT' }); }).value, undefined);
  assert.throws(() => apiPassword({}, () => { throw Error('private fixture contents'); }), error => !error.message.includes('private fixture'));
});

test('credential URLs are rejected and secret encodings are redacted', () => {
  assert.equal(baseUrl('http://localhost:8080').origin, 'http://localhost:8080');
  for (const url of ['http://person:secret@localhost', 'file:///x', 'invalid']) assert.throws(() => baseUrl(url));
  const secret = 'synthetic + "fixture"';
  const output = redact([secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)].join(' / '), [secret]);
  assert.equal(output, '[redacted] / [redacted] / [redacted]');
});

test('normalization distinguishes fixme, technical skips, interruptions and flaky passes', () => {
  const result = normalizeReport(json([
    {}, { result: 'skipped', annotations: [{ type: 'fixme', description: 'E2E-01: pending' }] },
    { result: 'skipped' }, { result: 'interrupted' }, { status: 'flaky' }, { result: null },
  ]), 'mock');
  assert.deepEqual(result.counts, { passed: 1, failed: 1, fixme: 1, skipped: 1, flaky: 1, notRun: 1 });
});

test('API summaries whitelist fields, omit raw errors and distinguish fixme from absent password', () => {
  const result = normalizeReport({ status: 'passed', environment: 'private', tests: [
    { title: 'coordinator', status: 'passed', errors: ['PRIVATE_LOG'], secret: 'PRIVATE_FIELD' },
    { title: 'worker', status: 'skipped', note: 'E2E-03: worker pending' },
    { title: 'no password', status: 'skipped', note: 'E2E_PASSWORD is absent' },
  ] }, 'api');
  assert.equal(result.counts.fixme, 1);
  assert.equal(result.counts.skipped, 1);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('acceptance requires complete clean current mock and API; smoke cannot replace them', () => {
  const mock = run('mock', json([{}]));
  const api = run('api', { status: 'passed', tests: [{ title: 'login', status: 'passed' }] });
  assert.equal(acceptance([mock, api], revision).ready, true);
  for (const changed of [
    { ...mock, current: false }, { ...mock, runnerFailed: true },
    { ...mock, meta: { ...mock.meta, selection: 'subset' } },
    { ...mock, meta: { ...mock.meta, dirty: true } },
    { ...mock, meta: { ...mock.meta, revision: 'b'.repeat(40) } },
    { ...mock, meta: { ...mock.meta, state: 'running' } },
  ]) assert.equal(acceptance([changed, api], revision).ready, false);
  assert.equal(acceptance([{ ...mock, profile: 'smoke' }, api], revision).ready, false);
  assert.equal(acceptance([mock, api], null).ready, false);
  const skippedApi = run('api', { status: 'passed', tests: [{ title: 'no password', status: 'skipped' }] });
  assert.equal(acceptance([mock, skippedApi], revision).ready, false);
});

test('only the two desktop-inapplicable mobile checks are permitted skips', () => {
  const mobileCheck = { title: 'mobile report: document fits the viewport and wide tables scroll internally', result: 'skipped', annotations: [{ type: 'skip' }] };
  assert.equal(runIsComplete(run('mock', json([{}, mobileCheck]))), true);
  assert.equal(runIsComplete(run('mock', json([{}, { ...mobileCheck, projectName: 'mobile' }]))), false);
  assert.equal(runIsComplete(run('mock', json([{}, { result: 'skipped' }]))), false);
});

test('a new failed invocation cannot reuse an old green report', t => {
  const root = folder(t);
  mkdirSync(join(root, 'test-results/mock'), { recursive: true });
  mkdirSync(join(root, 'playwright-report/runs'), { recursive: true });
  writeFileSync(join(root, 'test-results/mock/results.json'), JSON.stringify(json([{}])));
  writeFileSync(join(root, 'playwright-report/runs/mock.json'), JSON.stringify({ startedAt: new Date(Date.now() + 5000).toISOString(),
    state: 'finished', exitCode: 1, revision, selection: 'full', target: 'http://localhost:5174/?private=omit' }));
  const result = collectRuns(root).find(item => item.profile === 'mock');
  assert.equal(result.current, false);
  assert.equal(result.meta.target, 'http://localhost:5174');
  assert.equal(runIsComplete(result), false);
});

test('missing/corrupt reports and missing screenshots never produce a ready package', t => {
  const root = folder(t);
  mkdirSync(join(root, 'test-results/mock'), { recursive: true });
  writeFileSync(join(root, 'test-results/mock/results.json'), '{broken');
  assert.equal(collectRuns(root).find(item => item.profile === 'mock').invalid, true);
  assert.equal(generateSummary({ root }).acceptance.ready, false);
  assert.throws(() => generateSummary({ root, pack: true }), /26 fresh PNGs/);
});

test('offline HTML escapes report text and renders no raw error payload', () => {
  const attack = '<img src=x onerror=alert(1)>';
  const mock = run('mock', json([{ title: attack }]));
  const html = renderHtml({ runs: [mock], screens: [], acceptance: { ready: false, message: 'Pending' }, generatedAt: new Date().toISOString(), revision });
  assert.ok(!html.includes(attack));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});
