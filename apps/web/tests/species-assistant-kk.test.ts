import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { strFromU8, unzipSync } from 'fflate';
import osm from '../../../fixtures/osm/sites.json';
import baseline from './fixtures/rules-ru.json';
import { species } from '../src/shared/api/mock/species';
import type { CandidateSite } from '../src/shared/api/types';
import { answer, type AskContext } from '../src/shared/analytics/assistant';
import { analyzeZone } from '../src/shared/analytics/plan';
import { DEFAULT_RATES, ratesMap } from '../src/shared/analytics/rates';
import { getLang, setLang, speciesName } from '../src/shared/i18n';
import { SpeciesCardFull } from '../src/features/coordinator/species/SpeciesCardGrid';
import { buildMemoDocx } from '../src/shared/export/memo';

const sites = osm.sites as unknown as CandidateSite[];
const rates = ratesMap(DEFAULT_RATES);
const numericTokens = (s: string) => s.match(/\d+(?:[.,]\d+)?/g);

test('speciesName: язык, русский запасной вариант, пустое имя и неизвестный ID', () => {
  const prev = getLang(), sp = species.find(s => s.id === 'sp-pinus-sylvestris')!;
  try {
    setLang('kk'); assert.equal(speciesName(sp), 'Кәдімгі қарағай');
    assert.equal(speciesName({ ...sp, nameKk: null }), sp.nameRu);
    assert.equal(speciesName({ ...sp, nameKk: '  ' }), sp.nameRu);
    assert.equal(speciesName(undefined, 'missing'), 'missing');
    assert.equal(speciesName(sp, '', 'ru'), sp.nameRu);
    setLang('ru'); assert.equal(speciesName(sp), sp.nameRu);
    assert.equal(speciesName(sp, '', 'kk'), 'Кәдімгі қарағай');
  } finally { setLang(prev); }
});

test('каталог: казахское название в заголовке и alt, латынь сохранена', () => {
  const prev = getLang(), sp = species.find(s => s.id === 'sp-pinus-sylvestris')!;
  try {
    setLang('kk');
    const html = renderToStaticMarkup(createElement(SpeciesCardFull, { s: sp }));
    assert.ok(html.includes('>Кәдімгі қарағай</h3>'));
    assert.ok(html.includes('alt="Кәдімгі қарағай"'));
    assert.ok(html.includes('Pinus sylvestris'));
    setLang('ru');
    assert.ok(renderToStaticMarkup(createElement(SpeciesCardFull, { s: sp })).includes(`>${sp.nameRu}</h3>`));
  } finally { setLang(prev); }
});

test('Word: виды и рекомендации используют язык документа, неизвестные названия остаются русскими', () => {
  const site = sites[0], analysis = analyzeZone(site, species, rates);
  const input = { zones: [{ site, analysis }], species, rates: DEFAULT_RATES, evidence: [], generatedAt: '2026-10-29T12:00:00Z', source: 'mock' as const };
  const text = (lang: 'ru' | 'kk') => strFromU8(unzipSync(buildMemoDocx(input, lang))['word/document.xml']);
  for (const row of analysis.scheme) {
    const sp = species.find(s => s.id === row.speciesId)!;
    assert.ok(text('ru').includes(sp.nameRu));
    assert.ok(text('kk').includes(sp.nameKk || sp.nameRu));
  }
});

for (const example of baseline) test(`правила RU неизменны: ${example.id} (снимок до перевода, 590f55a)`, () => {
  const data = example.unknownArea ? sites.map((s, i) => i === 0 ? { ...s, areaM2: null } : s) : sites;
  const prev = getLang();
  try {
    setLang('kk'); // Russian question stays Russian even when the interface is Kazakh.
    const { text, intent, zones } = answer(example.question, example.ctx as AskContext, data, species, rates);
    assert.deepEqual({ text, intent, zones }, example.expected);
  } finally { setLang(prev); }
});

test('правила KK без модели: приоритеты, порядок зон и все числа совпадают с RU', () => {
  const ctx = { siteId: null }, prev = getLang();
  const before = structuredClone({ sites, species, rates });
  try {
    setLang('ru');
    const ru = answer('Какие зоны озеленять в первую очередь?', ctx, sites, species, rates);
    const kk = answer('Бірінші кезекте қай аумақтарды көгалдандыру керек?', ctx, sites, species, rates);
    assert.equal(kk.method, 'rules'); assert.equal(kk.intent, 'priority');
    assert.match(kk.text, /^Басымдық индексі бойынша алғашқы бестік/);
    assert.doesNotMatch(kk.text, /Первая пятёрка|Дефицит зелени|Плотность застройки|Данных о районах/);
    assert.deepEqual(numericTokens(kk.text), numericTokens(ru.text));
    assert.deepEqual(kk.zones, ru.zones);
    assert.deepEqual({ sites, species, rates }, before);
    assert.equal(getLang(), 'ru');
    assert.equal(answer('Басымдық?', ctx, sites, species, rates).text, kk.text);
  } finally { setLang(prev); }
});

test('правила KK: бюджет и проблемы используют те же расчёты, шаблоны не протекают', () => {
  for (const [ruQ, kkQ, intent] of [
    ['Бюджет 50 млн', '50 млн бюджетке қандай аумақтарды көгалдандыруға болады?', 'budget'],
    ['Проблемные зоны', 'Қандай мәселелі аймақтар бар?', 'problems'],
    ['Какой эффект?', 'Қандай экологиялық әсер болады?', 'effect'],
  ]) {
    const ctx = { siteId: sites[0].id };
    const ru = answer(ruQ, ctx, sites, species, rates), kk = answer(kkQ, ctx, sites, species, rates);
    assert.equal(kk.intent, intent); assert.equal(kk.method, 'rules');
    assert.deepEqual(numericTokens(kk.text), numericTokens(ru.text));
    assert.deepEqual(kk.zones, ru.zones);
    assert.deepEqual(kk.data, ru.data);
    assert.doesNotMatch(kk.text, /Жадный выбор|Выявлено проблем|Деградация насаждений:|поглощение CO₂|\{\w+\}/);
  }
});

test('правила KK: состав посадки показывает названия каталога без изменения подбора', () => {
  const ctx = { siteId: sites[0].id };
  const ru = answer('Что посадить?', ctx, sites, species, rates);
  const kk = answer('Қандай өсімдіктер отырғызу керек?', ctx, sites, species, rates);
  assert.equal(kk.intent, 'select'); assert.deepEqual(numericTokens(kk.text), numericTokens(ru.text));
  const a = analyzeZone(sites[0], species, rates);
  for (const row of a.scheme) assert.ok(kk.text.includes(speciesName(species.find(s => s.id === row.speciesId), '', 'kk')));
  assert.doesNotMatch(kk.text, /Лучшие виды|Полив и уход|Расценки демонстрационные/);
});

test('правила KK: факты помечены как цитаты на исходном языке, источники и числа сохранены', () => {
  const ctx = { siteId: null };
  const ru = answer('Климат Павлодара', ctx, sites, species, rates);
  const kk = answer('Климат Павлодара қандай?', ctx, sites, species, rates);
  assert.equal(kk.intent, 'facts');
  assert.match(kk.text, /^Дереккөздердегі мәліметтер \(түпнұсқа тілінде\):/);
  assert.ok(kk.text.endsWith(ru.text));
  assert.deepEqual(kk.sources, ru.sources);
});
