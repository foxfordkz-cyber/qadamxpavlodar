import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/shared/api/api';
import { createMockTransport, mockControls } from '../src/shared/api/mock/server';
import { loadMemo, MemoRatesChanged } from '../src/shared/export/loadMemo';
import { buildMemoDocx, memoEvidenceIds } from '../src/shared/export/memo';
import { strFromU8, unzipSync } from 'fflate';

test('mock: экспорт выбранных зон с источниками и параметрами отчёта', async () => {
  mockControls.latencyMs = 0;
  const api = createApi(createMockTransport());
  const sites = (await api.sites()).data.slice(0, 2);
  const input = await loadMemo(api, sites.map(s => s.id), { variant: 'econom', careYears: 3 }, 'mock');
  assert.equal(input.zones.length, 2);
  assert.ok(input.zones.every(z => z.analysis.options.variant === 'econom' && z.analysis.options.careYears === 3));
  assert.ok(input.evidence.length > 0);
  assert.ok(memoEvidenceIds(input.zones, input.species).every(id => input.evidence.some(e => e.id === id)));
  const doc = strFromU8(unzipSync(buildMemoDocx(input))['word/document.xml']);
  assert.ok(doc.includes(sites[0].id) && doc.includes(sites[1].id));
});
test('экспорт прекращается при смене версии ставок и не скрывает ошибку источников', async () => {
  mockControls.latencyMs = 0;
  const api = createApi(createMockTransport()); const id = (await api.sites()).data[0].id;
  let version = 1;
  await assert.rejects(loadMemo({ ...api, rates: async () => ({ ...(await api.rates()), version: version++ }) }, [id], {}, 'mock'), MemoRatesChanged);
  await assert.rejects(loadMemo({ ...api, evidence: async () => { throw new Error('source unavailable'); } }, [id], {}, 'mock'), /source unavailable/);
});
