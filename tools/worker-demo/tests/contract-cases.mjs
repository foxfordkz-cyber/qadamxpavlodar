import test from 'node:test';
import assert from 'node:assert/strict';
import { createContractGateway, createV2Transport } from '../../../apps/web/src/features/worker/contract-v2.mjs';
import { scheme } from '../../../apps/web/src/features/worker/v2-views.mjs';

const user = { id: 'worker-1', role: 'worker' };
const location = { lat: 52.28, lng: 76.95, accuracyM: 5, capturedAt: '2026-10-29T08:00:00Z' };
const analysis = {
  category: 'needs_inspection', facts: ['Повреждена опора'], proposedAction: 'inspect',
  decision: 'accepted', confirmedBy: user.id, confirmedAt: location.capturedAt,
  provenance: { evidenceIds: ['evidence-1'], missingData: ['Нужен осмотр'], provider: 'rules', originalText: 'Повреждена опора' },
};
const confirmedObservation = {
  category: 'needs_inspection', extractedFacts: ['Повреждена опора'], proposedAction: 'inspect',
  evidenceIds: ['evidence-1'], missingData: ['Нужен осмотр'], confirmed: true,
};
const payload = (extra = {}) => ({
  taskId: 'task-1', objectId: 'plant-1', expectedVersion: 7, expectedDraftVersion: 2,
  note: 'Материалы работника', photoId: 'photo-1', idempotencyKey: 'operation-1',
  geo: { latitude: location.lat, longitude: location.lng, accuracy: location.accuracyM, deviceTime: location.capturedAt },
  analysis, actualWorkerIds: [user.id], actualPlantingItems: [],
  revisionOf: 'old-report', deviceTime: location.capturedAt, contributorIds: [user.id], foremanChecked: true,
  ...extra,
});
const task = (extra = {}) => ({
  id: 'task-1', version: 7, status: 'in_progress', objectType: 'plant', objectId: 'plant-1',
  action: 'inspect', assignedWorkerIds: [user.id], assignedCrewId: 'crew-1', minWorkers: 1,
  scheduledStart: '2026-10-28T19:30:00Z', dueAt: null, requiredWaterLiters: null,
  estimatedMinutes: 15, priority: 'medium', isDemo: true, latestReportId: null,
  ...extra,
});
function writes(result) {
  const calls = [];
  const gateway = createContractGateway({ user, request: async (method, path, options) => {
    calls.push({ method, path, ...options });
    return { data: result };
  } });
  return { gateway, calls };
}
const bodyKeys = value => Object.keys(value).sort();

test('real API: contribution uses task and draft versions and only the strict contribution fields', async () => {
  const { gateway, calls } = writes({ taskId: 'task-1', version: 3, contributions: [{ authorId: user.id }], summary: null });
  const receipt = await gateway.submitReport(payload({ submissionType: 'contribution' }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/tasks/task-1/report-draft/contributions');
  assert.deepEqual(calls[0].body, { expectedVersion: 7, expectedDraftVersion: 2, note: 'Материалы работника', photoIds: ['photo-1'], location, confirmedObservation });
  assert.equal(calls[0].headers['Idempotency-Key'], 'operation-1');
  assert.equal(receipt.saved, true);
  assert.ok(receipt.id, 'server draft has taskId/version, not an id; gateway must create a usable receipt');
  assert.equal(receipt.submissionType, 'contribution');
});

test('real API: solo report excludes local-only fields and unwraps the server report receipt', async () => {
  const { gateway, calls } = writes({ report: { id: 'report-1', reviewStatus: 'pending' }, task: task({ status: 'submitted' }) });
  const receipt = await gateway.submitReport(payload({ submissionType: 'single' }));
  assert.equal(calls[0].path, '/tasks/task-1/reports');
  assert.deepEqual(calls[0].body, {
    expectedVersion: 7, note: 'Материалы работника', photoIds: ['photo-1'], location,
    confirmedObservation, actualWorkerIds: [user.id], actualPlantingItems: [],
  });
  assert.equal(receipt.id, 'report-1');
  assert.equal(receipt.saved, true);
  assert.equal(receipt.reviewLabel, 'Ожидает проверки');
});

test('real API: group final sends actual workers, planting geometry and independent draft version', async () => {
  const { gateway, calls } = writes({ report: { id: 'report-2', reviewStatus: 'pending' }, task: task() });
  const item = { plantingItemId: 'item-1', catalogItemId: 'catalog-1', quantity: 1, geometry: { type: 'Point', coordinates: [76.95, 52.28] }, note: null };
  await gateway.submitReport(payload({ submissionType: 'final', sharedPhotoIds: ['photo-shared'], actualWorkerIds: [user.id, 'worker-2'], actualPlantingItems: [{ ...item, localChecked: true, geometry: { ...item.geometry, bbox: [76.95, 52.28, 76.95, 52.28], localSource: 'map-editor' } }] }));
  assert.deepEqual(calls[0].body, {
    expectedVersion: 7, expectedDraftVersion: 2, note: 'Материалы работника', photoIds: ['photo-shared'], location,
    confirmedObservation, actualWorkerIds: [user.id, 'worker-2'], actualPlantingItems: [item],
  });
});

test('real API: issue combines reason and note into text without photo/report-only fields', async () => {
  const { gateway, calls } = writes({ id: 'issue-1' });
  const receipt = await gateway.submitIssue(payload({ reason: 'Нет доступа', note: 'Проход закрыт.' }));
  assert.deepEqual(bodyKeys(calls[0].body), ['confirmedObservation', 'expectedVersion', 'text']);
  assert.equal(calls[0].path, '/tasks/task-1/issues');
  assert.equal(calls[0].body.expectedVersion, 7);
  assert.match(calls[0].body.text, /Нет доступа/);
  assert.match(calls[0].body.text, /Проход закрыт\./);
  assert.deepEqual(calls[0].body.confirmedObservation, confirmedObservation);
  assert.equal(receipt.id, 'issue-1');
});

test('real API: confirmed observation uses a null proposed action when none was proposed', async () => {
  const { gateway, calls } = writes({ id: 'issue-1' });
  await gateway.submitIssue(payload({ reason: 'Нужна проверка', analysis: { ...analysis, proposedAction: undefined } }));
  assert.deepEqual(calls[0].body.confirmedObservation, { ...confirmedObservation, proposedAction: null });
});

test('real API: unconfirmed interpretation is not promoted into a confirmed observation', async () => {
  const { gateway, calls } = writes({ id: 'issue-1' });
  await gateway.submitIssue(payload({ reason: 'Нужна проверка', analysis: { ...analysis, decision: undefined, confirmedBy: undefined } }));
  assert.equal(calls[0].body.confirmedObservation, null);
});

test('real API: contribution and report photo limits reject excess without dropping evidence', async () => {
  const { gateway, calls } = writes({ id: 'unexpected' });
  await assert.rejects(gateway.submitReport(payload({ submissionType: 'contribution', photoIds: Array.from({ length: 11 }, (_, i) => `photo-${i}`) })));
  await assert.rejects(gateway.submitReport(payload({ submissionType: 'final', sharedPhotoIds: Array.from({ length: 21 }, (_, i) => `photo-${i}`) })));
  assert.equal(calls.length, 0);
});

test('real API: a report requires at least one actual worker', async () => {
  const { gateway, calls } = writes({ id: 'unexpected' });
  await assert.rejects(gateway.submitReport(payload({ submissionType: 'single', actualWorkerIds: [] })));
  assert.equal(calls.length, 0);
});

test('real API: uploading sends multipart file/taskId and keeps the binary content URL', async () => {
  const photo = new File(['image bytes'], 'photo.png', { type: 'image/png' });
  const { gateway, calls } = writes({ id: 'upload-1', taskId: 'task-1', contentUrl: '/api/v1/uploads/upload-1', mediaType: 'image/webp' });
  const upload = await gateway.uploadPhoto({ file: photo, taskId: 'task-1', idempotencyKey: 'operation-1:photo' });
  assert.equal(calls[0].path, '/uploads');
  assert.ok(calls[0].body instanceof FormData);
  assert.deepEqual([...calls[0].body.keys()], ['file', 'taskId']);
  assert.equal(calls[0].body.get('taskId'), 'task-1');
  assert.equal(calls[0].body.get('file').name, 'photo.png');
  assert.equal(calls[0].headers['Idempotency-Key'], 'operation-1:photo');
  assert.equal(upload.contentUrl, '/api/v1/uploads/upload-1');
  assert.equal(upload.url, upload.contentUrl);
});

test('real API: interpretation sends only taskId/text, includes an action key and retains proposedAction', async () => {
  const { gateway, calls } = writes({ category: 'needs_inspection', extractedFacts: ['Повреждена опора'], proposedAction: 'inspect', evidenceIds: [], missingData: [], method: 'rules' });
  const result = await gateway.analyzeNote({ taskId: 'task-1', objectId: 'plant-1', text: 'Повреждена опора', idempotencyKey: 'interpret-1' });
  assert.equal(calls[0].path, '/observations/interpret');
  assert.deepEqual(calls[0].body, { taskId: 'task-1', text: 'Повреждена опора' });
  assert.equal(calls[0].headers['Idempotency-Key'], 'interpret-1');
  assert.equal(result.proposedAction, 'inspect');
  assert.equal(result.provenance.proposedAction, 'inspect');
});

function readGateway({ tasks = [task()], reports = [], design, catalog = [], crews = [], workers = [], resources = [], actor = user, pageSize = 1 } = {}) {
  const calls = [];
  const paged = (items, url) => {
    assert.ok(Number(url.searchParams.get('limit')) > 0 && Number(url.searchParams.get('limit')) <= 200, 'all list requests must use a supported explicit limit');
    const offset = Number(url.searchParams.get('offset') || 0);
    return { data: items.slice(offset, offset + pageSize), meta: { limit: pageSize, offset, total: items.length } };
  };
  const gateway = createContractGateway({ user: actor, request: async (method, path) => {
    assert.equal(method, 'GET'); calls.push(path);
    const url = new URL(path, 'http://test.invalid');
    if (url.pathname === '/tasks') { assert.equal(url.searchParams.has('date'), false); return paged(tasks, url); }
    if (url.pathname === '/reports') return paged(reports.filter(r => r.taskId === url.searchParams.get('taskId')), url);
    if (url.pathname === '/crews') return paged(crews, url);
    if (url.pathname === '/workers') return paged(workers, url);
    if (url.pathname === '/resources') return paged(resources, url);
    if (url.pathname === '/plant-catalog') return paged(catalog, url);
    if (url.pathname.startsWith('/plant-catalog/')) return { data: catalog.find(c => c.id === decodeURIComponent(url.pathname.split('/').at(-1))) };
    if (url.pathname.startsWith('/designs/')) return { data: design };
    if (url.pathname.endsWith('/context')) return { data: { id: 'context-1', version: 1 } };
    if (url.pathname.endsWith('/report-draft')) return { data: { taskId: 'task-1', version: 2, contributions: [], summary: null } };
    if (url.pathname.startsWith('/tasks/')) return { data: tasks.find(t => t.id === decodeURIComponent(url.pathname.split('/').at(-1))) };
    if (url.pathname.startsWith('/plants/') || url.pathname.startsWith('/sites/')) return { data: { id: 'object-1', name: 'Точка', lat: 52.28, lng: 76.95, isDemo: true } };
    throw new Error(`Unexpected endpoint: ${path}`);
  } });
  return { gateway, calls };
}

test('real API: paginated tasks are filtered locally by scheduledStart on the UTC+5 boundary', async () => {
  const { gateway, calls } = readGateway({ tasks: [
    task({ id: 'before-midnight', scheduledStart: '2026-10-28T18:59:59Z' }),
    task({ id: 'at-midnight', scheduledStart: '2026-10-28T19:00:00Z' }),
    task({ id: 'next-day', scheduledStart: '2026-10-29T19:00:00Z' }),
  ] });
  const result = await gateway.listTasks({ date: '2026-10-29' });
  assert.deepEqual(result.map(t => t.id), ['at-midnight']);
  const pages = calls.filter(p => new URL(p, 'http://test.invalid').pathname === '/tasks').map(p => new URL(p, 'http://test.invalid'));
  assert.deepEqual(pages.map(p => Number(p.searchParams.get('offset') || 0)), [0, 1, 2]);
});

test('real API: report history loads subsequent pages and uses authenticated binary photo URLs', async () => {
  const { gateway } = readGateway({ reports: [
    { id: 'report-old', taskId: 'task-1', note: 'Первый', photoIds: [], reviewStatus: 'changes_requested', createdAt: '2026-10-28T10:00:00Z' },
    { id: 'report-new', taskId: 'task-1', note: 'Исправлен', photoIds: ['photo-1'], reviewStatus: 'pending', createdAt: '2026-10-29T10:00:00Z' },
  ] });
  const result = await gateway.getTask('task-1');
  assert.equal(result.history.length, 2);
  assert.equal(result.history[1].photoUrl, '/api/v1/uploads/photo-1');
});

test('real API: crew, worker and resource pages are fully loaded', async () => {
  const { gateway } = readGateway({ actor: { id: 'foreman-1', role: 'foreman' },
    crews: [{ id: 'foreign', foremanId: 'foreman-2', active: true }, { id: 'mine', foremanId: 'foreman-1', active: true }],
    workers: [{ id: 'worker-1' }, { id: 'worker-2' }], resources: [{ id: 'resource-1' }, { id: 'resource-2' }],
  });
  const workspace = await gateway.getCrewWorkspace();
  assert.deepEqual(workspace.crews.map(c => c.id), ['mine']);
  assert.equal(workspace.workers.length, 2);
  assert.equal(workspace.resources.length, 2);
});

test('real API: crew memberships include own foreman and active embedded members, overriding stale worker crewIds', async () => {
  const { gateway, calls } = readGateway({ actor: { id: 'foreman-1', role: 'foreman' }, crews: [
    { id: 'crew-1', foremanId: 'foreman-1', active: true, members: [{ userId: 'worker-1', active: true }] },
    { id: 'crew-2', foremanId: 'foreman-1', active: true, members: [{ userId: 'worker-1', active: false }, { userId: 'worker-2', active: true }] },
    { id: 'foreign-crew', foremanId: 'foreman-2', active: true, members: [{ userId: 'worker-3', active: true }] },
  ], workers: [{ id: 'worker-1' }, { id: 'worker-2' }, { id: 'worker-3', crewIds: ['crew-1'] }, { id: 'foreman-1' }] });
  const workspace = await gateway.getCrewWorkspace();
  assert.deepEqual(workspace.workers.map(w => [w.id, w.crewIds]), [['worker-1', ['crew-1']], ['worker-2', ['crew-2']], ['worker-3', []], ['foreman-1', ['crew-1', 'crew-2']]]);
  assert.equal(calls.some(p => p.includes('/members')), false);
});

test('real API: assignment sends only expectedVersion and workerIds with the supplied operation key', async () => {
  const mutations = [];
  const foreman = { id: 'foreman-1', role: 'foreman' };
  const assigned = task({ status: 'assigned', assignedWorkerIds: ['foreman-1', user.id] });
  const gateway = createContractGateway({ user: foreman, request: async (method, path, options) => {
    if (method === 'POST') { mutations.push({ path, ...options }); return { data: assigned }; }
    if (path === '/tasks/task-1') return { data: assigned };
    if (path.startsWith('/crews?')) return { data: [{ id: 'crew-1', foremanId: foreman.id, active: true }], meta: { offset: 0, limit: 200, total: 1 } };
    if (path.startsWith('/plants/')) return { data: { id: 'plant-1', name: 'Точка', lat: 52.28, lng: 76.95 } };
    if (path.startsWith('/reports?')) return { data: [], meta: { offset: 0, limit: 200, total: 0 } };
    throw new Error(`Unexpected endpoint: ${path}`);
  } });
  await gateway.assignWorkers('task-1', { expectedVersion: 7, workerIds: ['foreman-1', user.id], idempotencyKey: 'assign-once',
    responsibleUserId: user.id, scheduledStart: '2026-10-29T08:00:00Z', scheduledEnd: '2026-10-29T09:00:00Z' });
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].path, '/tasks/task-1/assign-workers');
  assert.deepEqual(mutations[0].body, { expectedVersion: 7, workerIds: ['foreman-1', user.id] });
  assert.equal(mutations[0].headers['Idempotency-Key'], 'assign-once');
});

test('real API: foreman reads the exact approved revision and only that revision catalog items', async () => {
  const revision = { id: 'design-1', revision: 2, status: 'approved', plantingItems: [{ id: 'item-1', catalogItemId: 'catalog-approved' }] };
  const { gateway } = readGateway({ actor: { id: 'foreman-1', role: 'foreman' }, crews: [{ id: 'crew-1', foremanId: 'foreman-1', active: true }], tasks: [task({ approvedDesignId: 'design-1', approvedDesignVersion: 2, action: 'plant', assignedWorkerIds: ['foreman-1'] })],
    design: { id: 'design-1', revisions: [revision, { ...revision, revision: 3, plantingItems: [{ id: 'new', catalogItemId: 'catalog-later' }] }] },
    catalog: [{ id: 'catalog-later' }, { id: 'catalog-approved' }, { id: 'catalog-unused' }],
  });
  const result = await gateway.getTask('task-1');
  assert.deepEqual(result.design, revision);
  assert.equal(result.designCurrent, true);
  assert.equal(result.permissions.report, true);
  assert.deepEqual(result.catalog.map(c => c.id), ['catalog-approved']);
});

test('real API: worker sees the approved revision without requesting the forbidden catalog route', async () => {
  const revision = { id: 'design-1', revision: 2, status: 'approved', plantingItems: [{ id: 'item-1', catalogItemId: 'catalog-approved' }] };
  const { gateway, calls } = readGateway({ tasks: [task({ approvedDesignId: 'design-1', approvedDesignVersion: 2 })], design: { id: 'design-1', revisions: [revision] } });
  const result = await gateway.getTask('task-1');
  assert.deepEqual(result.design, revision);
  assert.deepEqual(result.catalog, []);
  assert.equal(calls.some(p => p.startsWith('/plant-catalog')), false);
});

test('real API: an unavailable approved revision blocks writes instead of showing a later design', async () => {
  const { gateway } = readGateway({ tasks: [task({ approvedDesignId: 'design-1', approvedDesignVersion: 2 })],
    design: { id: 'design-1', revisions: [{ id: 'design-1', revision: 3, status: 'approved', plantingItems: [] }] },
  });
  const result = await gateway.getTask('task-1');
  assert.equal(result.designCurrent, false);
  assert.equal(result.permissions.start, false);
  assert.equal(result.permissions.report, false);
  assert.equal(result.design, null);
  assert.deepEqual(result.catalog, []);
});

test('real API UI: approved design renders when a context feature has unknown geometry', () => {
  const context = { features: [{ id: 'utility-unknown', featureType: 'utility', name: 'Подземная сеть', geometry: null }] };
  const approved = task({ approvedDesignId: 'design-1', approvedDesignVersion: 2, designCurrent: true, context,
    design: { id: 'design-1', revision: 2, status: 'approved', name: 'Утверждённая посадка', plantingItems: [{ id: 'item-1', catalogItemId: 'catalog-1', quantity: 1, geometry: { type: 'Point', coordinates: [76.95, 52.28] } }] },
    catalog: [{ id: 'catalog-1', displayName: 'Дерево' }],
  });
  const labels = { staleDesign: 'Ревизия недоступна', noScheme: 'Нет схемы', approvedDesign: 'Утверждённый проект', revision: 'Ревизия', taskVersion: 'Версия задания', schemeLabel: 'Схема посадки', schemeDemo: 'Учебная схема', schemeSources: 'Источники', schemeLegend: 'Легенда', noData: 'Нет данных', pieces: 'шт.', noConceptPhoto: 'Фото не приложено' };
  const markup = scheme(approved, labels);
  assert.match(markup, /<svg\b/);
  assert.equal((markup.match(/<circle\b/g) || []).length, 1);
  assert.match(markup, /Утверждённая посадка/);
  assert.match(markup, /Дерево/);
  assert.doesNotMatch(markup, /NaN|Infinity/);
  assert.deepEqual(context.features, [{ id: 'utility-unknown', featureType: 'utility', name: 'Подземная сеть', geometry: null }]);
});

function httpResponse(status, value) { return { ok: status >= 200 && status < 300, status, json: async () => value }; }
const header = (options, name) => new Headers(options.headers).get(name);
async function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { await run(); } finally { globalThis.fetch = original; }
}

test('real API: POST, PUT and PATCH include CSRF and preserve cookie credentials', async () => {
  await withFetch(async (_url, options) => {
    assert.equal(header(options, 'X-CSRF-Token'), 'session-token');
    assert.equal(options.credentials, 'same-origin');
    return httpResponse(200, { data: {} });
  }, async () => {
    const request = createV2Transport({ headersFor: () => ({ 'X-CSRF-Token': 'session-token' }) });
    for (const method of ['POST', 'PUT', 'PATCH']) await request(method, '/test', { body: { expectedVersion: 7 } });
  });
});

test('real API: logout sends an explicit empty JSON object with CSRF and accepts 204', async () => {
  const calls = [];
  await withFetch(async (url, options) => {
    calls.push({ url, ...options });
    return { ok: true, status: 204, json: async () => { throw new Error('204 has no JSON body'); } };
  }, async () => {
    const request = createV2Transport({ csrfToken: 'session-token' });
    assert.equal(await request('POST', '/auth/logout', { body: {} }), null);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/v1/auth/logout');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body, '{}');
  assert.equal(header(calls[0], 'Content-Type'), 'application/json');
  assert.equal(header(calls[0], 'X-CSRF-Token'), 'session-token');
  assert.equal(calls[0].credentials, 'same-origin');
});

test('real API: absent CSRF token is loaded before mutation and reused for the next action', async () => {
  const calls = [], sessions = [];
  await withFetch(async (url, options) => {
    calls.push({ url, ...options });
    return httpResponse(200, { data: url.endsWith('/auth/me') ? { user, csrfToken: 'loaded-token' } : { id: 'saved' } });
  }, async () => {
    const request = createV2Transport({ onSessionRefreshed: session => sessions.push(session) });
    await request('PATCH', '/test', { body: { version: 1 } });
    await request('PUT', '/test', { body: { version: 2 } });
  });
  assert.deepEqual(calls.map(c => [c.method, c.url]), [['GET', '/api/v1/auth/me'], ['PATCH', '/api/v1/test'], ['PUT', '/api/v1/test']]);
  assert.equal(header(calls[1], 'X-CSRF-Token'), 'loaded-token');
  assert.equal(header(calls[2], 'X-CSRF-Token'), 'loaded-token');
  assert.deepEqual(sessions, [{ user, csrfToken: 'loaded-token' }]);
});

test('real API: login response supplies CSRF for subsequent mutations without a redundant refresh', async () => {
  const calls = [];
  await withFetch(async (url, options) => {
    calls.push({ url, ...options });
    return httpResponse(200, { data: url.endsWith('/auth/login') ? { user, csrfToken: 'login-token' } : { id: 'saved' } });
  }, async () => {
    const request = createV2Transport();
    await request('POST', '/auth/login', { body: { username: 'worker1', password: 'test-only' } });
    await request('POST', '/test', { body: { version: 1 } });
  });
  assert.deepEqual(calls.map(c => c.url), ['/api/v1/auth/login', '/api/v1/test']);
  assert.equal(header(calls[1], 'X-CSRF-Token'), 'login-token');
});

test('real API: CSRF_REQUIRED refreshes once and retries identical action with refreshed token', async () => {
  const calls = [];
  await withFetch(async (url, options) => {
    calls.push({ url, ...options });
    if (url === '/api/v1/auth/me') return httpResponse(200, { data: { user, csrfToken: 'fresh-token' } });
    return calls.length === 1 ? httpResponse(403, { error: { code: 'CSRF_REQUIRED', message: 'CSRF required', requestId: 'request-first' } }) : httpResponse(200, { data: { id: 'issue-1' } });
  }, async () => {
    const request = createV2Transport({ headersFor: () => ({ 'X-CSRF-Token': 'stale-token' }) });
    const body = { expectedVersion: 7, text: 'Нет доступа' };
    assert.deepEqual(await request('POST', '/tasks/task-1/issues', { body, headers: { 'Idempotency-Key': 'same-action' } }), { data: { id: 'issue-1' } });
  });
  assert.deepEqual(calls.map(c => [c.method, c.url]), [['POST', '/api/v1/tasks/task-1/issues'], ['GET', '/api/v1/auth/me'], ['POST', '/api/v1/tasks/task-1/issues']]);
  assert.equal(header(calls[2], 'X-CSRF-Token'), 'fresh-token');
  assert.equal(header(calls[0], 'Idempotency-Key'), header(calls[2], 'Idempotency-Key'));
  assert.equal(calls[0].body, calls[2].body);
});

test('real API: repeated CSRF_REQUIRED stops after one refresh and exposes the final requestId', async () => {
  let mutations = 0, refreshes = 0;
  await withFetch(async (url) => {
    if (url === '/api/v1/auth/me') { refreshes++; return httpResponse(200, { data: { user, csrfToken: 'fresh-token' } }); }
    mutations++;
    return httpResponse(403, { error: { code: 'CSRF_REQUIRED', message: 'CSRF required', requestId: `request-${mutations}` } });
  }, async () => {
    const request = createV2Transport({ headersFor: () => ({ 'X-CSRF-Token': 'stale-token' }) });
    await assert.rejects(request('PATCH', '/test', { body: {} }), e => e.status === 403 && e.code === 'CSRF_REQUIRED' && e.requestId === 'request-2');
  });
  assert.equal(mutations, 2);
  assert.equal(refreshes, 1);
});

test('real API: multipart CSRF retry keeps the same file and lets fetch set its boundary', async () => {
  const form = new FormData();
  form.append('file', new File(['photo'], 'photo.png', { type: 'image/png' }));
  form.append('taskId', 'task-1');
  const writes = [];
  await withFetch(async (url, options) => {
    if (url.endsWith('/auth/me')) return httpResponse(200, { data: { user, csrfToken: 'fresh-token' } });
    writes.push(options);
    return writes.length === 1 ? httpResponse(403, { error: { code: 'CSRF_REQUIRED' } }) : httpResponse(201, { data: { id: 'photo-1', contentUrl: '/api/v1/uploads/photo-1' } });
  }, async () => {
    const request = createV2Transport({ csrfToken: 'stale-token' });
    await request('POST', '/uploads', { body: form, headers: { 'Idempotency-Key': 'photo-once' } });
  });
  assert.equal(writes.length, 2);
  for (const write of writes) {
    assert.equal(write.body, form);
    assert.equal(Object.keys(write.headers).some(k => k.toLowerCase() === 'content-type'), false);
    assert.equal(header(write, 'Idempotency-Key'), 'photo-once');
    assert.equal(write.credentials, 'same-origin');
  }
});

test('real API: permission and network failures are never automatically retried as CSRF', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return httpResponse(403, { error: { code: 'FORBIDDEN', message: 'Role cannot write' } }); }, async () => {
    const request = createV2Transport({ csrfToken: 'session-token' });
    await assert.rejects(request('POST', '/test', { body: {} }), e => e.code === 'FORBIDDEN');
  });
  assert.equal(calls, 1);
  calls = 0;
  await withFetch(async () => { calls++; throw new TypeError('Network failure'); }, async () => {
    const request = createV2Transport({ csrfToken: 'session-token' });
    await assert.rejects(request('POST', '/test', { body: {} }), /Network failure/);
  });
  assert.equal(calls, 1);
});

test('real API: explicit network retry keeps action body/key and a new action uses a new key', async () => {
  const calls = [];
  const gateway = createContractGateway({ user, request: async (method, path, options) => {
    calls.push({ method, path, ...structuredClone(options) });
    if (calls.length === 1) throw new TypeError('Response lost');
    return { data: { id: 'issue-1' } };
  } });
  const action = payload({ reason: 'Нет доступа' });
  await assert.rejects(gateway.submitIssue(action), /Response lost/);
  await gateway.submitIssue(action);
  await gateway.submitIssue({ ...action, idempotencyKey: 'operation-2', note: 'Новое наблюдение' });
  assert.deepEqual(calls[0], calls[1]);
  assert.notEqual(calls[1].headers['Idempotency-Key'], calls[2].headers['Idempotency-Key']);
});

test('real API: start retry retains its original version/key after a lost response', async () => {
  const mutations = [];
  let current = task({ status: 'assigned' });
  const gateway = createContractGateway({ user, request: async (method, path, options) => {
    if (method === 'POST') {
      assert.equal(path, '/tasks/task-1/start');
      mutations.push(structuredClone(options));
      current = task({ version: 8, status: 'in_progress' });
      if (mutations.length === 1) throw new TypeError('Response lost');
      return { data: current };
    }
    if (path === '/tasks/task-1') return { data: current };
    if (path.startsWith('/plants/')) return { data: { id: 'plant-1', name: 'Точка', lat: 52.28, lng: 76.95 } };
    if (path.startsWith('/reports')) return { data: [], meta: { offset: 0, limit: 200, total: 0 } };
    throw new Error(`Unexpected endpoint: ${path}`);
  } });
  await assert.rejects(gateway.startTask('task-1'), /Response lost/);
  await gateway.startTask('task-1');
  assert.deepEqual(mutations[0], mutations[1]);
  assert.deepEqual(mutations[0].body, { expectedVersion: 7 });
  assert.ok(mutations[0].headers['Idempotency-Key']);
  await gateway.startTask('task-1', { expectedVersion: 8, idempotencyKey: 'explicit-new-action' });
  assert.equal(mutations[2].headers['Idempotency-Key'], 'explicit-new-action');
  assert.deepEqual(mutations[2].body, { expectedVersion: 8 });
});

test('real API: concurrent starts share one operation while the task version is still loading', async () => {
  const mutations = [];
  let releaseVersion;
  const versionReady = new Promise(resolve => { releaseVersion = resolve; });
  let reads = 0;
  const gateway = createContractGateway({ user, request: async (method, path, options) => {
    if (method === 'POST') { mutations.push(structuredClone(options)); return { data: task({ version: 8 }) }; }
    if (path === '/tasks/task-1') {
      reads++;
      await versionReady;
      return { data: task({ version: mutations.length ? 8 : 7, status: mutations.length ? 'in_progress' : 'assigned' }) };
    }
    if (path.startsWith('/plants/')) return { data: { id: 'plant-1', name: 'Точка', lat: 52.28, lng: 76.95 } };
    if (path.startsWith('/reports')) return { data: [], meta: { offset: 0, limit: 200, total: 0 } };
    throw new Error(`Unexpected endpoint: ${path}`);
  } });
  const first = gateway.startTask('task-1');
  const second = gateway.startTask('task-1');
  releaseVersion();
  const [firstTask, secondTask] = await Promise.all([first, second]);
  assert.equal(mutations.length, 1);
  assert.equal(reads, 2, 'one initial version read and one post-write refresh');
  assert.deepEqual(mutations[0].body, { expectedVersion: 7 });
  assert.ok(mutations[0].headers['Idempotency-Key']);
  assert.deepEqual(firstTask, secondTask);
  assert.equal(firstTask.status, 'in_progress');
});
