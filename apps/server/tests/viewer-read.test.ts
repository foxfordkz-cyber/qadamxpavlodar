import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { Store } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/seed.js';
import { seedV2, DEMO_PASSWORD } from '../src/v2/seed.js';
import { seedTz } from '../src/tz/seed.js';
import { seedMunicipal } from '../src/municipal/data.js';
import { seedOutcomes } from '../src/outcomes/seed.js';
import { insertDoc } from '../src/v2/core.js';
import { today, day } from '../src/outcomes/shared.js';

const siteId = 'site-osm-1569993037';
const treeId = 'qa-viewer-tree';
const tables = ['v2_tasks', 'v2_reports', 'v2_uploads', 'v2_report_drafts', 'v2_history',
  'v2_documents', 'v2_crews', 'v2_memberships', 'v2_users', 'v2_profiles', 'v2_idempotency',
  'outcome_snapshots', 'outcome_cohorts', 'outcome_members', 'outcome_inspections', 'outcome_sources'];

async function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'gp-viewer-read-'));
  const path = join(root, 'test.sqlite'), uploadsPath = join(root, 'uploads');
  let store = new Store(path);
  const reseed = async () => { seed(store); await seedV2(store); seedTz(store); await seedMunicipal(store); return seedOutcomes(store); };
  await reseed();
  // Only registry input is a fixture. Tasks, reports, acceptance and inspections below use real HTTP.
  insertDoc(store, 'plant', { id: treeId, name: 'QA synthetic inspection tree', speciesId: 'sp-pinus-sylvestris',
    species: 'Pinus sylvestris', kind: 'tree', siteId, plantedAt: new Date().toISOString(),
    lat: 52.2726, lng: 76.9695, condition: 'unknown', lastVerifiedCareAt: null,
    carePolicyId: null, evidenceIds: ['demo-v2-evidence'], isDemo: true, version: 1 });
  let server = createApp(store, { uploadsPath }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = () => `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  async function stop() { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); store.close(); }
  t.after(async () => {
    await stop();
    assert(resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('gp-viewer-read-'));
    rmSync(root, { recursive: true, force: true });
  });
  const sessions = new Map<string, { cookie: string; csrf: string }>();
  let sequence = 0;
  async function session(user: string) {
    if (!sessions.has(user)) {
      const r = await fetch(base() + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: user, password: DEMO_PASSWORD }) });
      assert.equal(r.status, 200, `login ${user}`);
      const data = (await r.json()).data;
      sessions.set(user, { cookie: r.headers.get('set-cookie')!.split(';')[0]!, csrf: data.csrfToken });
    }
    return sessions.get(user)!;
  }
  async function request(path: string, method = 'GET', user = 'coordinator', body?: unknown,
    key = `viewer-qa-${++sequence}`, csrf = true) {
    const auth = await session(user);
    const r = await fetch(base() + path, { method, headers: { Cookie: auth.cookie,
      ...(csrf ? { 'X-CSRF-Token': auth.csrf } : {}), 'Idempotency-Key': key,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const data = r.headers.get('content-type')?.includes('application/json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, body: data, replay: r.headers.get('Idempotency-Replayed') };
  }
  async function upload(taskId: string, user = 'worker1') {
    const auth = await session(user), form = new FormData();
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#638460' } }).png().toBuffer();
    form.set('taskId', taskId); form.set('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'synthetic-qa.png');
    const r = await fetch(base() + '/uploads', { method: 'POST', headers: { Cookie: auth.cookie,
      'X-CSRF-Token': auth.csrf, 'Idempotency-Key': `photo-${++sequence}` }, body: form });
    return { status: r.status, body: await r.json() };
  }
  async function ok(path: string, method = 'GET', user = 'coordinator', body?: unknown, status = 200, key?: string) {
    const r = await request(path, method, user, body, key);
    assert.equal(r.status, status, `${method} ${path}: ${r.body.error?.code ?? ''}`);
    return r.body.data;
  }
  function snapshot() {
    return Object.fromEntries(tables.map(table => {
      const rows = store.all(`SELECT * FROM ${table}`).map(row => JSON.stringify(row)).sort();
      return [table, { count: rows.length, sha256: createHash('sha256').update(rows.join('\n')).digest('hex') }];
    }));
  }
  async function pending(plantId = treeId) {
    const created = await ok('/tasks', 'POST', 'coordinator', { objectType: 'plant', objectId: plantId,
      action: 'inspect', description: 'QA synthetic inspection; not a field observation', estimatedMinutes: 30,
      minWorkers: 1, requiredSkills: ['inspect'], evidenceIds: ['demo-v2-evidence'] }, 201);
    const assigned = await ok(`/tasks/${created.id}/assign`, 'POST', 'coordinator', { expectedVersion: created.version,
      crewId: 'demo-crew-1', scheduledStart: '2026-10-28T04:00:00Z', scheduledEnd: '2026-10-28T04:30:00Z', resourceIds: [] });
    const composed = await ok(`/tasks/${created.id}/assign-workers`, 'POST', 'foreman1', {
      expectedVersion: assigned.version, workerIds: ['demo-worker-1'] });
    const started = await ok(`/tasks/${created.id}/start`, 'POST', 'worker1', { expectedVersion: composed.version });
    const photo = await upload(created.id); assert.equal(photo.status, 201);
    const report = await ok(`/tasks/${created.id}/reports`, 'POST', 'worker1', { expectedVersion: started.version,
      note: 'QA synthetic image and observation, not real field work', actualWorkerIds: ['demo-worker-1'],
      photoIds: [photo.body.data.id], actualPlantingItems: [] }, 201);
    const task = await ok(`/tasks/${created.id}`);
    assert.ok(report.report.id, 'Existing submit DTO must include the report');
    return { task, report: report.report, photo: photo.body.data };
  }
  return { request, ok, upload, pending, snapshot, reseed, get store() { return store; },
    async restart() { await stop(); store = new Store(path); server = createApp(store, { uploadsPath }).listen(0, '127.0.0.1'); await once(server, 'listening'); } };
}

function noPrivateFields(value: unknown) {
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return;
  const forbidden = /^(password|passwordHash|password_hash|login|cookie|csrfToken|session_id|token_hash|storage_name|storagePath)$/i;
  for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.test(key), false, `Private field: ${key}`); noPrivateFields(child); }
}

test('viewer reads populated task/report lists, details, attached photos and public people DTOs', async t => {
  const f = await setup(t), { task, report, photo } = await f.pending();
  const paths = ['/tasks?limit=200', '/reports?limit=200', `/tasks/${task.id}`, `/reports/${report.id}`,
    `/uploads/${photo.id}`, '/crews', '/workers'];
  const results = [];
  for (const path of paths) {
    const viewer = await f.request(path, 'GET', 'viewer'), coordinator = await f.request(path);
    results.push({ path, status: viewer.status, total: viewer.body.meta?.total ?? viewer.body.data?.length ?? null });
    // Accumulate all original failure modes before asserting so the red run documents the whole issue.
    if (viewer.status === 200) noPrivateFields(viewer.body);
    (results[results.length - 1] as Record<string, unknown>).matchesCoordinator =
      viewer.status === coordinator.status && JSON.stringify(viewer.body) === JSON.stringify(coordinator.body);
  }
  t.diagnostic(JSON.stringify(results));
  assert.equal(results.every(r => r.status === 200 && (r as any).matchesCoordinator), true, 'Viewer must read the same existing records');
  for (const path of [`/tasks?objectId=${treeId}&status=submitted&limit=1`, `/reports?taskId=${task.id}&reviewStatus=pending&limit=1`]) {
    const page = await f.ok(path, 'GET', 'viewer'); assert.equal(page.length, 1);
  }
  for (const worker of await f.ok('/workers', 'GET', 'viewer')) {
    assert.deepEqual(Object.keys(worker).sort(), ['active', 'displayName', 'id', 'profile', 'role', 'version']);
  }
  assert.equal((await f.request('/users', 'GET', 'viewer')).status, 403);
  assert.equal((await f.request('/tasks/missing', 'GET', 'viewer')).status, 404);
  assert.equal((await f.request('/reports/missing', 'GET', 'viewer')).status, 404);
  assert.equal((await f.request('/uploads/missing', 'GET', 'viewer')).status, 404);
});

test('viewer cannot mutate; worker and foreman read restrictions, CSRF and versions remain intact', async t => {
  const f = await setup(t), { task, report, photo } = await f.pending();
  const operations: [string, string, unknown][] = [
    ['/tasks', 'POST', { objectType: 'plant', objectId: treeId, action: 'inspect', description: 'blocked', estimatedMinutes: 30, evidenceIds: ['demo-v2-evidence'] }],
    [`/tasks/${task.id}/assign`, 'POST', { expectedVersion: task.version, crewId: 'demo-crew-1', scheduledStart: '2026-10-28T05:00:00Z', scheduledEnd: '2026-10-28T05:30:00Z' }],
    [`/tasks/${task.id}/assign-workers`, 'POST', { expectedVersion: task.version, workerIds: ['demo-worker-1'] }],
    [`/tasks/${task.id}/start`, 'POST', { expectedVersion: task.version }],
    [`/tasks/${task.id}/report-draft`, 'PUT', { expectedVersion: task.version, expectedDraftVersion: 0, note: 'blocked', actualWorkerIds: ['demo-worker-1'] }],
    [`/tasks/${task.id}/report-draft/contributions`, 'POST', { expectedVersion: task.version, expectedDraftVersion: 0, note: 'blocked' }],
    [`/tasks/${task.id}/reports`, 'POST', { expectedVersion: task.version, note: 'blocked', actualWorkerIds: ['demo-worker-1'] }],
    ...(['accepted', 'changes_requested'] as const).map(decision => [`/reports/${report.id}/review`, 'POST', { expectedVersion: task.version, expectedReportVersion: report.version, decision, comment: 'blocked' }] as [string, string, unknown]),
    [`/tasks/${task.id}/issues`, 'POST', { expectedVersion: task.version, text: 'blocked' }],
    ['/crews', 'POST', { name: 'blocked', foremanId: 'demo-foreman-1' }],
    ['/crews/demo-crew-1', 'PATCH', { expectedVersion: 1, name: 'blocked' }],
    ['/crews/demo-crew-1/members', 'POST', { expectedVersion: 1, userId: 'demo-worker-1', active: false }],
    ['/users/demo-worker-1', 'PATCH', { expectedVersion: 1, displayName: 'blocked' }],
    [`/plants/${treeId}`, 'PATCH', { expectedVersion: 1, name: 'blocked' }],
  ];
  const before = f.snapshot();
  for (const [path, method, body] of operations) {
    const r = await f.request(path, method, 'viewer', body);
    assert.equal(r.status, 403, `${method} ${path}`); assert.equal(r.body.error.code, 'FORBIDDEN');
  }
  assert.equal((await f.upload(task.id, 'viewer')).status, 403);
  assert.deepEqual(f.snapshot(), before, 'Rejected writes must leave business data/history/idempotency unchanged');
  for (const user of ['worker3', 'foreman2']) {
    for (const path of [`/tasks/${task.id}`, `/reports/${report.id}`, `/uploads/${photo.id}`]) assert.equal((await f.request(path, 'GET', user)).status, 404);
    assert.equal((await f.ok(`/tasks?objectId=${treeId}`, 'GET', user)).length, 0);
    assert.equal((await f.ok(`/reports?taskId=${task.id}`, 'GET', user)).length, 0);
    assert.equal((await f.ok('/crews', 'GET', user)).some((c: any) => c.id === 'demo-crew-1'), false);
    assert.equal((await f.ok('/workers', 'GET', user)).some((w: any) => w.id === 'demo-worker-1'), false);
  }
  for (const user of ['worker1', 'foreman1']) assert.equal((await f.request(`/uploads/${photo.id}`, 'GET', user)).status, 200);
  const review = { expectedVersion: task.version, expectedReportVersion: report.version, decision: 'accepted', comment: 'QA acceptance' };
  const noCsrf = await f.request(`/reports/${report.id}/review`, 'POST', 'coordinator', review, 'missing-csrf', false);
  assert.equal(noCsrf.status, 403); assert.equal(noCsrf.body.error.code, 'CSRF_REQUIRED');
  const stale = await f.request(`/reports/${report.id}/review`, 'POST', 'coordinator', { ...review, expectedVersion: task.version - 1 });
  assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
});

test('accepted HTTP report and linked synthetic inspection survive restart and repeated seed without rewriting history', async t => {
  const f = await setup(t);
  const site = await f.ok(`/sites/${siteId}`);
  const forecast = await f.ok('/outcomes/snapshots', 'POST', 'coordinator', { id: 'qa-viewer-forecast', siteId, expectedVersion: site.version, variant: 'econom' }, 201);
  const plantIds: string[] = [];
  for (const item of forecast.snapshot.analysis.scheme) for (let n = 0; n < item.quantity; n++) {
    const id = `qa-report-tree-${plantIds.length + 1}`; plantIds.push(id);
    insertDoc(f.store, 'plant', { id, name: 'QA synthetic forecast cohort tree', kind: 'tree', siteId,
      speciesId: item.speciesId, species: forecast.snapshot.catalog.find((sp: any) => sp.id === item.speciesId).latin,
      plantedAt: new Date().toISOString(), condition: 'unknown', lat: 52.2726, lng: 76.9695,
      evidenceIds: ['demo-v2-evidence'], isDemo: true, version: 1 });
  }
  assert.ok(plantIds.length > 1);
  const inspectedTreeId = plantIds[0]!;
  await f.ok('/outcomes/cohorts', 'POST', 'coordinator', { id: 'qa-viewer-cohort', siteId, plantIds,
    plantedOn: today(), snapshotId: 'qa-viewer-forecast', evidenceIds: ['demo-v2-evidence'], expectedVersion: 0 }, 201);
  const { task, report, photo } = await f.pending(inspectedTreeId);
  const review = { expectedVersion: task.version, expectedReportVersion: report.version, decision: 'accepted', comment: 'QA synthetic acceptance, not field evidence' };
  const accepted = await f.request(`/reports/${report.id}/review`, 'POST', 'coordinator', review, 'qa-accept-once');
  assert.equal(accepted.status, 200);
  const replay = await f.request(`/reports/${report.id}/review`, 'POST', 'coordinator', review, 'qa-accept-once');
  assert.equal(replay.replay, 'true'); assert.deepEqual(replay.body, accepted.body);
  const observedOn = day(report.createdAt);
  const inspect = { id: 'qa-viewer-inspection', observedOn, expectedVersion: 1, evidenceIds: ['demo-v2-evidence'],
    observations: [{ plantId: inspectedTreeId, state: 'alive', reportId: report.id, evidenceIds: ['demo-v2-evidence'] }] };
  const inspectionPath = '/outcomes/cohorts/qa-viewer-cohort/inspections';
  for (const user of ['viewer', 'worker1', 'foreman1']) assert.equal((await f.request(inspectionPath, 'POST', user, inspect)).status, 403);
  const inspection = await f.ok(inspectionPath, 'POST', 'coordinator', inspect, 201, 'qa-inspect-once');
  assert.equal(inspection.provenance.isDemo, true); assert.equal(inspection.provenance.dataClass, 'demo');
  assert.equal((await f.request(inspectionPath, 'POST', 'coordinator', inspect, 'qa-inspect-once')).replay, 'true');
  const summaryPath = '/outcomes/cohorts/qa-viewer-cohort/summary?inspectionId=qa-viewer-inspection';
  const summary = await f.ok(summaryPath, 'GET', 'viewer');
  assert.equal(summary.summary.alive, 1); assert.equal(summary.summary.unknown, plantIds.length - 1);
  assert.equal(summary.summary.wholeCohortSurvivalPct, null, 'Uninspected trees must not be counted as alive');
  assert.deepEqual({ ...f.store.get('SELECT inspection_id,plant_id,report_id FROM outcome_sources WHERE inspection_id=?', inspection.id) },
    { inspection_id: inspection.id, plant_id: inspectedTreeId, report_id: report.id });
  const acceptedReport = await f.ok(`/reports/${report.id}`, 'GET', 'viewer');
  assert.equal(acceptedReport.reviewStatus, 'accepted'); assert.equal(acceptedReport.reviewerId, 'demo-coordinator-1');
  assert.equal((await f.ok(`/tasks/${task.id}`, 'GET', 'viewer')).status, 'verified');
  assert.equal((await f.ok('/outcomes/cohorts/qa-viewer-cohort', 'GET', 'viewer')).version, 2);
  assert.ok(f.store.get("SELECT id FROM v2_history WHERE entity_id=? AND action='verify'", task.id));
  assert.ok(f.store.get("SELECT id FROM v2_history WHERE entity_id=? AND action='accept'", inspection.id));
  const readPaths = [`/reports/${report.id}`, `/tasks/${task.id}`, `/uploads/${photo.id}`, inspectionPath,
    '/outcomes/cohorts/qa-viewer-cohort', summaryPath, `/outcomes/sites/${siteId}`];
  const saved = await Promise.all(readPaths.map(path => f.request(path, 'GET', 'viewer')));
  const before = f.snapshot();
  await f.restart();
  assert.equal((await f.reseed()).created, false);
  assert.deepEqual(f.snapshot(), before, 'Repeated seed must not rewrite accepted report, links, versions, forecasts or history');
  for (let i = 0; i < readPaths.length; i++) assert.deepEqual(await f.request(readPaths[i]!, 'GET', 'viewer'), saved[i]);
  assert.deepEqual(f.snapshot(), before, 'GET after restart remains read-only');
  assert.equal(f.store.get('PRAGMA integrity_check')?.integrity_check, 'ok'); assert.deepEqual(f.store.all('PRAGMA foreign_key_check'), []);
  t.diagnostic(JSON.stringify({ synthetic: true, report: report.id, task: task.id, cohort: 'qa-viewer-cohort',
    inspection: inspection.id, tablesPreserved: Object.keys(before).length, summary: summary.summary,
    seedRewritten: false, sessionRetained: true, uploadRetained: true }));
});
