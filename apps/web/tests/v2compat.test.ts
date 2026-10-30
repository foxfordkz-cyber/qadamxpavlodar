import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, type HttpMethod, type RequestOptions, type Transport } from '../src/shared/api/transport';
import {
  brigadeFromV2, checksToV2, createV2CompatTransport, errorFromV2, issueFromV2,
  itemFromV2, itemToV2, projectFromDesign, reportFromV2, siteFromV2, taskFromV2, workerFromV2,
} from '../src/shared/api/v2compat';

// Expectations follow types.ts and V2 schemas, not a second implementation of the adapter.
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const point = () => ({ type: 'Point', coordinates: [76.95, 52.28] });
const task = () => ({ id: 'task-1', objectType: 'plant', objectId: 'tree-1', action: 'water',
  description: 'Test task', priority: 'high', status: 'planned', estimatedMinutes: 30, version: 7,
  createdAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T01:00:00Z' });
const design = () => ({ id: 'design-1', siteId: 'site-1', name: 'Test design', version: 9,
  revision: 3, status: 'draft', createdBy: 'coordinator-1', createdAt: '2026-10-28T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z' });
type Call = { method: HttpMethod; path: string; options: RequestOptions };
function transport(reply: (call: Call) => { data: unknown; meta?: Record<string, unknown> } | Promise<{ data: unknown; meta?: Record<string, unknown> }>) {
  const calls: Call[] = [];
  const http: Transport = { kind: 'api', async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}) {
    const call = { method, path, options }; calls.push(call);
    return await reply(call) as { data: T; meta?: Record<string, unknown> };
  } };
  return { api: createV2CompatTransport(http), calls };
}

test('V2 site: reviewer identity, not_applicable and legacy missingData retain their meaning', () => {
  const input = freeze({ id: 'site-1', version: 4, areaM2: 0, geometry: point(), isDemo: true,
    futureField: { version: 2 }, evidenceIds: ['e1'], missingData: ['No soil test', { field: 'water', reason: 'No source' }],
    checks: { landPermission: { status: 'not_applicable', comment: null, reviewedByName: 'Reviewer', reviewedBy: 'user-1', reviewedAt: '2026-10-29' },
      utilities: { status: 'blocked', comment: 'Cable', reviewedBy: 'user-2' }, access: { comment: '' } } });
  const out = siteFromV2(input);
  assert.deepEqual(out.checks.landPermission, { state: 'cleared', comment: null, checkedBy: 'Reviewer', checkedAt: '2026-10-29' });
  assert.deepEqual(out.checks.utilities, { state: 'blocked', comment: 'Cable', checkedBy: 'user-2', checkedAt: null });
  assert.equal(out.checks.access.state, 'unknown'); assert.deepEqual(out.checks.siteSuitability, { state: 'unknown' });
  assert.deepEqual(out.missingData, [{ field: 'site', reason: 'No soil test' }, { field: 'water', reason: 'No source' }]);
  assert.equal(out.areaM2, 0); assert.equal(out.version, 4); assert.deepEqual(out.evidenceIds, ['e1']);
  assert.deepEqual((out as unknown as Record<string, unknown>).futureField, { version: 2 });
  assert.equal(input.checks.landPermission.status, 'not_applicable');
});

test('V2 site: absent nullable collections do not manufacture completed checks or evidence', () => {
  for (const input of [{ id: 'site' }, { id: 'site', checks: null, evidenceIds: null, missingData: null }]) {
    const out = siteFromV2(freeze(input));
    assert.deepEqual(Object.values(out.checks), Array.from({ length: 4 }, () => ({ state: 'unknown' })));
    assert.deepEqual(out.evidenceIds, []); assert.deepEqual(out.missingData, []); assert.equal(out.isDemo, false);
  }
});

test('V2 checks write: only selected checks, trimmed comments and explicit unknown', () => {
  const input = freeze({ utilities: { state: 'blocked' as const, comment: '  Cable  ' }, access: { state: 'unknown' as const, comment: '' } });
  assert.deepEqual(checksToV2(input), { utilities: { status: 'blocked', comment: 'Cable' }, access: { status: 'unknown', comment: 'Проверка не выполнена.' } });
  assert.equal(input.utilities.comment, '  Cable  '); assert.deepEqual(checksToV2({}), {});
});

test('V2 task: assignment, crew, design and concurrency version survive mapping', () => {
  const input = freeze({ ...task(), assignedWorkerIds: ['worker-a', 'worker-b'], assignedCrewId: 'crew', minWorkers: 2,
    approvedDesignId: 'design', approvedDesignVersion: 3, requiredWaterLiters: 0, evidenceIds: ['e1'], futureField: 'ignored' });
  const out = taskFromV2(input);
  assert.equal(out.assigneeId, 'worker-a'); assert.deepEqual(out.crewIds, ['worker-a', 'worker-b']);
  assert.equal(out.brigadeId, 'crew'); assert.equal(out.minCrew, 2); assert.equal(out.projectId, 'design');
  assert.equal(out.projectDesignVersion, 3); assert.equal(out.version, 7); assert.equal(out.priorityWeight, 3);
  assert.equal(out.requiredWaterLiters, 0); assert.deepEqual(out.evidenceIds, ['e1']);
  assert.equal(out.status, 'planned'); assert.equal('futureField' in out, false);
});

test('V2 task: no assignment is null/empty, zero duration and water are not replaced', () => {
  const out = taskFromV2(freeze({ ...task(), assignedWorkerIds: [], estimatedMinutes: 0, requiredWaterLiters: null }));
  for (const key of ['assigneeId', 'brigadeId', 'scheduledStart', 'scheduledEnd', 'projectId', 'projectDesignVersion', 'dueAt', 'latestReportId', 'minCrew', 'requiredWaterLiters'] as const) assert.equal(out[key], null, key);
  assert.equal(out.estimatedMinutes, 0); assert.deepEqual(out.crewIds, []); assert.deepEqual(out.evidenceIds, []);
  assert.equal(out.isDemo, false);
  for (const [priority, expected] of [['low', 1], ['medium', 2], ['high', 3], ['critical', 4], ['future', 2]] as const)
    assert.equal(taskFromV2({ ...task(), priority }).priorityWeight, expected);
});

test('V2 people: missing profile has no invented availability; active members are deduplicated', () => {
  const empty = workerFromV2(freeze({ id: 'worker-a', displayName: 'Worker', role: 'worker', active: true, profile: null, futureField: true }));
  assert.deepEqual(empty, { id: 'worker-a', displayName: 'Worker', role: 'worker', active: true,
    shiftStart: '', shiftEnd: '', capacityMinutes: 0, skills: [], startLocation: null });
  const workers = [empty, workerFromV2({ id: 'foreman', profile: { shiftStart: '08:00', shiftEnd: '17:00', capacityMinutes: 420, skills: ['water'] } }),
    workerFromV2({ id: 'worker-b', profile: { shiftStart: '09:00', shiftEnd: '18:00', capacityMinutes: 480, skills: ['water', 'prune'] } })];
  const crew = freeze({ id: 'crew', name: 'Crew', foremanId: 'foreman', active: true, resourceIds: ['truck', 'unlisted'],
    members: [{ userId: 'worker-b', active: true }, { userId: 'worker-b', active: true }, { userId: 'worker-a', active: false }] });
  const out = brigadeFromV2(crew, workers, [{ id: 'truck', label: 'Water truck' }]);
  assert.deepEqual(out.memberIds, ['foreman', 'worker-b']); assert.deepEqual(out.skills, ['water', 'prune']);
  assert.deepEqual(out.equipment, ['Water truck', 'unlisted']); assert.equal(out.shiftStart, '08:00'); assert.equal(out.shiftEnd, '18:00');
  assert.equal(out.capacityMinutes, 480);
  const withoutProfiles = brigadeFromV2({ id: 'empty', foremanId: 'unknown' }, []);
  assert.equal(withoutProfiles.capacityMinutes, 0); assert.equal(withoutProfiles.shiftStart, ''); assert.deepEqual(withoutProfiles.skills, []);
});

test('V2 items: legacy MultiPoint, polygon beds, zero quantity and explicit evidence', () => {
  const legacy = freeze({ id: 'i1', catalogItemId: 'species-1', geometry: { type: 'MultiPoint', coordinates: [[76.9, 52.2], [76.91, 52.21]] }, quantity: 0 });
  const out = itemFromV2(legacy);
  assert.deepEqual(out.geometry, { type: 'Point', coordinates: [76.9, 52.2] });
  assert.equal(out.quantity, 0); assert.equal(out.speciesId, 'species-1'); assert.equal(out.kind, 'point');
  const bed = itemFromV2({ id: 'bed', catalogItemId: 'flowers', geometry: { type: 'Polygon', coordinates: [] }, note: '  note  ', conflicts: [{ type: 'utility', message: 'Cable', resolution: '  confirmed  ' }] });
  assert.equal(bed.kind, 'bed'); assert.equal(bed.quantity, 1);
  const body = itemToV2(freeze(bed), ['evidence-1']);
  assert.equal(body.catalogItemId, 'flowers'); assert.deepEqual(body.evidenceIds, ['evidence-1']);
  assert.equal(body.note, 'note'); assert.equal(body.conflicts[0].resolution, 'confirmed');
  assert.equal(body.spacingM, null); assert.equal(body.bedAreaM2, null);
});

test('V2 project: current revision does not overwrite the last approved planting composition', () => {
  const previous = { ...design(), revision: 1, status: 'approved', approvedBy: 'admin-id', approvedByName: 'Admin', approvedAt: '2026-10-28', plantingItems: [{ id: 'old', catalogItemId: 'species-old', geometry: point(), quantity: 2 }] };
  const returned = { ...design(), revision: 2, status: 'changes_requested', reviewedBy: 'reviewer', reviewedAt: '2026-10-29', reviewComment: 'Revise' };
  const current = { ...design(), plantingItems: [{ id: 'new', catalogItemId: 'species-new', geometry: point(), quantity: 5 }], createdByName: 'Specialist' };
  const history = freeze([previous, returned, current]);
  const out = projectFromDesign(freeze(current), history);
  assert.equal(out.version, 9); assert.equal(out.designVersion, 3); assert.equal(out.status, 'draft');
  assert.equal(out.items[0].speciesId, 'species-new'); assert.equal(out.approved?.items[0].speciesId, 'species-old');
  assert.equal(out.approved?.designVersion, 1); assert.equal(out.approved?.by, 'Admin'); assert.equal(out.createdBy, 'Specialist');
  assert.deepEqual(out.reviews.map(r => [r.decision, r.designVersion, r.by]), [['approved', 1, 'Admin'], ['returned', 2, 'reviewer']]);
  assert.equal(history[0].revision, 1); assert.equal(out.implementedAt, null);
});

test('V2 project: absent items/reviews stay empty and statuses map to the web contract', () => {
  for (const [status, expected] of [['draft', 'draft'], ['submitted', 'submitted'], ['changes_requested', 'returned'], ['approved', 'approved'], ['future', 'draft']]) {
    const out = projectFromDesign(freeze({ ...design(), status }));
    assert.equal(out.status, expected); assert.deepEqual(out.items, []); assert.equal(out.isDemo, false);
    if (status === 'draft' || status === 'submitted') { assert.equal(out.approved, null); assert.deepEqual(out.reviews, []); }
  }
});

test('V2 reports and issues: optional text/photos default without losing confirmed observations', () => {
  const input = freeze({ id: 'report', taskId: 'task', photoIds: null, note: null, version: 3, futureField: 12 });
  const report = reportFromV2(input);
  assert.deepEqual(report.photoIds, []); assert.equal(report.note, ''); assert.equal(report.version, 3);
  assert.equal((report as unknown as Record<string, unknown>).futureField, 12);
  const observation = { state: 'unknown', evidenceIds: [] };
  const issue = issueFromV2(freeze({ id: 'issue', taskId: 'task', text: 'Missing info', confirmedObservation: observation }), 'plant');
  assert.equal(issue.objectId, 'plant'); assert.deepEqual(issue.confirmedObservation, observation);
  assert.equal(issueFromV2({ id: 'issue' }, 'plant').confirmedObservation, null);
});

test('V2 errors: status, request ID and details survive normalization; network errors are unchanged', () => {
  const details = { expected: 4, actual: 5 };
  const out = errorFromV2(new ApiError(409, 'VERSION_CONFLICT', 'conflict', 'request-1', details)) as ApiError;
  assert.equal(out.status, 409); assert.equal(out.code, 'version_conflict'); assert.equal(out.requestId, 'request-1'); assert.equal(out.details, details);
  const issues = [{ path: ['checks', 'utilities'], message: 'Comment required' }, { path: ['checks'], message: 'Second' }, { path: [], message: 'Invalid form' }];
  const validation = errorFromV2(new ApiError(400, 'VALIDATION_ERROR', 'invalid', 'r', issues)) as ApiError;
  assert.deepEqual(validation.details, { fields: { checks: 'Comment required', form: 'Invalid form' }, issues });
  for (const error of [new ApiError(0, 'NETWORK', 'offline'), new ApiError(503, 'offline', 'offline'), new Error('local')]) assert.equal(errorFromV2(error), error);
  assert.equal((errorFromV2(new ApiError(500, 'FUTURE_ERROR', 'Future', 'id')) as ApiError).code, 'future_error');
});

test('V2 transport: site write preserves zero water, version and a supplied idempotency key', async () => {
  const { api, calls } = transport(() => ({ data: { id: 'site/1', version: 8 } }));
  await api.request('PATCH', '/sites/site%2F1', { idempotencyKey: 'stable', body: {
    expectedVersion: 7, checks: { utilities: { state: 'blocked', comment: ' Cable ' } }, waterAvailability: { value: 0, note: 'No supply' } } });
  assert.deepEqual(calls, [{ method: 'PATCH', path: '/sites/site%2F1', options: { idempotencyKey: 'stable', body: {
    expectedVersion: 7, checks: { utilities: { status: 'blocked', comment: 'Cable' } }, waterAvailability: { value: 0, note: 'No supply' } } } }]);
});

test('V2 transport: task list paginates, translates assignee filter and keeps object filtering', async () => {
  const { api, calls } = transport(({ options }) => ({ data: options.query?.offset === 0
    ? Array.from({ length: 200 }, (_, n) => ({ ...task(), id: `t${n}`, objectId: n === 0 ? 'selected' : 'other' }))
    : [{ ...task(), id: 'last', objectId: 'selected' }], meta: { total: 201 } }));
  const out = await api.request<{ id: string }[]>('GET', '/tasks', { query: { assigneeId: 'worker', status: 'planned', objectId: 'selected' } });
  assert.deepEqual(out.data.map(t => t.id), ['t0', 'last']); assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(c => c.options.query), [0, 200].map(offset => ({ workerId: 'worker', status: 'planned', limit: 200, offset })));
});

test('V2 transport: creating a normal task sends contract fields, not client role/assignment', async () => {
  const { api, calls } = transport(() => ({ data: task() }));
  await api.request('POST', '/tasks', { idempotencyKey: 'task-key', body: { objectType: 'plant', objectId: 'tree', action: 'water',
    description: ' Water ', priority: 'critical', estimatedMinutes: 10, requiredWaterLiters: 0, evidenceIds: ['e1'], role: 'admin', assigneeId: 'spoofed' } });
  assert.deepEqual(calls[0], { method: 'POST', path: '/tasks', options: { idempotencyKey: 'task-key', body: {
    objectType: 'plant', objectId: 'tree', action: 'water', description: 'Water', priority: 'critical', priorityWeight: 100,
    dueAt: null, estimatedMinutes: 10, requiredWaterLiters: 0, minWorkers: 1, requiredSkills: ['water'], evidenceIds: ['e1'] } } });
});

test('V2 transport: planting uses approved design release and cannot become an ordinary task', async () => {
  const { api, calls } = transport(({ method }) => ({ data: method === 'GET' ? { ...design(), version: 9 } : [task()] }));
  await assert.rejects(api.request('POST', '/tasks', { body: { action: 'plant', objectType: 'candidate_site' } }), (e: ApiError) => e.code === 'validation_error');
  assert.equal(calls.length, 0);
  await api.request('POST', '/tasks', { idempotencyKey: 'release', body: { action: 'plant', objectType: 'candidate_site', projectId: 'design/1', projectDesignVersion: 2, estimatedMinutes: 45 } });
  assert.deepEqual(calls.map(c => [c.method, c.path]), [['GET', '/designs/design%2F1'], ['POST', '/designs/design%2F1/create-tasks']]);
  assert.deepEqual(calls[1].options, { idempotencyKey: 'release', body: { expectedVersion: 9, revision: 2, estimatedMinutes: 45, minWorkers: 1, requiredSkills: ['plant'] } });
});

test('V2 transport: assignment preserves caller version and computes end from server duration', async () => {
  const { api, calls } = transport(() => ({ data: task() }));
  await assert.rejects(api.request('POST', '/tasks/t1/assign', { body: { scheduledStart: null } }), (e: ApiError) => e.code === 'validation_error');
  assert.equal(calls.length, 0);
  await api.request('POST', '/tasks/t1/assign', { idempotencyKey: 'assign', body: { brigadeId: 'crew', minCrew: 2, expectedVersion: 6, scheduledStart: '2026-10-30T08:00:00+05:00' } });
  assert.deepEqual(calls[1], { method: 'POST', path: '/tasks/t1/assign', options: { idempotencyKey: 'assign', body: {
    expectedVersion: 6, crewId: 'crew', minWorkers: 2, scheduledStart: '2026-10-30T08:00:00+05:00', scheduledEnd: '2026-10-30T03:30:00.000Z', resourceIds: [] } } });
});

test('V2 transport: report review keeps independent task and report versions', async () => {
  const { api, calls } = transport(({ method }) => ({ data: method === 'GET' ? { id: 'report', version: 4 } : { report: { id: 'report', version: 5 }, task: task() } }));
  await api.request('POST', '/reports/report/review', { idempotencyKey: 'review', body: { expectedTaskVersion: 7, decision: 'changes_requested', comment: ' Correct ' } });
  assert.deepEqual(calls[1].options, { idempotencyKey: 'review', body: { expectedVersion: 7, expectedReportVersion: 4, decision: 'changes_requested', comment: 'Correct', acceptGeometryDeviation: false } });
});

test('V2 transport: project review/submit/withdraw preserve version and do not invent approval', async () => {
  const { api, calls } = transport(() => ({ data: design() }));
  await api.request('POST', '/projects/design-1/review', { idempotencyKey: 'return', body: { decision: 'returned', comment: ' Revise ', expectedVersion: 9 } });
  assert.deepEqual(calls[0], { method: 'POST', path: '/designs/design-1/review', options: { idempotencyKey: 'return', body: { decision: 'changes_requested', comment: 'Revise', expectedVersion: 9 } } });
  for (const action of ['submit', 'withdraw']) await api.request('POST', `/projects/design-1/${action}`, { idempotencyKey: action, body: { expectedVersion: 10 } });
  assert.deepEqual(calls.filter(c => c.method === 'POST').slice(1).map(c => [c.path, c.options]), ['submit', 'withdraw'].map(action => [`/designs/design-1/${action}`, { idempotencyKey: action, body: { expectedVersion: 10 } }]));
});

test('V2 transport: unknown routes pass through with signal, body and idempotency intact', async () => {
  const envelope = { data: { id: 'snapshot' }, meta: { source: 'api' } };
  const { api, calls } = transport(() => envelope);
  const options = { body: { expectedVersion: 3 }, idempotencyKey: 'forecast', signal: new AbortController().signal };
  assert.equal(await api.request('POST', '/outcomes/snapshots', options), envelope);
  assert.equal(calls[0].options, options);
});

test('V2 transport: failed requests stay failed without mock success or a write retry', async () => {
  const { api, calls } = transport(() => { throw new ApiError(409, 'VERSION_CONFLICT', 'stale', 'request-42', { actual: 8 }); });
  await assert.rejects(api.request('PATCH', '/sites/site', { body: { expectedVersion: 7 }, idempotencyKey: 'same' }), (e: ApiError) => {
    assert.equal(e.status, 409); assert.equal(e.code, 'version_conflict'); assert.equal(e.requestId, 'request-42'); assert.deepEqual(e.details, { actual: 8 }); return true;
  });
  assert.equal(calls.length, 1);
  await assert.rejects(api.request('POST', '/plans/2026-10-30/approve', { body: {} }), (e: ApiError) => e.status === 503 && e.code === 'integration_unavailable');
  assert.equal(calls.length, 1);
});
