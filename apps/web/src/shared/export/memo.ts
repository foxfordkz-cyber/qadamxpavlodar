import { strToU8, zipSync } from 'fflate';
import { VARIANT_LABEL } from '../analytics/plan';
import { tFor, type Key, type Lang } from '../i18n';
import { memoText } from './memoText';
import { memoEvidenceIds, type MemoInput } from './memoData';
export { memoEvidenceIds, type MemoInput } from './memoData';
type Block = { kind: 'paragraph' | 'title' | 'heading'; text: string } | { kind: 'table'; rows: string[][] };

/** Only renders supplied analysis values. Export language never changes the UI or input data. */
export function memoBlocks(input: MemoInput, language: Lang = 'ru'): Block[] {
  const t = (key: Key, params?: Record<string, string | number>) => tFor(language, key, params);
  const tr = (text: string) => memoText(language, text);
  // Keep number/date formatting identical between documents to make comparison unambiguous.
  const n = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? t('memo.doc.noData') : value.toLocaleString('ru-RU', { maximumFractionDigits: digits });
  const dataClass = (value: string) => value === 'real' || value === 'estimate' || value === 'demo' ? t(`memo.doc.class.${value}`) : value;
  if (!input.zones.length) throw new Error(t('memo.doc.noZones'));
  if (new Set(input.zones.map(z => z.site.id)).size !== input.zones.length) throw new Error(t('memo.doc.duplicateZones'));
  const byId = new Map(input.species.map(s => [s.id, s]));
  const name = (id: string) => {
    const species = byId.get(id);
    return (language === 'kk' ? species?.nameKk : null) || species?.nameRu || id;
  };
  const blocks: Block[] = [];
  const p = (text: string) => blocks.push({ kind: 'paragraph', text });
  const h = (text: string) => blocks.push({ kind: 'heading', text });
  const table = (rows: string[][]) => blocks.push({ kind: 'table', rows });
  p(t('memo.doc.to'));
  p(t('memo.doc.from'));
  blocks.push({ kind: 'title', text: t('memo.doc.title') });
  p(t('memo.doc.subject'));
  p(t('memo.doc.generated', { date: new Date(input.generatedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' }) }));
  h(t('memo.doc.grounds'));
  p(t('memo.doc.groundsText'));
  p(t('memo.doc.sourceNote', { source: t(input.source === 'mock' ? 'memo.doc.mock' : 'memo.doc.api') }));
  h(t('memo.doc.zones'));
  table([[t('memo.doc.zone'), t('memo.doc.idMark'), t('memo.doc.area')], ...input.zones.map(({ site, analysis }) => [site.name, `${site.id}${site.isDemo ? ` [${dataClass('demo')}]` : ''}`, n(analysis.facts.areaM2)])]);
  for (const { site, analysis: a } of input.zones) {
    if (site.id !== a.siteId) throw new Error(t('memo.doc.mismatch'));
    h(t('memo.doc.zoneTitle', { name: site.name }));
    h(t('memo.doc.variant'));
    p(t('memo.doc.options', { variant: tr(VARIANT_LABEL[a.options.variant]), years: a.options.careYears, purpose: tr(a.facts.purposeLabel) }));
    p(t('memo.doc.watering', { watering: t(`memo.doc.watering.${a.options.watering}`), soil: t(a.options.improveSoil ? 'memo.doc.enabled' : 'memo.doc.disabled') }));
    p(tr(a.tiersNote));
    table([[t('memo.doc.species'), t('memo.doc.latin'), t('memo.doc.tier'), t('memo.doc.quantity')], ...a.scheme.map(r => [name(r.speciesId), byId.get(r.speciesId)?.latin ?? t('memo.doc.noData'), t(`memo.doc.${r.tier}`), n(r.quantity, 0)])]);
    if (!a.scheme.length) p(t('memo.doc.emptyScheme'));
    h(t('memo.doc.cost'));
    table([[t('memo.doc.costItem'), t('memo.doc.amount'), t('memo.doc.calculation')], ...a.cost.items.map(r => [`${tr(r.label)} [${dataClass(r.dataClass)}]`, n(r.amount), tr(r.formula)]), [t('memo.doc.total'), n(a.cost.total), t('memo.doc.perM2', { amount: n(a.cost.perM2) })]]);
    h(t('memo.doc.survival'));
    p(t('memo.doc.model', { version: a.survivalModel.version, auc: n(a.survivalModel.rocAuc, 4), brier: n(a.survivalModel.brier, 4), n: n(a.survivalModel.validationN, 0) }));
    table([[t('memo.doc.species'), t('memo.doc.y1'), t('memo.doc.range'), t('memo.doc.y2'), t('memo.doc.y3')], ...a.survival.map(r => [name(r.speciesId), n(r.y1), `${n(r.low)}–${n(r.high)}`, n(r.y2), n(r.y3)])]);
    p(t('memo.doc.average', { y1: n(a.survivalAvg.y1), y2: n(a.survivalAvg.y2), y3: n(a.survivalAvg.y3) }));
    p(t('memo.doc.rangeNote'));
    h(t('memo.doc.effect'));
    table([[t('memo.doc.metric'), ...a.effect.map(e => t('memo.doc.years', { years: e.years }))],
      [t('memo.doc.co2'), ...a.effect.map(e => n(e.co2t))], [t('memo.doc.o2'), ...a.effect.map(e => n(e.o2t))],
      [t('memo.doc.rain'), ...a.effect.map(e => n(e.rainM3))], [t('memo.doc.cooling'), ...a.effect.map(e => n(e.coolingC))],
      [t('memo.doc.canopy'), ...a.effect.map(e => n(e.canopyM2))], [t('memo.doc.dust'), ...a.effect.map(e => n(e.dustKg))]]);
    p(t('memo.doc.co2Cost', { amount: n(a.costPerTonCo2) }));
    h(t('memo.doc.risks'));
    for (const r of a.survival) {
      if (r.risks.length) p(`${name(r.speciesId)}: ${r.risks.map(k => `${tr(k.label)}: ${k.pp > 0 ? '+' : ''}${n(k.pp)} ${t('memo.doc.pp')}`).join('; ')}.`);
      for (const warning of r.warnings ?? []) p(`${name(r.speciesId)}: ${tr(warning)}`);
    }
    for (const text of [...new Set([...a.missing, ...a.assumptions, ...a.careWarnings])]) p(tr(text));
    for (const measure of a.measures) p(t('memo.doc.measure', { label: tr(measure.label), effect: tr(measure.effect) }));
  }
  h(t('memo.doc.sources'));
  p(t('memo.doc.sourceMethod'));
  const ids = memoEvidenceIds(input.zones, input.species);
  for (const id of ids) {
    const ref = input.evidence.find(e => e.id === id);
    p(ref ? t('memo.doc.sourceRef', { id: ref.id, dataClass: dataClass(ref.dataClass), label: ref.sourceLabel, url: ref.sourceUrl ?? t('memo.doc.noUrl'), date: ref.observedAt ?? t('memo.doc.noDate'), note: ref.note ?? '' }) : t('memo.doc.missingSource', { id }));
  }
  if (!ids.length) p(t('memo.doc.noSources'));
  p(t('memo.doc.rateSources'));
  for (const rate of input.rates) p(`${rate.key} — ${tr(rate.label)} [${dataClass(rate.dataClass)}]. ${rate.source}${rate.sourceUrl ? ` ${rate.sourceUrl}` : ''}`);
  p(t('memo.doc.catalogNote'));
  h(t('memo.doc.signature'));
  p(t('memo.doc.decision'));
  p(t('memo.doc.signer'));
  p(t('memo.doc.signedAt'));
  return blocks;
}

const xml = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const paragraph = (s: string, style = 'Normal') => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${xml(s)}</w:t></w:r></w:p>`;
function tableXml(rows: string[][]) {
  const width = Math.floor(9638 / rows[0].length);
  return `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(x => `<w:${x} w:val="single" w:sz="4" w:color="B0B0B0"/>`).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${rows[0].map(() => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows.map((row, i) => `<w:tr><w:trPr><w:cantSplit/>${i === 0 ? '<w:tblHeader/>' : ''}</w:trPr>${row.map(text => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${i === 0 ? '<w:shd w:fill="EEEEEE"/>' : ''}</w:tcPr>${paragraph(text, i === 0 ? 'TableHeader' : 'TableText')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>${paragraph('')}`;
}

/** Small, self-contained OOXML package. No macros, remote images, templates or external requests. */
export function buildMemoDocx(input: MemoInput, language: Lang = 'ru'): Uint8Array {
  const body = memoBlocks(input, language).map(b => b.kind === 'table' ? tableXml(b.rows) : paragraph(b.text, b.kind === 'title' ? 'Title' : b.kind === 'heading' ? 'Heading1' : 'Normal')).join('');
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const files: Record<string, string> = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/document.xml': `<w:document xmlns:w="${w}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567"/></w:sectPr></w:body></w:document>`,
    'word/styles.xml': `<w:styles xmlns:w="${w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/><w:lang w:val="${language === 'kk' ? 'kk-KZ' : 'ru-RU'}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="260" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:before="180" w:after="180"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="180" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="30" w:line="230" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="19"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:basedOn w:val="TableText"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/></w:rPr></w:style></w:styles>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`)])), { level: 6 });
}
