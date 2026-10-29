import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { fixture } from './helpers.js';
import { seedV2, DEMO_PASSWORD, demoAccounts } from '../src/v2/seed.js';
import { seedTz } from '../src/tz/seed.js';
import { seedMunicipal } from '../src/municipal/data.js';

const geometry = { type: 'Polygon', coordinates: [[[76.95, 52.286], [76.9509, 52.286], [76.9509, 52.2866], [76.95, 52.2866], [76.95, 52.286]]] };
async function setup(t: TestContext, municipal = true) {
  const f = await fixture(t);
  await seedV2(f.store); seedTz(f.store);
  if (municipal) await seedMunicipal(f.store);
  const sessions = new Map<string, { cookie: string; csrf: string }>();
  let seq = 0;
  async function login(user: string) {
    const r = await fetch(f.base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: user, password: DEMO_PASSWORD }), signal: AbortSignal.timeout(10000) });
    const b = await r.json(); assert.equal(r.status, 200, `Login ${user}`);
    sessions.set(user, { cookie: r.headers.get('set-cookie')!.split(';')[0]!, csrf: b.data.csrfToken });
    return b.data.user;
  }
  async function call(path: string, method = 'GET', body?: unknown, user: string | null = 'coordinator', headers: Record<string, string> = {}) {
    if (user && !sessions.has(user)) await login(user);
    const ss = user ? sessions.get(user) : undefined;
    const r = await fetch(f.base + '/api/v1' + path, { method,
      headers: { ...(ss ? { Cookie: ss.cookie, 'X-CSRF-Token': ss.csrf } : {}), 'Content-Type': 'application/json', 'Idempotency-Key': `release-${++seq}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    return { status: r.status, body: await r.json(), headers: r.headers };
  }
  const spec = await (await fetch(f.base + '/api/v1/openapi.json')).json();
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  function validate(path: string, status: number, body: unknown) {
    const schema = spec.paths[path].post.responses[status].content['application/json'].schema;
    const check = ajv.compile({ ...schema, components: spec.components });
    assert(check(body), JSON.stringify(check.errors));
  }
  return { ...f, login, call, validate, spec };
}

test('Release: drawn zone → real assistant router preserves selected context, OSM, history, view and ID validation', async t => {
  const f = await setup(t);
  assert(f.spec.paths['/zones'].post.parameters.some((p: any) => p.in === 'header' && p.name === 'Idempotency-Key' && p.required));
  assert.equal((await f.call('/zones', 'POST', { geometry }, 'coordinator', { 'Idempotency-Key': '' })).status, 400);
  const created = await f.call('/zones', 'POST', { name: 'Synthetic release zone', geometry }, 'coordinator', { 'Idempotency-Key': 'draw-zone' });
  assert.equal(created.status, 201); f.validate('/zones', 201, created.body);
  const site = created.body.data;
  assert.match(site.id, /^site-user-/);
  const repeatedZone = await f.call('/zones', 'POST', { name: 'Synthetic release zone', geometry }, 'coordinator', { 'Idempotency-Key': 'draw-zone' });
  assert.equal(repeatedZone.body.data.id, site.id); assert.equal(repeatedZone.headers.get('idempotency-replayed'), 'true');
  assert(f.store.get("SELECT id FROM v2_documents WHERE kind='site' AND id=?", site.id));
  for (let i = 0; i < 2; i++) {
    const r = await f.call('/assistant', 'POST', { message: 'Подбери растения', siteId: site.id,
      history: [{ role: 'user', text: 'Какие растения посадить?' }], view: { lat: 52.28, lng: 76.94 } });
    assert.equal(r.status, 200, JSON.stringify(r.body)); f.validate('/assistant', 200, r.body);
    assert.equal(r.body.data.method, 'rules'); assert.equal(r.body.data.intent, 'select');
    assert.equal(r.body.data.zones[0].id, site.id); assert.equal(r.body.data.zones[0].name, site.name);
    assert(r.body.data.text.includes(site.name));
  }
  const history = await f.call('/assistant/history');
  assert.equal(history.body.data.length, 2); assert(history.body.data.every((r: any) => r.zones.includes(site.id)));
  assert.equal((await f.call('/assistant/history', 'GET', undefined, 'admin')).body.data.length, 0, 'History is user-scoped');
  const map = await f.call('/assistant', 'POST', { message: 'Подбери растения здесь', view: site.centroid });
  assert.equal(map.status, 200); assert.equal(map.body.data.zones[0].id, site.id);
  const osmId = String(f.store.get("SELECT id FROM v2_documents WHERE kind='site' AND id LIKE 'site-osm-%' ORDER BY id LIMIT 1")!.id);
  const osm = await f.call('/assistant', 'POST', { message: 'Подбери растения', siteId: osmId });
  assert.equal(osm.status, 200); assert.equal(osm.body.data.zones[0].id, osmId);
  for (const siteId of ['site-does-not-exist', site.contextId]) {
    const missing = await f.call('/assistant', 'POST', { message: 'Подбери растения', siteId });
    assert.equal(missing.status, 404); assert.equal(missing.body.error.code, 'NOT_FOUND'); f.validate('/assistant', 404, missing.body);
  }
  assert.equal((await f.call('/assistant/history')).body.data.length, 4, 'Invalid IDs must not write history');
});

test('Release: assistant validates access/existence without forcing an unrelated area calculation', async t => {
  const f = await setup(t);
  const preview = await f.call('/imports/preview', 'POST', { format: 'csv', content: 'name,lat,lng\nSynthetic point,52.2837,76.9457', source: 'Release synthetic fixture', dataClass: 'demo' });
  assert.equal(preview.status, 200);
  const importId = preview.body.data.id;
  assert.equal((await f.call(`/imports/${importId}`, 'GET', undefined, 'admin')).status, 404, 'Private import remains owner-scoped');
  assert.equal((await f.call('/assistant', 'POST', { message: 'Нормы озеленения', siteId: importId }, 'admin')).status, 404);
  assert.equal((await f.call(`/imports/${importId}/commit`, 'POST', { acknowledgeWarnings: true })).status, 200);
  const point = (await f.call('/municipal/sites')).body.data.find((s: any) => s.name === 'Synthetic point');
  assert(point);
  assert.equal((await f.call(`/zones/${point.id}/analysis`, 'POST', { options: {} })).status, 422, 'Cost calculations still require a measured area');
  const question = { message: 'Нормы озеленения Павлодара', siteId: point.id };
  const answer = await f.call('/assistant', 'POST', question);
  assert.equal(answer.status, 200, JSON.stringify(answer.body)); f.validate('/assistant', 200, answer.body);
  assert.equal(answer.body.data.method, 'rules'); assert(answer.body.data.sources.length > 0);
  assert.equal((await f.call('/assistant', 'POST', question, null)).status, 401);
  assert.equal((await f.call('/assistant', 'POST', question, 'coordinator', { 'X-CSRF-Token': '' })).status, 403);
  for (const user of ['worker1', 'worker3', 'foreman1']) {
    assert.equal((await f.call('/assistant', 'POST', question, user)).status, 403);
    assert.equal((await f.call('/assistant/history', 'GET', undefined, user)).status, 403);
  }
  assert.equal((await f.call('/zones', 'POST', { geometry }, 'viewer')).status, 403);
  assert.equal((await f.call('/assistant', 'POST', question, 'viewer')).status, 200, 'Viewer can read reference answers');
});

test('Release: municipal seed preserves old credentials/sessions and exposes five canonical roles', async t => {
  const f = await setup(t, false);
  const before = f.store.all('SELECT * FROM v2_users ORDER BY id');
  assert.equal(before.length, 9);
  for (const [id, login, role] of demoAccounts) {
    const user = await f.login(login); assert.equal(user.id, id); assert.equal(user.role, role);
  }
  await seedMunicipal(f.store); await seedV2(f.store); await seedMunicipal(f.store);
  assert.equal(f.store.get('SELECT count(*) n FROM v2_users')!.n, 10);
  for (const row of before) {
    assert(JSON.stringify(f.store.get('SELECT * FROM v2_users WHERE id=?', row.id!)) === JSON.stringify(row), 'Seed must not rewrite an existing user or password hash');
    assert.equal((await f.call('/auth/me', 'GET', undefined, String(row.login))).status, 200, 'Pre-seed session remains valid');
  }
  const alias = await f.login('specialist'); assert.equal(alias.role, 'coordinator');
  assert.equal(f.store.get('SELECT role FROM v2_users WHERE id=?', alias.id)!.role, 'coordinator');
  assert.equal(f.store.get("SELECT count(*) n FROM municipal_roles WHERE role='specialist'")!.n, 0, 'Seed must not create a sixth role');
  // Legacy v4 alias rows remain readable without rewriting old databases or passwords.
  f.store.run("INSERT INTO municipal_roles VALUES (?,'specialist')", alias.id);
  assert.equal((await f.call('/auth/me', 'GET', undefined, 'specialist')).body.data.user.role, 'coordinator');
  const snapshot = (await f.call('/integration/snapshot')).body.data;
  assert.equal(snapshot.workers.find((u: any) => u.id === alias.id).role, 'coordinator', 'Planning must normalize the same legacy role as login');
  assert.equal((await f.call('/zones', 'POST', { geometry }, 'specialist')).status, 201);
  const users = await f.call('/users', 'GET', undefined, 'admin');
  assert.deepEqual([...new Set(users.body.data.map((u: any) => u.role))].sort(), ['admin', 'coordinator', 'foreman', 'viewer', 'worker']);
  const rates = (await f.call('/rates')).body.data;
  const patch = { key: 'price.tree', value: 19030, source: 'Synthetic release check', expectedVersion: rates.version };
  for (const user of ['viewer', 'coordinator', 'specialist', 'worker1', 'foreman1'])
    assert.equal((await f.call('/rates', 'PATCH', patch, user)).status, 403);
  assert.equal((await f.call('/rates', 'PATCH', patch, 'admin')).status, 200);
});
