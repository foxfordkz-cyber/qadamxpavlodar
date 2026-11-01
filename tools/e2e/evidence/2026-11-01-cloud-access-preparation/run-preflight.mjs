// Independent QA wrapper: existing synthetic baseline; never a business-write runner.
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

export const PAGES_ORIGIN = 'https://green-pavlodar-api.pages.dev';
export const ACCESS_KEYS = ['CLOUD_ACCEPTANCE_DEMO', 'CLOUD_ACCEPTANCE_ORIGIN',
  'CLOUD_ACCEPTANCE_BROWSER_ORIGIN', 'CLOUD_ACCEPTANCE_PASSWORD'];
export const PINNED = Object.freeze({
  checker: '4dbb495766da4d32b151dc9637ffbb8d8cd6e8d5e56651ac205535ca68380a98',
  manifest: '1f85a4cab1981addd7c54bdbbdefca5dd41b2a0f10ce41a23003ba03468027af',
});
const here = new URL('.', import.meta.url);
const roles = ['coordinator', 'viewer', 'worker', 'foreman'];
const logins = ['coordinator', 'viewer', 'release-738f96b2-worker', 'release-738f96b2-foreman'];
export const BASELINE_GETS = Object.freeze([
  '/tasks/2f64e988-97f9-4970-9dcf-1ca016f66cb2',
  '/tasks/2f64e988-97f9-4970-9dcf-1ca016f66cb2/history',
  '/reports/368df690-6894-4b67-9aab-2651a9c4fad9',
  '/tasks/1abe0f0e-88ff-4c66-a7ce-fef3b0347f19/history',
  '/reports/32bf4fed-c476-4cf6-81f2-aec7813939bb',
  '/outcomes/cohorts/release-738f96b2-cohort',
  '/outcomes/cohorts/release-738f96b2-cohort/inspections',
]);
const getPaths = new Set(['/ready', '/auth/me', ...BASELINE_GETS,
  '/uploads/12ff65e8-d13d-49ca-bb9f-437baf3377bf']);
const hash = value => createHash('sha256').update(value).digest('hex');

// A file is optional. Existing process values take precedence, like Node --env-file.
// Only these four keys can reach the checker; no DEMO_PASSWORD or provider fallback.
export function selectAccessEnvironment(processEnvironment = {}, fileText) {
  const parsed = fileText === undefined ? {} : parseEnv(fileText);
  return Object.fromEntries(ACCESS_KEYS.flatMap(key => {
    const value = typeof processEnvironment[key] === 'string' ? processEnvironment[key] : parsed[key];
    return typeof value === 'string' ? [[key, value]] : [];
  }));
}

export function accessBlocker(env) {
  const presence = Object.fromEntries(ACCESS_KEYS.map(key => [key, typeof env[key] === 'string' && env[key].length > 0]));
  if (Object.values(presence).some(value => !value)) return { result: 'BLOCKED_ACCESS', reason: 'REQUIRED_PROCESS_VALUES_MISSING', presence };
  if (env.CLOUD_ACCEPTANCE_DEMO !== '1' || env.CLOUD_ACCEPTANCE_ORIGIN !== PAGES_ORIGIN ||
      env.CLOUD_ACCEPTANCE_BROWSER_ORIGIN !== PAGES_ORIGIN || env.CLOUD_ACCEPTANCE_PASSWORD.length < 12) {
    return { result: 'BLOCKED_ACCESS', reason: 'PROCESS_ACCESS_CONFIGURATION_INVALID', presence };
  }
  return null;
}

export function guardedFetch(env, delegate, exchanges = []) {
  if (accessBlocker(env)) throw Error('ACCESS_NOT_CONFIGURED');
  return async (target, options = {}) => {
    const prefix = PAGES_ORIGIN + '/api/v1';
    const raw = typeof target === 'string' ? target : '';
    const path = raw.startsWith(prefix) ? raw.slice(prefix.length) : '';
    const method = options.method ?? 'GET';
    const headers = new Headers(options.headers);
    if (!path || raw !== prefix + path || options.redirect !== 'error' ||
        headers.get('origin') !== PAGES_ORIGIN) throw Error('REQUEST_GUARD_REJECTED');
    if (method === 'GET') {
      if (!getPaths.has(path) || options.body !== undefined) throw Error('REQUEST_GUARD_REJECTED');
    } else if (method === 'POST' && ['/auth/login', '/auth/logout'].includes(path)) {
      let body;
      try { body = JSON.parse(options.body); } catch { throw Error('REQUEST_GUARD_REJECTED'); }
      if (!body || Array.isArray(body) || typeof body !== 'object') throw Error('REQUEST_GUARD_REJECTED');
      if (path === '/auth/login') {
        if (Object.keys(body).sort().join(',') !== 'login,password' || !logins.includes(body.login) ||
            body.password !== env.CLOUD_ACCEPTANCE_PASSWORD) throw Error('REQUEST_GUARD_REJECTED');
      } else if (Object.keys(body).length !== 0) throw Error('REQUEST_GUARD_REJECTED');
    } else throw Error('REQUEST_GUARD_REJECTED');
    // Never retain body, headers, URL query credentials, exception text or photo bytes.
    const response = await delegate(raw, options);
    exchanges.push({ method, path, status: Number.isInteger(response.status) ? response.status : null });
    return response;
  };
}

export function safeResult(raw) {
  const result = { result: raw?.result === 'PASS' ? 'PASS' : 'FAIL',
    checks: Array.isArray(raw?.checks) ? raw.checks.filter(item => roles.includes(item?.role) && item.login === 'PASS')
      .map(item => ({ role: item.role, login: 'PASS' })) : [] };
  const stages = ['configuration', 'readiness', 'baseline-read', 'private-photo', ...roles.map(role => 'login:' + role)];
  if (stages.includes(raw?.stage)) result.stage = raw.stage;
  if (raw?.baselineReads === 7) result.baselineReads = 7;
  if (raw?.privatePhoto === 'PASS') result.privatePhoto = 'PASS';
  if (raw?.cleanup === 'SESSION_REVOCATION_NOT_CONFIRMED') {
    result.result = 'FAIL'; result.cleanup = raw.cleanup;
  }
  if (result.result === 'PASS' && (result.checks.length !== 4 || new Set(result.checks.map(item => item.role)).size !== 4 ||
      result.baselineReads !== 7 || result.privatePhoto !== 'PASS')) {
    result.result = 'FAIL'; result.stage = 'RESULT_CONTRACT';
  }
  return result;
}

export function verifyPinnedBytes(checkerBytes, manifestBytes) {
  if (hash(checkerBytes) !== PINNED.checker || hash(manifestBytes) !== PINNED.manifest) throw Error('HANDOFF_DIGEST_MISMATCH');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (JSON.stringify(manifest.reads?.map(item => item.path)) !== JSON.stringify(BASELINE_GETS) ||
      manifest.prefix !== 'release-738f96b2' || manifest.photo?.id !== '12ff65e8-d13d-49ca-bb9f-437baf3377bf') {
    throw Error('HANDOFF_CONTRACT_MISMATCH');
  }
  return manifest;
}

export async function executePreflight({ env, checker, manifest, fetcher = globalThis.fetch }) {
  const blocked = accessBlocker(env);
  if (blocked) return { ...blocked, exchanges: [] };
  const exchanges = [];
  try {
    const raw = await checker(env, manifest, guardedFetch(env, fetcher, exchanges));
    return { ...safeResult(raw), exchanges };
  } catch {
    return { result: 'FAIL', stage: 'PREFLIGHT_EXCEPTION', exchanges };
  }
}

export async function main(args = process.argv.slice(2), processEnvironment = process.env) {
  const startedAt = new Date().toISOString();
  let outcome, qaHead = null, env, handoffDigestsVerified = false;
  try {
    if (!(args.length === 0 || (args.length === 2 && args[0] === '--env-file'))) throw Error('ARGS');
    const fileText = args.length ? readFileSync(args[1], 'utf8') : undefined;
    env = selectAccessEnvironment(processEnvironment, fileText);
    outcome = accessBlocker(env);
  } catch { outcome = { result: 'BLOCKED_ACCESS', reason: 'PRIVATE_CONFIGURATION_UNAVAILABLE_OR_INVALID', exchanges: [] }; }
  try {
    qaHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('../../', here)),
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      env: Object.fromEntries(Object.entries(process.env).filter(([name]) =>
        ['systemroot','windir','path','temp','tmp','userprofile','localappdata','appdata'].includes(name.toLowerCase()))) }).trim();
    if (!/^[a-f0-9]{40}$/.test(qaHead)) throw Error('SHA');
  } catch { qaHead = null; if (!outcome) outcome = { result: 'BLOCKED_CONFIGURATION', reason: 'QA_HEAD_UNAVAILABLE' }; }
  if (!outcome) {
    try {
      const checkerBytes = readFileSync(new URL('cloud-qa-access.mjs', here));
      const manifestBytes = readFileSync(new URL('release-738f96b2.json', here));
      const manifest = verifyPinnedBytes(checkerBytes, manifestBytes);
      handoffDigestsVerified = true;
      // Execute the exact reviewed bytes, avoiding a hash-check/file-import race.
      const { checkQaAccess } = await import('data:text/javascript;base64,' + checkerBytes.toString('base64'));
      outcome = await executePreflight({ env, checker: checkQaAccess, manifest });
    } catch { outcome = { result: 'BLOCKED_CONFIGURATION', reason: 'PINNED_HANDOFF_UNAVAILABLE_OR_INVALID', exchanges: [] }; }
  }
  const record = { schema: 'green-pavlodar-independent-cloud-access-v1', startedAt, endedAt: new Date().toISOString(),
    qaHead, runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
    expectedHandoffDigests: PINNED, handoffDigestsVerified,
    identity: {
      frontendShaOwnerReported: 'c970264919de2f7a62d0e1ea8a28cc70c95a3864',
      frontendDeploymentOwnerReported: 'a26bd214-1c78-4a83-9536-74a35c85b49f',
      backendShaOwnerReported: '3b14927def04b35bf97782eae6b550da276c779f',
      backendDeploymentOwnerReported: 'dep-dbj223h42hec73bqnttg',
      deployedSourceIndependentlyVerified: false, frontendAssetsCheckedByThisRunner: false,
    },
    scope: 'Pages HTTP login and unchanged synthetic baseline only; no browser workflow or restart acceptance',
    businessWritesPermitted: false, retries: 0, exchanges: [], ...outcome };
  const basename = 'run-' + startedAt.replaceAll(':', '-').replaceAll('.', '-') + '-' + randomBytes(3).toString('hex') + '.json';
  writeFileSync(new URL(basename, here), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ result: record.result, ...(record.reason ? { reason: record.reason } : {}),
    ...(record.stage ? { stage: record.stage } : {}), artifact: basename }));
  return record.result === 'PASS' ? 0 : record.result.startsWith('BLOCKED') ? 2 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(); }
  catch { console.error('FAIL: safe preflight recording unavailable; values omitted'); process.exitCode = 1; }
}
