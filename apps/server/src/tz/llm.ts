// Ассистент на модели (ТЗ 3.10): LLM через OpenAI-совместимый API — подойдёт любой провайдер
// с /chat/completions и tools (Gemini, Groq, DeepSeek, Grok, Ollama): LLM_BASE_URL и LLM_MODEL в .env.
// Резерв: LLM2_* (и LLM3_*). Если основная модель упёрлась в лимит, упала или не уложилась во время,
// отвечает следующая; после ответа 429 модель пропускается до конца Retry-After (или минуту).
// Модель ничего не считает сама: она выбирает функции, сервер выполняет их теми же модулями расчётов,
// и в ответе допустимы только цифры из результатов функций. RAG — поиск по справочникам и источникам в базе.
// В модель уходят вопрос, данные зон (OSM) и результаты расчётов; имена и роли пользователей — нет.
import { Store } from '../db.js';
import { listDocs, maybeDoc } from '../v2/core.js';
import { analyze, analyzable, candidate, candidates, priorities, ratesList, reference, speciesList } from './data.js';
import { web, type Json } from './shared.js';
import type { AssistantAdapter } from './routes.js';

export type LlmConfig = { name: string; baseUrl: string; model: string; apiKey: string; timeoutMs: number; maxRounds: number };
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\]|[a-z0-9-]+)$/; // loopback или имя сервиса в docker compose (ollama)

/** Провайдер с префиксом LLM, LLM2, LLM3. null — не настроен (нет ключа или модели). */
function provider(env: NodeJS.ProcessEnv, prefix: string, timeoutMs: number): LlmConfig | null {
  const apiKey = env[`${prefix}_API_KEY`]?.trim(), model = env[`${prefix}_MODEL`]?.trim();
  if (!apiKey || !model) return null;
  const baseUrl = (env[`${prefix}_BASE_URL`]?.trim() || 'https://api.x.ai/v1').replace(/\/+$/, '');
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${prefix}_BASE_URL: only scheme, host, port and path`);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOST.test(url.hostname))) throw new Error(`${prefix}_BASE_URL must use https (http only for a local model)`);
  return { name: prefix, baseUrl, model, apiKey, timeoutMs, maxRounds: 3 };
}
/** Модели по порядку: основная LLM_*, резервные LLM2_*, LLM3_*. Пусто — ассистент отвечает по правилам. */
export function llmProviders(env = process.env): LlmConfig[] {
  const timeoutMs = Number(env.LLM_TIMEOUT_MS ?? 20000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new Error('LLM_TIMEOUT_MS: 1000–120000');
  return ['LLM', 'LLM2', 'LLM3'].map((p) => provider(env, p, timeoutMs)).filter((p): p is LlmConfig => !!p);
}
/** Основная модель или null. */
export const llmConfig = (env = process.env): LlmConfig | null => llmProviders(env)[0] ?? null;

const SYSTEM = `Ты — ассистент специалиста акимата Павлодара по озеленению (прототип, демо-данные).
Правила:
1. Отвечай на языке вопроса (казахский или русский), коротко: 3–8 предложений или короткий список. Названия зон пиши как в результатах функций.
2. Любое число, площадь, цену, процент, балл бери ТОЛЬКО из результатов функций. Сам ничего не считай и не оценивай. Нужна цифра — вызови функцию.
   Факторы приоритета и пригодность видов — баллы 0–100, а не проценты; проценты — только приживаемость.
   Не добавляй фактов, которых нет в результатах функций (какие именно объекты рядом, причины, названия).
3. Если данных нет или функция вернула ошибку — прямо скажи, каких данных не хватает. Не придумывай.
4. Все сметы, приживаемость и экоэффект — оценки по правилам и демо-расценкам; так и говори.
5. Называй зоны по названию из результатов функций. Если зона не выбрана, а в вопросе адрес, улица, здание, «возле», «здесь» — или пользователь отвечает адресом на твой вопрос, — вызови find_place, затем analyze_zone для ближайшей зоны и скажи, какую зону взял и на каком расстоянии. Переспрашивай, только если find_place ничего не нашёл.
6. На вопросы «почему», «откуда цифра», «что за вид» используй search_knowledge и называй источник.
7. Не давай юридических разрешений: посадку согласует специалист после проверок участка.
8. Пиши простым текстом: без Markdown, таблиц и звёздочек; список — каждый пункт с новой строки, начиная с «• ». id зон не пиши — только названия.`;

/** Язык вопроса: буквы, которых нет в русском (ә ғ қ ң ө ұ ү һ і), — казахский. */
export const questionLang = (text: string): 'kk' | 'ru' => (/[әғқңөұүһі]/i.test(text) ? 'kk' : 'ru');
const LANG_NOTE = { kk: '\nОтветь на казахском языке (қазақ тілінде).', ru: '' } as const;

const ZONE = { type: 'string', description: 'id зоны, например site-osm-1546881092' };
const tool = (name: string, description: string, properties: Json, required: string[] = []) =>
  ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
export const TOOLS = [
  tool('search_zones', 'Найти зоны по названию или улице. Возвращает id, название, площадь и статус проверок.', { query: { type: 'string' } }, ['query']),
  tool('find_place', 'Найти место по адресу, улице или зданию (снимок OSM центра Павлодара) и ближайшие к нему зоны с расстоянием в метрах. Без query или если адреса нет в снимке — зоны у центра карты, которую видит специалист.', { query: { type: 'string', description: 'адрес, улица или место, например «Торайгырова 1/5»' } }),
  tool('analyze_zone', 'Расчёт зоны: подбор видов 0–100, схема посадки, смета из 5 статей, приживаемость на 1/2/3 года, уход, экоэффект на 5/10/20 лет.', {
    zoneId: ZONE, variant: { type: 'string', enum: ['econom', 'optimal', 'max'] }, careYears: { type: 'integer', enum: [1, 2, 3] },
    excluded: { type: 'array', items: { type: 'string' }, description: 'id видов, которые исключить' },
    replacements: { type: 'object', additionalProperties: { type: 'string' }, description: 'замена вида: {"id из схемы": "id замены"}' },
  }, ['zoneId']),
  tool('compare_variants', 'Сравнить варианты «эконом», «оптимальный», «максимальный эффект» для зоны.', { zoneId: ZONE }, ['zoneId']),
  tool('top_priorities', 'Зоны с наибольшим индексом приоритета 0–100 и объяснение факторов.', {
    limit: { type: 'integer', minimum: 1, maximum: 20 },
    weights: { type: 'object', description: 'веса факторов deficit, density, social, load, soil, benefit (0–1)', additionalProperties: { type: 'number' } },
  }),
  tool('budget_roadmap', 'Какие зоны озеленить на заданный бюджет (жадный отбор по индексу приоритета).', { budgetKzt: { type: 'number', minimum: 1 } }, ['budgetKzt']),
  tool('find_problems', 'Проблемные зоны: дефицит зелени, почва, остров тепла, нет защитной полосы; острота, причина, действие.', {
    type: { type: 'string', enum: ['deficit', 'soil', 'heat', 'unprotected', 'degradation'] }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, limit: { type: 'integer', minimum: 1, maximum: 20 },
  }),
  tool('search_knowledge', 'Поиск по справочникам: виды растений, расценки, проверенные факты о Павлодаре (климат, нормы отступов СП РК, правила вырубки и компенсации, воздух, зелёный фонд, цены госзакупок), источники.', { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 8 } }, ['query']),
];

const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е');
/** Основы слов запроса: «липу», «липы» → «лип». */
const stems = (q: string) => norm(q).split(/[^a-zа-я0-9-]+/).filter((w) => w.length >= 3).map((w) => w.slice(0, Math.max(3, Math.min(6, w.length - 1))));
const score = (text: string, keys: string[]) => keys.reduce((n, k) => n + (text.includes(k) ? 1 : 0), 0);
const clip = (x: string, n = 280) => (x.length > n ? `${x.slice(0, n - 1)}…` : x);

type Zone = { id: string; name: string };
type Ctx = { zones: Zone[]; evidence: Set<string>; view?: { lat: number; lng: number } | null };

/** Функции, которые вызывает модель. Выполняются сервером теми же модулями, что экраны. */
export function createTools(s: Store) {
  const spName = () => new Map(speciesList(s).map((x) => [x.id, x.nameRu as string]));
  const zoneOf = (id: string, ctx: Ctx): Zone => {
    const z = { id, name: String(maybeDoc(s, 'site', id)?.name ?? id) };
    if (!ctx.zones.some((x) => x.id === id)) ctx.zones.push(z);
    return z;
  };
  const elig = (c: Json) => { const st = web.CHECKS.map((k) => c.checks[k].state); return st.includes('blocked') ? 'есть ограничение' : st.every((x) => x === 'cleared') ? 'проверки завершены' : 'нужна проверка'; };
  const run: Record<string, (a: Json, ctx: Ctx) => Json> = {
    find_place: (a, ctx) => {
      const p = web.placeZones(String(a.query ?? ''), candidates(s), ctx.view);
      if (!p.zones.length) return { found: false, note: 'Места нет в снимке OSM района прототипа (центр Павлодара), центр карты неизвестен: попросите выбрать зону на карте, найти адрес строкой над картой или нарисовать контур.' };
      return { found: p.from === 'address', place: p.place, basedOn: p.from === 'address' ? 'адрес из снимка OSM' : 'центр карты: такого адреса нет в снимке района',
        zones: p.zones.map((x) => ({ ...zoneOf(String(x.site.id), ctx), distanceM: x.distanceM, areaM2: x.site.areaM2 ?? null, checks: elig(x.site) })) };
    },
    search_zones: (a, ctx) => {
      const keys = stems(String(a.query ?? ''));
      const found = candidates(s).map((c) => ({ c, n: score(norm(`${c.name} ${c.id}`), keys) })).filter((x) => x.n > 0).sort((x, y) => y.n - x.n).slice(0, 8);
      return { zones: found.map(({ c }) => ({ ...zoneOf(c.id, ctx), areaM2: c.areaM2 ?? null, checks: elig(c) })), note: found.length ? undefined : 'Совпадений нет: уточните улицу.' };
    },
    analyze_zone: (a, ctx) => {
      const site = candidate(s, String(a.zoneId)); const ref = reference(s); const names = spName();
      const opts: Json = {};
      for (const k of ['variant', 'careYears', 'excluded', 'replacements']) if (a[k] !== undefined) opts[k] = a[k];
      const r = analyze(site, ref, opts);
      return {
        zone: zoneOf(site.id, ctx), options: r.options, areaM2: r.facts.areaM2, purpose: r.facts.purposeLabel, soil: r.facts.soil,
        topSpecies: r.ranked.filter((x: Json) => !x.excludedBy).slice(0, 5).map((x: Json) => ({ id: x.speciesId, name: names.get(x.speciesId), score: x.score, reason: x.reasons[0] ?? null })),
        excludedSpecies: r.ranked.filter((x: Json) => x.excludedBy).slice(0, 3).map((x: Json) => ({ name: names.get(x.speciesId), why: x.excludedBy })),
        scheme: r.scheme.map((x: Json) => ({ id: x.speciesId, name: names.get(x.speciesId), tier: x.tier, quantity: x.quantity })),
        cost: { totalKzt: r.cost.total, perM2Kzt: r.cost.perM2, items: r.cost.items.map((x: Json) => ({ label: x.label, amountKzt: x.amount, dataClass: x.dataClass })) },
        survivalPercent: r.survivalAvg, care: { visitsPerYear: r.care.reduce((n: number, x: Json) => n + x.visits, 0), warnings: r.careWarnings },
        effect: r.effect.map((x: Json) => ({ years: x.years, co2TonsPerYear: x.co2t, coolingC: x.coolingC, rainM3: x.rainM3 })),
        costPerTonCo2Kzt: r.costPerTonCo2, missingData: r.missing.slice(0, 4), note: 'Оценки по правилам; расценки — демо, пока администратор не заменит их в справочнике.',
      };
    },
    compare_variants: (a, ctx) => {
      const site = candidate(s, String(a.zoneId)); const ref = reference(s);
      return { zone: zoneOf(site.id, ctx), variants: web.variantSummaries({}, (o) => analyze(site, ref, o)) };
    },
    top_priorities: (a, ctx) => {
      const items = priorities(candidates(s), reference(s), a.weights ?? web.DEFAULT_PRIORITY_WEIGHTS);
      return { items: items.slice(0, Math.min(20, Number(a.limit ?? 5))).map((x) => ({ zone: zoneOf(x.siteId, ctx), index: x.index, explanation: x.explanation.slice(0, 2), costKzt: Math.round(x.cost), co2t20: x.co2t20 })),
        note: 'Плотность населения заменена плотностью застройки: данных о населении нет.' };
    },
    budget_roadmap: (a, ctx) => {
      const budget = Number(a.budgetKzt);
      if (!Number.isFinite(budget) || budget <= 0) return { error: 'budgetKzt должен быть положительным числом в тенге' };
      const rm = web.roadmap(priorities(candidates(s), reference(s), web.DEFAULT_PRIORITY_WEIGHTS), budget);
      return { budgetKzt: budget, zonesCount: rm.chosen.length, spentKzt: Math.round(rm.spent), leftKzt: Math.round(rm.left), co2t20: rm.co2t20, method: rm.method,
        zones: rm.chosen.slice(0, 8).map((x: Json) => ({ zone: zoneOf(x.siteId, ctx), index: x.index, costKzt: Math.round(x.cost) })) };
    },
    find_problems: (a, ctx) => {
      const { problems, notDetectable } = web.detectProblems(candidates(s));
      const list = problems.filter((p) => (!a.type || p.type === a.type) && (!a.severity || p.severity === a.severity));
      const counts = Object.fromEntries(['deficit', 'soil', 'heat', 'unprotected'].map((t) => [t, problems.filter((p) => p.type === t).length]));
      return { total: problems.length, countsByType: counts, matched: list.length, notDetectable,
        items: list.slice(0, Math.min(20, Number(a.limit ?? 6))).map((p) => ({ zone: zoneOf(p.siteId, ctx), type: p.type, severity: p.severity, cause: p.cause, action: p.action })) };
    },
    search_knowledge: (a, ctx) => {
      const keys = stems(String(a.query ?? ''));
      const docs: { id: string; kind: string; title: string; text: string; sourceIds: string[] }[] = [
        ...speciesList(s).map((x) => ({ id: x.id, kind: 'вид', title: `${x.nameRu} (${x.latin})`, text: [...(x.notes ?? []), ...(x.benefits ?? []), ...(x.beauty ?? [])].join(' '), sourceIds: [...(x.evidenceIds ?? []), ...(x.pavlodarEvidenceId ? [x.pavlodarEvidenceId] : [])] })),
        ...ratesList(s).map((x) => ({ id: x.key, kind: 'расценка', title: x.label, text: `${x.value ?? 'нет данных'} ${x.unit}. Источник: ${x.source}`, sourceIds: [] as string[] })),
        ...web.pavlodarFacts.map((x) => ({ id: x.id, kind: x.gap ? 'нет данных' : 'факт о Павлодаре', title: x.title, text: x.text, sourceIds: x.evidenceIds as string[] })),
        ...listDocs(s, 'evidence').map((x) => ({ id: x.id, kind: 'источник', title: String(x.sourceLabel), text: String(x.note ?? ''), sourceIds: [x.id] })),
      ];
      const hits = docs.map((d) => ({ d, n: score(norm(`${d.title} ${d.text}`), keys) * 2 + score(norm(d.title), keys) })).filter((x) => x.n > 0).sort((x, y) => y.n - x.n).slice(0, Math.min(8, Number(a.limit ?? 5)));
      for (const { d } of hits) d.sourceIds.forEach((id) => ctx.evidence.add(id));
      return { results: hits.map(({ d }) => ({ id: d.id, kind: d.kind, title: d.title, text: clip(d.text, 220), sourceIds: d.sourceIds })), note: hits.length ? undefined : 'В справочниках ничего не нашлось.' };
    },
  };
  return (name: string, args: Json, ctx: Ctx): Json => {
    const fn = run[name];
    if (!fn) return { error: `Нет функции ${name}` };
    try { return fn(args, ctx); } catch (e) { return { error: e instanceof Error ? e.message : 'Ошибка расчёта' }; }
  };
}

class LlmError extends Error {
  constructor(message: string, public status?: number, public retryAfterMs?: number) { super(message); }
}

async function chat(cfg: LlmConfig, messages: Json[], deadline: number, toolChoice: 'auto' | 'none') {
  const left = deadline - Date.now();
  if (left < 500) throw new LlmError('timeout');
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST', signal: AbortSignal.timeout(left),
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, messages, tools: TOOLS, tool_choice: toolChoice, temperature: 0.2, max_tokens: 800 }),
    });
  } catch (e) {
    throw new LlmError((e as Error).name === 'TimeoutError' ? 'timeout' : 'network error');
  }
  if (!res.ok) {
    const retry = Number(res.headers.get('retry-after'));
    throw new LlmError(res.status === 429 ? 'rate limit' : `HTTP ${res.status}`, res.status, Number.isFinite(retry) && retry > 0 ? Math.min(retry, 600) * 1000 : undefined);
  }
  const json = (await res.json()) as Json;
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new LlmError('empty response');
  return msg as { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };
}

const REASON: Record<string, string> = { 'rate limit': 'лимит запросов', timeout: 'не уложилась во время', 'network error': 'нет связи', 'numbers without tool calls': 'цифры без расчёта', 'empty answer': 'пустой ответ' };
const reasonText = (e: unknown) => (e instanceof LlmError ? REASON[e.message] ?? e.message : 'ошибка');

/**
 * Ответ модели в форме AssistantReply: method 'model', sources и toolCalls по контракту 29.10.
 * Модели пробуются по порядку; у каждой — своя доля общего лимита LLM_TIMEOUT_MS, чтобы резерву хватило времени.
 */
export function createLlmAssistant(s: Store, providers: LlmConfig | LlmConfig[]): AssistantAdapter {
  const list = Array.isArray(providers) ? providers : [providers];
  const exec = createTools(s);
  const coolUntil = new Map<string, number>();
  return async (input) => {
    const total = list[0]!.timeoutMs, end = Date.now() + total;
    const failures: string[] = [];
    const ready = list.filter((p) => (coolUntil.get(p.name) ?? 0) <= Date.now());
    for (const [i, cfg] of ready.entries()) {
      const share = Math.max(1000, Math.floor((end - Date.now()) / (ready.length - i)));
      try {
        const reply = await askOne(s, exec, cfg, input, Math.min(end, Date.now() + share));
        const skipped = list.filter((p) => !ready.includes(p)).map((p) => `${p.model}: лимит запросов, пропущена`);
        const notes = [...skipped, ...failures];
        return notes.length ? { ...reply, reserveReason: `Ответила резервная модель (${notes.join('; ')}).` } : reply;
      } catch (e) {
        if (e instanceof LlmError && e.status === 429) coolUntil.set(cfg.name, Date.now() + (e.retryAfterMs ?? 60000));
        failures.push(`${cfg.model}: ${reasonText(e)}`);
        console.warn(`Assistant model ${cfg.name} (${cfg.model}) failed: ${e instanceof Error ? e.message : 'error'}`);
      }
    }
    throw new LlmError(failures.length ? `all models failed: ${failures.join('; ')}` : 'all models are cooling down after rate limits');
  };
}

type AskInput = Parameters<AssistantAdapter>[0];

async function askOne(s: Store, exec: ReturnType<typeof createTools>, cfg: LlmConfig, { message, siteId, history = [], view = null }: AskInput, deadline: number) {
  const ctx: Ctx = { zones: [], evidence: new Set(), view };
  const selected = siteId ? maybeDoc(s, 'site', siteId) : undefined;
  const where = selected && analyzable(selected) ? `Выбранная на карте зона: ${selected.id} «${selected.name}».` : `Зона на карте не выбрана.${view ? ' find_place без query вернёт зоны у центра карты, которую видит специалист.' : ''}`;
  const lang = questionLang(message);
  // Прошлые реплики — только текст: короткий ответ пользователя продолжает его прошлый вопрос.
  const turns = history.slice(-6).map((h) => ({ role: h.role, content: clip(h.text, 600) }));
  const messages: Json[] = [{ role: 'system', content: SYSTEM }, ...turns, { role: 'user', content: `${where}${LANG_NOTE[lang]}\nВопрос: ${message}` }];
  const toolCalls: { name: string; args: Json }[] = [];
  let text = '';
  for (let round = 0; ; round++) {
    const msg = await chat(cfg, messages, deadline, round < cfg.maxRounds ? 'auto' : 'none');
    if (!msg.tool_calls?.length || round >= cfg.maxRounds) { text = (msg.content ?? '').trim(); break; }
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      let args: Json = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* пустые аргументы */ }
      toolCalls.push({ name: call.function.name, args });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(exec(call.function.name, args, ctx)) });
    }
  }
  if (!text) throw new LlmError('empty answer');
  // Цифры без вызова функций — значит, модель их придумала: такой ответ не показываем (резерв или правила).
  if (!toolCalls.length && /\d/.test(text)) throw new LlmError('numbers without tool calls');
  const named = ctx.zones.filter((z) => text.includes(z.name));
  const sources = [...ctx.evidence].map((id) => maybeDoc(s, 'evidence', id)).filter(Boolean).slice(0, 6)
    .map((e) => ({ id: e!.id, label: String(e!.sourceLabel), ...(e!.sourceUrl ? { url: String(e!.sourceUrl) } : {}) }));
  return { text, zones: (named.length ? named : ctx.zones).slice(0, 8), method: 'model', intent: toolCalls[0]?.name ?? 'chat', model: cfg.model, sources, toolCalls, lang } as Json;
}

export type CheckResult = { name: string; model: string; host: string; hostAllowed: boolean; keyAccepted: boolean | null; modelListed: boolean | null; available: string[]; toolCall: boolean; ms: number | null; error: string | null };
// Текст ошибки провайдера; Gemini присылает массив [{error}] и на неверный ключ отвечает 400, а не 401.
async function providerError(res: Response) {
  let text = '';
  try { const raw = (await res.json()) as Json; const j = (Array.isArray(raw) ? raw[0] : raw) ?? {}; text = String(j.error?.message ?? j.error ?? j.message ?? ''); } catch { /* не JSON */ }
  return { text: `HTTP ${res.status}${text ? `: ${clip(text, 160)}` : ''}`, badKey: res.status === 401 || res.status === 403 || /api key|api_key|unauthori[sz]ed/i.test(text) };
}
/** Проверка подключения для npm run llm:check: хост, ключ, модель в списке провайдера, вызов функции, время. Ключ не выводится. */
export async function checkProvider(cfg: LlmConfig, allowedHosts: string[]): Promise<CheckResult> {
  const host = new URL(cfg.baseUrl).hostname;
  const r: CheckResult = { name: cfg.name, model: cfg.model, host, hostAllowed: allowedHosts.includes(host), keyAccepted: null, modelListed: null, available: [], toolCall: false, ms: null, error: null };
  if (!r.hostAllowed) return { ...r, error: `хост ${host} не указан в LLM_ALLOWED_HOSTS` };
  const auth = { Authorization: `Bearer ${cfg.apiKey}` };
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, { headers: auth, signal: AbortSignal.timeout(10000) });
    if (!res.ok) { const e = await providerError(res); if (e.badKey) return { ...r, keyAccepted: false, error: `ключ не принят (${e.text})` }; }
    else {
      const ids = (((await res.json()) as Json).data ?? []).map((m: Json) => String(m.id).replace(/^models\//, '')) as string[];
      r.keyAccepted = true; r.modelListed = ids.includes(cfg.model);
      const family = cfg.model.split(/[-:/.]/)[0]!;
      r.available = (r.modelListed ? [] : ids.filter((id) => id.includes(family))).slice(0, 10);
    }
  } catch { /* список моделей есть не у всех — проверяем запросом ниже */ }
  const tool = TOOLS.find((x) => x.function.name === 'top_priorities')!;
  const started = Date.now();
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(cfg.timeoutMs),
      body: JSON.stringify({ model: cfg.model, temperature: 0, max_tokens: 200, tools: [tool], tool_choice: 'auto',
        messages: [{ role: 'system', content: 'Проверка подключения. Для ответа вызови функцию.' }, { role: 'user', content: 'Покажи три самые приоритетные зоны.' }] }),
    });
    r.ms = Date.now() - started;
    if (!res.ok) { const e = await providerError(res); return { ...r, ...(e.badKey ? { keyAccepted: false } : {}), error: e.badKey ? `ключ не принят (${e.text})` : `запрос к модели: ${e.text}` }; }
    r.keyAccepted = true;
    const msg = (((await res.json()) as Json).choices?.[0]?.message ?? {}) as Json;
    r.toolCall = !!msg.tool_calls?.length;
    if (!r.toolCall) r.error = 'модель ответила текстом и не вызвала функцию — нужна модель с поддержкой tools';
  } catch (e) {
    r.ms = Date.now() - started;
    r.error = (e as Error).name === 'TimeoutError' ? `нет ответа за ${cfg.timeoutMs / 1000} с` : 'нет связи с провайдером';
  }
  return r;
}
