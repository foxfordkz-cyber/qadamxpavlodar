import { strToU8, zipSync } from 'fflate';
import { VARIANT_LABEL } from '../analytics/plan';
import { memoEvidenceIds, type MemoInput } from './memoData';
export { memoEvidenceIds, type MemoInput } from './memoData';
type Block = { kind: 'paragraph' | 'title' | 'heading'; text: string } | { kind: 'table'; rows: string[][] };
const n = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? 'нет данных' : value.toLocaleString('ru-RU', { maximumFractionDigits: digits });
const dataClass = (value: string) => ({ real: 'реальные данные', estimate: 'оценка', demo: 'демо' }[value] ?? value);

/** Only renders supplied analysis values. No forecasts, prices or missing ranges are invented here. */
export function memoBlocks(input: MemoInput): Block[] {
  if (!input.zones.length) throw new Error('Не выбраны зоны');
  if (new Set(input.zones.map(z => z.site.id)).size !== input.zones.length) throw new Error('Зоны повторяются');
  const byId = new Map(input.species.map(s => [s.id, s]));
  const name = (id: string) => byId.get(id)?.nameRu ?? id;
  const blocks: Block[] = [];
  const p = (text: string) => blocks.push({ kind: 'paragraph', text });
  const h = (text: string) => blocks.push({ kind: 'heading', text });
  const table = (rows: string[][]) => blocks.push({ kind: 'table', rows });
  p('В акимат города Павлодара');
  p('От: ______________________________');
  blocks.push({ kind: 'title', text: 'СЛУЖЕБНАЯ ЗАПИСКА' });
  p('О рассмотрении предложения по озеленению выбранных зон');
  p(`Дата формирования: ${new Date(input.generatedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })} (Павлодар). Регистрационный №: __________`);
  h('Основание');
  p('Предлагается рассмотреть результаты анализа Green Pavlodar. Основание — расчёт по выбранным зонам и варианту посадки, приведённый в отчёте. Реквизиты поручения или обращения: ____________________.');
  p(`Источник приложения: ${input.source === 'mock' ? 'mock — демонстрационный режим' : 'api — серверные данные'}. Расчёт является оценкой, а не разрешением на посадку. Демо и синтетические данные требуют замены и проверки специалистом.`);
  h('Выбранные зоны и площадь');
  table([['Зона', 'ID / отметка', 'Площадь, м²'], ...input.zones.map(({ site, analysis }) => [site.name, `${site.id}${site.isDemo ? ' [демо]' : ''}`, n(analysis.facts.areaM2)])]);
  for (const { site, analysis: a } of input.zones) {
    if (site.id !== a.siteId) throw new Error('Зона не соответствует расчёту');
    h(`Зона: ${site.name}`);
    h('Вариант посадки');
    p(`${VARIANT_LABEL[a.options.variant]}; уход: ${a.options.careYears} г.; назначение: ${a.facts.purposeLabel}.`);
    p(`Полив: ${{ regular: 'регулярный', rare: 'редкий', none: 'отсутствует' }[a.options.watering]}. Улучшение почвы: ${a.options.improveSoil ? 'включено' : 'не включено'}.`);
    p(a.tiersNote);
    table([['Вид', 'Латинское название', 'Ярус', 'Количество, шт.'], ...a.scheme.map(r => [name(r.speciesId), byId.get(r.speciesId)?.latin ?? 'нет данных', { tree: 'дерево', shrub: 'кустарник', flower: 'цветы' }[r.tier], n(r.quantity, 0)])]);
    if (!a.scheme.length) p('Схема посадки пуста. Количество растений не определено.');
    h('Смета по статьям');
    table([['Статья / класс', 'Сумма, ₸', 'Расчёт'], ...a.cost.items.map(r => [`${r.label} [${dataClass(r.dataClass)}]`, n(r.amount), r.formula]), ['Итого (оценка)', n(a.cost.total), `На м²: ${n(a.cost.perM2)} ₸`]]);
    h('Приживаемость по годам (оценка)');
    p(`Модель: ${a.survivalModel.version}. Логистическая регрессия обучена на синтетических данных из экспертных правил; на посадках Павлодара не калибрована. ROC-AUC: ${n(a.survivalModel.rocAuc, 4)}; Brier: ${n(a.survivalModel.brier, 4)}; проверочная выборка: ${n(a.survivalModel.validationN, 0)}.`);
    table([['Вид', '1 год, %', 'Диапазон 1 года, %', '2 года, %', '3 года, %'], ...a.survival.map(r => [name(r.speciesId), n(r.y1), `${n(r.low)}–${n(r.high)}`, n(r.y2), n(r.y3)])]);
    p(`Средняя по зоне за 1 / 2 / 3 года: ${n(a.survivalAvg.y1)}% / ${n(a.survivalAvg.y2)}% / ${n(a.survivalAvg.y3)}%. В среднем за последующие годы учтены только многолетние растения, как в анализе зоны.`);
    p('Диапазон 1-го года отражает неопределённость калибровки: ошибка в корзине синтетической проверки и 95%-й интервал Уилсона частоты в ней. Это не гарантия для отдельной посадки. Для 2-го и 3-го года модель возвращает экспертное затухание без диапазонов: диапазоны не рассчитаны. Нули у однолетников сохранены из анализа.');
    h('Экологический эффект на 5 / 10 / 20 лет (оценка)');
    table([['Показатель', ...a.effect.map(e => `${e.years} лет`)],
      ['CO₂, т/год', ...a.effect.map(e => n(e.co2t))], ['O₂, т/год', ...a.effect.map(e => n(e.o2t))],
      ['Задержание дождя, м³/год', ...a.effect.map(e => n(e.rainM3))], ['Охлаждение, °C', ...a.effect.map(e => n(e.coolingC))],
      ['Крона, м²', ...a.effect.map(e => n(e.canopyM2))], ['Пыль, кг/год', ...a.effect.map(e => n(e.dustKg))]]);
    p(`Стоимость тонны CO₂ за 20 лет: ${n(a.costPerTonCo2)} ₸ (оценка из отчёта).`);
    h('Риски, ограничения и необходимые проверки');
    for (const r of a.survival) {
      if (r.risks.length) p(`${name(r.speciesId)}: ${r.risks.map(k => `${k.label}: ${k.pp > 0 ? '+' : ''}${n(k.pp)} п.п.`).join('; ')}.`);
      for (const warning of r.warnings ?? []) p(`${name(r.speciesId)}: ${warning}`);
    }
    for (const text of [...new Set([...a.missing, ...a.assumptions, ...a.careWarnings])]) p(text);
    for (const measure of a.measures) p(`Предлагаемая мера: ${measure.label}. ${measure.effect}.`);
  }
  h('Источники данных');
  p('Числа перенесены из результатов analyzeZone — того же расчёта, что используется на странице отчёта. Экспорт пересчитывает выбранные зоны с их параметрами. Почва — синтетический слой (демо); экоэффект и прогноз — оценка. Ни mock, ни api сами по себе не подтверждают достоверность исходных данных.');
  const ids = memoEvidenceIds(input.zones, input.species);
  for (const id of ids) {
    const ref = input.evidence.find(e => e.id === id);
    p(ref ? `${ref.id} [${dataClass(ref.dataClass)}]. ${ref.sourceLabel}. ${ref.sourceUrl ?? 'URL не указан'}. Дата источника: ${ref.observedAt ?? 'не указана'}. ${ref.note ?? ''}` : `${id}: описание источника не найдено.`);
  }
  if (!ids.length) p('У выбранных зон не указаны источники. Требуется уточнение.');
  p('Источники расценок и коэффициентов из текущего справочника (surv.* относится только к сравнению с правилами):');
  for (const rate of input.rates) p(`${rate.key} — ${rate.label} [${dataClass(rate.dataClass)}]. ${rate.source}${rate.sourceUrl ? ` ${rate.sourceUrl}` : ''}`);
  p('Посадочный материал: названия и цены видов — каталог приложения; характеристики требуют проверки дендрологом.');
  h('Решение и подпись');
  p('Решение / замечания: __________________________________________________');
  p('Должность: __________________  Подпись: __________  ФИО: __________________');
  p('Дата подписания: __________________');
  return blocks;
}

const xml = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const paragraph = (s: string, style = 'Normal') => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${xml(s)}</w:t></w:r></w:p>`;
function tableXml(rows: string[][]) {
  const width = Math.floor(9638 / rows[0].length);
  return `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(x => `<w:${x} w:val="single" w:sz="4" w:color="B0B0B0"/>`).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${rows[0].map(() => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows.map((row, i) => `<w:tr><w:trPr><w:cantSplit/>${i === 0 ? '<w:tblHeader/>' : ''}</w:trPr>${row.map(text => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${i === 0 ? '<w:shd w:fill="EEEEEE"/>' : ''}</w:tcPr>${paragraph(text, i === 0 ? 'TableHeader' : 'TableText')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>${paragraph('')}`;
}

/** Small, self-contained OOXML package. No macros, remote images, templates or external requests. */
export function buildMemoDocx(input: MemoInput): Uint8Array {
  const body = memoBlocks(input).map(b => b.kind === 'table' ? tableXml(b.rows) : paragraph(b.text, b.kind === 'title' ? 'Title' : b.kind === 'heading' ? 'Heading1' : 'Normal')).join('');
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const files: Record<string, string> = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/document.xml': `<w:document xmlns:w="${w}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567"/></w:sectPr></w:body></w:document>`,
    'word/styles.xml': `<w:styles xmlns:w="${w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="260" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:before="180" w:after="180"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="180" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="30" w:line="230" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="19"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:basedOn w:val="TableText"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/></w:rPr></w:style></w:styles>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`)])), { level: 6 });
}
