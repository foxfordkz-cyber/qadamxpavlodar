import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { requestJSON } from '../../../apps/web/src/features/worker/gateway.mjs';
import { createContractGateway } from '../../../apps/web/src/features/worker/contract-v2.mjs';
import { WorkerWorkflow } from '../../../apps/web/src/features/worker/workflow.mjs';
import { MemoryDrafts } from '../../../apps/web/src/features/worker/drafts.mjs';
import { createDemoSource, DEMO_SCOPE } from '../demo/source.mjs';

const pending = () => new Promise(() => {});
const timedOut = error => error.code === 'WORKER_REQUEST_TIMEOUT' && error.status === undefined;
const cancelled = error => error.code === 'WORKER_REQUEST_ABORTED' && error.status === undefined;
async function withFetch(fetcher, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { await run(); } finally { globalThis.fetch = original; }
}

test('worker network: a stalled fetch aborts within the deadline without retrying', async () => {
  let calls = 0, sentSignal;
  const caller = new AbortController();
  await withFetch(async (_url, { signal }) => { calls++; sentSignal = signal; return pending(); }, async () => {
    await assert.rejects(requestJSON('/stalled', { signal: caller.signal, timeoutMs: 10 }), timedOut);
  });
  assert.equal(calls, 1);
  assert.equal(sentSignal.aborted, true);
  assert.equal(caller.signal.aborted, false, 'the gateway must not cancel its caller');
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
});

test('worker network: success and error response bodies remain subject to the deadline', async t => {
  for (const status of [200, 503]) await t.test(String(status), async () => {
    let calls = 0, sentSignal;
    await withFetch(async (_url, { signal }) => {
      calls++; sentSignal = signal;
      return { ok: status === 200, status, json: pending };
    }, async () => {
      await assert.rejects(requestJSON('/body-stalled', { timeoutMs: 10 }), timedOut);
    });
    assert.equal(calls, 1);
    assert.equal(sentSignal.aborted, true);
  });
});

test('worker network: caller cancellation before fetch does not send a request', async () => {
  let calls = 0;
  const caller = new AbortController(); caller.abort();
  await withFetch(async () => { calls++; }, async () => {
    await assert.rejects(requestJSON('/cancelled', { signal: caller.signal, timeoutMs: 10 }), cancelled);
  });
  assert.equal(calls, 0);
});

test('worker network: caller cancellation interrupts response parsing and cleans up its listener', async () => {
  const caller = new AbortController();
  let sentSignal, calls = 0, bodyStarted;
  const started = new Promise(resolve => { bodyStarted = resolve; });
  await withFetch(async (_url, { signal }) => {
    calls++; sentSignal = signal;
    return { ok: true, status: 200, json: () => { bodyStarted(); return pending(); } };
  }, async () => {
    const result = requestJSON('/cancelled-body', { signal: caller.signal, timeoutMs: 1000 });
    await started;
    caller.abort(new Error('Caller-specific detail must not become UI text'));
    await assert.rejects(result, cancelled);
  });
  assert.equal(calls, 1);
  assert.equal(sentSignal.aborted, true);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
});

test('worker network: successful requests clear the timeout and detach caller cancellation', async () => {
  const caller = new AbortController();
  let sentSignal;
  await withFetch(async (_url, { signal }) => {
    sentSignal = signal;
    return { ok: true, status: 200, json: async () => ({ saved: true }) };
  }, async () => {
    assert.deepEqual(await requestJSON('/success', { signal: caller.signal, timeoutMs: 10 }), { saved: true });
  });
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  caller.abort();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(sentSignal.aborted, false);
});

test('worker network: manual retry after an uncertain upload or report keeps the saved operation', async t => {
  for (const stage of ['upload', 'report']) await t.test(stage, async () => {
    const source = createDemoSource({ delayMs: 0 });
    const transport = source.transportFor('demo-worker-1');
    await source.apiFor('demo-worker-1').startTask('GP-104');
    const requests = [];
    let stalled = false;
    await withFetch(async (url, options) => {
      const parsed = new URL(url), path = parsed.pathname;
      const body = options.body instanceof FormData ? options.body : options.body === undefined ? undefined : JSON.parse(options.body);
      requests.push({ path, method: options.method, body: options.body, key: options.headers['Idempotency-Key'] });
      // The fixture commits before losing its response, just as a server may.
      const response = await transport(options.method, path + parsed.search, { body, headers: options.headers });
      const target = options.method === 'POST' && (stage === 'upload' ? path === '/uploads' : path.endsWith('/reports'));
      const loseBody = target && !stalled;
      if (loseBody) stalled = true;
      return { ok: true, status: 200, json: loseBody ? pending : async () => response };
    }, async () => {
      const gateway = createContractGateway({ user: { id: 'demo-worker-1', role: 'worker' }, demo: true,
        request: (method, path, options) => requestJSON(`http://worker.test${path}`, { ...options, method, timeoutMs: 20 }) });
      const workflow = new WorkerWorkflow({ gateway, drafts: new MemoryDrafts(), userId: 'demo-worker-1', scope: DEMO_SCOPE, strictServer: true });
      const draft = await workflow.draft('GP-104');
      const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=', 'base64');
      draft.photo = new File([bytes], 'result.png', { type: 'image/png' });
      draft.note = 'Работа выполнена, нужен осмотр опоры.';
      await workflow.save(draft);
      const operationKey = draft.idempotencyKey;
      await assert.rejects(workflow.send(draft), timedOut);
      const afterFailure = requests.length;
      await new Promise(resolve => setTimeout(resolve, 25));
      assert.equal(requests.length, afterFailure, 'timeout does not automatically resend');
      const recovered = await workflow.draft('GP-104');
      assert.equal(recovered.delivery, 'uncertain');
      assert.equal(recovered.idempotencyKey, operationKey);
      assert.equal(recovered.note, draft.note);
      assert.deepEqual(Buffer.from(await recovered.photo.arrayBuffer()), bytes);
      assert.deepEqual(recovered.frozen, draft.frozen);
      assert.equal(stage === 'upload' ? recovered.upload === null : !!recovered.upload, true);
      assert.equal((await workflow.send(recovered)).saved, true, 'only the explicit retry completes delivery');
      const writes = requests.filter(request => request.method === 'POST' && (stage === 'upload' ? request.path === '/uploads' : request.path.endsWith('/reports')));
      assert.equal(writes.length, 2);
      assert.equal(writes[0].key, writes[1].key);
      if (stage === 'report') assert.equal(writes[0].body, writes[1].body, 'serialized report payload is identical');
      else {
        assert.equal(writes[0].body.get('taskId'), writes[1].body.get('taskId'));
        assert.deepEqual(Buffer.from(await writes[0].body.get('file').arrayBuffer()), Buffer.from(await writes[1].body.get('file').arrayBuffer()));
      }
      assert.equal(source.snapshot().calls.uploads, 1);
      assert.equal(source.snapshot().calls.reports, 1);
      assert.equal((await workflow.pending()).length, 0);
    });
  });
});
