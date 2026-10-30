import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiOutcomesReader, mockOutcomesReader, type CohortRecord, type InspectionRecord } from '../src/shared/api/outcomes-reader';
const provenance = { source: 'mock' as const, capturedAt: '2026-10-30T00:00:00+05:00', dataClass: 'demo' as const, isDemo: true, evidenceIds: ['synthetic'], siteVersion: null, ratesVersion: null };
const cohort: CohortRecord = { data: { id: 'demo', siteId: 'demo-site', plants: [{ plantId: 'tree', speciesId: 'species' }], forecast: null, plantedOn: null, provenance, version: 1 }, meta: { createdAt: provenance.capturedAt, createdBy: 'demo-reviewer' } };
const inspection: InspectionRecord = { data: { id: 'inspection', cohortId: 'demo', observedOn: '2026-10-30', observations: [{ plantId: 'tree', state: 'unknown', reportId: null, evidenceIds: [] }], provenance, version: 1 }, meta: { createdAt: provenance.capturedAt, reviewerId: 'demo-reviewer' } };
test('outcomes offline reader preserves DTO envelopes, nulls, explicit selection and detached fixtures', async () => {
  const mock = mockOutcomesReader([cohort], [inspection], '2026-10-30');
  assert.deepEqual(await mock.get('demo'), cohort);
  assert.equal((await mock.history('demo')).data.length, 1);
  assert.equal((await mock.summary('demo')).data.summary.inspectionId, null);
  assert.equal((await mock.summary('demo', 'inspection')).data.summary.wholeCohortSurvivalPct, null);
  await assert.rejects(mock.summary('demo', 'foreign'));
  const list = await mock.list(); list.data.length = 0; assert.equal((await mock.list()).data.length, 1);
});
test('outcomes API reader uses session credentials and never masks failures with mock', async () => {
  const reader = apiOutcomesReader(async (url, options) => {
    assert.equal(url, '/api/v1/outcomes/cohorts/demo'); assert.equal(options?.credentials, 'include');
    return new Response(JSON.stringify(cohort), { status: 200 });
  });
  assert.deepEqual(await reader.get('demo'), cohort);
  const error = apiOutcomesReader(async () => new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'Sign in', requestId: 'test' } }), { status: 401 }));
  await assert.rejects(error.list(), { code: 'AUTH_REQUIRED', status: 401 });
  const offline = apiOutcomesReader(async () => { throw Error('Network unavailable'); });
  await assert.rejects(offline.list(), /Network unavailable/);
});
