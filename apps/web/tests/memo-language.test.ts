import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaxesParser } from 'saxes';
import { strFromU8, unzipSync } from 'fflate';
import osm from '../../../fixtures/osm/sites.json';
import { species } from '../src/shared/api/mock/species';
import type { CandidateSite } from '../src/shared/api/types';
import { analyzeZone } from '../src/shared/analytics/plan';
import { DEFAULT_RATES, ratesMap } from '../src/shared/analytics/rates';
import { getLang, setLang, type Lang } from '../src/shared/i18n';
import { buildMemoDocx, memoBlocks, type MemoInput } from '../src/shared/export/memo';
import { memoText } from '../src/shared/export/memoText';

function input(): MemoInput {
  const site = structuredClone(osm.sites[0]) as unknown as CandidateSite;
  site.name = 'Аймақ <&> «№ 7»'; site.isDemo = true;
  return {
    zones: [{ site, analysis: analyzeZone(site, species, ratesMap(DEFAULT_RATES), { watering: 'none', variant: 'max' }) }],
    species, rates: DEFAULT_RATES, evidence: [], generatedAt: '2026-10-29T12:00:00Z', source: 'mock',
  };
}

function xmlText(xml: string) {
  const parser = new SaxesParser({ xmlns: true });
  const text: string[] = [];
  parser.on('text', value => text.push(value));
  parser.write(xml).close(); // Throws on malformed XML, including undeclared namespaces.
  return text.join('\n');
}

for (const language of ['ru', 'kk'] as const) test(`DOCX ${language}: все XML-части корректны, язык Word задан, служебные фразы переведены`, () => {
  const files = unzipSync(buildMemoDocx(input(), language));
  for (const [path, bytes] of Object.entries(files)) if (/\.(xml|rels)$/.test(path)) assert.doesNotThrow(() => xmlText(strFromU8(bytes)), path);
  const doc = strFromU8(files['word/document.xml']);
  const text = xmlText(doc);
  assert.ok(text.includes('Аймақ <&> «№ 7»'), 'input names are preserved and XML entities round-trip');
  assert.match(strFromU8(files['word/styles.xml']), new RegExp(`w:lang w:val="${language === 'kk' ? 'kk-KZ' : 'ru-RU'}"`));
  assert.ok(!/undefined|NaN|\{\w+\}/.test(text));
  if (language === 'kk') {
    for (const phrase of ['ҚЫЗМЕТТІК ЖАЗБА', 'Негіздеме', 'Баптар бойынша смета', 'Жылдар бойынша жерсіну', 'Дереккөздер', 'Шешім және қол қою']) assert.ok(text.includes(phrase), phrase);
    // Source quotations and object/species names may legitimately be Russian.
    for (const phrase of ['СЛУЖЕБНАЯ ЗАПИСКА', 'В акимат города', 'Дата формирования', 'Регистрационный №', 'Основание', 'Выбранные зоны', 'Вариант посадки', 'Смета по статьям', 'Итого (оценка)', 'Приживаемость по годам', 'Средняя по зоне', 'Экологический эффект', 'Предлагаемая мера', 'Источники данных', 'Дата источника', 'Решение / замечания', 'Должность:', 'Подпись:', 'Дата подписания', 'Ярусы:', 'Σ(цена × количество)', 'Полив и уход (', 'п.п.']) assert.ok(!text.includes(phrase), `Russian service text: ${phrase}`);
  } else {
    assert.ok(text.includes('СЛУЖЕБНАЯ ЗАПИСКА') && text.includes('Смета по статьям'));
  }
});

test('DOCX: выбор языка не меняет числа, исходный расчёт и язык интерфейса', () => {
  const data = input(), before = structuredClone(data), previous = getLang();
  try {
    const blocks: Partial<Record<Lang, ReturnType<typeof memoBlocks>>> = {};
    for (const lang of ['ru', 'kk'] as const) {
      setLang(lang === 'ru' ? 'kk' : 'ru');
      const ui = getLang();
      blocks[lang] = memoBlocks(data, lang);
      buildMemoDocx(data, lang);
      assert.equal(getLang(), ui, 'document language must not mutate UI state');
    }
    const numbers = (lang: Lang) => blocks[lang]!.flatMap(b => b.kind === 'table' ? b.rows.slice(1).map(row => row.slice(1).map(cell => cell.match(/[+−-]?\d+(?:[\s\u00a0\u202f]\d{3})*(?:[.,]\d+)?/g))) : []);
    assert.deepEqual(numbers('ru'), numbers('kk'), 'quantities, formulas, prices, ranges and ecological effects must match');
    const kk = JSON.stringify(blocks.kk);
    assert.ok(kk.includes(data.zones[0].analysis.cost.total.toLocaleString('ru-RU', { maximumFractionDigits: 2 })));
    assert.deepEqual(data, before);
  } finally { setLang(previous); }
});

test('DOCX: казахская версия сохраняет неизвестные значения, нули и ограничения диапазонов', () => {
  const data = input(), a = data.zones[0].analysis;
  a.facts.areaM2 = null; a.cost.perM2 = null; a.effect[0].dustKg = null;
  a.survival[0] = { ...a.survival[0], y2: 0, y3: 0 };
  const blocks = memoBlocks(data, 'kk');
  const text = JSON.stringify(blocks);
  assert.ok(text.includes('деректер жоқ') && text.includes('аралықтар есептелмеген'));
  const survival = blocks.find(b => b.kind === 'table' && b.rows[0][1] === '1 жыл, %');
  assert.ok(survival?.kind === 'table');
  assert.deepEqual(survival.rows[1].slice(-2), ['0', '0']);
});

test('DOCX: шаблоны формул переводят текст, сохраняя дроби и неизвестные описания', () => {
  assert.equal(memoText('kk', 'работы 1 234,5 ₸ + доставка 8% от материала (98,76 ₸)'), 'жұмыстар 1 234,5 ₸ + жеткізу материал құнының 8%-ы (98,76 ₸)');
  assert.equal(memoText('kk', 'Полив и уход (3 г.)'), 'Суару және күтім (3 жыл)');
  assert.equal(memoText('kk', 'Месяц 7: нужно ≈12 выездов, а допустимо 10. Совместите операции или выберите засухоустойчивые виды.'), '7-ай: ≈12 рет бару қажет, ал рұқсат етілгені 10. Жұмыстарды біріктіріңіз немесе қуаңшылыққа төзімді түрлерді таңдаңыз.');
  assert.equal(memoText('kk', 'Пользовательская формула «A&B < 7»'), 'Пользовательская формула «A&B < 7»');
});
