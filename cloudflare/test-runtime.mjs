// Real local workerd via Miniflare; all outbound network is mocked, no provider calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { UPSTREAM_ORIGIN, RUNTIME_COMPATIBILITY } from './pages-worker.mjs';

const { values } = parseArgs({ options: { deps: { type: 'string' }, dist: { type: 'string' }, 'public-origin': { type: 'string' } } });
if (!values.deps || !values.dist || !values['public-origin']) throw Error('Use --deps <isolated-miniflare-directory> --dist <built-dist> --public-origin <exact-built-origin>');
const require = createRequire(join(resolve(values.deps), 'package.json'));
const { Miniflare } = require('miniflare');
const origin = values['public-origin'];
const expectations = [];
const upstream = { intercept(request) { return { reply(status, body, options = {}) { expectations.push({ request, status, body, options }); } }; } };
// Miniflare's outboundService runs in Node; the unmodified bundle still runs in
// real workerd. Every global fetch must match an explicit synthetic expectation.
async function outboundService(request) {
  const next = expectations.shift();
  assert.ok(next, 'Unexpected outbound request (including any automatic retry)');
  const url = new URL(request.url);
  assert.equal(url.origin, UPSTREAM_ORIGIN);
  assert.equal(url.pathname + url.search, next.request.path);
  assert.equal(request.method, next.request.method);
  if (next.request.body !== undefined) assert.equal(await request.text(), next.request.body);
  for (const [key, value] of Object.entries(next.request.headers ?? {})) assert.equal(request.headers.get(key), value);
  assert.equal(request.headers.get('X-Forwarded-Host'), null);
  const headers = new Headers();
  for (const [key, value] of Object.entries(next.options.headers ?? {}))
    for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item);
  return new Response(next.body, { status: next.status, headers });
}
let assetCalls = 0;
const mf = new Miniflare({ modules: true, script: await readFile(join(resolve(values.dist), '_worker.js'), 'utf8'),
  compatibilityDate: RUNTIME_COMPATIBILITY.date, compatibilityFlags: RUNTIME_COMPATIBILITY.flags,
  cf: false, host: '127.0.0.1', port: 0, outboundService,
  serviceBindings: { ASSETS: request => { assetCalls++; return new Response('static:' + new URL(request.url).pathname); } },
});
const checks = [];
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
try {
  await mf.ready;
  await check('static fallback uses ASSETS without upstream', async () => {
    const response = await mf.dispatchFetch(origin + '/assets/app.js');
    assert.equal(await response.text(), 'static:/assets/app.js'); assert.equal(assetCalls, 1);
  });
  await check('wrong API origin fails closed', async () => {
    const response = await mf.dispatchFetch('https://unapproved.invalid/api/v1/auth/me');
    assert.equal(response.status, 421); assert.equal(assetCalls, 1);
  });
  const cookies = ['gp_v2_session=synthetic; Secure; HttpOnly; SameSite=Strict; Path=/api/v1',
    'second=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/api/v1; Secure'];
  await check('session cookies retain separate headers and attributes', async () => {
    upstream.intercept({ path: '/api/v1/auth/login', method: 'POST', body: '{}' })
      .reply(200, '{"data":{}}', { headers: { 'Set-Cookie': cookies, 'Content-Type': 'application/json' } });
    const response = await mf.dispatchFetch(origin + '/api/v1/auth/login', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    if (response.status !== 200) throw Error('Synthetic runtime login failed: ' + response.status + ' ' + await response.text());
    assert.deepEqual(response.headers.getSetCookie(), cookies);
    assert.equal(response.headers.get('Cache-Control'), 'no-store, private');
  });
  await check('POST multipart bytes, Origin, Cookie, CSRF and idempotency reach fixed upstream', async () => {
    const boundary = 'synthetic-boundary';
    const body = '--synthetic-boundary\r\nContent-Disposition: form-data; name="taskId"\r\n\r\nfixture\r\n--synthetic-boundary\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\nPNG fixture\r\n--synthetic-boundary--\r\n';
    upstream.intercept({ path: '/api/v1/uploads', method: 'POST', body,
      headers: { cookie: 'gp_v2_session=synthetic', origin, 'x-csrf-token': 'synthetic-csrf', 'idempotency-key': 'synthetic-key', 'content-type': 'multipart/form-data; boundary=' + boundary } })
      .reply(201, '{"data":{"id":"fixture"}}', { headers: { 'Content-Type': 'application/json', 'Idempotency-Replayed': 'false' } });
    const response = await mf.dispatchFetch(origin + '/api/v1/uploads', { method: 'POST', body, headers: {
      Cookie: 'gp_v2_session=synthetic', Origin: origin, 'X-CSRF-Token': 'synthetic-csrf', 'Idempotency-Key': 'synthetic-key',
      'Content-Type': 'multipart/form-data; boundary=' + boundary, 'X-Forwarded-Host': 'untrusted.invalid',
    } });
    assert.equal(response.status, 201); assert.equal(response.headers.get('Idempotency-Replayed'), 'false');
    assert.equal((await response.json()).data.id, 'fixture');
  });
  await check('private binary photo keeps bytes and no-store', async () => {
    const bytes = Buffer.from([0, 255, 13, 10, 99]);
    upstream.intercept({ path: '/api/v1/uploads/fixture', method: 'GET' }).reply(200, bytes, { headers: { 'Content-Type': 'image/webp' } });
    const response = await mf.dispatchFetch(origin + '/api/v1/uploads/fixture');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get('Content-Type'), 'image/webp');
    assert.equal(response.headers.get('Cloudflare-CDN-Cache-Control'), 'no-store');
  });
  await check('all redirect statuses reject one POST without Location or cookies', async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      upstream.intercept({ path: '/api/v1/reports/fixture/review', method: 'POST', body: '{}' })
        .reply(status, '', { headers: { Location: '/api/v1/auth/me', 'Set-Cookie': cookies } });
      const response = await mf.dispatchFetch(origin + '/api/v1/reports/fixture/review', { method: 'POST', body: '{}' });
      assert.equal(response.status, 502); assert.equal(response.headers.get('Location'), null);
      assert.deepEqual(response.headers.getSetCookie(), []);
      assert.equal((await response.json()).error.code, 'PROXY_REDIRECT_REJECTED');
    }
  });
  await check('HTML cold-start failure and 503 remain errors without static fallback', async () => {
    upstream.intercept({ path: '/api/v1/ready', method: 'GET' }).reply(503, '<p>Starting</p>', { headers: { 'Content-Type': 'text/html' } });
    const response = await mf.dispatchFetch(origin + '/api/v1/ready');
    assert.equal(response.status, 503); assert.equal(await response.text(), '<p>Starting</p>'); assert.equal(assetCalls, 1);
  });
  assert.equal(expectations.length, 0);
  console.log(JSON.stringify({ runtime: 'local Miniflare/workerd', miniflare: require('miniflare/package.json').version,
    compatibility: RUNTIME_COMPATIBILITY, checks: checks.length, passed: checks.length,
    providerRequests: 0, publicDeploymentAcceptance: false }));
} finally { await mf.dispose(); }
