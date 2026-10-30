import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { fixture } from './helpers.js';
import { seedV2, DEMO_PASSWORD } from '../src/v2/seed.js';
import { seedTz } from '../src/tz/seed.js';
import { seedMunicipal } from '../src/municipal/data.js';
import { insertDoc } from '../src/v2/core.js';
import { today } from '../src/outcomes/shared.js';

// Exercise the published web readers against HTTP, without a second formula implementation.
// The expected counts below are independent, explicit arithmetic for four synthetic trees.
const readers = await import(new URL('../../web/src/shared/api/outcomes-reader.ts', import.meta.url).href);
const siteId = 'site-osm-1569993037';
const cohortId = 'compat-synthetic-cohort';
const plantIds = [1, 2, 3, 4].map(n => `compat-synthetic-tree-${n}`);

async function setup(t: TestContext) {
  const f = await fixture(t);
  await seedV2(f.store); seedTz(f.store); await seedMunicipal(f.store);
  for (const id of plantIds) insertDoc(f.store, 'plant', {
    id, siteId, speciesId: 'sp-pinus-sylvestris', species: 'Pinus sylvestris',
    kind: 'tree', plantedAt: null, isDemo: true, version: 1,
  });
  insertDoc(f.store, 'evidence', {
    id: 'outcomes-demo-evidence', sourceType: 'fixture', dataClass: 'demo', isDemo: true, version: 1,
  });
  const sessions = new Map<string, { cookie: string; csrf: string }>();
  let sequence = 0;
  async function session(user: string) {
    if (!sessions.has(user)) {
      const r = await fetch(f.base + '/api/v1/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: user, password: DEMO_PASSWORD }),
      });
      assert.equal(r.status, 200, `Login ${user}`);
      const body = await r.json();
      sessions.set(user, { cookie: r.headers.get('set-cookie')!.split(';')[0]!, csrf: body.data.csrfToken });
    }
    return sessions.get(user)!;
  }
  async function call(path: string, method = 'GET', body?: unknown, user = 'coordinator') {
    const auth = await session(user);
    const r = await fetch(f.base + '/api/v1' + path, {
      method, headers: {
        Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf,
        'Content-Type': 'application/json', 'Idempotency-Key': `compat-${++sequence}`,
      }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  }
  assert.equal((await call('/outcomes/cohorts', 'POST', {
    id: cohortId, siteId, plantIds, plantedOn: null, snapshotId: null, evidenceIds: [], expectedVersion: 0,
  })).status, 201);
  const date = today();
  const previousDate = new Date(Date.parse(`${date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const observation = (index: number, state: 'alive' | 'dead' | 'unknown') => ({
    plantId: plantIds[index]!, state, reportId: null,
    evidenceIds: state === 'unknown' ? [] : ['outcomes-demo-evidence'],
  });
  for (const inspection of [
    { id: 'compat-partial', observedOn: previousDate, expectedVersion: 1,
      observations: [observation(0, 'alive'), observation(1, 'unknown')] },
    { id: 'compat-latest', observedOn: date, expectedVersion: 2,
      observations: [observation(0, 'alive'), observation(1, 'dead'), observation(2, 'unknown')] },
  ]) {
    const r = await call(`/outcomes/cohorts/${cohortId}/inspections`, 'POST', { ...inspection, evidenceIds: [] });
    assert.equal(r.status, 201, `Synthetic inspection ${inspection.id}`);
  }
  return { ...f, call, session, date };
}

test('Outcomes compatibility: real HTTP and offline readers preserve explicit selection and unknown counts', async t => {
  const f = await setup(t);
  const auth = await f.session('viewer');
  const request: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers); headers.set('Cookie', auth.cookie);
    return fetch(f.base + String(input), { ...init, headers });
  };
  const api = readers.apiOutcomesReader(request);
  const record = await api.get(cohortId);
  const history = await api.history(cohortId);
  const mock = readers.mockOutcomesReader([record], history.data, f.date);
  assert.deepEqual(await mock.get(cohortId), record);
  assert.deepEqual(await mock.history(cohortId), history);
  assert.deepEqual(history.data.map((r: { data: { id: string } }) => r.data.id), ['compat-partial', 'compat-latest']);

  const cases = [
    { id: undefined, inspected: 0, assessed: 0, alive: 0, dead: 0, unknown: 4, notInspected: 4,
      inspectionCoveragePct: 0, assessmentCoveragePct: 0, survivalAmongAssessedPct: null },
    { id: 'compat-partial', inspected: 2, assessed: 1, alive: 1, dead: 0, unknown: 3, notInspected: 2,
      inspectionCoveragePct: 50, assessmentCoveragePct: 25, survivalAmongAssessedPct: 100 },
    { id: 'compat-latest', inspected: 3, assessed: 2, alive: 1, dead: 1, unknown: 2, notInspected: 1,
      inspectionCoveragePct: 75, assessmentCoveragePct: 50, survivalAmongAssessedPct: 50 },
  ];
  for (const { id, ...counts } of cases) {
    const fromApi = await api.summary(cohortId, id);
    const fromMock = await mock.summary(cohortId, id);
    assert.deepEqual(fromApi, fromMock, 'Same DTOs, date and selected inspection must produce the same result');
    assert.deepEqual(fromApi.data.summary, {
      cohortId, inspectionId: id ?? null, total: 4, ...counts,
      wholeCohortSurvivalPct: null, dataClass: 'demo', isDemo: true,
    });
    assert.equal(fromApi.data.comparison.comparable, false);
    for (const key of ['expectedAlive', 'expectedSurvivalPct', 'observedSurvivalPct', 'differencePp'])
      assert.equal(fromApi.data.comparison[key], null, key);
  }
  await assert.rejects(api.summary(cohortId, 'missing-inspection'), { status: 404, code: 'NOT_FOUND' });
  await assert.rejects(mock.summary(cohortId, 'missing-inspection'), /Inspection not found/);
});

test('Outcomes compatibility: saving forecasts after a rate update never replaces observations or earlier snapshots', async t => {
  const f = await setup(t);
  const sitePath = `/outcomes/sites/${siteId}`;
  const before = (await f.call(sitePath)).body.data;
  const previousSummary = (await f.call(`/outcomes/cohorts/${cohortId}/summary?inspectionId=compat-partial`)).body.data;
  const site = (await f.call(`/sites/${siteId}`)).body.data;
  const rates = (await f.call('/rates')).body.data;
  const input = {
    id: 'compat-first-forecast', siteId, expectedVersion: site.version,
    expectedRatesVersion: rates.version, variant: 'econom',
  };
  const first = await f.call('/outcomes/snapshots', 'POST', input);
  assert.equal(first.status, 201);

  const rate = rates.rates.find((r: { key: string }) => r.key === 'soil.prep');
  assert.equal(typeof rate.value, 'number');
  const updated = await f.call('/rates', 'PATCH', {
    key: rate.key, value: rate.value + 100, source: 'Synthetic compatibility test in disposable database',
    expectedVersion: rates.version,
  }, 'admin');
  assert.equal(updated.status, 200);
  assert.equal((await f.call('/outcomes/snapshots', 'POST', { ...input, id: 'compat-second-forecast' })).status, 409);
  const second = await f.call('/outcomes/snapshots', 'POST', {
    ...input, id: 'compat-second-forecast', expectedRatesVersion: updated.body.data.version,
  });
  assert.equal(second.status, 201);
  assert.ok(second.body.data.snapshot.outcome.cost.totalKzt > first.body.data.snapshot.outcome.cost.totalKzt);

  const after = (await f.call(sitePath, 'GET', undefined, 'viewer')).body.data;
  assert.deepEqual(after.cohorts, before.cohorts, 'Saving a forecast cannot attach it retrospectively to an existing cohort');
  assert.deepEqual(after.inspections, before.inspections, 'All historical observations retain their original contents');
  assert.deepEqual(after.registry, before.registry);
  assert.equal(after.forecasts.length, before.forecasts.length + 2, 'Stale save must not add another snapshot');
  assert.deepEqual(after.forecasts.find((f: { id: string }) => f.id === input.id).snapshot, first.body.data.snapshot);
  assert.deepEqual(after.forecasts.find((f: { id: string }) => f.id === 'compat-second-forecast').snapshot, second.body.data.snapshot);
  assert.deepEqual((await f.call(`/outcomes/cohorts/${cohortId}/summary?inspectionId=compat-partial`)).body.data, previousSummary);
});
