// Run after npm run build. Uses a fresh local data/smoke-* DB, never the demo DB.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../dist/db.js';
import { seed } from '../dist/seed.js';

const root = resolve('data');
mkdirSync(root, { recursive: true });
const dir = mkdtempSync(join(root, 'smoke-'));
const path = join(dir, 'restart.sqlite');
const initial = new Store(path);
assert.equal(seed(initial).plants, 30);
assert.equal(seed(initial).tasks, 15);
initial.close();
let child;
let base;
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit');
  child.kill();
  await exit;
}
async function start() {
  // The test uses an OS-assigned port. App configuration still forbids PORT=0.
  // Reserve a free port briefly, then retry-free fail clearly if it is taken.
  const { createServer } = await import('node:net');
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import','./scripts/local-network-guard.mjs','dist/server.js'], {
    env: { ...process.env, NODE_ENV: 'test', DB_PATH: path, PORT: String(port) },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  let launchError;
  child.on('error', e => { launchError = e; });
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try {
      const response = await fetch(base + '/health', { signal: AbortSignal.timeout(1000) });
      const body = await response.json();
      if (response.ok && body.database === 'ok') return;
    } catch { /* startup can take a moment */ }
    await delay(100);
  }
  throw new Error(`Server readiness timeout: ${output}`);
}
async function request(route, method = 'GET', user = 'demo-coordinator-1', body, key) {
  const response = await fetch(base + route, {
    method, headers: { 'X-Demo-User': user, ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}) }, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000)
  });
  const json = await response.json();
  assert(response.ok, `${method} ${route}: ${response.status} ${JSON.stringify(json)}`);
  return { body: json, headers: response.headers };
}
try {
  await start();
  assert.equal((await request('/plants')).body.data.length, 30);
  const payload = { title: 'DEMO restart smoke', assignedToId: 'demo-worker-1', plantId: 'demo-plant-1' };
  const created = (await request('/tasks', 'POST', 'demo-coordinator-1', payload, 'restart-create')).body;
  await request(`/tasks/${created.data.id}`, 'PATCH', 'demo-worker-1', { version: 1, status: 'in_progress' }, 'restart-start');
  await stop();
  await start();
  const replay = await request('/tasks', 'POST', 'demo-coordinator-1', payload, 'restart-create');
  assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
  assert.deepEqual(replay.body, created);
  const tasks = (await request('/tasks')).body.data;
  assert.equal(tasks.length, 16);
  assert.equal(tasks.find(row => row.id === created.data.id).version, 2);
  const report = await request('/reports', 'POST', 'demo-worker-1', {
    taskId: created.data.id, version: 2, notes: 'DEMO survived server restart'
  }, 'restart-report');
  assert.equal(report.body.task.status, 'completed');
  await stop();
  const reopened = new Store(path);
  try {
    assert.equal(seed(reopened).tasks, 16);
    assert.equal(reopened.get('PRAGMA integrity_check').integrity_check, 'ok');
    assert.deepEqual(reopened.all('PRAGMA foreign_key_check'), []);
    assert.equal(reopened.get('SELECT count(*) AS n FROM reports').n, 1);
    assert.equal(reopened.get('SELECT count(*) AS n FROM task_history WHERE task_id=?', created.data.id).n, 3);
  } finally { reopened.close(); }
  console.log('PASS: compiled Express /health, SQLite reads/writes, repeat seed, process restart, durable idempotency, reports and history.');
} finally {
  await stop();
  const target = resolve(dir);
  assert(target.startsWith(root + sep) && target.includes(`${sep}smoke-`));
  rmSync(target, { recursive: true, force: true });
}
