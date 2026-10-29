import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fixture } from './helpers.js';
import { Store } from '../src/db.js';
import { schema } from '../src/schema.js';
import { migration2 } from '../src/migrations.js';
import { migration3 } from '../src/v2/migration.js';
import { seedV2, DEMO_PASSWORD } from '../src/v2/seed.js';
import { seedTz } from '../src/tz/seed.js';
import { web } from '../src/tz/shared.js';
import { cacheSize } from '../src/tz/data.js';
import { insertDoc } from '../src/v2/core.js';

test('care schedule: shared result, registered plants only, validation, roles and V2 task creation', async t => {
  const f = await tzFixture(t);
  const created = await f.call('/zones', 'POST', 'coordinator', { name: 'Care test', geometry: square(76.950, 52.286, 0.0009) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const zone = created.body.data.id;
  const empty = await f.call(`/zones/${zone}/care-schedule`, 'POST', 'viewer', { months: 12, crewVisitsPerMonth: 0, budgetKzt: 100 }, null);
  assert.equal(empty.status, 200, JSON.stringify(empty.body));
  assert.equal(empty.body.data.tasks.length, 12);
  assert.ok(empty.body.data.tasks.every((x: any) => x.objectType === 'candidate_site' && x.action === 'inspect'));
  assert.ok(empty.body.data.warnings.some((w: string) => w.includes('нет зарегистрированных')));
  for (const body of [{ months: 0 }, { months: 13 }, { months: 1.5 }, { months: 1, budgetKzt: -1 }, { months: 1, extra: 1 }]) {
    assert.equal((await f.call(`/zones/${zone}/care-schedule`, 'POST', 'coordinator', body, null)).status, 400);
  }
  assert.equal((await f.call(`/zones/${zone}/care-schedule`, 'POST', 'worker1', { months: 1 }, null)).status, 403);
  assert.equal((await f.call('/zones/missing/care-schedule', 'POST', 'coordinator', { months: 1 }, null)).status, 404);
  const catalog = (await f.call('/species')).body.data, sp = catalog.find((s: any) => s.form === 'tree');
  const plant = insertDoc(f.store, 'plant', { id: 'care-registered', name: 'Care tree', kind: 'tree', species: sp.latin, lat: 52.2862, lng: 76.9504, condition: 'unknown', evidenceIds: ['demo-v2-evidence'], isDemo: true, version: 1 });
  const input = { months: 12 }, result = await f.call(`/zones/${zone}/care-schedule`, 'POST', 'coordinator', input, null);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const site = web.siteFromV2((await f.call(`/sites/${zone}`)).body.data), rates = (await f.call('/rates')).body.data.rates;
  assert.deepEqual(result.body.data, web.buildCareSchedule(site, [plant], catalog, web.ratesMap(rates), input));
  assert.ok(result.body.data.tasks.every((x: any) => x.objectType === 'plant' && x.objectId === plant.id));
  const water = result.body.data.tasks.find((x: any) => x.action === 'water');
  assert.ok(water);
  const { id: _id, objectName: _name, dataClass: _class, estimatedCostKzt: _cost, ...taskBody } = water;
  const saved = await f.call('/tasks', 'POST', 'coordinator', taskBody, 'care-create');
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.equal((await f.call('/tasks', 'POST', 'coordinator', taskBody, 'care-create')).body.data.id, saved.body.data.id);
  assert.equal((await f.call('/tasks', 'POST', 'coordinator', { ...taskBody, objectType: 'candidate_site', objectId: zone })).status, 400);
  const { id: _inspectId, objectName: _inspectName, dataClass: _inspectClass, estimatedCostKzt: _inspectCost, ...inspection } = empty.body.data.tasks[0];
  assert.equal((await f.call('/tasks', 'POST', 'coordinator', inspection)).status, 201);
});

async function tzFixture(t: TestContext) {
  const f = await fixture(t); await seedV2(f.store); const seeded = seedTz(f.store);
  const sessions = new Map<string, { cookie: string; csrf: string }>(); let n = 0;
  async function login(user: string) {
    const r = await fetch(f.base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: user, password: DEMO_PASSWORD }) });
    const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b));
    const session = { cookie: r.headers.get('set-cookie')!.split(';')[0]!, csrf: b.data.csrfToken }; sessions.set(user, session); return b.data;
  }
  async function call(path: string, method = 'GET', user = 'coordinator', body?: unknown, key: string | null = `tz-${++n}`) {
    const session = sessions.get(user) ?? (await login(user), sessions.get(user)!);
    const r = await fetch(f.base + '/api/v1' + path, { method, headers: { Cookie: session.cookie, 'X-CSRF-Token': session.csrf, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  }
  return { ...f, seeded, login, call };
}
const firstZone = (f: { store: Store }) => String(f.store.get("SELECT id FROM v2_documents WHERE kind='site' AND id LIKE 'site-osm-%' ORDER BY id LIMIT 1")!.id);
const square = (lng: number, lat: number, d: number) => ({ type: 'Polygon', coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d * 0.6], [lng, lat + d * 0.6], [lng, lat]]] });

test('migration 4 rebuilds v2_users with the viewer role and keeps every reference', () => {
  const dir = mkdtempSync(join(tmpdir(), 'green-pavlodar-migration4-'));
  const path = join(dir, 'v3.sqlite');
  const old = new DatabaseSync(path);
  old.exec(schema + migration2 + migration3 + 'PRAGMA user_version=3;');
  old.exec("INSERT INTO v2_users VALUES ('u1','coord','DEMO','coordinator',1,'x',1,'t','t'); INSERT INTO v2_sessions VALUES ('h','u1','c','t','2999');");
  old.close();
  try {
    const s = new Store(path);
    assert.equal(s.get('PRAGMA user_version')?.user_version, 4);
    assert.equal(s.get('SELECT user_id FROM v2_sessions')?.user_id, 'u1');
    s.run("INSERT INTO v2_users VALUES ('u2','view','DEMO','viewer',1,'x',1,'t','t')");
    assert.throws(() => s.run("INSERT INTO v2_users VALUES ('u3','bad','DEMO','superuser',1,'x',1,'t','t')"), /CHECK/);
    assert.throws(() => s.run("INSERT INTO v2_sessions VALUES ('h2','missing','c','t','2999')"), /FOREIGN KEY/);
    assert.deepEqual(s.all('PRAGMA foreign_key_check'), []);
    s.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('TZ seed: 114 OSM zones, 50 species as catalog items, 27 rates; repeat seed changes nothing', async t => {
  const f = await tzFixture(t);
  assert.equal(f.seeded.inserted.zones, 114); assert.equal(f.seeded.inserted.species, 50); assert.equal(f.seeded.inserted.rates, 27);
  assert.deepEqual(seedTz(f.store).inserted, { zones: 0, evidence: 0, species: 0, rates: 0 });
  assert.equal(f.store.get("SELECT count(*) AS n FROM v2_documents WHERE kind='catalog' AND id LIKE 'sp-%'")?.n, 50);
  const species = await f.call('/species', 'GET', 'viewer');
  assert.equal(species.status, 200); assert.equal(species.body.data.length, 50);
  const site = await f.call(`/sites/${firstZone(f)}`);
  assert.equal(site.body.data.checks.landPermission.status, 'unknown');
  assert.equal(site.body.data.checks.trafficVisibility.status, 'not_applicable');
  const me = await f.call('/auth/me', 'GET', 'viewer');
  assert.equal(me.body.data.user.role, 'viewer'); assert.equal(me.body.data.user.displayName, 'Просмотр (демо)');
});

test('TZ routes compute with shared analytics, cache by zone/options/rates version, and respect one role rule', async t => {
  const f = await tzFixture(t); const zone = firstZone(f);
  // Те же цифры, что у функции веба: сервер не копирует расчёты.
  const analysis = await f.call(`/zones/${zone}/analysis`, 'POST', 'viewer', { options: { variant: 'optimal' } }, null);
  assert.equal(analysis.status, 200, JSON.stringify(analysis.body));
  const species = (await f.call('/species')).body.data; const rates = (await f.call('/rates')).body.data;
  const site = web.siteFromV2((await f.call(`/sites/${zone}`)).body.data);
  assert.deepEqual(analysis.body.data, JSON.parse(JSON.stringify(web.analyzeZone(site, species, web.ratesMap(rates.rates), { variant: 'optimal' }))));
  const cached = cacheSize();
  await f.call(`/zones/${zone}/analysis`, 'POST', 'coordinator', { options: { variant: 'optimal' } }, null);
  assert.equal(cacheSize(), cached, 'repeat analysis is served from cache');
  const variants = await f.call(`/zones/${zone}/variants`, 'POST', 'coordinator', { options: {} }, null);
  assert.deepEqual(variants.body.data.map((v: any) => v.variant), ['econom', 'optimal', 'max']);
  const problems = await f.call('/problems', 'GET', 'viewer');
  assert(problems.body.data.problems.length > 0 && problems.body.data.notDetectable.length > 0);
  const pr = await f.call('/priorities', 'POST', 'viewer', { weights: web.DEFAULT_PRIORITY_WEIGHTS, budget: 50_000_000 }, null);
  assert.equal(pr.body.data.items.length, 114); assert(pr.body.data.roadmap.spent <= 50_000_000);
  assert.equal((await f.call('/layers/soils', 'GET', 'viewer')).body.meta.synthetic, true);
  assert.equal((await f.call('/layers/greenery', 'GET', 'viewer')).body.data.type, 'FeatureCollection');
  const dash = await f.call('/dashboard/metrics', 'GET', 'viewer');
  assert.equal(dash.body.data.find((m: any) => m.key === 'sites_total').value, 114);
  const ctx = await f.call(`/zones/${zone}/context?radius=100`);
  assert.equal(ctx.body.data.radiusM, 100);

  // Расценки: правит только администратор, источник обязателен, версия и история.
  const key = rates.rates[0].key;
  assert.equal((await f.call('/rates', 'PATCH', 'coordinator', { key, value: 1, source: 'тест', expectedVersion: 1 })).status, 403);
  assert.equal((await f.call('/rates', 'PATCH', 'viewer', { key, value: 1, source: 'тест', expectedVersion: 1 })).status, 403);
  assert.equal((await f.call('/rates', 'PATCH', 'admin', { key, value: 1, expectedVersion: 1 })).status, 400);
  const patched = await f.call('/rates', 'PATCH', 'admin', { key, value: 1234, source: 'Прайс питомника (тест)', expectedVersion: 1 });
  assert.equal(patched.status, 200, JSON.stringify(patched.body)); assert.equal(patched.body.data.version, 2);
  assert.equal(patched.body.data.rates[0].dataClass, 'real');
  assert.equal((await f.call('/rates', 'PATCH', 'admin', { key, value: 5, source: 'устарело', expectedVersion: 1 })).status, 409);
  const history = await f.call('/rates/history', 'GET', 'admin');
  assert.equal(history.body.data[0].after.value, 1234); assert.equal(history.body.data[0].actorName, 'Администратор (демо)');
  const after = await f.call(`/zones/${zone}/analysis`, 'POST', 'viewer', { options: { variant: 'optimal' } }, null);
  assert.equal(after.status, 200); assert.equal(cacheSize() > cached, true, 'new rates version is a new cache key');

  // Одно правило ролей: администратор — справочники, не задания; просмотр — ничего не сохраняет.
  const task = { objectType: 'candidate_site', objectId: zone, action: 'inspect', description: 'Осмотр', estimatedMinutes: 30, evidenceIds: ['ev-osm-landuse'] };
  assert.equal((await f.call('/tasks', 'POST', 'admin', task)).status, 403);
  assert.equal((await f.call('/tasks', 'POST', 'viewer', task)).status, 403);
  assert.equal((await f.call('/tasks', 'POST', 'coordinator', task)).status, 201);
  assert.equal((await f.call('/zones', 'POST', 'viewer', { geometry: square(76.95, 52.286, 0.0009) })).status, 403);
  assert.equal((await f.call(`/sites/${zone}`, 'PATCH', 'viewer', { expectedVersion: 1, checks: { access: { status: 'cleared', comment: 'x' } } })).status, 403);
});

test('POST /zones validates the polygon, stores site-user-N as a V2 site and replays by Idempotency-Key', async t => {
  const f = await tzFixture(t);
  const bad = await f.call('/zones', 'POST', 'coordinator', { geometry: square(76.80, 52.286, 0.0009) });
  assert.equal(bad.status, 400); assert.match(bad.body.error.details.fields.geometry, /за пределы/);
  const body = { name: 'Двор у школы', geometry: square(76.95, 52.286, 0.0009) };
  const created = await f.call('/zones', 'POST', 'coordinator', body, 'zone-1');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.id, 'site-user-1'); assert.equal(created.body.data.factors.waterAvailability.value, null);
  assert.equal(created.body.data.checks.utilities.status, 'unknown'); assert(created.body.meta.soil.type);
  const replay = await f.call('/zones', 'POST', 'coordinator', body, 'zone-1');
  assert.equal(replay.body.data.id, 'site-user-1');
  assert.equal(f.store.get("SELECT count(*) AS n FROM v2_documents WHERE kind='site' AND id LIKE 'site-user-%'")?.n, 1);
  const analysis = await f.call('/zones/site-user-1/analysis', 'POST', 'coordinator', { options: {} }, null);
  assert.equal(analysis.status, 200); assert(analysis.body.data.cost.total > 0);
  // Проект на нарисованной зоне: окружение V2 есть, черновик может быть пустым.
  const context = await f.call('/sites/site-user-1/context');
  const design = await f.call('/designs', 'POST', 'coordinator', { siteId: 'site-user-1', name: 'Проект', objective: 'Проект', season: 'Весна 2027', contextVersion: context.body.data.version, plantingItems: [], evidenceIds: ['ev-osm-context'] });
  assert.equal(design.status, 201, JSON.stringify(design.body));
  assert.equal((await f.call(`/designs/${design.body.data.id}/submit`, 'POST', 'coordinator', { expectedVersion: 1 })).body.error.code, 'DESIGN_EMPTY');
  // Правка одного поля не сбрасывает остальные (season, exclusionZones) значениями по умолчанию.
  const renamed = await f.call(`/designs/${design.body.data.id}`, 'PATCH', 'coordinator', { expectedVersion: 1, name: 'Проект 2' });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body)); assert.equal(renamed.body.data.season, 'Весна 2027');
  const withdrawn = await f.call(`/designs/${design.body.data.id}/withdraw`, 'POST', 'coordinator', { expectedVersion: 2 });
  assert.equal(withdrawn.body.error.code, 'INVALID_TRANSITION');
});

test('site checks and water availability: human reviewer name, evidence for the value, siteFromV2 maps status to state', async t => {
  const f = await tzFixture(t); const zone = firstZone(f);
  const patched = await f.call(`/sites/${zone}`, 'PATCH', 'coordinator', { expectedVersion: 1, checks: { access: { status: 'cleared', comment: 'Подъезд с улицы есть.' } }, waterAvailability: { value: 60, note: 'Кран во дворе' } });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  const site = web.siteFromV2(patched.body.data);
  assert.equal(site.checks.access.state, 'cleared'); assert.equal(site.checks.access.checkedBy, 'Специалист (демо)');
  assert.equal(site.factors.waterAvailability.value, 60);
  const ev = site.factors.waterAvailability.evidenceIds[0];
  assert.equal(f.store.get("SELECT json_extract(data,'$.note') AS note FROM v2_documents WHERE kind='evidence' AND id=?", ev)?.note, 'Кран во дворе');
  assert(!site.missingData.some((m: any) => m.field === 'factors.waterAvailability'));
});

test('assistant answers by rules with module numbers and keeps history per user', async t => {
  const f = await tzFixture(t);
  const r = await f.call('/assistant', 'POST', 'viewer', { message: 'Какие зоны озеленить в первую очередь?', siteId: null }, null);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.data.method, 'rules'); assert.deepEqual(r.body.data.toolCalls, []);
  await f.call('/assistant', 'POST', 'coordinator', { message: 'Что посадить?', siteId: firstZone(f) }, null);
  const mine = await f.call('/assistant/history', 'GET', 'viewer');
  assert.equal(mine.body.data.length, 1); assert.equal(mine.body.data[0].q, 'Какие зоны озеленить в первую очередь?');
  assert.equal((await f.call('/assistant', 'POST', 'viewer', { message: '   ' }, null)).status, 400);
  // Без CSRF расчёт не выполняется, даже если он ничего не сохраняет.
  const noCsrf = await fetch(f.base + '/api/v1/priorities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noCsrf.status, 401);
});

test('verified Pavlodar data: sources seeded as evidence, facts route, assistant answers norms with sources', async t => {
  const f = await tzFixture(t);
  const ref = await f.call('/reference/facts', 'GET', 'viewer');
  assert.equal(ref.status, 200);
  assert.equal(ref.body.data.facts.length, 33); assert.equal(ref.body.data.sources.length, 34); assert.equal(ref.body.data.climate.months.length, 12);
  assert.ok(ref.body.data.facts.every((x: any) => x.gap || x.evidenceIds.every((id: string) => ref.body.data.sources.some((s: any) => s.id === id))));
  assert.equal(f.store.get("SELECT json_extract(data,'$.sourceUrl') AS u FROM v2_documents WHERE kind='evidence' AND id='ev-pvl-sp-planning'")?.u !== null, true);
  const { createTools } = await import('../src/tz/llm.js');
  const ctx = { zones: [], evidence: new Set<string>() };
  const hits = createTools(f.store)('search_knowledge', { query: 'отступ дерева от здания' }, ctx);
  assert.equal(hits.results[0].id, 'norm-building'); assert.ok(ctx.evidence.has('ev-pvl-sp-planning'));
  // Без модели ответ по правилам тоже опирается на проверенные факты и называет источник.
  const r = await f.call('/assistant', 'POST', 'coordinator', { message: 'Какой отступ дерева от здания по нормам?' }, null);
  assert.equal(r.body.data.intent, 'facts'); assert.match(r.body.data.text, /5 м/);
  assert.ok(r.body.data.sources.some((s: any) => s.id === 'ev-pvl-sp-planning' && s.url));
});
