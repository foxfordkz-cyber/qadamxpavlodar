// Ассистент по правилам (ТЗ 3.10): работает в тестовом источнике и как запасной ответ сервера,
// когда модель не настроена или не ответила. Ответ модели собирает сервер (apps/server/src/tz/llm.ts).
// Отвечает только цифрами из модулей; при нехватке данных говорит об этом, а не придумывает.
import type { CandidateSite, Species } from '../api/types';
import type { Rates } from './rates';
import { analyzeZone, type PlanOptions } from './plan';
import { detectProblems, PROBLEM_LABEL, priorities, roadmap, DEFAULT_PRIORITY_WEIGHTS } from './city';
import { factSources, searchFacts } from '../api/pavlodar';

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

export function answer(q: string, ctx: { siteId: string | null }, sites: CandidateSite[], catalog: Species[], rates: Rates): AssistantReply {
  const text = q.trim();
  const low = text.toLowerCase();
  const site = sites.find((s) => s.id === ctx.siteId) ?? null;
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const zone = (id: string) => ({ id, name: sites.find((s) => s.id === id)?.name ?? id });

  if (/млн|млрд|тыс|бюджет|на сумм/.test(low)) {
    const budget = parseBudget(low);
    if (!budget) return { text: 'Не понял сумму бюджета. Напишите, например: «Что можно озеленить на 50 млн при максимальном эффекте?»', zones: [], method: 'rules', intent: 'budget' };
    const pr = priorities(sites, catalog, rates, DEFAULT_PRIORITY_WEIGHTS);
    const rm = roadmap(pr, budget);
    if (!rm.chosen.length) return { text: `На ${money(budget)} не помещается ни одна зона в варианте «оптимальный» (самая дешёвая — ${money(Math.min(...pr.map((p) => p.cost)))}). Попробуйте вариант «эконом» в панели зоны.`, zones: [], method: 'rules', intent: 'budget' };
    return { text: `На ${money(budget)} по дорожной карте можно озеленить ${rm.chosen.length} зон(ы), потрачено ${money(rm.spent)}, остаток ${money(rm.left)}. Оценка поглощения CO₂ через 20 лет — ${rm.co2t20.toFixed(1)} т/год. ${rm.method}`, zones: rm.chosen.slice(0, 8).map((c) => zone(c.siteId)), method: 'rules', intent: 'budget', data: rm };
  }
  if (/перв|очеред|приоритет|в первую/.test(low)) {
    const pr = priorities(sites, catalog, rates, DEFAULT_PRIORITY_WEIGHTS).slice(0, 5);
    return { text: `Первая пятёрка по индексу приоритета (веса по умолчанию):\n${pr.map((p, i) => `${i + 1}. ${zone(p.siteId).name} — индекс ${p.index}; ${p.explanation.join('; ')}`).join('\n')}\nДанных о районах нет, поэтому фильтр «район N» пока недоступен — показываю весь демонстрационный участок.`, zones: pr.map((p) => zone(p.siteId)), method: 'rules', intent: 'priority' };
  }
  if (/проблем/.test(low)) {
    const { problems, notDetectable } = detectProblems(sites);
    const counts = Object.entries(PROBLEM_LABEL).map(([k, v]) => `${v}: ${problems.filter((p) => p.type === k).length}`).join('; ');
    const high = problems.filter((p) => p.severity === 'high').slice(0, 5);
    return { text: `Выявлено проблем: ${problems.length} (${counts}). С высокой остротой — ${problems.filter((p) => p.severity === 'high').length}.\n${high.map((p) => `• ${zone(p.siteId).name}: ${PROBLEM_LABEL[p.type]} — ${p.cause}`).join('\n')}\n${notDetectable.join(' ')}`, zones: high.map((p) => zone(p.siteId)), method: 'rules', intent: 'problems' };
  }
  // Вопрос про выбранную зону («какая почва здесь») — к расчёту зоны, а не к общим фактам о городе.
  if (FACT_WORDS.test(low) && !(site && /зон|участ|здесь/.test(low))) {
    const found = searchFacts(low, 3);
    if (found.length) return { text: found.map((f) => `• ${f.title}: ${f.text}`).join('\n'), zones: [], method: 'rules', intent: 'facts', sources: factSources(found) };
  }
  if (!site) return { text: 'Выберите зону на карте — и я посчитаю подбор, смету, приживаемость или эффект для неё. Без выбранной зоны могу ответить про приоритеты, бюджет и проблемные зоны.', zones: [], method: 'rules', intent: 'need_zone' };

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
    if (!inScheme || !target) return { text: `Чтобы сравнить замену, назовите вид из текущей схемы и вид-замену. В схеме сейчас: ${[...new Set(a0.scheme.map((r) => byId.get(r.speciesId)?.nameRu))].join(', ')}.`, zones: [zone(site.id)], method: 'rules', intent: 'replace' };
    const a1 = analyzeZone(site, catalog, rates, { ...base, replacements: { [inScheme.id]: target.id } });
    const s0 = a0.survival.find((s) => s.speciesId === inScheme.id);
    const s1 = a1.survival.find((s) => s.speciesId === target.id);
    return { text: `${site.name}: замена «${inScheme.nameRu}» на «${target.nameRu}». Приживаемость за 1 год: ${s0?.y1 ?? '?'}% → ${s1?.y1 ?? '?'}% (диапазон ${s1?.low}–${s1?.high}%). Средняя по зоне: ${a0.survivalAvg.y1}% → ${a1.survivalAvg.y1}%. Смета: ${money(a0.cost.total)} → ${money(a1.cost.total)}. Главные риски замены: ${(s1?.risks ?? []).map((r) => `${r.label} ${r.pp} п.п.`).join('; ') || 'нет'}.`, zones: [zone(site.id)], method: 'rules', intent: 'replace' };
  }
  const a = analyzeZone(site, catalog, rates, base);
  if (/прижив/.test(low)) {
    return { text: `${site.name}: средняя приживаемость — ${a.survivalAvg.y1}% за 1 год, ${a.survivalAvg.y2}% за 2, ${a.survivalAvg.y3}% за 3 (оценка по правилам, не калибрована). ${a.measures.length ? `Как повысить: ${a.measures.map((m) => `${m.label} (${m.effect})`).join('; ')}.` : ''}`, zones: [zone(site.id)], method: 'rules', intent: 'survival' };
  }
  if (/эффект|co2|со2|углекисл|кислород/.test(low)) {
    const e = a.effect;
    return { text: `${site.name}: поглощение CO₂ ≈ ${e[0].co2t.toFixed(2)} / ${e[1].co2t.toFixed(2)} / ${e[2].co2t.toFixed(2)} т в год через 5 / 10 / 20 лет; охлаждение до ${e[2].coolingC} °C; задержание дождя ≈ ${fmt(e[2].rainM3)} м³ в год. ${a.costPerTonCo2 ? `Стоимость тонны CO₂ за 20 лет ≈ ${money(a.costPerTonCo2)}.` : ''} Все значения оценочные.`, zones: [zone(site.id)], method: 'rules', intent: 'effect' };
  }
  const top = a.ranked.filter((r) => !r.excludedBy).slice(0, 5).map((r) => `${byId.get(r.speciesId)?.nameRu} (${r.score})`).join(', ');
  return { text: `${site.name} (${a.facts.purposeLabel.toLowerCase()}, ${a.facts.areaM2} м²). Лучшие виды по пригодности: ${top}. Схема: ${a.scheme.map((r) => `${byId.get(r.speciesId)?.nameRu} × ${r.quantity}`).join(', ')}. Смета на ${a.options.careYears} г. ухода — ${money(a.cost.total)} (${a.cost.items.map((i) => `${i.label.toLowerCase()} ${money(i.amount)}`).join('; ')}). Средняя приживаемость за 1 год — ${a.survivalAvg.y1}%. Расценки демонстрационные.`, zones: [zone(site.id)], method: 'rules', intent: 'select' };
}
