import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { IMPORT_API_ACCEPT, IMPORT_TEXT_ACCEPT, localizedImportError, prepareImportFile } from '../src/features/coordinator/tz/importFile';
import { ApiError } from '../src/shared/api/transport';
import { parseFile } from '../src/features/coordinator/tz/ImportPage';
import { getLang, setLang, t } from '../src/shared/i18n';

test('SHP ZIP: preserve actual binary bytes and never decode the archive as text', async () => {
  const bytes = readFileSync('../../fixtures/imports/synthetic-zones.zip');
  const input = new File([bytes], 'LAYERS.ZIP');
  input.text = async () => { throw Error('Binary archive was decoded as text'); };
  const result = await prepareImportFile(input);
  assert.equal(result.format, 'shp');
  assert.deepEqual(Buffer.from(result.content, 'base64'), bytes);
  const entries = unzipSync(bytes);
  assert.deepEqual(Object.keys(entries).sort(), ['zones.cpg', 'zones.dbf', 'zones.prj', 'zones.shp', 'zones.shx']);
  assert.equal(new DataView(entries['zones.shp'].buffer).getInt32(0), 9994);
  assert.equal(new DataView(entries['zones.shp'].buffer).getInt32(32, true), 5);
});

test('text formats retain UTF-8 content and map JSON to GeoJSON', async () => {
  for (const [ext, format] of [['JSON', 'geojson'], ['geojson', 'geojson'], ['kml', 'kml'], ['CSV', 'csv']]) {
    const content = 'Аймақ;Дерек\n52.28;76.95';
    const result = await prepareImportFile(new File([content], `sample.${ext}`));
    assert.deepEqual(result, { format, content });
  }
});

test('reject oversized files before reading their content; accept the exact size limit', async () => {
  const oversized = { name: 'large.zip', size: 5 * 1024 * 1024 + 1,
    text: async () => { throw Error('unexpected text read'); }, arrayBuffer: async () => { throw Error('unexpected binary read'); } };
  await assert.rejects(prepareImportFile(oversized), { message: t('import.maxSize', { size: 5 }) });
  const limit = await prepareImportFile(new File([new Uint8Array(5 * 1024 * 1024)], 'limit.zip'));
  assert.equal(Buffer.from(limit.content, 'base64').length, 5 * 1024 * 1024);
});

test('bare SHP and unsupported extensions produce localized guidance in both languages', async () => {
  const previous = getLang();
  try {
    for (const lang of ['ru', 'kk'] as const) {
      setLang(lang);
      await assert.rejects(prepareImportFile(new File(['x'], 'zone.SHP')), { message: t('import.shpArchiveRequired') });
      await assert.rejects(prepareImportFile(new File(['x'], 'zone.pdf')), { message: t('dynamic.013', { p0: 'pdf' }) });
      assert.throws(() => parseFile('zone.zip', 'binary'), { message: t('import.shpMockHint') });
      if (lang === 'kk') assert.doesNotMatch(t('import.shpMockHint'), /загрузите|сервере|участник|поддерживает/i);
    }
  } finally { setLang(previous); }
});

test('ZIP is advertised only for connected-server import', () => {
  assert.ok(IMPORT_API_ACCEPT.split(',').includes('.zip'));
  assert.ok(!IMPORT_TEXT_ACCEPT.split(',').includes('.zip'));
  assert.ok(!IMPORT_API_ACCEPT.split(',').includes('.shp'));
});

test('localized archive failures preserve status, code, request ID and details; unknown failures stay intact', () => {
  const previous = getLang();
  try {
    for (const lang of ['ru', 'kk'] as const) {
      setLang(lang);
      const original = new ApiError(400, 'missing_crs', 'SHP requires .dbf and .prj', 'request-example', { field: 'content' });
      const translated = localizedImportError(original) as ApiError;
      assert.ok(translated instanceof ApiError);
      assert.equal(translated.message, t('import.errorCrs'));
      assert.equal(translated.status, original.status);
      assert.equal(translated.code, original.code);
      assert.equal(translated.requestId, original.requestId);
      assert.equal(translated.details, original.details);
      assert.equal(original.message, 'SHP requires .dbf and .prj');
      assert.equal((localizedImportError(new ApiError(400, 'MISSING_CRS', 'Raw server error')) as ApiError).message, translated.message);
      assert.equal((localizedImportError(new ApiError(413, 'file_too_large', 'ZIP limit 5 MiB')) as ApiError).message, t('import.maxSize', { size: 5 }));
      const forbidden = new ApiError(403, 'FORBIDDEN', 'Forbidden');
      assert.equal(localizedImportError(forbidden), forbidden);
      const network = new Error('Disconnected');
      assert.equal(localizedImportError(network), network);
    }
  } finally { setLang(previous); }
});
