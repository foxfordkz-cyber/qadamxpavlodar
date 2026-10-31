// Preparation only: run after the frozen suites, review, checks, pack and gate.
// No browser, server, network, Git mutation, deletion or overwritten destination.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { verifyPublishedSummary } from '../../scripts/summary.mjs';
import { expectedScreens, normalizeReport } from '../../scripts/report-model.mjs';

const APP = '84d009e3b72c4fe637ef30607e29701054b6c621';
const QA = 'c7f15755c80292509aaeeb9f9e4638f62c8b6810';
const TREE = '2fd878cfbec10d93942afeb5add57a39a230304f';
const PREFIX = '2026-11-01-final-local-84d009e';
const dir = realpathSync(fileURLToPath(new URL('.', import.meta.url)));
const root = realpathSync(resolve(dir, '../..'));
const destination = resolve(dir, 'publication');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const bytesJson = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const time = value => { const n = Date.parse(value); assert.ok(Number.isFinite(n), 'Expected a valid timestamp'); return n; };
const safeLocal = file => {
  const full = realpathSync(resolve(dir, file));
  const rel = relative(dir, full);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Supplementary input must stay inside final84');
  return full;
};
const knownSecrets = Object.entries(process.env)
  .filter(([key, value]) => /PASSWORD|TOKEN|SECRET|COOKIE|API_KEY|DATABASE_URL/i.test(key) && value && value.length >= 8)
  .map(([, value]) => value);
const publicText = (bytes, label) => {
  for (const secret of knownSecrets) {
    for (const form of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)]) {
      assert.ok(!bytes.includes(Buffer.from(form)), `Secret-bearing content rejected: ${label}`);
    }
  }
  const text = bytes.toString('utf8');
  assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s/:]+:[^\s@]+@|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/.test(text), `Credential pattern rejected: ${label}`);
};
function cleanIdentity() {
  assert.equal(git(['rev-parse', 'HEAD']), QA, 'Unexpected QA revision');
  assert.equal(git(['status', '--porcelain', '--untracked-files=normal']), '', 'Tracked context must remain clean');
  assert.equal(git(['rev-parse', 'HEAD:apps']), TREE, 'Unexpected application tree');
  assert.equal(git(['rev-parse', `${APP}:apps`]), TREE, 'Application base tree mismatch');
  git(['merge-base', '--is-ancestor', APP, 'HEAD']);
}

assert.equal(process.argv.length, 2, 'Usage: node test-results/final84/export-evidence.mjs');
assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use the same Node 24 runtime');
cleanIdentity();
assert.equal(basename(root), 'e2e');
assert.ok(relative(root, dir).replaceAll('\\', '/') === 'test-results/final84', 'Unexpected helper location');
assert.ok(!existsSync(destination), 'Publication destination already exists; preserve it and do not overwrite');
const input = json(join(dir, 'export-input.json'));
assert.equal(input.schemaVersion, 1);
assert.equal(input.applicationBase, APP);
assert.equal(input.testSHA, QA);

const summaryDir = join(root, 'playwright-report/summary');
const archivePath = join(summaryDir, 'green-pavlodar-demo.zip');
assert.ok(existsSync(archivePath), 'Packed ZIP is mandatory, even though the normal gate allows an absent ZIP');
const current = verifyPublishedSummary({ root }); // Read-only existing gate logic.
const summaryBytes = readFileSync(join(summaryDir, 'results.json'));
const summary = JSON.parse(summaryBytes.toString('utf8'));
assert.equal(current.revision, QA);
assert.equal(current.dirty, false);
assert.equal(current.acceptance.ready, true, 'Local acceptance is not ready');
assert.equal(current.packageKind, 'accepted-local-build');
assert.equal(summary.acceptance.ready, true);

const required = ['mock', 'api'].map(profile => {
  const run = current.runs.find(item => item.profile === profile);
  assert.ok(run && run.current && run.available && !run.runnerFailed, `Missing successful ${profile}`);
  assert.equal(run.meta.revision, QA);
  assert.equal(run.meta.dirty, false);
  assert.equal(run.meta.selection, 'full');
  assert.equal(run.meta.state, 'finished');
  assert.equal(run.meta.exitCode, 0);
  assert.equal(run.meta.environment.node, '24.22.2');
  assert.equal(run.meta.environment.playwright, '1.64.1');
  assert.equal(run.meta.environment.retries, 0);
  assert.equal(run.meta.environment.workers, profile === 'mock' ? 2 : 1);
  assert.equal(run.meta.target, profile === 'mock' ? 'http://localhost:5176' : 'http://localhost:5177');
  assert.deepEqual(run.counts, { passed: profile === 'mock' ? 292 : 78, failed: 0, fixme: 0, skipped: profile === 'mock' ? 2 : 0, flaky: 0, notRun: 0 });
  const rawPath = join(root, profile === 'api' ? 'playwright-report/api/results.json' : 'test-results/mock/results.json');
  const parsed = normalizeReport(json(rawPath), profile);
  assert.deepEqual(parsed.counts, run.counts);
  assert.equal(parsed.runnerFailed, false);
  if (profile === 'api') {
    assert.equal(run.meta.privacyScan, 'passed');
    assert.equal(run.meta.browserExitCode, 0);
  }
  return run;
});
const [mock, api] = required;
assert.ok(time(api.meta.startedAt) >= time(mock.meta.endedAt), 'Suites must have run sequentially');
assert.equal(current.captureRun.runId, mock.meta.runId);
assert.equal(current.captureRun.profile, 'mock');
assert.equal(current.captureRun.successful, true);
assert.equal(current.screens.length, 30);
assert.deepEqual(current.screens.map(s => s.name).sort(), [...expectedScreens].sort());

const reviewPath = join(root, 'playwright-report/captures', mock.meta.runId, 'review.json');
const review = json(reviewPath);
assert.equal(review.runId, mock.meta.runId);
assert.equal(review.revision, QA);
assert.equal(review.captures.length, 30);
assert.ok(time(review.reviewedAt) >= time(mock.meta.endedAt), 'Formal review must follow completed captures');
const captures = [];
for (const screen of current.screens) {
  assert.ok(screen.valid && screen.fresh && screen.reviewed, 'Every PNG must be fresh and approved');
  assert.equal(screen.revision, QA);
  assert.equal(screen.runId, mock.meta.runId);
  assert.equal(review.captures.filter(c => c.name === screen.name && c.sha256 === screen.sha256).length, 1);
  const capture = json(join(root, 'playwright-report/captures', mock.meta.runId, screen.name + '.json'));
  assert.equal(capture.source, 'mock');
  assert.equal(capture.sha256, screen.sha256);
  assert.equal(sha(readFileSync(join(root, screen.relativePath))), screen.sha256);
  captures.push(capture);
}
const zipBytes = readFileSync(archivePath), zip = unzipSync(zipBytes);
const allowedZip = ['index.html', 'DAMIR.md', 'results.json', ...expectedScreens.map(name => 'screens/' + name)].sort();
assert.deepEqual(Object.keys(zip).sort(), allowedZip);
assert.equal(Object.keys(zip).length, 33);
assert.equal(Object.keys(zip).filter(name => name.endsWith('.png')).length, 30);
assert.deepEqual(Buffer.from(zip['results.json']), summaryBytes);
for (const screen of current.screens) assert.equal(sha(zip['screens/' + screen.name]), screen.sha256);
for (const [name, data] of Object.entries(zip)) publicText(Buffer.from(data), 'ZIP:' + name);

const checkSpecs = [
  ['check:tools', 'node --test scripts/tests/tooling.test.mjs scripts/tests/api-privacy.browser.mjs', 24],
  ['check:report-before-pack', 'node --test scripts/tests/report.browser.mjs', 3],
  ['check:report-after-pack', 'node --test scripts/tests/report.browser.mjs', 3],
  ['e2e:gate', 'node scripts/summary.mjs --strict', null],
];
assert.equal(input.checks?.length, checkSpecs.length, 'Supply all four observed checks in export-input.json');
let previousEnd = time(api.meta.endedAt);
const checks = checkSpecs.map(([id, command, pass]) => {
  const source = input.checks.find(c => c.id === id);
  assert.ok(source, `Missing observed check ${id}`);
  assert.equal(source.testSHA, QA);
  assert.equal(source.exitCode, 0);
  assert.ok(time(source.startedAt) >= previousEnd, 'Checks must follow the suites and each other');
  assert.ok(time(source.endedAt) >= time(source.startedAt));
  previousEnd = time(source.endedAt);
  if (pass !== null) assert.deepEqual(source.counts, { passed: pass, failed: 0, skipped: 0, fixme: 0, flaky: 0 });
  else assert.equal(source.counts, null, 'The gate is a command verdict, not extra application tests');
  const record = { id, command, testSHA: QA, startedAt: source.startedAt, endedAt: source.endedAt,
    exitCode: 0, counts: source.counts, provenance: 'Observed process result supplied by the root QA operator; export does not rerun this check' };
  if (source.logFile) {
    const logPath = safeLocal(source.logFile), bytes = readFileSync(logPath);
    publicText(bytes, id + ' log');
    record.logEvidence = { localFile: relative(dir, logPath).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha(bytes), copied: false };
  }
  return record;
});
assert.ok(time(checks[1].startedAt) >= time(review.reviewedAt), 'Report browser check must follow formal visual approval');
assert.ok(time(summary.generatedAt) >= time(checks[1].endedAt), 'Final packed report must follow the first report check');
assert.ok(time(summary.generatedAt) <= time(checks[2].startedAt), 'Final packed report must precede the post-pack check');

const control = json(join(dir, 'run-control.json'));
assert.equal(control.testSHA, QA); assert.equal(control.appSHA, APP); assert.equal(control.appsTree, TREE); assert.equal(control.fullRun, true);
assert.equal(control.results.length, 2);
const orchestration = json(join(dir, 'orchestration-note.json'));
assert.deepEqual(control.orchestration, orchestration, 'Control must retain the recorded orchestration failure');
assert.equal(orchestration.firstWrapperExit, 1);
assert.equal(orchestration.stage, 'snapshot after completed mock');
assert.equal(orchestration.mockRunId, mock.meta.runId);
assert.equal(orchestration.mockSuiteExit, 0);
assert.equal(orchestration.applicationOrTestEdits, false);
assert.equal(orchestration.mockRerun, false);
assert.ok(time(orchestration.observedAt) >= time(mock.meta.endedAt));
assert.ok(time(orchestration.observedAt) <= time(api.meta.startedAt));
for (const run of required) {
  const entry = control.results.find(item => item.name === run.profile);
  assert.ok(entry); assert.equal(entry.exitCode, 0);
  assert.deepEqual(entry.args, run.profile === 'mock' ? ['scripts/isolated.mjs', 'mock'] : ['scripts/isolated.mjs', 'api', '--outcomes']);
  assert.ok(time(entry.startedAt) <= time(run.meta.startedAt));
  assert.ok(time(entry.endedAt) >= time(run.meta.endedAt));
}
assert.equal(control.results.find(r => r.name === 'mock').completionSource,
  'Finished runner metadata; first wrapper stopped only during subsequent snapshot copy');
const osSample = json(join(dir, 'environment-sample.json'));
const environment = { applicationBase: APP, appsTree: TREE, testSHA: QA,
  software: mock.meta.environment, apiSoftware: api.meta.environment,
  memorySample: Object.fromEntries(['utc', 'method', 'platform', 'release', 'arch', 'totalMemoryBytes', 'freeMemoryBytes', 'cimSample'].filter(k => k in osSample).map(k => [k, osSample[k]])),
  limitation: 'Memory sample describes the environment, not a causal diagnosis; local SQLite/API does not prove cloud or Docker' };
const accessKeys = ['CLOUD_ACCEPTANCE_DEMO', 'CLOUD_ACCEPTANCE_ORIGIN', 'CLOUD_ACCEPTANCE_BROWSER_ORIGIN', 'CLOUD_ACCEPTANCE_PASSWORD'];
const access = { checkedAt: new Date().toISOString(), method: 'Presence booleans only; values neither read into evidence nor printed',
  processPresence: Object.fromEntries(accessKeys.map(key => [key, !!process.env[key]])),
  baselineManifestPresentAtDefaultPath: existsSync(resolve(root, '../../apps/server/data/cloud-release-acceptance.json')),
  authenticatedCloudAcceptanceRun: false,
  note: 'Presence does not prove valid credentials, baseline identity, authorization for shared writes or successful cloud acceptance' };
const coordination = { applicationBase: APP, testSHA: QA, recordedAt: new Date().toISOString(),
  scope: 'QA publication-window coordination and access request; not proof that the owner deployed or froze any public version',
  qaRequestedWindow: { from: '2026-10-31T19:00:00.000Z', to: '2026-10-31T19:20:00.000Z', displayZone: 'UTC+5', displayDate: '2026-11-01' },
  comments: (input.coordinationComments ?? []).map(c => {
    assert.ok(/^https:\/\/github\.com\/foxfordkz-cyber\/qadamxpavlodar\/pull\/(35|39)#issuecomment-\d+$/.test(c.url), 'Unexpected coordination URL');
    time(c.postedAt);
    return { url: c.url, postedAt: c.postedAt, provenance: 'Operator-supplied posted QA comment URL; no network request performed by exporter' };
  }),
  cloudReady: false, publicWorkerLocaleVerified: false, publicDeploymentSHA: null,
  notes: ['Publication source c970264 must not be renamed 84d009e; any source-tree equivalence requires separate evidence.',
    'Shared DEMO writes require agreed scope; owner restart needs a separate window; no Docker or cloud mutation occurs here.'] };

const outputs = new Map();
const add = (suffix, data) => {
  const name = PREFIX + suffix, bytes = Buffer.isBuffer(data) ? data : bytesJson(data);
  if (!name.endsWith('.zip')) publicText(bytes, name);
  assert.ok(!outputs.has(name)); outputs.set(name, bytes);
};
add('.json', summaryBytes); add('.zip', zipBytes);
add('.zip.sha256', Buffer.from(sha(zipBytes) + '  ' + PREFIX + '.zip\n'));
add('-local-runs.json', { applicationBase: APP, appsTree: TREE, testSHA: QA, scope: 'Current full local mock/API only', runs: required });
add('-checks.json', { applicationBase: APP, testSHA: QA, checks, independentReadOnlyExportGatePassed: true });
add('-visual-review.json', readFileSync(reviewPath));
add('-capture-manifests.json', { applicationBase: APP, testSHA: QA, runId: mock.meta.runId, captures });
add('-run-control.json', { testSHA: QA, appSHA: APP, appsTree: TREE, fullRun: true,
  results: control.results.map(r => ({ name: r.name, args: r.args, startedAt: r.startedAt, endedAt: r.endedAt, exitCode: r.exitCode,
    ...(r.completionSource ? { completionSource: r.completionSource } : {}) })), orchestration });
add('-orchestration-note.json', orchestration);
add('-wrapper-initial.mjs', readFileSync(join(dir, 'run-full.mjs')));
add('-wrapper-api-continuation.mjs', readFileSync(join(dir, 'run-api.mjs')));
add('-environment.json', environment); add('-access-presence.json', access); add('-coordination.json', coordination);
add('-window-note.md', readFileSync(join(dir, 'toni-window.md')));
add('-access-request.md', readFileSync(join(dir, 'bekzat-access.md')));
if (input.visualNotesFile) {
  const file = safeLocal(input.visualNotesFile), data = json(file);
  assert.ok(JSON.stringify(data).includes(mock.meta.runId), 'Visual notes must identify this capture run');
  add('-visual-notes.json', data);
}
add('-export-method.mjs', readFileSync(fileURLToPath(import.meta.url)));
const manifest = { schemaVersion: 1, createdAt: new Date().toISOString(), applicationBase: APP, appsTree: TREE, testSHA: QA,
  status: 'ACCEPTED_LOCAL_BUILD_ONLY', cloudReady: false, dockerVerifiedOnThisSHA: false, nativeWordVerified: false,
  sourceMockRunId: mock.meta.runId, sourceApiRunId: api.meta.runId,
  countsByScope: required.map(r => ({ profile: r.profile, ...r.counts, meta: r.meta })),
  orchestration: { firstWrapperExit: 1, stage: orchestration.stage, mockSuiteExit: 0, mockRerun: false,
    correction: orchestration.correction, applicationOrTestEdits: false,
    note: 'The original wrapper failed after the completed successful mock, while copying a nonexistent optional screens directory. Exact current screen-review captures were preserved; API continued separately. This ancillary failure is not relabelled as a successful original wrapper.' },
  archive: { path: PREFIX + '.zip', bytes: zipBytes.length, sha256: sha(zipBytes), entries: 33, png: 30, sourceMockRunId: mock.meta.runId },
  summaryIsExactPublishedBytes: true,
  nonAcceptanceSummaryProfiles: summary.runs.filter(r => !['mock', 'api'].includes(r.profile)).map(r => ({ profile: r.profile, revision: r.meta?.revision ?? null,
    available: r.available, countedForThisAcceptance: false, reason: 'Exact generated summary may retain explicitly identified optional-profile history; only current full mock/API and current approved captures are accepted' })),
  unverified: ['Authenticated public API worker/report/photo/outcomes flow', 'Public deployment SHA and freeze', 'Cloud persistence after owner restart', 'Docker on this application SHA', 'Native Microsoft Word and presentation machine'],
  files: [...outputs].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha(bytes) })) };
add('-manifest.json', manifest);
cleanIdentity();
assert.ok(!existsSync(destination), 'Destination appeared during validation; do not overwrite');
mkdirSync(destination); // New task-owned directory only; no recursive delete/move.
for (const [name, bytes] of outputs) writeFileSync(join(destination, name), bytes, { flag: 'wx' });
for (const entry of manifest.files) assert.equal(sha(readFileSync(join(destination, entry.path))), entry.sha256);
console.log(JSON.stringify({ directory: relative(root, destination).replaceAll('\\', '/'), files: outputs.size,
  applicationBase: APP, testSHA: QA, archive: manifest.archive, counts: manifest.countsByScope.map(({ profile, meta, ...counts }) => ({ profile, ...counts })),
  cloudReady: false, status: manifest.status }, null, 2));
