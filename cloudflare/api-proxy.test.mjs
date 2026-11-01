import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiProxy } from './api-proxy.mjs';

// Reserved .invalid names are test fixtures, not proposed deployment addresses.
const config = { upstreamOrigin: 'https://api.invalid', publicOrigin: 'https://web.invalid' };
const request = (path, init) => new Request(config.publicOrigin + path, init);

test('fixed target preserves encoded path/query, method, body and contract headers', async () => {
  let calls = 0;
  const proxy = createApiProxy(config, async (out, options) => {
    calls++;
    assert.equal(out.url, 'https://api.invalid/api/v1/tasks/a%2Fb?url=https%3A%2F%2Fevil.invalid&x=1&x=2');
    assert.equal(out.method, 'PATCH');
    assert.equal(await out.text(), '{"version":3}');
    assert.equal(out.headers.get('Cookie'), 'gp_v2_session=test-session');
    assert.equal(out.headers.get('Origin'), config.publicOrigin);
    assert.equal(out.headers.get('X-CSRF-Token'), 'test-csrf');
    assert.equal(out.headers.get('Idempotency-Key'), 'test-key');
    assert.equal(out.headers.get('X-Forwarded-Host'), null);
    assert.equal(out.headers.get('X-Forwarded-Port'), null);
    assert.equal(out.headers.get('X-Forwarded-Prefix'), null);
    assert.equal(out.redirect, 'manual');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(options.cf.cacheTtlByStatus, { '100-599': -1 });
    return new Response('{"data":{}}', { status: 201, headers: { 'X-API-Contract': 'v2', 'X-Request-Id': 'request-test', 'X-Data-Mode': 'DEMO' } });
  });
  const result = await proxy(request('/api/v1/tasks/a%2Fb?url=https%3A%2F%2Fevil.invalid&x=1&x=2', {
    method: 'PATCH', body: '{"version":3}', headers: { Cookie: 'gp_v2_session=test-session', Origin: config.publicOrigin,
      'X-CSRF-Token': 'test-csrf', 'Idempotency-Key': 'test-key', 'X-Forwarded-Host': 'evil.invalid',
      'X-Forwarded-Port': '80', 'X-Forwarded-Prefix': '/attacker' },
  }));
  assert.equal(calls, 1);
  assert.equal(result.status, 201);
  for (const [key, value] of [['X-API-Contract', 'v2'], ['X-Request-Id', 'request-test'], ['X-Data-Mode', 'DEMO']])
    assert.equal(result.headers.get(key), value);
});

test('multipart upload and binary photo download retain bytes without JSON conversion', async () => {
  const bytes = Uint8Array.from([0, 255, 3, 13, 10]);
  const form = new FormData(); form.set('taskId', 'task-1'); form.set('file', new Blob([bytes], { type: 'image/png' }), 'test.png');
  const proxy = createApiProxy(config, async out => {
    assert.match(out.headers.get('Content-Type'), /^multipart\/form-data; boundary=/);
    const parsed = await out.formData();
    assert.equal(parsed.get('taskId'), 'task-1');
    assert.deepEqual(new Uint8Array(await parsed.get('file').arrayBuffer()), bytes);
    return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public,max-age=3600' } });
  });
  const response = await proxy(request('/api/v1/uploads', { method: 'POST', body: form }));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal(response.headers.get('Cloudflare-CDN-Cache-Control'), 'no-store');
});

test('multiple cookies retain attributes and Expires commas; failed login status is retained', async () => {
  const cookies = ['gp_v2_session=test; Path=/api/v1; Secure; HttpOnly; SameSite=Strict',
    'second=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/api/v1; Secure'];
  const headers = new Headers(); cookies.forEach(cookie => headers.append('Set-Cookie', cookie));
  const proxy = createApiProxy(config, async () => new Response('{"error":{"code":"AUTH_REQUIRED"}}', { status: 401, headers }));
  const response = await proxy(request('/api/v1/auth/me'));
  assert.equal(response.status, 401);
  assert.deepEqual(response.headers.getSetCookie(), cookies);
});

test('all upstream redirects reject POST once without location, cookies or caching', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    for (const location of ['https://api.invalid/api/v1/auth/me?x=1', null]) {
      let count = 0;
      const proxy = createApiProxy(config, async out => {
        count++;
        assert.equal(out.method, 'POST');
        assert.equal(out.redirect, 'manual');
        assert.equal(await out.text(), '{}');
        const headers = new Headers({ 'Set-Cookie': 'gp_v2_session=redirect; Path=/api/v1; Secure', 'Cache-Control': 'public, max-age=3600' });
        if (location) headers.set('Location', location);
        return new Response('upstream redirect body', { status, headers });
      });
      const response = await proxy(request('/api/v1/auth/login', { method: 'POST', body: '{}' }));
      assert.equal(count, 1); assert.equal(response.status, 502);
      assert.equal(response.headers.get('Location'), null);
      assert.deepEqual(response.headers.getSetCookie(), []);
      assert.equal(response.headers.get('Cache-Control'), 'no-store, private');
      assert.equal(response.headers.get('CDN-Cache-Control'), 'no-store');
      assert.equal(response.headers.get('Cloudflare-CDN-Cache-Control'), 'no-store');
      assert.deepEqual(await response.json(), { error: { code: 'PROXY_REDIRECT_REJECTED' } });
    }
  }
});

test('redirect failure does not wait for an upstream body that stalls during cancellation', { timeout: 1000 }, async () => {
  let cancelled = false, calls = 0;
  const proxy = createApiProxy(config, async () => {
    calls++;
    return new Response(new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } }), {
      status: 307, headers: { Location: '/api/v1/evidence' },
    });
  });
  const response = await proxy(request('/api/v1/evidence', { method: 'POST', body: '{}' }));
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: { code: 'PROXY_REDIRECT_REJECTED' } });
});

test('external, HTTP, credential-bearing and non-API redirects fail closed', async () => {
  for (const location of ['https://evil.invalid/api/v1/x', 'http://api.invalid/api/v1/x', 'https://secret@api.invalid/api/v1/x', '/login']) {
    let calls = 0;
    const proxy = createApiProxy(config, async () => { calls++; return new Response(null, { status: 307, headers: { Location: location } }); });
    const response = await proxy(request('/api/v1/uploads', { method: 'POST', body: 'private fixture' }));
    assert.equal(calls, 1); assert.equal(response.status, 502);
    assert.equal(response.headers.get('Location'), null);
    assert.deepEqual(await response.json(), { error: { code: 'PROXY_REDIRECT_REJECTED' } });
  }
});

test('cold-start HTML failures preserve status and body without replay or mock fallback', async () => {
  for (const status of [502, 503]) {
    let calls = 0;
    const body = '<!doctype html><p>Service is starting</p>';
    const proxy = createApiProxy(config, async () => {
      calls++;
      return new Response(body, { status, headers: { 'Content-Type': 'text/html', 'Retry-After': '5' } });
    });
    const response = await proxy(request('/api/v1/resources'));
    assert.equal(calls, 1);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Content-Type'), 'text/html');
    assert.equal(response.headers.get('Retry-After'), '5');
    assert.equal(response.headers.get('Cache-Control'), 'no-store, private');
    assert.equal(await response.text(), body);
  }
});

test('static resources bypass proxy and unexpected public hosts cannot reach upstream', async () => {
  let calls = 0;
  const proxy = createApiProxy(config, async () => { calls++; return new Response(); });
  for (const path of ['/', '/assets/main.js', '/health', '/api-docs/']) assert.equal(await proxy(request(path)), null);
  assert.equal((await proxy(new Request('https://evil.invalid/api/v1/auth/me'))).status, 421);
  assert.equal(calls, 0);
});

test('invalid configuration cannot become an arbitrary or insecure origin', () => {
  for (const upstreamOrigin of ['http://api.invalid', 'https://api.invalid/path', 'https://x:secret@api.invalid', 'https://api.invalid?url=x', config.publicOrigin])
    assert.throws(() => createApiProxy({ ...config, upstreamOrigin }), TypeError);
  assert.throws(() => createApiProxy({ ...config, timeoutMs: Infinity }), TypeError);
});

test('timeout and connection failure never replay a mutation or disclose exception data', async () => {
  let calls = 0;
  const proxy = createApiProxy({ ...config, timeoutMs: 5 }, async out => {
    calls++;
    return new Promise((_, reject) => out.signal.addEventListener('abort', () => reject(new Error('sensitive fixture')), { once: true }));
  });
  const response = await proxy(request('/api/v1/uploads', { method: 'POST', body: 'private fixture' }));
  assert.equal(calls, 1); assert.equal(response.status, 504);
  assert.equal((await response.text()).includes('sensitive'), false);
  const failed = createApiProxy(config, async () => { throw new Error('cookie=private fixture'); });
  const failedResponse = await failed(request('/api/v1/auth/me'));
  assert.deepEqual(await failedResponse.json(), { error: { code: 'PROXY_UNAVAILABLE' } });
});

test('client cancellation reaches the upstream request', async () => {
  const controller = new AbortController();
  let forwarded;
  const proxy = createApiProxy(config, async out => {
    forwarded = out.signal;
    return new Promise((_, reject) => out.signal.addEventListener('abort', () => reject(out.signal.reason), { once: true }));
  });
  const pending = proxy(request('/api/v1/auth/me', { signal: controller.signal }));
  controller.abort();
  await pending;
  assert.equal(forwarded.aborted, true);
});

test('an already cancelled mutation never reaches the upstream transport', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const proxy = createApiProxy(config, async () => { calls++; return new Response(); });
  const response = await proxy(request('/api/v1/uploads', {
    method: 'POST', body: 'private fixture', signal: controller.signal,
  }));
  assert.equal(calls, 0);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: { code: 'PROXY_UNAVAILABLE' } });
});

test('hop-by-hop headers are stripped even when Connection contains malformed options', async () => {
  const proxy = createApiProxy(config, async out => {
    assert.equal(out.headers.get('Connection'), null);
    assert.equal(out.headers.get('X-Request-Hop'), null);
    assert.equal(out.headers.get('X-CSRF-Token'), 'test-csrf');
    return new Response('ok', { headers: {
      Connection: 'X-Response-Hop, @invalid, malformed option',
      'X-Response-Hop': 'private-hop', 'X-API-Contract': 'v2',
    } });
  });
  const response = await proxy(request('/api/v1/auth/me', { headers: {
    Connection: 'X-Request-Hop, @invalid, malformed option',
    'X-Request-Hop': 'private-hop', 'X-CSRF-Token': 'test-csrf',
  } }));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok');
  assert.equal(response.headers.get('Connection'), null);
  assert.equal(response.headers.get('X-Response-Hop'), null);
  assert.equal(response.headers.get('X-API-Contract'), 'v2');
});
