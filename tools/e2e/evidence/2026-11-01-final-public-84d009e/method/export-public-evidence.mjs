// Offline export only. Run AFTER the three completed public checks and image review.
// Never launches browsers, requests a URL, changes Git, rewrites results or local ZIP.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync, readdirSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const QA = 'c7f15755c80292509aaeeb9f9e4638f62c8b6810', APP = '84d009e3b72c4fe637ef30607e29701054b6c621';
const TREE = '2fd878cfbec10d93942afeb5add57a39a230304f', API_SOURCE = 'c970264919de2f7a62d0e1ea8a28cc70c95a3864';
const API_DEPLOY = 'a26bd214-1c78-4a83-9536-74a35c85b49f', MOCK_DEPLOY = 'd0e985d1-bbd0-4f8c-b1c1-31d20d164ef7';
const API_DIGEST = 'd8b042398be87fc8c7283a82499dda317ee2d6e77f8d4979f55c226d93b67f60';
const MOCK_DIGEST = '8a8f8773a10ffab44e24115e49b79e3c9d6103a21ead1ca409505802bc7335ca';
const LOCAL_ZIP_DIGEST = 'f87089999c6bcf6c384f7d7344a169e199a23e1a5071d9b309ef5f85bcd4102b';
const PREFIX = '2026-11-01-final-public-84d009e';
const own = realpathSync(fileURLToPath(new URL('.', import.meta.url))), root = realpathSync(resolve(own, '../..'));
const output = join(own, 'publication');
const folders = { anonymous: 'anonymous-entry-2026-10-31T19-20-33-923Z', mock: 'mock-2026-10-31T19-24-02-246Z', worker: 'worker-locale-2026-10-31T19-25-18-108Z' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const millis = value => { const result = Date.parse(value); assert.ok(Number.isFinite(result)); return result; };
const expectedCounts = n => ({ passed: n, failed: 0, skipped: 0, fixme: 0, flaky: 0, notRun: 0 });
const safePath = file => {
  const full = realpathSync(resolve(own, file)), rel = relative(own, full);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Only public task-owned files may be copied');
  return full;
};
const secretValues = Object.entries(process.env).filter(([name, value]) => /PASSWORD|TOKEN|SECRET|COOKIE|API_KEY|DATABASE_URL/i.test(name) && value && value.length >= 8).map(([, value]) => value);
function privacy(bytes, label) {
  for (const value of secretValues) for (const text of [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)]) {
    assert.ok(!bytes.includes(Buffer.from(text)), 'Secret-bearing evidence rejected: ' + label);
  }
  assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s/:]+:[^\s@]+@|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/.test(bytes.toString('utf8')), 'Credential pattern rejected: ' + label);
}
function pinned() {
  assert.equal(git(['rev-parse', 'HEAD']), QA);
  assert.equal(git(['status', '--porcelain', '--untracked-files=normal']), '');
  assert.equal(git(['rev-parse', 'HEAD:apps']), TREE);
  assert.equal(git(['rev-parse', `${APP}:apps`]), TREE);
}
assert.equal(process.argv.length, 2, 'Usage: node test-results/final84-public/export-public-evidence.mjs');
pinned(); assert.ok(!existsSync(output), 'Preserve the existing output; never overwrite an exported evidence set');
const localZip = resolve(own, '../final84/publication/2026-11-01-final-local-84d009e.zip');
assert.equal(sha(readFileSync(localZip)), LOCAL_ZIP_DIGEST, 'Local accepted archive must remain immutable');
const apiBytes = readFileSync(join(own, 'api-manifest.json')), ownBytes = readFileSync(join(own, 'local-84d009e-build-manifest.json'));
assert.equal(sha(apiBytes), API_DIGEST); assert.equal(sha(ownBytes), MOCK_DIGEST);
const apiManifest = JSON.parse(apiBytes), build = JSON.parse(ownBytes);
const apiManifestSource = read(join(own, 'api-manifest-source.json'));
assert.equal(apiManifestSource.sourceCommit, 'a05c3affae8f539bd407571d831fa645f6f7f01d');
assert.equal(apiManifestSource.sourcePath, 'docs/cloudflare-evidence/2026-10-31-api-candidate-c970264.json');
const gitManifest = execFileSync('git', ['show', `${apiManifestSource.sourceCommit}:${apiManifestSource.sourcePath}`], { cwd: root, windowsHide: true });
assert.deepEqual(gitManifest, apiBytes, 'Publisher reference must be the exact canonical Git blob');
assert.equal(apiManifest.frontendSourceSha, API_SOURCE);
assert.equal(build.frontendSha, APP); assert.equal(build.source.qaSha, QA); assert.equal(build.source.appsTree, TREE);
assert.equal(build.exitCode, 0); assert.equal(build.sourceStillClean, true); assert.equal(build.dirty, false);
assert.deepEqual(build.activeWebEnvFiles, []); assert.equal(build.environment.VITE_DATA_SOURCE, 'mock');
assert.equal(build.files.length, 34);
for (const f of build.files) {
  assert.ok(/^(?:assets\/[A-Za-z0-9_.-]+|index\.html)$/.test(f.path));
  const bytes = readFileSync(safePath('local-84d009e-dist/' + f.path));
  assert.equal(bytes.length, f.bytes); assert.equal(sha(bytes), f.sha256);
}
const sourceTrees = ['apps/web', 'apps/web/src/features/worker', 'tools/worker-demo', 'cloudflare'].map(path => {
  const a = git(['rev-parse', `${APP}:${path}`]), b = git(['rev-parse', `${API_SOURCE}:${path}`]), c = git(['rev-parse', `HEAD:${path}`]);
  assert.equal(a, b); assert.equal(a, c); return { path, acceptedApplicationTree: a, apiFrontendTree: b, qaTree: c, identical: true };
});

function binding(record, mode) {
  const b = record.binding, p = b.publication;
  assert.equal(b.qaSha, QA); assert.equal(b.releaseSha, APP); assert.equal(b.appsTree, TREE); assert.equal(b.mode, mode);
  assert.equal(p.frontendSha, mode === 'api' ? API_SOURCE : APP);
  assert.equal(p.deploymentId, mode === 'api' ? API_DEPLOY : MOCK_DEPLOY);
  assert.equal(p.origin, `https://green-pavlodar-${mode}.pages.dev`);
  assert.equal(p.immutableOrigin, `https://${mode === 'api' ? 'a26bd214' : 'd0e985d1'}.green-pavlodar-${mode}.pages.dev`);
  assert.equal(p.manifestSha256, mode === 'api' ? API_DIGEST : MOCK_DIGEST);
  assert.equal(p.manifestVerified, true); assert.equal(p.files.length, 34);
  assert.deepEqual(b.sourceIdentityEvidence.paths, sourceTrees);
  assert.equal(b.backendReported.applicationSha, '3b14927def04b35bf97782eae6b550da276c779f');
  assert.match(b.backendReported.verification, /Owner-reported/);
  const reference = mode === 'api' ? apiManifest.entries.filter(f => !['_routes.json', '_worker.js'].includes(f.path)) : build.files;
  assert.equal(reference.length, 34);
  assert.deepEqual(p.files.map(f => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })).sort((a, b) => a.path.localeCompare(b.path)),
    reference.map(f => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })).sort((a, b) => a.path.localeCompare(b.path)));
  return p;
}
function fingerprint(f, p) {
  assert.equal(f.matchesHandoff, true); assert.equal(f.files.length, 68);
  const seen = new Set();
  for (const row of f.files) {
    assert.ok([p.origin, p.immutableOrigin].includes(row.origin));
    const ref = p.files.find(item => item.path === row.path); assert.ok(ref, 'Unexpected HTTP file');
    assert.equal(row.status, 200); assert.equal(row.passed, true);
    assert.equal(row.bytes, ref.bytes); assert.equal(row.expectedBytes, ref.bytes);
    assert.equal(row.sha256, ref.sha256); assert.equal(row.expectedSha256, ref.sha256);
    const key = row.origin + '/' + row.path; assert.ok(!seen.has(key)); seen.add(key);
  }
  return { observedAt: f.observedAt, verified: 68, mismatched: 0, staticFilesPerOrigin: 34, origins: [p.origin, p.immutableOrigin] };
}
function noRaw(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'Run output must not contain links');
    assert.ok(!/temporary-browser|error-context|trace|video|storage-state|cookie|credential|password/i.test(entry.name), 'Forbidden run artifact: ' + entry.name);
    if (entry.isDirectory()) noRaw(join(dir, entry.name));
  }
}
const rows = [], toCopy = [], visualFindings = [];
const copy = (source, destination) => { const file = safePath(source); toCopy.push({ file, destination }); };
function addReview(folder, screens, scope) {
  const review = read(safePath(folder + '/visual-review.json'));
  assert.equal(review.testSHA, QA);
  if (scope === 'anonymous') assert.equal(review.status, 'approved-for-anonymous-entry-evidence');
  else assert.equal(review.status, 'reviewed-with-minor-layout-and-framing-limitations');
  assert.equal(review.captures.length, screens.length);
  if (scope === 'anonymous') assert.equal((review.findings ?? []).length, 0);
  else {
    assert.equal(review.findings.length, 2);
    assert.equal(review.findings.find(f => f.id === 'V-01')?.severity, 'minor');
    assert.ok(review.findings.some(f => f.severity === 'artifact-framing'));
  }
  visualFindings.push(...(review.findings ?? []).map(finding => ({ scope, ...finding })));
  for (const s of screens) {
    const r = review.captures.find(item => item.file === s.file); assert.ok(r, 'Missing image review');
    assert.equal(r.sha256, s.sha256);
    if (scope === 'anonymous') { assert.equal(r.viewed, true); assert.equal(r.assessment, 'approved'); }
    else { assert.equal(r.reviewed, true); assert.equal(r.assessment, 'safe-workflow-evidence'); }
    const bytes = readFileSync(safePath(folder + '/' + s.file)); assert.equal(sha(bytes), s.sha256);
    assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
    copy(folder + '/' + s.file, scope + '/' + s.file);
  }
  copy(folder + '/visual-review.json', scope + '/visual-review.json');
}

const anonymous = read(safePath(folders.anonymous + '/results.json'));
assert.equal(anonymous.testSHA, QA); assert.equal(anonymous.dirty, false); assert.equal(anonymous.entryAssetsStable, true);
assert.deepEqual(anonymous.counts, expectedCounts(4)); assert.equal(anonymous.results.length, 4);
const apiPub = binding(anonymous, 'api');
const apiBefore = fingerprint(anonymous.entryBefore, apiPub), apiAfter = fingerprint(anonymous.entryAfter, apiPub);
for (const c of anonymous.results) {
  assert.equal(c.status, 'passed'); assert.equal(c.pageErrorCount, 0); assert.deepEqual(c.blockedRequests, []); assert.deepEqual(c.readErrors, []);
  assert.equal(c.anonymousAuth.status, 401); assert.equal(c.anonymousAuth.errorCode, 'AUTH_REQUIRED'); assert.equal(c.screenshot.inputsEmpty, true);
}
assert.equal(new Set(anonymous.results.map(c => c.language + ':' + c.width)).size, 4);
assert.ok(millis(anonymous.startedAt) >= millis('2026-10-31T19:20:00Z'));
noRaw(safePath(folders.anonymous));
addReview(folders.anonymous, anonymous.results.map(c => c.screenshot), 'anonymous');
copy(folders.anonymous + '/results.json', 'anonymous/results.json');
copy(folders.anonymous + '/api-publisher-manifest.json', 'anonymous/api-publisher-manifest.json');
assert.equal(sha(readFileSync(safePath(folders.anonymous + '/api-publisher-manifest.json'))), API_DIGEST);
rows.push({ scope: 'Anonymous API entry only; RU/KK and 1280/375; JSON401 and empty login form', testSHA: QA, frontendSha: API_SOURCE,
  deploymentId: API_DEPLOY, deploymentIdentitySource: 'Owner handoff', counts: anonymous.counts, startedAt: anonymous.startedAt, endedAt: anonymous.endedAt,
  staticBefore: apiBefore, staticAfter: apiAfter, authenticated: false });

for (const [scope, expected, suite, config] of [['mock', 16, 'public-mock.public.spec.ts', 'public.config.mjs'], ['worker', 8, 'worker-locale-regression.mock.spec.ts', 'worker-locale.config.mjs']]) {
  const folder = folders[scope], run = read(safePath(folder + '/acceptance.json')), browser = read(safePath(folder + '/browser-results.json'));
  assert.equal(run.status, 'passed'); assert.equal(run.exitCode, 0); assert.equal(run.browserGlobalErrors, 0); assert.equal(run.staticStable, true);
  assert.ok(!run.failure && !run.privacyFailure && !run.fingerprintFailure);
  assert.deepEqual(run.counts, expectedCounts(expected)); assert.deepEqual({ ...browser.counts, notRun: 0 }, expectedCounts(expected));
  assert.equal(browser.globalErrors, 0); assert.equal(browser.tests.length, expected);
  assert.equal(run.suiteSha256, sha(readFileSync(join(root, 'tests', suite))));
  assert.equal(run.configSha256, sha(readFileSync(join(own, config))));
  const pub = binding(run, 'mock');
  const before = fingerprint(run.before, pub), after = fingerprint(run.after, pub);
  const screens = [];
  for (const t of browser.tests) {
    assert.equal(t.status, 'passed'); assert.equal(t.retry, 0); assert.equal(t.fixme, false); assert.equal(t.failure, null);
    for (const s of t.screenshots) { assert.ok(/^screens\/\d+-[a-z0-9-]+\.png$/.test(s.file)); screens.push(s); }
  }
  assert.equal(screens.length, scope === 'mock' ? 20 : 0);
  noRaw(safePath(folder));
  if (screens.length) addReview(folder, screens, scope);
  if (scope === 'mock') copy(folder + '/V-01.json', scope + '/V-01.json');
  copy(folder + '/acceptance.json', scope + '/acceptance.json');
  copy(folder + '/browser-results.json', scope + '/browser-results.json');
  copy(folder + '/mock-independent-build-manifest.json', scope + '/mock-independent-build-manifest.json');
  assert.equal(sha(readFileSync(safePath(folder + '/mock-independent-build-manifest.json'))), MOCK_DIGEST);
  rows.push({ scope: scope === 'mock' ? 'Published mock 16-browser subset' : 'Published mock worker-locale eight-case subset; synthetic local data, not cloud worker',
    testSHA: QA, frontendSha: APP, deploymentId: MOCK_DEPLOY, deploymentIdentitySource: 'Owner handoff', manifestProvenance: 'Independent clean QA build',
    counts: run.counts, startedAt: run.startedAt, endedAt: run.endedAt, staticBefore: before, staticAfter: after, suiteSha256: run.suiteSha256, configSha256: run.configSha256,
    screenshotCount: screens.length });
}
assert.ok(millis(rows[1].startedAt) >= millis(rows[0].endedAt));
assert.ok(millis(rows[2].startedAt) >= millis(rows[1].endedAt));

for (const name of ['api-manifest.json', 'api-manifest-source.json', 'local-84d009e-build-manifest.json', 'handoff.json', 'handoff-with-own-build.json', 'final-access-presence.json']) copy(name, 'reference/' + name);
for (const name of ['anonymous-api.mjs', 'guard.mjs', 'run-mock.mjs', 'safe-public-reporter.mjs', 'public.config.mjs', 'worker-locale.config.mjs', 'build-local-84d009e.mjs', 'prepare-api-manifest.mjs', 'export-public-evidence.mjs']) copy(name, 'method/' + name);
const assets = new Map();
function add(name, bytes) {
  assert.ok(!assets.has(name)); assert.ok(!name.includes('..'));
  privacy(bytes, name); assets.set(name, bytes);
}
for (const item of toCopy) add(item.destination, readFileSync(item.file));
for (const name of ['public-mock.public.spec.ts', 'worker-locale-regression.mock.spec.ts']) add('method/' + name, readFileSync(join(root, 'tests', name)));
for (const name of ['playwright.public.config.ts', 'playwright.config.ts']) add('method/' + name, readFileSync(join(root, name)));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const buildLog = readFileSync(join(own, 'local-84d009e-build.log')); privacy(buildLog, 'own-build log');
add('reference/own-build-log-metadata.json', jsonBytes({ bytes: buildLog.length, sha256: sha(buildLog), copied: false,
  exitCode: build.exitCode, startedAt: build.startedAt, endedAt: build.endedAt, applicationBase: APP, testSHA: QA, files: build.files.length,
  reason: 'Preserve digest and build result; no raw console log is included' }));
add('method/source-snapshot-provenance.json', jsonBytes({ capturedAt: new Date().toISOString(), testSHA: QA,
  trackedSuites: 'Exact tracked c7 test files; per-run suiteSha256 checked for both mock runs',
  configs: 'Both mock config hashes checked against their run records',
  anonymousMethod: 'Prepared helper snapshot preserved after the run; anonymous report does not record a helper hash',
  guard: { currentSha256: sha(readFileSync(join(own, 'guard.mjs'))), exactAnonymousExecutedBytesPreserved: false,
    note: 'Root reports guard.mjs was changed after the anonymous run to support the independent mock build. This current snapshot is not claimed to be the exact anonymous runtime guard.',
    mockTiming: 'Root reports the current guard was unchanged during both mock runs; the per-run reports do not record a guard hash. Runtime binding and exact manifest digests remain the authoritative per-run evidence.',
    exactModificationTimestampKnown: false },
  offlineInspectionExcluded: 'Earlier API manifest schema-inspection hash came from a noncanonical file serialization. Current evidence instead binds exact Git blob d8b04239; the older ignored inspection is preserved but is not exported as proof.' }));
const acceptance = { schemaVersion: 1, createdAt: new Date().toISOString(), applicationBase: APP, appsTree: TREE, testSHA: QA,
  status: 'PUBLIC_MOCK_SUBSETS_AND_ANONYMOUS_API_ENTRY_VERIFIED', fullCloudReady: false,
  publications: { mock: { frontendSha: APP, origin: 'https://green-pavlodar-mock.pages.dev', deploymentId: MOCK_DEPLOY,
    contentBinding: 'Own clean mock build: all34 public static files matched production and immutable deployment before/after both browser subsets', manifestSha256: MOCK_DIGEST },
    api: { frontendSha: API_SOURCE, origin: 'https://green-pavlodar-api.pages.dev', deploymentId: API_DEPLOY,
      contentBinding: 'Exact publisher Git-blob manifest: all34 public static files matched production and immutable deployment before/after anonymous browser checks', manifestSha256: API_DIGEST } },
  backend: { sourceShaOwnerReported: '3b14927def04b35bf97782eae6b550da276c779f', deploymentIdOwnerReported: 'dep-dbj223h42hec73bqnttg', independentlyVerifiedSource: false },
  deploymentIdsAreOwnerReported: true, sourceTreeIdentity: sourceTrees, runs: rows,
  screenshots: { anonymousEmptyLogin: 4, successfulSyntheticPublicMock: 20, workerSubset: 0, localPresentationSet: 'Separate immutable30; not combined or relabelled' },
  visualFindings,
  publicScreenshotUse: 'Separate workflow evidence, not replacements for the formal local30. Public lab result cards and mobile Outcomes values may be outside the captured viewport. V-01 status-label clipping remains recorded as a minor finding.',
  localArchive: { sha256: LOCAL_ZIP_DIGEST, unchanged: true, copiedIntoPublicEvidence: false },
  exclusions: ['Authenticated cloud worker/coordinator/viewer scenario', 'Private photo/report/inspection/forecast/history persistence', 'Cloud restart or reseed',
    'Backend source identity', 'API deployment-control _worker.js and _routes.json bytes through public HTTP', 'Full cloud API suite', 'Native Microsoft Word', 'Docker on84d009e'],
  manifestBuildStatusNote: 'The publisher manifest was created before deployment and retains its historical runtimeStatus. Static HTTP confirmation here does not certify deployment-control code or backend runtime.',
};
const cloudAccess = read(join(own, 'final-access-presence.json'));
for (const key of ['CLOUD_ACCEPTANCE_DEMO', 'CLOUD_ACCEPTANCE_ORIGIN', 'CLOUD_ACCEPTANCE_BROWSER_ORIGIN', 'CLOUD_ACCEPTANCE_PASSWORD']) assert.equal(cloudAccess.processPresence[key], false);
assert.equal(cloudAccess.baselineManifestPresentAtDefaultPath, false);
acceptance.cloudAcceptanceStatus = { status: 'BLOCKED_ACCESS', checkedAt: cloudAccess.checkedAt,
  reason: 'All four process access variables and the expected baseline manifest are absent on this QA machine',
  scope: 'Authenticated cloud scenario and persistence; anonymous/public mock checks do not satisfy it' };
add('acceptance.json', jsonBytes(acceptance));
const manifest = { schemaVersion: 1, prefix: PREFIX, applicationBase: APP, testSHA: QA, status: acceptance.status,
  ignoredHelperBoundary: 'QA checkout SHA identifies tracked suites/configuration. Prepared ignored helpers are separately hashed post-run source snapshots; see method/source-snapshot-provenance.json for execution-identity limits.',
  fullCloudReady: false, files: [...assets].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha(bytes) })) };
add('manifest.json', jsonBytes(manifest));
pinned(); assert.equal(sha(readFileSync(localZip)), LOCAL_ZIP_DIGEST); assert.ok(!existsSync(output));
mkdirSync(output);
for (const [name, bytes] of assets) {
  const target = join(output, PREFIX, name); mkdirSync(resolve(target, '..'), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx' });
}
for (const f of manifest.files) assert.equal(sha(readFileSync(join(output, PREFIX, f.path))), f.sha256);
console.log(JSON.stringify({ directory: relative(root, join(output, PREFIX)).replaceAll('\\', '/'), files: assets.size,
  testSHA: QA, scopes: rows.map(r => ({ scope: r.scope, counts: r.counts })), fullCloudReady: false, localArchiveUnchanged: true }, null, 2));
