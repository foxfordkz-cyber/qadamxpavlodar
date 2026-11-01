import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ru, kk, kkDraft, dictionary } from '../../../apps/web/src/features/worker/strings.mjs';
import { TASK_STATUSES, ROLE_LABELS, OBSERVATION_CATEGORIES } from '../../../apps/web/src/features/worker/contract-v2.mjs';
import { REASONS } from '../../../apps/web/src/features/worker/workflow.mjs';

function leaves(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === 'string' ? [[path, child]] : leaves(child, path);
  });
}

test('worker locale: canonical Kazakh and legacy alias have complete independent dictionary parity', () => {
  const russian = new Map(leaves(ru)), kazakh = new Map(leaves(kk));
  assert.deepEqual([...kazakh.keys()].sort(), [...russian.keys()].sort());
  assert.equal(dictionary('kk'), kk);
  assert.equal(dictionary('kk-draft'), kk);
  assert.equal(kkDraft, kk);
  assert.equal(dictionary('ru'), ru);
  assert.equal(dictionary('unsupported'), ru);
  // These proper names, borrowed words and unit symbols are genuinely shared.
  const shared = new Set(['brand', 'journalNav', 'profile', 'session', 'demo',
    'roleNames.foreman', 'minuteUnit', 'kbUnit', 'meterUnit']);
  for (const [key, value] of kazakh) {
    assert.ok(value.trim(), `empty Kazakh value: ${key}`);
    assert.doesNotMatch(value, /undefined|\[object Object\]|TODO|M\d{1,2}/, key);
    if (!shared.has(key)) assert.notEqual(value, russian.get(key), `untranslated value: ${key}`);
    assert.deepEqual([...value.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort(),
      [...russian.get(key).matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort(), `placeholder mismatch: ${key}`);
    assert.deepEqual(value.match(/\d+/g) ?? [], russian.get(key).match(/\d+/g) ?? [], `numeric constraint changed: ${key}`);
  }
});

test('worker locale: domain labels cover canonical values without translating payload identifiers', () => {
  for (const locale of [ru, kk]) {
    assert.deepEqual(Object.keys(locale.roleNames).sort(), Object.keys(ROLE_LABELS).sort());
    assert.deepEqual(Object.keys(locale.statusNames).sort(), [...TASK_STATUSES, 'changes_requested'].sort());
    assert.deepEqual(Object.keys(locale.observationNames).sort(), Object.keys(OBSERVATION_CATEGORIES).sort());
    assert.deepEqual(Object.keys(locale.reasonNames), REASONS);
    assert.deepEqual(Object.keys(locale.actionNames).sort(), ['inspect', 'plant', 'water', 'weed']);
    assert.deepEqual(Object.keys(locale.skillNames).sort(), Object.keys(locale.actionNames).sort());
    assert.equal(locale.monthNames.length, 12);
    assert.equal(new Set(locale.monthNames).size, 12);
    assert.equal(locale.weekdayNames.length, 7);
    assert.equal(new Set(locale.weekdayNames).size, 7);
  }
  assert.equal(kk.monthNames[9], 'қазан');
  assert.equal(kk.weekdayNames[0], 'жексенбі');
  assert.equal(kk.reviewNames.accepted, 'Үйлестіруші қабылдады');
  assert.equal(kk.statusNames.changes_requested, 'Түзету қажет');
  assert.match(kk.issueSaved, /орындалғанын растамайды/);
  assert.match(kk.geoEvidence, /дәлелі емес/);
});

test('worker locale: known local errors are covered from their real source messages', async () => {
  const messages = new Set();
  for (const name of ['workflow.mjs', 'field-values.mjs', 'contract-v2.mjs', 'gateway.mjs']) {
    const source = await readFile(new URL(`../../../apps/web/src/features/worker/${name}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/new Error\(\s*(['"])(.*?)\1\s*\)/g)) messages.add(match[2]);
  }
  assert.deepEqual(Object.keys(ru.errorMessages).sort(), [...messages].sort());
  assert.deepEqual(Object.keys(kk.errorMessages).sort(), [...messages].sort());
  for (const message of messages) {
    assert.equal(ru.errorMessages[message], message);
    assert.ok(kk.errorMessages[message].trim());
    assert.notEqual(kk.errorMessages[message], message);
  }
  assert.equal(kk.errorPhotoTooLarge.match(/\{mb\}/g)?.length, 1);
  assert.equal(kk.errorPhotoCount.match(/\{maximum\}/g)?.length, 1);
  assert.match(kk.errorMessages['Неоднозначную отправку нужно повторить с тем же ключом.'], /сол кілтпен/);
  assert.match(kk.errorMessages['Нет подтверждения сохранения. Повторите отправку с тем же ключом.'], /сол кілтпен/);
});
