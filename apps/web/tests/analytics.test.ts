import { test } from 'node:test';
import assert from 'node:assert/strict';
import osm from '../../../fixtures/osm/sites.json';
import { species } from '../src/shared/api/mock/species';
import type { CandidateSite, Species } from '../src/shared/api/types';
import { analyzeZone, costEstimate, survivalForecast, careCalendar, ecoEffect, DEFAULT_OPTIONS, type SchemeRow, type SurvivalRow } from '../src/shared/analytics/plan';
import { soilFor } from '../src/shared/analytics/zone';
import { detectProblems, priorities, roadmap, DEFAULT_PRIORITY_WEIGHTS, type PriorityItem } from '../src/shared/analytics/city';
import { DEFAULT_RATES, ratesMap } from '../src/shared/analytics/rates';
import { searchAddress } from '../src/shared/api/geocode';
import { validateTranslations } from '../src/shared/i18n/validate';
import { ru } from '../src/shared/i18n/ru';
import { kk } from '../src/shared/i18n/kk';
import { getLang, setLang, t } from '../src/shared/i18n';
import { buildMemoDocx, memoBlocks, type MemoInput } from '../src/shared/export/memo';
import { strFromU8, unzipSync } from 'fflate';
import { parseFile } from '../src/features/coordinator/tz/ImportPage';

const base = osm.sites[0] as unknown as CandidateSite;
const site = (): CandidateSite => structuredClone(base);
const rates = ratesMap(DEFAULT_RATES);
const opt = () => structuredClone(DEFAULT_OPTIONS);
const tree: Species = { ...species.find(s => s.form === 'tree')!, id: 'test-tree', pricePerUnitKzt: 100, crownDiameterM: 4, droughtTolerance: 'high' };
const catalog = new Map([[tree.id, tree]]);
const scheme: SchemeRow[] = [{ speciesId: tree.id, tier: 'tree', quantity: 2, locked: false }];
const survival: SurvivalRow[] = [{ speciesId: tree.id, y1: 80, y2: 75, y3: 50, low: 70, high: 90, risks: [] }];
const soil = { ...soilFor(base.centroid!.lat, base.centroid!.lng), salinity: 'none' as const };
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

test('смета: ручной контроль материала, подготовки, доставки, ухода и резерва', () => {
  const s = { ...site(), areaM2: 100 };
  const r = { 'soil.prep': 10, 'soil.salinity': 4, 'work.tree': 20, 'delivery.share': 10, 'care.tree': 30 };
  const result = costEstimate(s, scheme, catalog, survival, { ...opt(), careYears: 2 }, r, soil);
  assert.deepEqual(result.items.map(i => Math.round(i.amount)), [200, 600, 60, 120, 40]);
  close(result.total, 1020); close(result.perM2!, 10.2);
});
test('смета: неизвестная площадь не превращается в нулевую цену за м²', () => {
  assert.equal(costEstimate({ ...site(), areaM2: null }, scheme, catalog, survival, opt(), rates, soil).perM2, null);
});
test('смета: неизвестная цена вида использует указанную общую расценку', () => {
  const c = new Map([[tree.id, { ...tree, pricePerUnitKzt: null }]]);
  const result = costEstimate(site(), scheme, c, survival, opt(), { ...rates, 'price.tree': 70 }, soil);
  assert.equal(result.items.find(i => i.key === 'material')!.amount, 140);
});
test('смета: улучшение почвы и дополнительный год ухода имеют отдельную стоимость', () => {
  const a = costEstimate(site(), scheme, catalog, survival, opt(), rates, soil);
  const b = costEstimate(site(), scheme, catalog, survival, { ...opt(), improveSoil: true, careYears: 3 }, rates, soil);
  close(b.total - a.total, (base.areaM2 ?? 0) * 0.6 * rates['soil.salinity']! + 2 * rates['care.tree']!);
});
test('схема: без площади посадка не назначается', () => {
  const s = { ...site(), areaM2: null };
  assert.deepEqual(analyzeZone(s, species, rates).scheme, []);
});
test('схема: запрет сетей исключает деревья, ручное исключение вида сохраняется', () => {
  const s = site(); s.checks.utilities.state = 'blocked';
  assert.ok(analyzeZone(s, species, rates).scheme.every(r => r.tier !== 'tree'));
  const a = analyzeZone(site(), species, rates); const id = a.scheme[0].speciesId;
  assert.ok(analyzeZone(site(), species, rates, { excluded: [id] }).scheme.every(r => r.speciesId !== id));
});
test('приживаемость: вероятности ограничены, последующие годы не растут', () => {
  for (const variant of ['econom', 'optimal', 'max'] as const) for (const watering of ['regular', 'rare', 'none'] as const) {
    const a = analyzeZone(site(), species, rates, { variant, watering });
    for (const r of a.survival) { assert.ok(r.low <= r.y1 && r.y1 <= r.high && r.low >= 0 && r.high <= 100); assert.ok(r.y3 <= r.y2 && r.y2 <= r.y1); }
  }
});
test('приживаемость: изменение surv.base не меняет ML, но меняет сравнение с правилами', () => {
  const a = analyzeZone(site(), species, rates);
  const b = analyzeZone(site(), species, { ...rates, 'surv.base': 10 });
  assert.deepEqual(a.survival, b.survival); assert.notDeepEqual(a.survivalRules, b.survivalRules);
});
test('приживаемость: однолетники не продолжаются на второй год', () => {
  const flower = { ...tree, id: 'annual', form: 'flower' as const, nameRu: 'Тестовый однолетник' };
  const [r] = survivalForecast(site(), [{ ...scheme[0], speciesId: flower.id, tier: 'flower' }], new Map([[flower.id, flower]]), opt(), soil, rates);
  assert.equal(r.y2, 0); assert.equal(r.y3, 0);
});
test('уход: объём за один выезд и редкий полив', () => {
  const regular = careCalendar(scheme, catalog, soil, opt(), { ...rates, 'care.water.tree': 40 });
  const rare = careCalendar(scheme, catalog, soil, { ...opt(), watering: 'rare' }, rates);
  const july = regular.care.find(c => c.month === 7 && c.taskAction === 'water')!;
  assert.equal(july.waterLitersPerVisit, 80); assert.equal(july.visits, 8);
  assert.equal(rare.care.find(c => c.month === 7 && c.taskAction === 'water')!.visits, 4);
});
test('уход: нет нормы воды — неизвестный объём; цветник не подменяется деревом', () => {
  assert.equal(careCalendar(scheme, catalog, soil, opt(), { ...rates, 'care.water.tree': null }).care.find(c => c.month === 7 && c.taskAction === 'water')!.waterLitersPerVisit, null);
  assert.equal(careCalendar([{ ...scheme[0], tier: 'flower' }], catalog, soil, opt(), rates).care.find(c => c.month === 7 && c.taskAction === 'water')!.waterLitersPerVisit, null);
});
test('уход: ограничение выездов даёт предупреждение, календарь отсортирован', () => {
  const { care, warnings } = careCalendar(scheme, catalog, soil, opt(), { ...rates, 'care.visits': 1 });
  assert.ok(warnings.length > 0); assert.ok(care.every((c, i) => c.month >= 1 && c.month <= 12 && (i === 0 || c.month >= care[i - 1].month)));
});
test('экоэффект: единицы, выжившие деревья и горизонты', () => {
  const e = ecoEffect({ ...site(), areaM2: 1000 }, scheme, catalog, survival, { ...rates, 'eff.co2.tree': 20, 'eff.o2.ratio': 0.727, 'eff.rain.tree': 2000 });
  assert.deepEqual(e.map(r => r.years), [5, 10, 20]);
  close(e[0].co2t, 0.006); close(e[2].co2t, 0.02); close(e[2].o2t, 0.01454); close(e[2].rainM3, 2);
  assert.ok(e.every(r => r.dustKg === null));
});
test('экоэффект: крона не больше участка, пустая схема не создаёт CO₂', () => {
  const effects = ecoEffect({ ...site(), areaM2: 5 }, scheme, catalog, survival, rates);
  assert.ok(effects.every(e => e.canopyM2 <= 5 && e.coolingC <= rates['eff.cool.max']!));
  assert.ok(ecoEffect(site(), [], catalog, [], rates).every(e => e.co2t === 0 && e.rainM3 === 0));
});
test('analyzeZone не изменяет исходные данные и повторяем', () => {
  const s = site(); const before = structuredClone(s); const o = opt(); const a = analyzeZone(s, species, rates, o);
  assert.deepEqual(s, before); assert.deepEqual(o, DEFAULT_OPTIONS); assert.deepEqual(analyzeZone(s, species, rates, o), a);
  close(a.cost.total, a.cost.items.reduce((sum, i) => sum + i.amount, 0));
});
test('проблемы: дефицит, перегрев, защита у дороги; деградация без обследования не заявляется', () => {
  const s = site(); s.factors.greeneryGap.value = 90;
  s.context = { ...s.context, greenShare200m: 0.01, buildings200m: 55, nearestMajorRoadM: 10, osmTrees150m: 0, socialWithin400m: ['школа'] };
  const { problems, notDetectable } = detectProblems([s]);
  for (const type of ['deficit', 'heat', 'unprotected']) assert.ok(problems.some(p => p.type === type && p.severity === 'high'));
  assert.ok(problems.every(p => p.type !== 'degradation')); assert.ok(notDetectable.length);
  assert.ok(problems.find(p => p.type === 'heat')!.dataNote);
});
test('проблемы: неизвестные зелень и расстояние не доказывают дефицит или перегрев', () => {
  const s = site(); s.factors.greeneryGap.value = null; s.context = {};
  assert.ok(detectProblems([s]).problems.every(p => p.type === 'soil'));
  assert.deepEqual(detectProblems([]).problems, []);
});
test('приоритеты: масштаб весов не меняет рейтинг, один фактор управляет порядком', () => {
  const a = site(), b = site(); b.id = 'b'; a.context = { ...a.context, greenShare200m: 0 }; b.context = { ...b.context, greenShare200m: 0.3 };
  const w = { deficit: 1, density: 0, social: 0, load: 0, soil: 0, benefit: 0 };
  const result = priorities([b, a], species, rates, w);
  assert.deepEqual(result.map(r => [r.siteId, r.index]), [[a.id, 100], ['b', 0]]);
  assert.deepEqual(priorities([b, a], species, rates, { ...w, deficit: 10 }), result);
});
test('приоритеты: нулевые веса и пустой набор безопасны', () => {
  assert.deepEqual(priorities([], species, rates, DEFAULT_PRIORITY_WEIGHTS), []);
  assert.equal(priorities([site()], species, rates, { deficit: 0, density: 0, social: 0, load: 0, soil: 0, benefit: 0 })[0].index, 0);
});
const priority = (id: string, cost: number, co2t20 = 1): PriorityItem => ({ siteId: id, cost, co2t20, index: 90, factors: { deficit: 0, density: 0, social: 0, load: 0, soil: 0, benefit: 0 }, explanation: [] });
test('дорожная карта: пропускает дорогую зону, сохраняет порядок и точную границу бюджета', () => {
  const rows = [priority('expensive', 101), priority('a', 70, 2), priority('b', 30, 3), priority('c', 1)];
  const result = roadmap(rows, 100);
  assert.deepEqual(result.chosen.map(r => r.siteId), ['a', 'b']); assert.equal(result.spent, 100); assert.equal(result.left, 0); assert.equal(result.co2t20, 5);
  assert.equal(rows.length, 4);
});
test('дорожная карта: нулевой бюджет и пустой список', () => {
  assert.equal(roadmap([priority('a', 1)], 0).chosen.length, 0); assert.equal(roadmap([], 40).left, 40);
});
test('ratesMap: нулевой тариф отличается от неизвестного; оригинал не изменяется', () => {
  const entries = [{ ...DEFAULT_RATES[0], value: 0 }, { ...DEFAULT_RATES[1], value: null }];
  const result = ratesMap(entries); assert.equal(result[entries[0].key], 0); assert.equal(result[entries[1].key], null);
  result[entries[0].key] = 10; assert.equal(entries[0].value, 0); assert.deepEqual(ratesMap([]), {});
  assert.equal(new Set(DEFAULT_RATES.map(r => r.key)).size, DEFAULT_RATES.length);
});
test('геокодер: пустой, числовой и неизвестный запрос не выдумывают адрес', () => {
  for (const q of ['', '   ', '12345', 'zzzznonexistent']) assert.deepEqual(searchAddress(q), []);
});
test('геокодер: казахские буквы, регистр и отсутствие координат зоны', () => {
  const zones = [{ id: 'test', name: 'Қазақ бағы', centroid: { lng: 76.95, lat: 52.28 } }, { id: 'unknown', name: 'Қазақ бағы' }];
  const hits = searchAddress('ҚАЗАҚ', zones); const hit = hits.find(h => h.zoneId === 'test');
  assert.ok(hit); assert.equal(hit.lng, 76.95); assert.equal(hit.lat, 52.28); assert.ok(!hits.some(h => h.zoneId === 'unknown'));
});
test('геокодер: локальные адреса из снимка, ограничение и уникальность', () => {
  const hits = searchAddress('Торайгырова 1/5'); assert.ok(hits.length); assert.equal(hits[0].kind, 'address');
  assert.ok(hits[0].label.includes('1/5'));
  assert.ok(hits.every(h => h.lng > 76 && h.lng < 78 && h.lat > 51 && h.lat < 53));
  const short = searchAddress('Лермонтова', [], 2); assert.ok(short.length <= 2); assert.equal(new Set(short.map(h => h.label)).size, short.length);
});
test('i18n: полный словарь, параметры и реальная проверка испорченного перевода', () => {
  assert.deepEqual(validateTranslations(ru, kk), { missing: [], extra: [], placeholders: [] });
  assert.deepEqual(validateTranslations({ a: '{x} {y}', b: 'b' }, { a: '{x} {x}', c: 'c' }), { missing: ['b'], extra: ['c'], placeholders: ['a'] });
});
test('i18n: переключение и русская подстановка отсутствующего перевода', () => {
  const before = getLang(); const saved = kk['state.retry'];
  try { setLang('kk'); assert.equal(t('care.created', { id: 'test' }), 'Құрылды: test'); delete kk['state.retry']; assert.equal(t('state.retry'), ru['state.retry']); }
  finally { kk['state.retry'] = saved; setLang(before); }
});
const memoInput = (): MemoInput => ({ zones: [{ site: site(), analysis: analyzeZone(site(), species, rates) }], species, rates: DEFAULT_RATES, evidence: [], generatedAt: '2026-10-29T12:00:00Z', source: 'mock' });
test('DOCX: таблицы содержат расчёт, неизвестные значения и ограничения диапазонов', () => {
  const input = memoInput(); input.zones[0].analysis.facts.areaM2 = null;
  const blocks = memoBlocks(input); const text = JSON.stringify(blocks);
  assert.ok(text.includes('нет данных')); assert.ok(text.includes('диапазоны не рассчитаны')); assert.ok(text.includes('демо')); assert.ok(text.includes('оценка'));
  const total = blocks.filter(b => b.kind === 'table').flatMap(b => b.kind === 'table' ? b.rows : []).find(r => r[0] === 'Итого (оценка)')!;
  assert.equal(total[1], input.zones[0].analysis.cost.total.toLocaleString('ru-RU', { maximumFractionDigits: 2 }));
});
test('DOCX: валидная упаковка OOXML, экранирование и повтор заголовка таблиц', () => {
  const input = memoInput(); input.zones[0].site.name = 'Тест <&> «Қазақ»';
  const files = unzipSync(buildMemoDocx(input));
  for (const path of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels']) assert.ok(files[path]);
  const doc = strFromU8(files['word/document.xml']); assert.ok(doc.includes('Тест &lt;&amp;&gt; «Қазақ»')); assert.ok(doc.includes('<w:tblHeader/>'));
  assert.ok(!doc.includes('undefined') && !doc.includes('NaN')); assert.ok(!Object.keys(files).some(k => /vba|macro/i.test(k)));
});
test('DOCX: несколько зон, повтор и чужой расчёт не принимаются', () => {
  const input = memoInput(); const other = site(); other.id = 'zone-2'; other.name = 'Вторая зона';
  input.zones.push({ site: other, analysis: analyzeZone(other, species, rates) }); assert.ok(JSON.stringify(memoBlocks(input)).includes('Вторая зона'));
  input.zones.push(input.zones[0]); assert.throws(() => memoBlocks(input), /повтор/);
  assert.throws(() => memoBlocks({ ...memoInput(), zones: [] }), /выбраны/);
  const mismatch = memoInput(); mismatch.zones[0].analysis.siteId = 'wrong'; assert.throws(() => memoBlocks(mismatch), /соответствует/);
});
test('CSV: русские и казахские имена колонок работают при обоих языках интерфейса', () => {
  const previous = getLang();
  try { for (const lang of ['ru', 'kk'] as const) { setLang(lang); for (const header of ['широта;долгота', 'ендік;бойлық', 'lat;lng']) assert.deepEqual(parseFile('test.csv', `${header}\n52.28;76.95`).features[0].geometry, { type: 'Point', coordinates: [76.95, 52.28] }); } }
  finally { setLang(previous); }
});
