import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { seedV2, DEMO_PASSWORD } from '../src/v2/seed.js';
import { seedTz } from '../src/tz/seed.js';
import type { Json } from '../src/tz/shared.js';
// Same tsx boundary as src/tz/shared.ts: browser modules have a separate TS configuration.
const load = (path: string): Promise<Json> => import(new URL('../../web/src/shared/' + path, import.meta.url).href);
const [{ createApi }, { createV2CompatTransport }, { loadMemo }] = await Promise.all([
  load('api/api.ts'), load('api/v2compat.ts'), load('export/loadMemo.ts'),
]);

test('api: memo snapshot uses authenticated V2-compatible zone analysis, catalog, rates and evidence', async t => {
  const f = await fixture(t); await seedV2(f.store); seedTz(f.store);
  const login = await fetch(f.base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'coordinator', password: DEMO_PASSWORD }) });
  assert.equal(login.status, 200); const session = (await login.json()).data;
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const transport = { kind: 'api', async request(method: string, path: string, options: { query?: Record<string, unknown>; body?: unknown } = {}) {
    const url = new URL(f.base + '/api/v1' + path);
    for (const [k, v] of Object.entries(options.query ?? {})) if (v != null) url.searchParams.set(k, String(v));
    const r = await fetch(url, { method, headers: { Cookie: cookie, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    const body = await r.json(); assert.ok(r.ok, `${method} ${path}: ${r.status}`); return body;
  } };
  const api = createApi(createV2CompatTransport(transport)); const sites: { id: string }[] = (await api.sites()).data.filter((s: { id: string }) => s.id.startsWith('site-osm-')).slice(0, 2);
  const input = await loadMemo(api, sites.map(s => s.id), { variant: 'econom', careYears: 3 }, 'api');
  assert.equal(input.zones.length, 2); assert.ok(input.evidence.length > 0);
  const direct = await api.zoneAnalysis(sites[0]!.id, { variant: 'econom', careYears: 3 });
  assert.deepEqual(input.zones[0].analysis, direct);
  assert.equal(input.source, 'api'); assert.ok(input.rates.length > 0 && input.species.length > 0);
});
