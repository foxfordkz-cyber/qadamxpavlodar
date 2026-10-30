// Ассистент по правилам (ТЗ 3.10): работает в тестовом источнике и как запасной ответ сервера,
// когда модель не настроена или не ответила. Ответ модели собирает сервер (apps/server/src/tz/llm.ts).
// Отвечает только цифрами из модулей; при нехватке данных говорит об этом, а не придумывает.
import type { CandidateSite, Species } from '../api/types';
import type { Rates } from './rates';
import { analyzeZone, type PlanOptions } from './plan';
import { detectProblems, PROBLEM_LABEL, priorities, roadmap, DEFAULT_PRIORITY_WEIGHTS } from './city';
import { factSources, searchFacts } from '../api/pavlodar';
import { searchAddress } from '../api/geocode';
import { speciesName, tFor, type Key, type Lang } from '../i18n';
import { analysisText } from '../i18n/templateText';

// Вопросы о нормах, климате, воздухе, зелёном фонде — отвечаем проверенными фактами о Павлодаре со ссылками.
const FACT_WORDS = /норм|отступ|расстоян|климат|мороз|температур|осадк|ветер|ветр|снег|воздух|загрязн|компенсац|вырубк|населен|жител|почв|инвентаризац|безмороз|микрорайон|госзакуп/;

export interface AssistantReply {
  text: string;
  zones: { id: string; name: string }[];
  /** model — ответ модели с расчётами модулей; rules — разбор по правилам. */
  method: 'rules' | 'model';
  intent: string;
  data?: unknown;
  /** (контракт 29.10) Источники из справочников, на которые опирался ответ модели. */
  sources?: { id: string; label: string; url?: string }[];
  /** (контракт 29.10) Какие функции расчёта вызвала модель и с какими параметрами. */
  toolCalls?: { name: string; args: Record<string, unknown> }[];
  model?: string;
  /** Почему вместо модели ответили правила (модель не ответила или ответ не прошёл проверку). */
  fallbackReason?: string;
  /** Почему ответила резервная модель, а не основная (лимит, сбой, долгий ответ). */
  reserveReason?: string;
  /** Язык вопроса, на котором отвечала модель. */
  lang?: 'kk' | 'ru';
}

export interface AskContext {
  siteId: string | null;
  /** Центр карты, которую сейчас видит специалист, — если зона не выбрана. */
  view?: { lat: number; lng: number } | null;
  /** Последние реплики: короткий ответ («Едиге би 1») продолжает прошлый вопрос. */
  history?: { role: 'user' | 'assistant'; text: string }[];
}

// Вопрос «про место»: «возле», «здесь», ЖК, улица, номер дома — ищем зону рядом, а не переспрашиваем.
const PLACE_CUE = /возле|около|рядом|вблизи|напротив|(^|\s)у\s|здесь|тут|в районе|жк|жил|дом|улиц|проспект|вокзал|школ|\d/;
// Слова, по которым понятно, что спрашивают; без них короткая реплика — продолжение прошлого вопроса.
const INTENT = /млн|млрд|тыс|бюджет|перв|очеред|приоритет|проблем|прижив|эффект|co2|со2|замен|подбер|смет|стоим|растен|норм|климат/;

const distM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = (d: number) => (d * Math.PI) / 180;
  return Math.hypot(r(b.lng - a.lng) * Math.cos(r((a.lat + b.lat) / 2)), r(b.lat - a.lat)) * 6371008.8;
};
const nearest = (sites: CandidateSite[], p: { lat: number; lng: number }, limit: number, maxM: number) =>
  sites.filter((s) => s.centroid).map((s) => ({ site: s, distanceM: Math.round(distM(s.centroid!, p)) }))
    .filter((x) => x.distanceM <= maxM).sort((a, b) => a.distanceM - b.distanceM).slice(0, limit);

/** Место из вопроса — адрес, улица, здание по снимку OSM района; если его там нет — центр карты. Ближайшие зоны с расстоянием. */
export function placeZones(text: string, sites: CandidateSite[], view?: AskContext['view'], limit = 5) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const after = text.match(/(?:возле|около|рядом с|вблизи|напротив|в районе|у|на|по)\s+(.+)$/i)?.[1];
  // Весь вопрос, хвост после «возле/у/на», последние 1–4 слова: «подбери растения у Торайгырова 1/5» → «Торайгырова 1/5».
  const phrases = [...new Set([text, ...(after ? [after] : []), ...[4, 3, 2].filter((n) => n < words.length).map((n) => words.slice(-n).join(' '))])];
  const zones = sites.map((s) => ({ id: s.id, name: s.name, centroid: s.centroid }));
  for (const p of phrases) {
    const hit = searchAddress(p, zones, 1)[0];
    if (hit) return { place: hit.label, from: 'address' as const, zones: nearest(sites, hit, limit, 1500) };
  }
  if (view) return { place: null, from: 'map' as const, zones: nearest(sites, view, limit, Infinity) };
  return { place: null, from: null, zones: [] };
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const money = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} млн ₸` : `${fmt(n)} ₸`);

function parseBudget(q: string): number | null {
  const m = q.match(/(\d+(?:[.,]\d+)?)\s*(млн|миллион|млрд|тыс)?/i);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  const k = /млрд/i.test(m[2] ?? '') ? 1e9 : /млн|миллион/i.test(m[2] ?? '') ? 1e6 : /тыс/i.test(m[2] ?? '') ? 1e3 : 1;
  return v * k;
}

/** Поиск видов по названию с учётом окончаний («липу», «клёна»): основа слова без последней буквы. */
function findSpecies(q: string, catalog: Species[]): Species[] {
  const low = q.toLowerCase().replace(/ё/g, 'е');
  return catalog.filter((s) => {
    const word = s.nameRu.toLowerCase().replace(/ё/g, 'е').split(/[ (]/)[0];
    const stem = word.slice(0, Math.max(3, Math.min(6, word.length - 1)));
    return stem.length >= 3 && low.includes(stem);
  });
}

export function answer(q: string, ctx: AskContext, sites: CandidateSite[], catalog: Species[], rates: Rates): AssistantReply {
  // Same letters as server questionLang; never mutate the UI/global language.
  const language: Lang = /[әғқңөұүһі]/i.test(q) ? 'kk' : 'ru';
  const t = (key: Key, params?: Record<string, string | number>) => tFor(language, key, params);
  const name = (sp: Species | undefined) => speciesName(sp, '', language);
  const display = (value: string) => analysisText(value, catalog, language);
  const said = q.trim();
  const prev = [...(ctx.history ?? [])].reverse().find((m) => m.role === 'user')?.text;
  const followUp = !!prev && said.split(/\s+/).length <= 4 && !INTENT.test(said.toLowerCase()) && !(language === 'kk' && /бірінші|кезек|басымдық|мәселе|жерсін|әсер|оттегі|көмірқышқыл/.test(said.toLowerCase()));
  const text = followUp ? `${prev} ${said}` : said;
  const low = text.toLowerCase();
  let site = sites.find((s) => s.id === ctx.siteId) ?? null;
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const zone = (id: string) => ({ id, name: sites.find((s) => s.id === id)?.name ?? id });

  if (/млн|млрд|тыс|бюджет|на сумм/.test(low)) {
    const budget = parseBudget(low);
    if (!budget) return { text: t('rules.budgetHelp'), zones: [], method: 'rules', intent: 'budget' };
    const pr = priorities(sites, catalog, rates, DEFAULT_PRIORITY_WEIGHTS);
    const rm = roadmap(pr, budget);
    if (!rm.chosen.length) return { text: t('rules.budgetNone', { p0: money(budget), p1: money(Math.min(...pr.map((p) => p.cost))) }), zones: [], method: 'rules', intent: 'budget' };
    return { text: t('rules.budget', { p0: money(budget), p1: rm.chosen.length, p2: money(rm.spent), p3: money(rm.left), p4: rm.co2t20.toFixed(1), p5: display(rm.method) }), zones: rm.chosen.slice(0, 8).map((c) => zone(c.siteId)), method: 'rules', intent: 'budget', data: rm };
  }
  if (/перв|очеред|приоритет|в первую/.test(low) || (language === 'kk' && /бірінші|кезек|басымдық/.test(low))) {
    const pr = priorities(sites, catalog, rates, DEFAULT_PRIORITY_WEIGHTS).slice(0, 5);
    return { text: t('rules.priority', { p0: pr.map((p, i) => t('rules.priorityRow', { p0: i + 1, p1: zone(p.siteId).name, p2: p.index, p3: p.explanation.map(display).join('; ') })).join('\n') }), zones: pr.map((p) => zone(p.siteId)), method: 'rules', intent: 'priority' };
  }
  if (/проблем/.test(low) || (language === 'kk' && /мәселе/.test(low))) {
    const { problems, notDetectable } = detectProblems(sites);
    const counts = Object.entries(PROBLEM_LABEL).map(([k, v]) => `${display(v)}: ${problems.filter((p) => p.type === k).length}`).join('; ');
    const high = problems.filter((p) => p.severity === 'high').slice(0, 5);
    return { text: t('rules.problems', { p0: problems.length, p1: counts, p2: problems.filter((p) => p.severity === 'high').length, p3: high.map((p) => t('rules.problemRow', { p0: zone(p.siteId).name, p1: display(PROBLEM_LABEL[p.type]), p2: display(p.cause) })).join('\n'), p4: notDetectable.map(display).join(' ') }), zones: high.map((p) => zone(p.siteId)), method: 'rules', intent: 'problems' };
  }
  // Вопрос про выбранную зону («какая почва здесь») — к расчёту зоны, а не к общим фактам о городе.
  if (FACT_WORDS.test(low) && !(site && /зон|участ|здесь/.test(low))) {
    const found = searchFacts(low, 3);
    if (found.length) return { text: t('rules.facts', { facts: found.map((f) => t('rules.factRow', { title: f.title, text: f.text })).join('\n') }), zones: [], method: 'rules', intent: 'facts', sources: factSources(found) };
  }
  // Зона не выбрана, но названо место («у вокзала», «Едиге би 1») — считаем ближайшую зону и говорим, какую.
  let lead = '';
  if (!site && (PLACE_CUE.test(low) || followUp)) {
    const p = placeZones(said, sites, ctx.view);
    const first = p.zones[0];
    if (first) {
      site = first.site;
      lead = p.from === 'address' ? t('rules.nearAddress', { p0: p.place ?? '', p1: site.name, p2: fmt(first.distanceM) }) : t('rules.nearMap', { p0: site.name, p1: fmt(first.distanceM) });
    }
  }
  if (!site) return { text: ctx.view || PLACE_CUE.test(low) ? t('rules.placeMissing') : t('rules.needZone'), zones: [], method: 'rules', intent: 'need_zone' };
  const out = (r: AssistantReply): AssistantReply => (lead ? { ...r, text: lead + r.text } : r);

  const years = (low.match(/(\d)\s*(год|лет|года)/)?.[1] as unknown as number) ?? null;
  const base: Partial<PlanOptions> = { careYears: years && [1, 2, 3].includes(Number(years)) ? (Number(years) as 1 | 2 | 3) : 2 };
  if (/замен/.test(low)) {
    // «заменить X на Y»: X ищем до последнего « на », Y — после; инвазивные виды как замену не предлагаем.
    const cut = low.lastIndexOf(' на ');
    const fromText = cut > 0 ? low.slice(0, cut) : low;
    const toText = cut > 0 ? low.slice(cut + 4) : low;
    const a0 = analyzeZone(site, catalog, rates, base);
    const ok = new Set(a0.ranked.filter((r) => !r.excludedBy).map((r) => r.speciesId));
    const inScheme = findSpecies(fromText, catalog).find((s) => a0.scheme.some((r) => r.speciesId === s.id || r.replacedFrom === s.id));
    const target = findSpecies(toText, catalog).filter((s) => s.id !== inScheme?.id && ok.has(s.id)).sort((x, y) => (a0.ranked.find((r) => r.speciesId === y.id)?.score ?? 0) - (a0.ranked.find((r) => r.speciesId === x.id)?.score ?? 0))[0];
    if (!inScheme || !target) return out({ text: t('rules.replaceHelp', { p0: [...new Set(a0.scheme.map((r) => name(byId.get(r.speciesId))))].join(', ') }), zones: [zone(site.id)], method: 'rules', intent: 'replace' });
    const a1 = analyzeZone(site, catalog, rates, { ...base, replacements: { [inScheme.id]: target.id } });
    const s0 = a0.survival.find((s) => s.speciesId === inScheme.id);
    const s1 = a1.survival.find((s) => s.speciesId === target.id);
    return out({ text: t('rules.replace', { p0: site.name, p1: name(inScheme), p2: name(target), p3: s0?.y1 ?? '?', p4: s1?.y1 ?? '?', p5: s1?.low ?? 'undefined', p6: s1?.high ?? 'undefined', p7: a0.survivalAvg.y1, p8: a1.survivalAvg.y1, p9: money(a0.cost.total), p10: money(a1.cost.total), p11: (s1?.risks ?? []).map((r) => t('rules.risk', { p0: display(r.label), p1: r.pp })).join('; ') || t('rules.none') }), zones: [zone(site.id)], method: 'rules', intent: 'replace' });
  }
  const a = analyzeZone(site, catalog, rates, base);
  if (/прижив/.test(low) || (language === 'kk' && /жерсін/.test(low))) {
    return out({ text: t('rules.survival', { p0: site.name, p1: a.survivalAvg.y1, p2: a.survivalAvg.y2, p3: a.survivalAvg.y3, p4: a.measures.length ? t('rules.measures', { p0: a.measures.map((m) => `${display(m.label)} (${display(m.effect)})`).join('; ') }) : '' }), zones: [zone(site.id)], method: 'rules', intent: 'survival' });
  }
  if (/эффект|co2|со2|углекисл|кислород/.test(low) || (language === 'kk' && /әсер|көмірқышқыл|оттегі/.test(low))) {
    const e = a.effect;
    return out({ text: t('rules.effect', { p0: site.name, p1: e[0].co2t.toFixed(2), p2: e[1].co2t.toFixed(2), p3: e[2].co2t.toFixed(2), p4: e[2].coolingC, p5: fmt(e[2].rainM3), p6: a.costPerTonCo2 ? t('rules.effectCost', { p0: money(a.costPerTonCo2) }) : '' }), zones: [zone(site.id)], method: 'rules', intent: 'effect' });
  }
  const top = a.ranked.filter((r) => !r.excludedBy).slice(0, 5).map((r) => `${name(byId.get(r.speciesId))} (${r.score})`).join(', ');
  return out({ text: t('rules.selection', { p0: site.name, p1: display(a.facts.purposeLabel).toLowerCase(), p2: a.facts.areaM2 ?? 'null', p3: top, p4: a.scheme.map((r) => `${name(byId.get(r.speciesId))} × ${r.quantity}`).join(', '), p5: a.options.careYears, p6: money(a.cost.total), p7: a.cost.items.map((i) => `${display(i.label).toLowerCase()} ${money(i.amount)}`).join('; '), p8: a.survivalAvg.y1 }), zones: [zone(site.id)], method: 'rules', intent: 'select' });
}
