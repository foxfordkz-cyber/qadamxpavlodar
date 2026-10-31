import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

export const captureReadiness = ['settled-page', 'settled-plan', 'settled-outcomes', 'settled-map'];
export const captureRunId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
export function pngSize(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function capturePath(root, file) {
  const rootPath = realpathSync(root), realFile = realpathSync(resolve(root, file));
  const local = relative(rootPath, realFile).replaceAll('\\', '/');
  if (isAbsolute(local) || local.startsWith('../') || !/^(?:screens|test-results\/(?:screen-review|lab-review))\/[a-z0-9-]+-(?:375|1280)\.png$/.test(local)) {
    throw new Error('Screenshot path must be an allowed mock capture inside tools/e2e');
  }
  return { file: realFile, relativePath: local };
}

// Called only AFTER the browser assertion has proved the requested page/plan is
// settled and the PNG was written. This does not turn an old PNG into a capture:
// the helper binds actual bytes to a live runner identity and a clean Git SHA.
export function recordScreenCapture({ root = process.cwd(), file, name = basename(file), width, height,
  readiness, source = 'mock', testIdentity = '', env = process.env } = {}) {
  const runId = env.E2E_RUN_ID, revision = env.E2E_RUN_REVISION, profile = env.E2E_PROFILE;
  if (source !== 'mock' || !['mock', 'screens'].includes(profile) || !captureRunId.test(runId ?? '') || !/^[a-f0-9]{40}$/.test(revision ?? '')) {
    throw new Error('Mock screenshot provenance requires the active scripts/run.mjs runner');
  }
  if (!captureReadiness.includes(readiness)) throw new Error('Screenshot requires an explicit settled readiness assertion');
  const meta = JSON.parse(readFileSync(join(root, 'playwright-report', 'runs', `${profile}.json`), 'utf8'));
  if (meta.runId !== runId || meta.revision !== revision || meta.state !== 'running') throw new Error('Screenshot runner identity is not current');
  const options = { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, windowsHide: true };
  const actualRevision = execFileSync('git', ['rev-parse', 'HEAD'], options).trim();
  const dirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], options).trim();
  if (actualRevision !== revision || (!meta.dirty && dirty)) throw new Error('Repository changed during screenshot capture');
  const location = capturePath(root, file), bytes = readFileSync(location.file), size = pngSize(bytes);
  if (basename(location.file) !== name || !size || size.width !== width || size.height !== height) throw new Error('Screenshot name or PNG dimensions do not match the capture');
  const manifest = { schemaVersion: 1, runId, revision, profile, dirty: !!meta.dirty || dirty, source, name,
    relativePath: location.relativePath, width, height, readiness, sha256: hashBytes(bytes),
    capturedAt: new Date().toISOString(), testIdentity: String(testIdentity).slice(0, 250) };
  const directory = join(root, 'playwright-report', 'captures', runId);
  mkdirSync(directory, { recursive: true });
  // Independent names avoid lost updates from concurrent Playwright workers.
  writeFileSync(join(directory, `${name}.json`), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  return manifest;
}

export function inspectCapture(root, name, run, revision) {
  const width = name.endsWith('-375.png') ? 375 : 1280, height = width === 375 ? 812 : 800;
  const missing = reason => ({ name, width, height, valid: false, fresh: false, reviewed: false, reason });
  try {
    const meta = run?.meta;
    if (!meta || !captureRunId.test(meta.runId ?? '')) return missing('No capture manifest for this run');
    const folder = join(root, 'playwright-report', 'captures', meta.runId);
    const capture = JSON.parse(readFileSync(join(folder, `${name}.json`), 'utf8'));
    const location = capturePath(root, capture.relativePath), bytes = readFileSync(location.file), size = pngSize(bytes);
    const identity = capture.schemaVersion === 1 && capture.runId === meta.runId && capture.revision === meta.revision &&
      capture.revision === revision && capture.profile === run.profile && capture.name === name && capture.source === 'mock' &&
      !capture.dirty && !meta.dirty && captureReadiness.includes(capture.readiness);
    const valid = !!size && size.width === width && size.height === height && capture.width === width && capture.height === height &&
      capture.sha256 === hashBytes(bytes);
    const captured = Date.parse(capture.capturedAt), start = Date.parse(meta.startedAt), end = Date.parse(meta.endedAt);
    // A failed run can supply diagnostic images, but never acceptance-ready evidence.
    const fresh = valid && identity && run.current && meta.state === 'finished' && captured >= start && captured <= end;
    let reviewed = false;
    try {
      const review = JSON.parse(readFileSync(join(folder, 'review.json'), 'utf8'));
      reviewed = fresh && review.runId === meta.runId && review.revision === revision &&
        review.captures?.some(entry => entry.name === name && entry.sha256 === capture.sha256);
    } catch { /* Review is a separate explicit operation, never inferred from mtime. */ }
    return { name, width, height, valid, fresh: !!fresh, reviewed: !!reviewed, capturedAt: capture.capturedAt,
      runId: capture.runId, revision: capture.revision, sha256: capture.sha256, readiness: capture.readiness,
      relativePath: location.relativePath, reason: fresh ? reviewed ? 'Reviewed current capture' : 'Current capture awaiting visual review' : 'Capture identity, hash or run interval does not match' };
  } catch { return missing('Capture manifest or its PNG is absent or invalid'); }
}
