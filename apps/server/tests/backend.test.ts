import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Store } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const coordinator = 'demo-coordinator-1';
const w1 = 'demo-worker-1';
const w2 = 'demo-worker-2';
const draft = { title: 'DEMO Тестовое задание', assignedToId: w1, plantId: 'demo-plant-1' };

async function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'green-pavlodar-test-'));
  const store = new Store(join(dir, 'test.sqlite'));
  seed(store);
  const server = createApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((done, reject) => server.close(e => e ? reject(e) : done()));
    store.close();
    const resolved = resolve(dir);
    assert(resolved.startsWith(resolve(tmpdir()) + sep) && dir.includes('green-pavlodar-test-'));
    rmSync(resolved, { recursive: true, force: true });
  });
  async function request(path: string, method = 'GET', user: string | null = coordinator,
    body?: unknown, key?: string) {
    const headers: Record<string, string> = {};
    if (user) headers['X-Demo-User'] = user;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (key) headers['Idempotency-Key'] = key;
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  return { store, base, request };
}

test('health checks real SQLite; reads require explicit demo identity', async t => {
  const { request } = await fixture(t);
  const health = await request('/health', 'GET', null);
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { status: 'ok', database: 'ok', mode: 'DEMO', contract: 'draft' });
  assert.equal((await request('/plants', 'GET', null)).status, 401);
  assert.equal((await request('/plants', 'GET', 'missing')).status, 401);
  const plants = await request('/plants');
  assert.equal(plants.body.data.length, 30);
  assert.equal(plants.body.data[0].isDemo, true);
  assert.equal((await request('/plants/demo-plant-1')).status, 200);
  assert.equal((await request('/plants/missing')).status, 404);
  assert.equal((await request('/candidate-sites')).body.data.length, 6);
  assert.equal((await request('/workers')).body.data.length, 3);
});

test('pagination and strict validation reject malformed or oversized input', async t => {
  const { request, base } = await fixture(t);
  assert.equal((await request('/plants?limit=2&offset=1')).body.data.length, 2);
  assert.equal((await request('/plants?limit=101')).status, 400);
  assert.equal((await request('/plants?unknown=true')).status, 400);
  assert.equal((await request('/tasks', 'POST', coordinator, { ...draft, role: 'coordinator' }, 'bad-field')).status, 400);
  assert.equal((await request('/tasks', 'POST', coordinator, { ...draft, candidateSiteId: 'demo-site-1' }, 'two-targets')).status, 400);
  assert.equal((await request('/tasks', 'POST', coordinator, { ...draft, title: '   ' }, 'empty-title')).status, 400);
  assert.equal((await request('/tasks', 'POST', coordinator, draft)).status, 400);
  const headers = { 'X-Demo-User': coordinator, 'Content-Type': 'application/json' };
  const malformed = await fetch(base + '/tasks', { method: 'POST', headers, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
  const oversized = await fetch(base + '/tasks', { method: 'POST', headers, body: JSON.stringify({ text: 'x'.repeat(34000) }) });
  assert.equal(oversized.status, 413);
  await oversized.arrayBuffer();
});

test('worker scope is enforced on reads, writes, reports, and role changes', async t => {
  const { request } = await fixture(t);
  const own = await request('/tasks', 'GET', w1);
  assert.equal(own.body.data.length, 5);
  assert(own.body.data.every((row: { assignedToId: string }) => row.assignedToId === w1));
  assert.equal((await request('/workers', 'GET', w1)).status, 403);
  assert.equal((await request('/tasks', 'POST', w1, draft, 'worker-create')).status, 403);
  assert.equal((await request('/tasks/demo-task-1', 'PATCH', w2, { version: 1, status: 'in_progress' }, 'foreign-patch')).status, 404);
  assert.equal((await request('/reports', 'POST', w2, { taskId: 'demo-task-1', version: 1, notes: 'DEMO' }, 'foreign-report')).status, 404);
  assert.equal((await request('/tasks/demo-task-1', 'PATCH', w1, { version: 1, title: 'DEMO changed' }, 'worker-title')).status, 403);
  assert.equal((await request('/tasks', 'POST', coordinator, { ...draft, assignedToId: coordinator }, 'bad-assignee')).status, 422);
});

test('create is atomic and idempotent; same key cannot be reused with a new payload', async t => {
  const { request, store } = await fixture(t);
  const first = await request('/tasks', 'POST', coordinator, draft, 'create-1');
  assert.equal(first.status, 201);
  assert.equal(first.body.data.version, 1);
  const replay = await request('/tasks', 'POST', coordinator, { plantId: draft.plantId, assignedToId: w1, title: draft.title }, 'create-1');
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
  assert.deepEqual(first.body, replay.body);
  assert.equal((await request('/tasks', 'POST', coordinator, { ...draft, title: 'DEMO other' }, 'create-1')).status, 409);
  assert.equal(store.get('SELECT count(*) AS n FROM tasks')?.n, 16);
  assert.equal(store.get('SELECT count(*) AS n FROM task_history WHERE task_id=?', first.body.data.id)?.n, 1);
  assert.equal((await request('/tasks', 'POST', coordinator, { ...draft, plantId: 'missing' }, 'bad-ref')).status, 422);
  assert.equal(store.get('SELECT count(*) AS n FROM idempotency_keys')?.n, 1);
  const siteTask = await request('/tasks', 'POST', coordinator,
    { title: 'DEMO Осмотреть участок', assignedToId: w1, candidateSiteId: 'demo-site-1' }, 'site-task');
  assert.equal(siteTask.status, 201);
  assert.equal(siteTask.body.data.candidateSiteId, 'demo-site-1');
});

test('versions, transitions, completion report and history form one workflow', async t => {
  const { request, store } = await fixture(t);
  const start = await request('/tasks/demo-task-1', 'PATCH', w1, { version: 1, status: 'in_progress' }, 'start-1');
  assert.equal(start.status, 200);
  assert.equal(start.body.data.version, 2);
  assert.deepEqual((await request('/tasks/demo-task-1', 'PATCH', w1, { version: 1, status: 'in_progress' }, 'start-1')).body, start.body);
  const stale = await request('/tasks/demo-task-1', 'PATCH', coordinator, { version: 1, title: 'DEMO stale' }, 'stale');
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
  assert.equal((await request('/tasks/demo-task-1', 'PATCH', coordinator, { version: 2, status: 'pending' }, 'backward')).status, 409);
  assert.equal((await request('/tasks/demo-task-1', 'PATCH', coordinator, { version: 2, assignedToId: w2 }, 'reassign')).status, 409);
  const report = { taskId: 'demo-task-1', version: 2, notes: 'DEMO Осмотр завершён' };
  assert.equal((await request('/reports', 'POST', coordinator, report, 'coord-report')).status, 403);
  const done = await request('/reports', 'POST', w1, report, 'report-1');
  assert.equal(done.status, 201);
  assert.equal(done.body.task.status, 'completed');
  assert.equal(done.body.task.version, 3);
  assert.deepEqual((await request('/reports', 'POST', w1, report, 'report-1')).body, done.body);
  assert.equal((await request('/reports', 'POST', w1, { ...report, version: 3 }, 'report-2')).status, 409);
  assert.equal((await request('/tasks/demo-task-1', 'PATCH', coordinator, { version: 3, title: 'DEMO terminal' }, 'terminal')).status, 409);
  assert.equal(store.get('SELECT count(*) AS n FROM reports')?.n, 1);
  assert.equal(store.get('SELECT count(*) AS n FROM task_history WHERE task_id=?', 'demo-task-1')?.n, 3);
  assert.equal(store.get('SELECT count(*) AS n FROM idempotency_keys')?.n, 2);
});

test('concurrent requests allow only one write for the same task version', async t => {
  const { request, store } = await fixture(t);
  const results = await Promise.all([
    request('/tasks/demo-task-1', 'PATCH', coordinator, { version: 1, title: 'DEMO A' }, 'concurrent-a'),
    request('/tasks/demo-task-1', 'PATCH', coordinator, { version: 1, title: 'DEMO B' }, 'concurrent-b')
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(store.get('SELECT version FROM tasks WHERE id=?', 'demo-task-1')?.version, 2);
  assert.equal(store.get('SELECT count(*) AS n FROM task_history WHERE task_id=?', 'demo-task-1')?.n, 2);
});

test('database failure rolls back report, task, history and idempotency together', async t => {
  const { request, store } = await fixture(t);
  await request('/tasks/demo-task-1', 'PATCH', w1, { version: 1, status: 'in_progress' }, 'start');
  store.db.exec(`CREATE TRIGGER test_failure BEFORE INSERT ON task_history WHEN NEW.version=3
    BEGIN SELECT RAISE(ABORT, 'simulated test failure'); END`);
  const body = { taskId: 'demo-task-1', version: 2, notes: 'DEMO rollback' };
  const failed = await request('/reports', 'POST', w1, body, 'rollback-report');
  assert.equal(failed.status, 500);
  assert.equal(failed.body.error.code, 'INTERNAL_ERROR');
  assert(!JSON.stringify(failed.body).includes('simulated'));
  assert.equal(store.get('SELECT count(*) AS n FROM reports')?.n, 0);
  assert.equal(store.get('SELECT version FROM tasks WHERE id=?', 'demo-task-1')?.version, 2);
  assert.equal(store.get("SELECT count(*) AS n FROM idempotency_keys WHERE key='rollback-report'")?.n, 0);
  store.db.exec('DROP TRIGGER test_failure');
  assert.equal((await request('/reports', 'POST', w1, body, 'rollback-report')).status, 201);
});

test('repeat seed preserves existing data, edits, histories, and user-created records', async t => {
  const { request, store } = await fixture(t);
  store.run('UPDATE plants SET name=? WHERE id=?', 'DEMO user edit', 'demo-plant-1');
  await request('/tasks/demo-task-1', 'PATCH', w1, { version: 1, status: 'in_progress' }, 'start');
  const custom = await request('/tasks', 'POST', coordinator, draft, 'custom');
  assert.equal(custom.status, 201);
  seed(store); seed(store);
  assert.equal(store.get('SELECT name FROM plants WHERE id=?', 'demo-plant-1')?.name, 'DEMO user edit');
  assert.equal(store.get('SELECT count(*) AS n FROM plants')?.n, 30);
  assert.equal(store.get('SELECT count(*) AS n FROM candidate_sites')?.n, 6);
  assert.equal(store.get("SELECT count(*) AS n FROM users WHERE role='worker'")?.n, 3);
  assert.equal(store.get("SELECT count(*) AS n FROM users WHERE role='coordinator'")?.n, 1);
  assert.equal(store.get('SELECT count(*) AS n FROM tasks')?.n, 16);
  assert.equal(store.get('SELECT version FROM tasks WHERE id=?', 'demo-task-1')?.version, 2);
  assert.equal(store.get('SELECT count(*) AS n FROM task_history')?.n, 17);
  assert(store.get('SELECT id FROM tasks WHERE id=?', custom.body.data.id));
});

test('SQLite enforces references, one target, role values and photo metadata checks', async t => {
  const { store } = await fixture(t);
  assert.equal(store.get('PRAGMA integrity_check')?.integrity_check, 'ok');
  assert.deepEqual(store.all('PRAGMA foreign_key_check'), []);
  assert.throws(() => store.run("UPDATE tasks SET assigned_to_id='missing' WHERE id='demo-task-1'"), /FOREIGN KEY/);
  assert.throws(() => store.run("UPDATE tasks SET candidate_site_id='demo-site-1' WHERE id='demo-task-1'"), /CHECK/);
  assert.throws(() => store.run("UPDATE users SET role='admin' WHERE id='demo-worker-1'"), /CHECK/);
  assert.throws(() => store.run("INSERT INTO photos VALUES ('bad','missing','../bad.exe','application/octet-stream',1,'x',1)"));
  const tables = store.all("SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name);
  for (const name of ['plants', 'candidate_sites', 'users', 'tasks', 'reports', 'observations', 'photos', 'evidence_refs', 'task_history']) {
    assert(tables.includes(name));
  }
});

test('uploads, browser origins and untrusted Host headers are rejected', async t => {
  const { base, request } = await fixture(t);
  const photo = await fetch(base + '/photos', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data' }, body: 'DEMO' });
  assert.equal(photo.status, 415); await photo.arrayBuffer();
  assert.equal((await request('/photos')).status, 404);
  const origin = await fetch(base + '/health', { headers: { Origin: 'https://example.com' } });
  assert.equal(origin.status, 403); await origin.arrayBuffer();
  // Native fetch controls Host itself; use the HTTP client to send a real override.
  const hostStatus = await new Promise<number | undefined>((done, reject) => {
    const req = httpRequest(base + '/health', { headers: { Host: 'untrusted.example' } }, response => {
      response.resume(); response.on('end', () => done(response.statusCode));
    });
    req.on('error', reject); req.end();
  });
  assert.equal(hostStatus, 403);
});

test('configuration prevents production mode and paths outside local data/', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /development/);
  assert.throws(() => loadConfig({ DB_PATH: '../shared.sqlite' }), /data/);
  assert.throws(() => loadConfig({ DB_PATH: 'postgres://production' }), /data/);
  assert.throws(() => loadConfig({ PORT: 'NaN' }), /PORT/);
  assert.equal(loadConfig({}).host, '127.0.0.1');
});
