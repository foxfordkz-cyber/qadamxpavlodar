import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { apiPassword, baseUrl, redact } from '../environment.mjs';
import { selectRun } from '../profiles.mjs';
import { acceptance, captureRunIsComplete, collectRuns, inspectScreens, normalizeReport, runIsComplete } from '../report-model.mjs';
import { hashBytes, recordScreenCapture } from '../screen-provenance.mjs';
import { errorDiagnostics } from '../api-diagnostics.mjs';
import { unzipSync, zipSync } from 'fflate';
import { renderHtml } from '../report-html.mjs';
import { generateSummary, verifyPublishedSummary } from '../summary.mjs';
import { savePrivacyVerdict } from '../privacy-verdict.mjs';

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

test('an isolated privacy failure blocks acceptance without inventing failed browser cases', t => {
  const root = folder(t);
  const runId = '11111111-1111-4111-8111-111111111111';
  mkdirSync(join(root, 'playwright-report/runs'), { recursive: true });
  mkdirSync(join(root, 'playwright-report/api'), { recursive: true });
  writeFileSync(join(root, 'playwright-report/runs/api.json'), JSON.stringify({ runId, revision, dirty: false,
    state: 'finished', exitCode: 0, privacyScan: 'pending', selection: 'full', startedAt: new Date(Date.now() - 1000).toISOString() }));
  writeFileSync(join(root, 'playwright-report/api/results.json'), JSON.stringify({ status: 'passed', tests: [{ title: 'safe case', status: 'passed' }] }));
  assert.equal(runIsComplete(collectRuns(root).find(run => run.profile === 'api')), false);
  savePrivacyVerdict(root, runId, true);
  assert.equal(runIsComplete(collectRuns(root).find(run => run.profile === 'api')), true);
  savePrivacyVerdict(root, runId, false);
  const rejected = collectRuns(root).find(run => run.profile === 'api');
  assert.equal(runIsComplete(rejected), false);
  assert.equal(rejected.counts.passed, 1);
  assert.equal(rejected.counts.failed, 0);
  assert.equal(rejected.meta.exitCode, 1);
  assert.equal(rejected.meta.browserExitCode, 0);
  const history = JSON.parse(readFileSync(join(root, 'playwright-report/history', `${runId}.json`), 'utf8'));
  assert.equal(history.meta.privacyScan, 'failed');
  assert.equal(history.meta.exitCode, 1);
  assert.throws(() => savePrivacyVerdict(root, 'different-run', true));
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
  const flaky = normalizeReport({ status: 'passed', tests: [{ title: 'retried', status: 'flaky', attempts: 2 }] }, 'api');
  assert.equal(flaky.counts.flaky, 1);
  assert.equal(flaky.counts.passed, 0);
});

test('API reporter collapses retried attempts into one flaky case without raw errors or credentials', t => {
  const root = folder(t), secret = 'synthetic-api-reporter-fixture';
  const moduleUrl = new URL('../../support/api-reporter.ts', import.meta.url).href;
  const source = `import Reporter from ${JSON.stringify(moduleUrl)};
    const reporter = new Reporter(); reporter.onBegin({ workers: 1, projects: [{ retries: 1 }] });
    const failed = { status: 'failed', duration: 10, errors: [{ message: 'PRIVATE_DOM_AND_RESPONSE ' + process.env.E2E_PASSWORD }] };
    const passed = { status: 'passed', duration: 20, errors: [] };
    const scenario = { id: 'one-case', title: 'Scenario ' + process.env.E2E_PASSWORD, annotations: [], results: [failed, passed], outcome: () => 'flaky' };
    reporter.onTestEnd(scenario, failed); reporter.onTestEnd(scenario, passed); reporter.onEnd({ status: 'passed' });`;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', source], { cwd: root, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, E2E_PASSWORD: secret } });
  const raw = readFileSync(join(root, 'playwright-report/api/results.json'), 'utf8'), report = JSON.parse(raw);
  assert.equal(report.tests.length, 1);
  assert.equal(report.tests[0].status, 'flaky');
  assert.equal(report.tests[0].attempts, 2);
  assert.equal(report.tests[0].durationMs, 30);
  assert.deepEqual(report.environment, { workers: 1, retries: 1 });
  assert.ok(!raw.includes(secret) && !output.includes(secret));
  assert.ok(!raw.includes('PRIVATE_DOM_AND_RESPONSE'));
  assert.equal('errors' in report.tests[0], false);
  assert.equal(normalizeReport(report, 'api').counts.flaky, 1);
});

test('API diagnostics expose only code location, known matcher and unquoted numeric/boolean scalars', () => {
  const privateText = 'PRIVATE_RESPONSE_OR_PERSON';
  const diagnostics = errorDiagnostics([{ message: 'Error: expect(value).toBe(expected)\nExpected: 200\nReceived: 403\n' + privateText,
    stack: `Error: ${privateText}\n at Object.test (C:\\Users\\PRIVATE_USER\\repo\\tools\\e2e\\tests\\permissions-final.api.spec.ts:44:9)` }]);
  assert.deepEqual(diagnostics, [{ errorLocation: { file: 'tests/permissions-final.api.spec.ts', line: 44, column: 9 }, matcher: 'toBe', expected: 200, actual: 403 }]);
  assert.ok(!JSON.stringify(diagnostics).includes('PRIVATE'));
  const secret = '123456';
  assert.deepEqual(errorDiagnostics([{ message: `expect(x).toEqual(expected)\nExpected: "${privateText}"\nReceived: ${secret}` }], [secret]), [{ matcher: 'toEqual' }]);
  assert.deepEqual(errorDiagnostics([{ message: 'expect(x).toBe(expected)\nExpected: true\nReceived: false', location: { file: '/outside/private.ts', line: 1, column: 1 } }]), [{ matcher: 'toBe', expected: true, actual: false }]);
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
  assert.equal(result.available, false);
  assert.equal(result.tests, undefined);
  assert.equal(result.meta.target, 'http://localhost:5174');
  assert.equal(runIsComplete(result), false);
});

test('missing/corrupt reports produce a diagnostic package without old screenshots', t => {
  const root = folder(t);
  mkdirSync(join(root, 'test-results/mock'), { recursive: true });
  writeFileSync(join(root, 'test-results/mock/results.json'), '{broken');
  assert.equal(collectRuns(root).find(item => item.profile === 'mock').invalid, true);
  assert.equal(generateSummary({ root }).acceptance.ready, false);
  mkdirSync(join(root, 'screens'), { recursive: true });
  writeFileSync(join(root, 'screens/home-1280.png'), Buffer.from('old image must never be copied'));
  const model = generateSummary({ root, pack: true });
  assert.equal(model.acceptance.ready, false);
  assert.equal(model.packageKind, 'diagnostic-not-accepted');
  const entries = unzipSync(readFileSync(join(root, 'playwright-report/summary/green-pavlodar-demo.zip')));
  assert.deepEqual(Object.keys(entries).sort(), ['DAMIR.md', 'index.html', 'results.json']);
  assert.equal(JSON.parse(new TextDecoder().decode(entries['results.json'])).acceptance.ready, false);
});

test('summary then pack then read-only gate preserves archive and report bytes', t => {
  const root = folder(t);
  generateSummary({ root });
  generateSummary({ root, pack: true });
  const files = ['index.html', 'DAMIR.md', 'results.json', 'green-pavlodar-demo.zip'];
  const before = files.map(file => readFileSync(join(root, 'playwright-report/summary', file)));
  assert.equal(verifyPublishedSummary({ root }).acceptance.ready, false); // Empty diagnostic fixture stays blocked.
  files.forEach((file, index) => assert.deepEqual(readFileSync(join(root, 'playwright-report/summary', file)), before[index]));
});

test('read-only gate rejects changed run evidence and an archive with unexpected old images', t => {
  const root = folder(t); generateSummary({ root, pack: true });
  mkdirSync(join(root, 'test-results/mock'), { recursive: true });
  writeFileSync(join(root, 'test-results/mock/results.json'), '{broken');
  assert.throws(() => verifyPublishedSummary({ root }), /summary is stale/);
  generateSummary({ root, pack: true });
  const archive = join(root, 'playwright-report/summary/green-pavlodar-demo.zip');
  const entries = unzipSync(readFileSync(archive)); entries['screens/old-1280.png'] = Buffer.from('old frame');
  writeFileSync(archive, zipSync(entries));
  assert.throws(() => verifyPublishedSummary({ root }), /unexpected files/);
});

test('failed or flaky screenshot run cannot support acceptance even if its PNGs are fresh', () => {
  const screenshots = run('screens', json([{}]));
  screenshots.meta = { ...screenshots.meta, capturesScreens: true, selection: 'subset' };
  assert.equal(captureRunIsComplete(screenshots), true); // The standard screens preset is deliberately a subset.
  assert.equal(captureRunIsComplete({ ...screenshots, meta: { ...screenshots.meta, exitCode: 1 } }), false);
  assert.equal(captureRunIsComplete({ ...screenshots, runnerFailed: true }), false);
  const flaky = { ...screenshots, ...normalizeReport(json([{ status: 'flaky' }]), 'screens') };
  assert.equal(captureRunIsComplete(flaky), false);
});

function captureFixture(t) {
  const root = folder(t), runId = '11111111-2222-4333-8444-555555555555', name = 'lab-1280.png';
  const captureDir = join(root, 'playwright-report/captures', runId), file = join(root, 'test-results/screen-review', name);
  mkdirSync(captureDir, { recursive: true }); mkdirSync(dirname(file), { recursive: true });
  const bytes = Buffer.alloc(32); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(1280, 16); bytes.writeUInt32BE(800, 20); writeFileSync(file, bytes);
  const now = Date.now(), meta = { runId, revision, dirty: false, capturesScreens: true, state: 'finished', exitCode: 0,
    startedAt: new Date(now - 1000).toISOString(), endedAt: new Date(now + 1000).toISOString() };
  const manifest = { schemaVersion: 1, runId, revision, profile: 'mock', dirty: false, source: 'mock', name,
    relativePath: `test-results/screen-review/${name}`, width: 1280, height: 800, readiness: 'settled-plan',
    sha256: hashBytes(bytes), capturedAt: new Date(now).toISOString() };
  const save = value => writeFileSync(join(captureDir, `${name}.json`), JSON.stringify(value));
  const run = { profile: 'mock', current: true, meta };
  const inspect = (runs = [run], sha = revision) => inspectScreens(root, runs, sha).find(screen => screen.name === name);
  return { root, runId, name, captureDir, file, bytes, meta, manifest, save, run, inspect };
}

test('image mtime alone cannot establish screenshot freshness or visual approval', t => {
  const f = captureFixture(t);
  utimesSync(f.file, new Date(), new Date());
  assert.equal(f.inspect().fresh, false);
  f.save(f.manifest);
  assert.equal(f.inspect().fresh, true);
  assert.equal(f.inspect().reviewed, false);
  f.save({ ...f.manifest, capturedAt: new Date(Date.parse(f.meta.startedAt) - 1000).toISOString() });
  assert.equal(f.inspect().fresh, false);
});

test('screenshot provenance rejects another SHA, run, source, dirty state, loading frame and replacement bytes', t => {
  const f = captureFixture(t);
  for (const change of [{ revision: 'b'.repeat(40) }, { runId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }, { source: 'api' },
    { dirty: true }, { readiness: 'loading' }]) {
    f.save({ ...f.manifest, ...change });
    assert.equal(f.inspect().fresh, false, JSON.stringify(change));
  }
  f.save(f.manifest);
  assert.equal(f.inspect(undefined, 'b'.repeat(40)).fresh, false);
  const replaced = Buffer.from(f.bytes); replaced[31] = 1; writeFileSync(f.file, replaced);
  assert.equal(f.inspect().fresh, false);
});

test('visual approval is bound to exactly the reviewed image bytes', t => {
  const f = captureFixture(t); f.save(f.manifest);
  writeFileSync(join(f.captureDir, 'review.json'), JSON.stringify({ runId: f.runId, revision,
    captures: [{ name: f.name, sha256: f.manifest.sha256 }] }));
  assert.equal(f.inspect().reviewed, true);
  const replaced = Buffer.from(f.bytes); replaced[31] = 3; writeFileSync(f.file, replaced);
  f.save({ ...f.manifest, sha256: hashBytes(replaced) });
  assert.equal(f.inspect().fresh, true);
  assert.equal(f.inspect().reviewed, false);
});

test('a later failed or unfinished run cannot borrow images from an earlier successful run', t => {
  const f = captureFixture(t); f.save(f.manifest);
  const later = { ...f.run, meta: { ...f.meta, runId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', exitCode: 1,
    startedAt: new Date(Date.parse(f.meta.startedAt) + 5000).toISOString() } };
  assert.equal(f.inspect([f.run, later]).fresh, false);
  assert.equal(f.inspect([{ ...f.run, meta: { ...f.meta, state: 'running' } }]).fresh, false);
  // Current failed-run images are useful diagnostic evidence, not a successful run.
  assert.equal(f.inspect([{ ...f.run, meta: { ...f.meta, exitCode: 1 } }]).fresh, true);
});

test('capture writer rejects API screenshots and loading readiness before touching artifacts', t => {
  const f = captureFixture(t);
  const env = { E2E_RUN_ID: f.runId, E2E_RUN_REVISION: revision, E2E_PROFILE: 'api' };
  assert.throws(() => recordScreenCapture({ root: f.root, file: f.file, width: 1280, height: 800, readiness: 'settled-plan', env }), /Mock screenshot provenance/);
  assert.throws(() => recordScreenCapture({ root: f.root, file: f.file, width: 1280, height: 800, readiness: 'loading', env: { ...env, E2E_PROFILE: 'mock' } }), /settled readiness/);
});

test('offline HTML escapes report text and renders no raw error payload', () => {
  const attack = '<img src=x onerror=alert(1)>';
  const mock = run('mock', json([{ title: attack }]));
  const html = renderHtml({ runs: [mock], screens: [], acceptance: { ready: false, message: 'Pending' }, generatedAt: new Date().toISOString(), revision });
  assert.ok(!html.includes(attack));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});
