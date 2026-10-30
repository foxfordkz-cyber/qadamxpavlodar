import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiConnection, isConnectionFailure, isUnavailableStatus } from '../src/shared/api/connection';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const identity = { data: { user: { id: 'worker-1', displayName: 'Worker', role: 'worker' }, csrfToken: 'not-stored-by-readiness' } };
const authRequired = () => json(401, { error: { code: 'AUTH_REQUIRED', message: 'Sign in', requestId: 'fixture' } });
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

for (const authenticated of [true, false]) test(`readiness accepts the current contract (${authenticated ? 'identity' : 'auth required'}) using only same-origin GET`, async () => {
  let calls = 0;
  const connection = createApiConnection({ fetchImpl: (async (url, options) => {
    calls++;
    assert.equal(url, '/api/v1/auth/me');
    assert.equal(options?.method, 'GET');
    assert.equal(options?.body, undefined);
    assert.equal(options?.credentials, 'same-origin');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).has('Idempotency-Key'), false);
    return authenticated ? json(200, identity) : authRequired();
  }) as typeof fetch });
  assert.equal(await connection.start(), true);
  assert.equal(calls, 1);
  assert.deepEqual(connection.getSnapshot(), { phase: 'ready', attempt: 1, maxAttempts: 6 });
  assert.equal(JSON.stringify(connection.getSnapshot()).includes('not-stored-by-readiness'), false);
});

test('HTML fallback, empty identity and unrelated 401 do not claim readiness; attempts stop at the bound', async () => {
  const responses = [new Response('<html>SPA fallback</html>', { headers: { 'Content-Type': 'text/html' } }),
    json(200, { data: [] }), json(401, { error: { code: 'INVALID_CREDENTIALS' } })];
  const methods: string[] = [];
  const connection = createApiConnection({ retryDelaysMs: [0, 0], fetchImpl: (async (_url, options) => {
    methods.push(options!.method!);
    return responses.shift()!;
  }) as typeof fetch });
  assert.equal(await connection.start(), false);
  assert.deepEqual(connection.getSnapshot(), { phase: 'unavailable', attempt: 3, maxAttempts: 3 });
  await tick();
  assert.deepEqual(methods, ['GET', 'GET', 'GET']);
});

test('cold server failures can recover; no application writes are replayed', async () => {
  let calls = 0;
  const connection = createApiConnection({ retryDelaysMs: [0, 0], fetchImpl: (async (_url, options) => {
    assert.equal(options!.method, 'GET');
    if (++calls === 1) throw new TypeError('Network unavailable');
    return calls === 2 ? json(503, { error: { code: 'DATABASE_UNAVAILABLE' } }) : authRequired();
  }) as typeof fetch });
  assert.equal(await connection.start(), true);
  assert.equal(calls, 3);
});

test('cancel aborts the pending probe and ignores a late successful response', async () => {
  let finish!: (response: Response) => void;
  let signal!: AbortSignal;
  let calls = 0;
  const connection = createApiConnection({ fetchImpl: (async (_url, options) => {
    calls++; signal = options!.signal!;
    return new Promise<Response>(resolve => { finish = resolve; });
  }) as typeof fetch });
  const pending = connection.start();
  connection.cancel();
  assert.equal(signal.aborted, true);
  assert.equal(await pending, false);
  finish(json(200, identity));
  await tick();
  assert.equal(connection.getSnapshot().phase, 'cancelled');
  assert.equal(calls, 1);
});

test('cancel during a retry delay prevents the next request', async () => {
  let calls = 0;
  const connection = createApiConnection({ retryDelaysMs: [5_000], fetchImpl: (async () => {
    calls++; return json(503, {});
  }) as typeof fetch });
  const pending = connection.start();
  await tick();
  connection.cancel();
  assert.equal(await pending, false);
  assert.equal(calls, 1);
  assert.equal(connection.getSnapshot().phase, 'cancelled');
});

test('an unresponsive fetch is bounded and can be manually retried', async () => {
  let calls = 0;
  const signals: AbortSignal[] = [];
  const connection = createApiConnection({ timeoutMs: 5, retryDelaysMs: [], fetchImpl: (async (_url, options) => {
    signals.push(options!.signal!);
    if (++calls === 1) return new Promise<Response>(() => {});
    return authRequired();
  }) as typeof fetch });
  assert.equal(await connection.start(), false);
  assert.equal(signals[0].aborted, true);
  assert.equal(connection.getSnapshot().phase, 'unavailable');
  assert.equal(await connection.start(), true);
  assert.equal(calls, 2);
});

test('a replacement run cancels the old probe without publishing its late response', async () => {
  let finish!: (response: Response) => void;
  let calls = 0;
  const connection = createApiConnection({ retryDelaysMs: [], fetchImpl: (async () => {
    if (++calls === 1) return new Promise<Response>(resolve => { finish = resolve; });
    return authRequired();
  }) as typeof fetch });
  const first = connection.start();
  assert.equal(await connection.start(), true);
  assert.equal(await first, false);
  finish(json(503, {}));
  await tick();
  assert.equal(connection.getSnapshot().phase, 'ready');
  assert.equal(calls, 2);
});

test('only network and gateway unavailable statuses trigger recovery, not auth or validation errors', () => {
  for (const status of [0, 502, 503, 504]) {
    assert.equal(isUnavailableStatus(status), true);
    assert.equal(isConnectionFailure({ status }), true);
  }
  for (const status of [200, 400, 401, 403, 404, 409, 422, 429]) {
    assert.equal(isUnavailableStatus(status), false);
    assert.equal(isConnectionFailure({ status }), false);
  }
  assert.equal(isConnectionFailure(null), false);
  assert.throws(() => createApiConnection({ retryDelaysMs: Array(10).fill(0) }), /bounds/);
});
