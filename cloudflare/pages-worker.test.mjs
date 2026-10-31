import test from 'node:test';
import assert from 'node:assert/strict';
import { createPagesWorker, UPSTREAM_ORIGIN, API_ROUTES } from './pages-worker.mjs';

const publicOrigin = 'https://green-pavlodar-api.pages.dev';
test('Pages adapter serves static assets without invoking upstream', async () => {
  let upstream = 0, assets = 0;
  const worker = createPagesWorker(publicOrigin, async () => { upstream++; throw Error('unexpected'); });
  const env = { ASSETS: { fetch: async request => { assets++; return new Response(new URL(request.url).pathname); } } };
  for (const path of ['/', '/assets/app.js', '/api-docs']) {
    const response = await worker.fetch(new Request(publicOrigin + path), env);
    assert.equal(await response.text(), path);
  }
  assert.equal(assets, 3); assert.equal(upstream, 0);
  assert.deepEqual(API_ROUTES, { version: 1, include: ['/api', '/api/*'], exclude: [] });
});

test('Pages API routes cannot fall back to assets or choose an upstream from browser input', async () => {
  const seen = [];
  const worker = createPagesWorker(publicOrigin, async request => {
    seen.push(request.url); return new Response('unavailable', { status: 503 });
  });
  const env = { ASSETS: { fetch: () => { throw Error('API must not become static HTML'); } } };
  for (const path of ['/api', '/api/v1/ready?upstream=https%3A%2F%2Fevil.invalid']) {
    const response = await worker.fetch(new Request(publicOrigin + path), env);
    assert.equal(response.status, 503);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
  }
  assert.deepEqual(seen, [UPSTREAM_ORIGIN + '/api', UPSTREAM_ORIGIN + '/api/v1/ready?upstream=https%3A%2F%2Fevil.invalid']);
  const wrongOrigin = await worker.fetch(new Request('https://preview.invalid/api/v1/auth/me'), env);
  assert.equal(wrongOrigin.status, 421); assert.equal(seen.length, 2);
});
