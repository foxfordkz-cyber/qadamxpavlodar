import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCESS_KEYS, PAGES_ORIGIN, BASELINE_GETS, selectAccessEnvironment, accessBlocker,
  guardedFetch, safeResult, verifyPinnedBytes, executePreflight } from './run-preflight.mjs';

const secret = 'SYNTHETIC_OFFLINE_CREDENTIAL_ONLY';
const env = { CLOUD_ACCEPTANCE_DEMO: '1', CLOUD_ACCEPTANCE_ORIGIN: PAGES_ORIGIN,
  CLOUD_ACCEPTANCE_BROWSER_ORIGIN: PAGES_ORIGIN, CLOUD_ACCEPTANCE_PASSWORD: secret };
const options = (method = 'GET', body) => ({ method, redirect: 'error',
  headers: { Origin: PAGES_ORIGIN }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const url = path => PAGES_ORIGIN + '/api/v1' + path;
const noNetwork = async () => { throw Error('OFFLINE_TEST_NETWORK_MUST_NOT_RUN'); };

test('only four CLOUD keys are imported; process wins; DEMO_PASSWORD is not a fallback', () => {
  const parsed = selectAccessEnvironment({ CLOUD_ACCEPTANCE_DEMO: '1' },
    'CLOUD_ACCEPTANCE_DEMO=0\nDEMO_PASSWORD=forbidden\nNODE_OPTIONS=forbidden\nDATABASE_URL=forbidden\nCLOUD_ACCEPTANCE_PASSWORD="' + secret + '"\n');
  assert.equal(parsed.CLOUD_ACCEPTANCE_DEMO, '1');
  assert.equal(parsed.CLOUD_ACCEPTANCE_PASSWORD, secret);
  assert.ok(Object.keys(parsed).every(key => ACCESS_KEYS.includes(key)));
  assert.equal(selectAccessEnvironment({ DEMO_PASSWORD: secret }).CLOUD_ACCEPTANCE_PASSWORD, undefined);
});

test('missing or invalid process access is BLOCKED_ACCESS and never invokes checker/fetch', async () => {
  let invoked = false;
  const checker = async () => { invoked = true; throw Error(secret); };
  for (const bad of [{}, { ...env, CLOUD_ACCEPTANCE_PASSWORD: '' },
    { ...env, CLOUD_ACCEPTANCE_ORIGIN: 'https://green-pavlodar-api-demo.onrender.com' },
    { ...env, CLOUD_ACCEPTANCE_BROWSER_ORIGIN: 'https://not-approved.example' }]) {
    const result = await executePreflight({ env: bad, checker, manifest: {}, fetcher: noNetwork });
    assert.equal(result.result, 'BLOCKED_ACCESS');
    assert.deepEqual(result.exchanges, []);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
  assert.equal(invoked, false);
  assert.equal(accessBlocker(env), null);
});

test('guard permits only known GET and login/logout POST; rejects writes, redirects, body changes and origins', async () => {
  const exchanges = [], forwarded = [];
  const guarded = guardedFetch(env, async (target, init) => {
    forwarded.push([target, init.method]); return new Response('{}', { status: 200 });
  }, exchanges);
  await guarded(url('/ready'), options());
  await guarded(url(BASELINE_GETS[0]), options());
  await guarded(url('/auth/login'), options('POST', { login: 'viewer', password: secret }));
  await guarded(url('/auth/logout'), options('POST', {}));
  assert.equal(forwarded.length, 4);
  const forbidden = [
    [url('/tasks'), options('POST', {})],
    [url(BASELINE_GETS[0]), options('PATCH', {})],
    [url('/ready'), { ...options(), redirect: 'follow' }],
    [url('/ready'), options('GET', {})],
    ['https://not-approved.example/api/v1/auth/login', options('POST', { login: 'viewer', password: secret })],
    [url('/auth/login'), options('POST', { login: 'admin', password: secret })],
    [url('/auth/login'), options('POST', { login: 'viewer', password: 'wrong-value' })],
    [url('/auth/logout'), options('POST', { mutate: true })],
    [url('/auth/login?other=1'), options('POST', { login: 'viewer', password: secret })],
    [url('/ready'), { ...options(), headers: { Origin: 'https://not-approved.example' } }],
  ];
  for (const [target, init] of forbidden) await assert.rejects(guarded(target, init), /REQUEST_GUARD_REJECTED/);
  assert.equal(forwarded.length, 4);
  assert.equal(JSON.stringify(exchanges).includes(secret), false);
  assert.ok(exchanges.every(item => Object.keys(item).sort().join(',') === 'method,path,status'));
});

test('only fixed diagnostic fields survive failures or checker exceptions', async () => {
  const unsafe = { result: 'FAIL', stage: secret, checks: [{ role: secret, login: 'PASS' }],
    password: secret, response: secret, headers: { cookie: secret } };
  const sanitized = safeResult(unsafe);
  assert.deepEqual(sanitized, { result: 'FAIL', checks: [] });
  const result = await executePreflight({ env, manifest: {}, fetcher: noNetwork,
    checker: async () => { throw Error(secret); } });
  assert.equal(result.result, 'FAIL');
  assert.equal(result.stage, 'PREFLIGHT_EXCEPTION');
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(safeResult({ result: 'PASS' }).result, 'FAIL');
});

test('manifest/checker bytes must match the reviewed handoff pins', () => {
  const checkerBytes = readFileSync(new URL('cloud-qa-access.mjs', import.meta.url));
  const manifestBytes = readFileSync(new URL('release-738f96b2.json', import.meta.url));
  const manifest = verifyPinnedBytes(checkerBytes, manifestBytes);
  assert.equal(manifest.reads.length, 7);
  assert.throws(() => verifyPinnedBytes(Buffer.concat([checkerBytes, Buffer.from('\n')]), manifestBytes), /HANDOFF_DIGEST_MISMATCH/);
  assert.throws(() => verifyPinnedBytes(checkerBytes, Buffer.from('{}')), /HANDOFF_DIGEST_MISMATCH/);
});

test('real pinned checker revokes all four mock sessions after a baseline mismatch without leaking raw data', async () => {
  const bytes = readFileSync(new URL('cloud-qa-access.mjs', import.meta.url));
  const manifestBytes = readFileSync(new URL('release-738f96b2.json', import.meta.url));
  const manifest = verifyPinnedBytes(bytes, manifestBytes);
  const { checkQaAccess } = await import('data:text/javascript;base64,' + bytes.toString('base64'));
  const sessionRoles = new Map(), calls = [];
  const fetcher = async (target, init) => {
    const path = target.slice((PAGES_ORIGIN + '/api/v1').length);
    calls.push({ path, method: init.method });
    if (path === '/ready') return Response.json({ database: 'ok', photos: 'private-storage-configured' });
    if (path === '/auth/login') {
      const body = JSON.parse(init.body), role = body.login.replace('release-738f96b2-', '');
      const cookie = 'session=OFFLINE_' + role;
      sessionRoles.set(cookie, role);
      return Response.json({ data: { csrfToken: 'OFFLINE_CSRF' } }, {
        headers: { 'set-cookie': cookie + '; HttpOnly; Secure; SameSite=Strict' },
      });
    }
    if (path === '/auth/me') return Response.json({ data: { user: { role: sessionRoles.get(init.headers.Cookie) } } });
    if (path === '/auth/logout') return Response.json({ data: {} });
    if (path === BASELINE_GETS[0]) return Response.json({ data: { intentionallyDifferent: secret } });
    throw Error('UNEXPECTED_OFFLINE_REQUEST');
  };
  const result = await executePreflight({ env, checker: checkQaAccess, manifest, fetcher });
  assert.equal(result.result, 'FAIL');
  assert.equal(result.stage, 'baseline-read');
  assert.equal(result.checks.length, 4);
  assert.equal(calls.filter(item => item.path === '/auth/logout').length, 4);
  assert.equal(calls.length, 14);
  assert.ok(calls.filter(item => item.method === 'POST').every(item => ['/auth/login', '/auth/logout'].includes(item.path)));
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes('OFFLINE_CSRF'), false);
  assert.equal(JSON.stringify(result).includes('session='), false);
});
