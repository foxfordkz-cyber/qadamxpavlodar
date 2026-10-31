import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const directory = fileURLToPath(new URL('.', import.meta.url));
export const e2e = fileURLToPath(new URL('../..', import.meta.url));
export const QA_SHA = 'c7f15755c80292509aaeeb9f9e4638f62c8b6810';
export const APP_SHA = '84d009e3b72c4fe637ef30607e29701054b6c621';
export const API_FRONTEND_SHA = 'c970264919de2f7a62d0e1ea8a28cc70c95a3864';
export const APPS_TREE = '2fd878cfbec10d93942afeb5add57a39a230304f';
export const PAUSE_START = '2026-10-31T19:00:00Z';
export const PAUSE_END = '2026-10-31T19:20:00Z';
const origins = { mock: 'https://green-pavlodar-mock.pages.dev', api: 'https://green-pavlodar-api.pages.dev' };
const sourcePins = { mock: APP_SHA, api: API_FRONTEND_SHA };
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: e2e, encoding: 'utf8', windowsHide: true }).trim();

export function assertAfterPublication() {
  // No probes before/during the agreed pause: these are post-publication scripts.
  if (Date.now() < Date.parse(PAUSE_END)) throw new Error('BLOCKED_PUBLICATION_WINDOW');
}
export function assertPinned() {
  if (git(['rev-parse', 'HEAD']) !== QA_SHA || git(['rev-parse', 'HEAD:apps']) !== APPS_TREE ||
      git(['status', '--porcelain', '--untracked-files=normal'])) throw new Error('BLOCKED_SOURCE_NOT_CLEAN_PINNED_QA');
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('BLOCKED_NODE_VERSION');
  for (const mode of ['mock', 'api']) {
    const file = resolve(e2e, `playwright-report/runs/${mode}.json`);
    if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).state === 'running') throw new Error('BLOCKED_LOCAL_ACCEPTANCE_RUNNING');
  }
}
function localManifest(base, name) {
  if (typeof name !== 'string' || !name || isAbsolute(name)) throw new Error('BLOCKED_MANIFEST_PATH');
  const path = resolve(base, name), rel = relative(base, path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('BLOCKED_MANIFEST_PATH');
  return path;
}

export function parsePublisherManifest(raw, entry, kind) {
  const manifest = JSON.parse(raw.toString('utf8'));
  const manifestProvenance = entry.manifestProvenance ?? 'publisher';
  if (!['publisher', 'independent-qa-build'].includes(manifestProvenance) || (kind === 'api' && manifestProvenance !== 'publisher')) throw new Error('BLOCKED_MANIFEST_PROVENANCE');
  const sha = manifest.frontendSourceSha ?? manifest.source?.sha ?? manifest.frontendSha;
  const entries = manifest.entries ?? manifest.files;
  if (sha !== sourcePins[kind] || !Array.isArray(entries) || entries.length < 2) throw new Error('BLOCKED_MANIFEST_SOURCE');
  if (manifestProvenance === 'independent-qa-build' && (kind !== 'mock' ||
      manifest.schema !== 'green-pavlodar-independent-qa-mock-build-v1' || manifest.manifestProvenance !== 'independent-qa-build' ||
      manifest.testSHA !== QA_SHA || manifest.source?.qaSha !== QA_SHA || manifest.appsTree !== APPS_TREE ||
      manifest.exitCode !== 0 || manifest.dirty !== false || manifest.sourceStillClean !== true ||
      manifest.outputWasNewAndTaskOwned !== true || entries.length !== 34 ||
      manifest.activeWebEnvFiles?.length !== 0 || manifest.environment?.VITE_DATA_SOURCE !== 'mock' ||
      manifest.environment?.inheritedViteVariablesRemoved !== true || manifest.environment?.sensitiveVariablesRemoved !== true)) throw new Error('BLOCKED_INDEPENDENT_BUILD_CONTRACT');
  if (manifestProvenance === 'publisher' && manifest.schema === 'green-pavlodar-independent-qa-mock-build-v1') throw new Error('BLOCKED_INDEPENDENT_BUILD_MISLABELLED_AS_PUBLISHER');
  if (kind === 'api' && (manifest.schema !== 'green-pavlodar-pages-api-build-v1' || manifest.sourceDirty !== false ||
      manifest.dataSource !== 'api' || manifest.publicOrigin !== origins.api ||
      manifest.upstreamOrigin !== 'https://green-pavlodar-api-demo.onrender.com')) throw new Error('BLOCKED_API_MANIFEST_CONTRACT');
  const reserved = {
    '_worker.js': 'Cloudflare Pages executable worker: uploaded runtime artifact, not a publicly servable static file.',
    '_routes.json': 'Cloudflare Pages routing configuration: deployment control artifact, not a static HTTP target.',
    '_headers': 'Cloudflare Pages response-header configuration, not a static HTTP target.',
    '_redirects': 'Cloudflare Pages redirect configuration, not a static HTTP target.',
  };
  const files = [], excluded = [], seen = new Set();
  for (const file of entries) {
    if (typeof file.path !== 'string' || !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(file.path) ||
        file.path.split('/').some(part => part === '.' || part === '..') || seen.has(file.path) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 1 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('BLOCKED_MANIFEST_ENTRY');
    seen.add(file.path);
    const safe = { path: file.path, bytes: file.bytes, sha256: file.sha256 };
    if (reserved[file.path]) excluded.push({ ...safe, reason: reserved[file.path], httpVerified: false });
    else if (/\.(?:html|js|css|woff2?|ttf|otf|svg|png|webp|jpe?g|ico|json|txt|webmanifest)$/.test(file.path)) files.push(safe);
    else throw new Error('BLOCKED_UNCLASSIFIED_MANIFEST_ENTRY_REVIEW_REQUIRED');
  }
  if (!files.some(file => file.path === 'index.html') || !files.some(file => file.path.endsWith('.js'))) throw new Error('BLOCKED_MANIFEST_INCOMPLETE');
  return { schema: typeof manifest.schema === 'string' ? manifest.schema : null, manifestProvenance,
    sourceSha: sha, totalEntries: entries.length, files, excluded,
    buildArtifactRuntimeStatus: typeof manifest.runtimeStatus === 'string' ? manifest.runtimeStatus : null };
}

function sourceIdentityEvidence() {
  const expected = {
    'apps/web': '1690174760f23f4ba0d297771073b838360b32a6',
    'apps/web/src/features/worker': '3d26ea7b4e61667e5a1efb58f8f639b5b8966d47',
    'tools/worker-demo': '22569488f8e728ebb2971a1ddb3d48e58ac77f0f',
    cloudflare: 'f899444993055bce5d130717ffb6af90a78d6bc2',
  };
  const paths = Object.entries(expected).map(([path, tree]) => {
    const accepted = git(['rev-parse', `${APP_SHA}:${path}`]), api = git(['rev-parse', `${API_FRONTEND_SHA}:${path}`]), qa = git(['rev-parse', `HEAD:${path}`]);
    if ([accepted, api, qa].some(value => value !== tree)) throw new Error('BLOCKED_FRONTEND_SOURCE_TREES_DIFFER');
    return { path, acceptedApplicationTree: accepted, apiFrontendTree: api, qaTree: qa, identical: true };
  });
  return { acceptedApplicationSha: APP_SHA, apiFrontendSha: API_FRONTEND_SHA, qaSha: QA_SHA, paths,
    scope: 'Independent local Git tree equality for these build inputs only; source commit identities remain distinct.' };
}

export function loadHandoff(mode) {
  assertAfterPublication(); assertPinned();
  const path = process.env.FINAL84_HANDOFF;
  if (!path) throw new Error('BLOCKED_HANDOFF_MISSING');
  const raw = readFileSync(path), handoff = JSON.parse(raw.toString('utf8'));
  if (handoff.schema !== 1 || handoff.releaseSha !== APP_SHA || handoff.publicationComplete !== true ||
      !Number.isFinite(Date.parse(handoff.publicationCompletedConfirmedAt)) ||
      Date.parse(handoff.publicationCompletedConfirmedAt) > Date.now()) throw new Error('BLOCKED_HANDOFF_RELEASE');
  // Require separate source/deployment identities for both publications. Only
  // the selected mode's manifest is a dependency of this independent run.
  const publications = {}, manifestSources = [];
  for (const kind of ['mock', 'api']) {
    const entry = handoff.publications?.[kind];
    if (!entry || entry.origin !== origins[kind] || entry.frontendSha !== sourcePins[kind] ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(entry.deploymentId ?? '') ||
        entry.immutableOrigin !== `https://${entry.deploymentId.slice(0, 8)}.green-pavlodar-${kind}.pages.dev`) throw new Error('BLOCKED_PUBLICATION_IDENTITY');
    const identity = { origin: entry.origin, frontendSha: entry.frontendSha, deploymentId: entry.deploymentId, immutableOrigin: entry.immutableOrigin };
    if (kind !== mode) {
      const digest = /^[a-f0-9]{64}$/.test(entry.manifestSha256 ?? '') ? entry.manifestSha256 : null;
      const hasPath = typeof entry.manifestPath === 'string' && entry.manifestPath.length > 0;
      const locallyPresent = digest && hasPath ? existsSync(localManifest(dirname(resolve(path)), entry.manifestPath)) : false;
      publications[kind] = { ...identity, manifestProvenance: entry.manifestProvenance ?? 'publisher', manifestVerification: locallyPresent ? 'not-verified-in-this-mode' : 'pending-unverified',
        manifestSha256Reported: digest, manifestVerified: false,
        reason: 'This run validates only its own publication manifest; the other frontend is not accepted by these results.' };
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(entry.manifestSha256 ?? '')) throw new Error('BLOCKED_SELECTED_MANIFEST_DIGEST_MISSING');
    const manifestFile = localManifest(dirname(resolve(path)), entry.manifestPath);
    const manifestRaw = readFileSync(manifestFile);
    if (hash(manifestRaw) !== entry.manifestSha256) throw new Error('BLOCKED_MANIFEST_DIGEST');
    const manifest = parsePublisherManifest(manifestRaw, entry, kind);
    publications[kind] = { ...identity, manifestSha256: entry.manifestSha256, manifestProvenance: manifest.manifestProvenance, manifestVerification: 'hash-and-schema-verified', manifestVerified: true,
      manifestSchema: manifest.schema, manifestTotalEntries: manifest.totalEntries,
      files: manifest.files, excludedFromHttp: manifest.excluded, buildArtifactRuntimeStatus: manifest.buildArtifactRuntimeStatus };
    manifestSources.push({ kind, path: manifestFile, sha256: entry.manifestSha256, provenance: manifest.manifestProvenance });
  }
  if ((handoff.publications.mock.manifestPath && handoff.publications.mock.manifestPath === handoff.publications.api.manifestPath) ||
      handoff.publications.mock.deploymentId === handoff.publications.api.deploymentId) throw new Error('BLOCKED_PUBLICATIONS_NOT_SEPARATE');
  const backend = handoff.backend;
  if (!backend || backend.origin !== 'https://green-pavlodar-api-demo.onrender.com' ||
      !/^[a-f0-9]{40}$/.test(backend.applicationSha ?? '') || !/^dep-[a-z0-9]+$/.test(backend.deploymentId ?? '')) throw new Error('BLOCKED_BACKEND_HANDOFF');
  const binding = { mode, publication: publications[mode], handoffSha256: hash(raw),
    otherPublication: publications[mode === 'api' ? 'mock' : 'api'],
    manifestDigests: Object.fromEntries(manifestSources.map(item => [item.kind, item.sha256])),
    backendReported: { origin: backend.origin, applicationSha: backend.applicationSha, deploymentId: backend.deploymentId,
      verification: 'Owner-reported identity only; anonymous browser checks do not independently verify deployed backend source.' },
    releaseSha: APP_SHA, qaSha: QA_SHA, appsTree: APPS_TREE,
    publicationCompletedConfirmedAt: handoff.publicationCompletedConfirmedAt,
    sourceIdentityEvidence: sourceIdentityEvidence() };
  Object.defineProperty(binding, 'manifestSources', { value: manifestSources, enumerable: false });
  return binding;
}

export function preservePublisherManifests(binding, output) {
  for (const source of binding.manifestSources) {
    const raw = readFileSync(source.path);
    if (hash(raw) !== source.sha256) throw new Error('BLOCKED_MANIFEST_CHANGED_AFTER_LOAD');
    // Preserve exact reference bytes. Label OUR build separately from a publisher
    // manifest; the HTTP subset/exclusions remain independent evidence.
    const label = source.provenance === 'independent-qa-build' ? 'independent-build' : 'publisher';
    writeFileSync(resolve(output, `${source.kind}-${label}-manifest.json`), raw);
  }
}
export function safeEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/PASSWORD|SECRET|TOKEN|COOKIE|DATABASE_URL|SUPABASE|API_KEY|ACCESS_KEY/i.test(key)) delete env[key];
  return env;
}
export async function fingerprint(binding) {
  assertAfterPublication(); assertPinned();
  const files = [];
  // Every publisher-manifest file, both production and immutable deployment.
  // Bytes are hashed in memory and discarded; no HTML/JS bodies enter reports.
  for (const origin of [binding.publication.origin, binding.publication.immutableOrigin]) {
    for (const expected of binding.publication.files) {
      assertAfterPublication();
      const url = new URL(expected.path === 'index.html' ? '/' : `/${expected.path}`, origin);
      const response = await fetch(url, { method: 'GET', credentials: 'omit', redirect: 'error',
        headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(12000) });
      const bytes = Buffer.from(await response.arrayBuffer()), digest = hash(bytes);
      files.push({ origin, path: expected.path, status: response.status, bytes: bytes.length, sha256: digest,
        expectedBytes: expected.bytes, expectedSha256: expected.sha256,
        passed: response.status === 200 && bytes.length === expected.bytes && digest === expected.sha256 });
    }
  }
  return { observedAt: new Date().toISOString(), files, matchesHandoff: files.every(file => file.passed) };
}
export function stable(before, after) {
  return before?.matchesHandoff === true && after?.matchesHandoff === true && JSON.stringify(before.files) === JSON.stringify(after.files);
}
export function noRawContexts(path) {
  if (!existsSync(path)) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) noRawContexts(child);
    else if (/error-context|trace\.zip|\.webm$/i.test(entry.name)) throw new Error('BLOCKED_UNSAFE_BROWSER_ARTIFACT');
  }
}

export function discardTemporaryBrowserOutput(output) {
  const root = resolve(output), withinPrepared = relative(directory, root);
  if (!withinPrepared || withinPrepared.startsWith('..') || isAbsolute(withinPrepared) || /[\\/]/.test(withinPrepared)) throw new Error('BLOCKED_CLEANUP_ROOT');
  const target = resolve(root, 'temporary-browser');
  if (!existsSync(target)) return;
  // Verify the resolved absolute target is inside this one run before recursive removal.
  const real = realpathSync(target), inside = relative(root, real);
  if (inside !== 'temporary-browser' || isAbsolute(inside)) throw new Error('BLOCKED_CLEANUP_TARGET');
  rmSync(real, { recursive: true });
}
