// Маршруты ТЗ на сервере (SRV-05) в формате ответов тестового источника.
// Расчёты — функции apps/web/src/shared/analytics (через shared.ts), без копии кода.
// Права (одно правило для сервера и тестового источника, см. README):
//   Специалист (coordinator) — анализ, зоны, варианты, проекты, задания;
//   Администратор (admin) — справочники и пользователи, согласование проектов; задания и отчёты не ведёт;
//   Просмотр (viewer) — только чтение и расчёты без сохранения.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../db.js';
import { ApiError } from '../errors.js';
import { allow, fail, id, listDocs, mutate, now, text, version, type User } from '../v2/core.js';
import { actor } from '../v2/auth.js';
import { type Api, param } from '../v2/router.js';
import { analyze, candidate, candidates, priorities, ratesList, ratesVersion, reference, speciesList } from './data.js';
import { insertZone } from './seed.js';
import { web, type Json } from './shared.js';
import * as municipal from '../municipal/data.js';

/** Подключение ассистента участника 3 (LLM + RAG). Нет адаптера или он упал — ответ по правилам. */
export type AssistantAdapter = (input: { message: string; siteId: string | null; user: User }) => Promise<Json>;
export type TzOptions = { assistant?: AssistantAdapter };

const reader = (a: User) => allow(a, 'admin', 'coordinator', 'viewer');
const object = z.object({}).passthrough();
const options = z.object({ options: object.default({}) }).strict();
const weights = z.record(z.string(), z.number().min(0).max(1));
const prioritiesInput = z.object({ weights: weights.optional(), budget: z.number().nonnegative().nullable().optional() }).strict();
const rateInput = z.object({ key: z.string().min(1).max(80), value: z.number().nonnegative().finite().nullable(), source: text, expectedVersion: version }).strict();
const assistantInput = z.object({ message: z.string().trim().min(1).max(2000), siteId: id.nullable().optional() }).strict();
const zoneInput = z.object({ name: z.string().max(120).optional(), geometry: z.unknown() }).strict();
const importInput = z.object({ format: z.string().max(20).optional(), features: z.array(object).max(20000) }).strict();
const rankInput = z.object({ weights: z.record(z.string(), z.number()) }).strict();
const radius = z.object({ radius: z.coerce.number().refine(r => [30, 50, 100, 200].includes(r), 'radius: 30, 50, 100 or 200') }).strict();

export function tzRoutes(s: Store, api: Api, tz: TzOptions = {}) {
  const { route, write } = api;
  const fetchedAt = () => ({ fetchedAt: now() });

  route({ method: 'get', path: '/species', summary: 'TZ: plant species reference (50 species with sources)', response: z.array(object) }, (_req, res) => {
    reader(actor(res)); res.json({ data: speciesList(s) });
  });
  route({ method: 'get', path: '/layers/sources', summary: 'TZ: provenance of map layers (OSM snapshot date and license)' }, (_req, res) => {
    reader(actor(res)); res.json({ data: { osm: web.osmMeta } });
  });
  route({ method: 'get', path: '/geocode', summary: 'TZ 3.1.4: address, street, place or zone search over the OSM snapshot', response: z.array(object) }, (req, res) => {
    reader(actor(res)); const q = z.object({ q: z.string().trim().min(1).max(100) }).strict().parse(req.query);
    res.json({ data: web.searchAddress(q.q, candidates(s), 8), meta: web.GEOCODE_META });
  });
  route({ method: 'get', path: '/reference/facts', summary: 'TZ 5.3: verified Pavlodar facts (climate, norms, air, green fund, prices) with sources' }, (_req, res) => {
    reader(actor(res)); res.json(web.referenceFacts());
  });
  route({ method: 'get', path: '/layers/soils', summary: 'TZ: synthetic soil grid until the organizer soil map arrives' }, (_req, res) => { reader(actor(res)); res.json(web.soilsLayer()); });
  route({ method: 'get', path: '/layers/greenery', summary: 'TZ: existing greenery from OpenStreetMap' }, (_req, res) => { reader(actor(res)); res.json(web.greeneryLayer()); });

  // POST /zones — нарисованная зона (контракт 29.10): проверка полигона, площадь, окружение; почва — в meta.
  route({ method: 'post', path: '/zones', input: zoneInput, status: 201, summary: 'Coordinator: save a drawn zone polygon as site-user-N' }, (req, res) => {
    const a = actor(res); allow(a, 'coordinator'); const b = zoneInput.parse(req.body);
    const { ring, errors } = web.validateDrawnPolygon(b.geometry);
    if (errors.length) throw new ApiError(400, 'VALIDATION_ERROR', errors.map(e => e.message).join(' '), { fields: { geometry: errors[0]!.message }, errors });
    const result = mutate(s, a, req.method, req.path, req.get('Idempotency-Key'), b, 201, () => allow(a, 'coordinator'), () => {
      const docs = listDocs(s, 'site');
      const n = 1 + docs.reduce((mx, d) => Math.max(mx, Number(/^site-user-(\d+)$/.exec(d.id)?.[1] ?? 0)), 0);
      const maxB = docs.reduce((mx, d) => Math.max(mx, d.context?.buildings200m ?? 0), 1);
      const site = web.buildDrawnZone(`site-user-${n}`, (b.name ?? '').trim().slice(0, 120), ring, maxB);
      return insertZone(s, site, now());
    });
    const site = (result.body as { data: Json }).data;
    res.set('Idempotency-Replayed', String(result.replayed)).status(result.status)
      .json({ ...(result.body as Json), meta: { soil: web.soilFor(site.centroid.lat, site.centroid.lng), note: 'Почва — синтетический слой до карты почв организатора.' } });
  });
  route({ method: 'get', path: '/zones/:id/context', summary: 'TZ: buildings, roads, entrances around a zone (OSM), radius 30/50/100/200 m' }, (req, res) => {
    reader(actor(res)); const q = radius.parse(req.query); res.json({ data: web.siteContext(candidate(s, param(req)), q.radius) });
  });

  route({ method: 'post', path: '/zones/:id/analysis', input: options, readOnly: true, summary: 'TZ 3.3–3.8: selection, scheme, cost, survival, care, effect (estimates)' }, (req, res) => {
    reader(actor(res)); const b = options.parse(req.body);
    res.json({ data: analyze(candidate(s, param(req)), reference(s), b.options) });
  });
  route({ method: 'post', path: '/zones/:id/variants', input: options, readOnly: true, summary: 'TZ 3.4: econom / optimal / max comparison', response: z.array(object) }, (req, res) => {
    reader(actor(res)); const b = options.parse(req.body); const site = candidate(s, param(req)); const ref = reference(s);
    res.json({ data: web.variantSummaries(b.options, o => analyze(site, ref, o)) });
  });
  route({ method: 'get', path: '/problems', summary: 'TZ 3.2: problem zones (4 of 5 types; degradation needs organizer data)' }, (_req, res) => {
    reader(actor(res)); res.json({ data: web.detectProblems(candidates(s)), meta: fetchedAt() });
  });
  route({ method: 'post', path: '/priorities', input: prioritiesInput, readOnly: true, summary: 'TZ 3.7: priority index and budget roadmap' }, (req, res) => {
    reader(actor(res)); const b = prioritiesInput.parse(req.body);
    const items = priorities(candidates(s), reference(s), b.weights ?? web.DEFAULT_PRIORITY_WEIGHTS);
    res.json({ data: { items, roadmap: b.budget ? web.roadmap(items, b.budget) : null } });
  });

  route({ method: 'get', path: '/rates', summary: 'TZ 3.4/5.3: rates and coefficients with sources' }, (_req, res) => {
    reader(actor(res)); res.json({ data: { rates: ratesList(s), version: ratesVersion(s) } });
  });
  write({ method: 'patch', path: '/rates', input: rateInput, summary: 'Admin: change one rate; source required; change history kept' }, a => allow(a, 'admin'), (a, b) => {
    if (b.expectedVersion !== ratesVersion(s)) fail('VERSION_CONFLICT', 'Rates changed; reload and retry');
    const row = s.get('SELECT data FROM tz_rates WHERE key=?', b.key);
    if (!row) fail('NOT_FOUND', 'Rate not found', 404);
    const before = JSON.parse(String(row!.data));
    const after = { ...before, value: b.value, source: b.source.trim(), dataClass: 'real', updatedBy: a.displayName, updatedAt: now() };
    s.run('UPDATE tz_rates SET data=? WHERE key=?', JSON.stringify(after), b.key);
    s.run('INSERT INTO tz_rate_history VALUES (?,?,?,?,?,?)', b.expectedVersion + 1, b.key, a.id, JSON.stringify(before), JSON.stringify(after), now());
    return { rates: ratesList(s), version: ratesVersion(s) };
  });
  route({ method: 'get', path: '/rates/history', summary: 'Admin: rate change history', response: z.array(object) }, (_req, res) => {
    allow(actor(res), 'admin');
    res.json({ data: s.all('SELECT h.*,u.display_name FROM tz_rate_history h JOIN v2_users u ON u.id=h.actor_id ORDER BY version DESC').map(r => ({ version: r.version, key: r.rate_key, actorId: r.actor_id, actorName: r.display_name, before: JSON.parse(String(r.before_json)), after: JSON.parse(String(r.after_json)), createdAt: r.created_at })) });
  });

  route({ method: 'get', path: '/dashboard/metrics', summary: 'TZ 3.9: overview metrics with definitions', response: z.array(object) }, (_req, res) => {
    reader(actor(res));
    const rows = (sql: string) => s.all(sql).map(r => JSON.parse(String(r.data)));
    res.json({ data: web.dashboardMetrics({ sites: candidates(s), tasks: rows('SELECT data FROM v2_tasks').map(web.taskFromV2), reports: rows('SELECT data FROM v2_reports'),
      projects: rows('SELECT data FROM v2_designs').map(d => web.projectFromDesign(d, s.all('SELECT data FROM v2_design_revisions WHERE design_id=? ORDER BY revision', d.id).map(r => JSON.parse(String(r.data))))),
      osmBase: web.osmMeta.osmBase }), meta: fetchedAt() });
  });

  // Ассистент (ТЗ 3.10): модель через адаптер (src/tz/llm.ts) с расчётами модулей; без модели или при её сбое — правила.
  route({ method: 'post', path: '/assistant', input: assistantInput, readOnly: true, summary: 'TZ 3.10: assistant answer with numbers from modules; history kept per user' }, async (req, res) => {
    const a = actor(res); reader(a); const b = assistantInput.parse(req.body);
    const siteId = b.siteId ?? null;
    if(siteId)municipal.analyze(s,siteId,{});
    let reply: Json | null = null, fallbackReason: string | null = null;
    if (tz.assistant) {
      try { reply = await tz.assistant({ message: b.message, siteId, user: a }); }
      catch (e) {
        // В журнал — только причина, без текста вопроса и ключа.
        console.warn(`Assistant model failed, rules answer instead: ${e instanceof Error ? e.message : 'error'}`);
        fallbackReason = 'Модель не ответила вовремя или ответ не прошёл проверку — показан ответ по правилам.';
      }
    }
    if (!reply) { const ref = reference(s); reply = { sources: [], toolCalls: [], ...web.answer(b.message, { siteId }, candidates(s), ref.species, ref.map), ...(fallbackReason ? { fallbackReason } : {}) }; }
    s.run('INSERT INTO tz_assistant_history VALUES (?,?,?,?,?,?,?)', randomUUID(), a.id, now(), b.message.slice(0, 300), String(reply.intent ?? 'other'), String(reply.method ?? 'rules'), JSON.stringify((reply.zones ?? []).map((z: Json) => z.id)));
    res.json({ data: reply });
  });
  route({ method: 'get', path: '/assistant/history', summary: 'TZ 3.9: current user assistant history (last 50)', response: z.array(object) }, (_req, res) => {
    const a = actor(res); reader(a);
    const rows = s.all('SELECT * FROM tz_assistant_history WHERE user_id=? ORDER BY at DESC, id LIMIT 50', a.id).map(r => ({ at: r.at, q: r.question, intent: r.intent, method: r.method, zones: JSON.parse(String(r.zones)) }));
    const legacy=s.all('SELECT data FROM municipal_history WHERE owner_id=? ORDER BY created_at DESC LIMIT 50',a.id).map(r=>JSON.parse(String(r.data)));
    res.json({ data: [...legacy,...rows].sort((a,b)=>String(a.at).localeCompare(String(b.at))).slice(-50) });
  });

  route({ method: 'post', path: '/imports/preview', input: importInput, readOnly: true, summary: 'TZ 3.1.5: import quality check; nothing is saved' }, (req, res) => {
    allow(actor(res), 'admin', 'coordinator'); const b = importInput.parse(req.body);
    res.json({ data: web.previewImport(b.format, b.features, 'Предпросмотр: в базу ничего не записано. Сохранение слоя — отдельным шагом после подтверждения.') });
  });

  // Рейтинг и подбор по правилам (экраны «Рейтинг» и карточка участка).
  route({ method: 'post', path: '/sites/rank-preview', input: rankInput, readOnly: true, summary: 'Rule-based site ranking preview with explicit weights' }, (req, res) => {
    reader(actor(res)); const b = rankInput.parse(req.body);
    const sum = Object.values(b.weights).reduce((x, y) => x + y, 0);
    if (Math.abs(sum - 1) > 0.011) throw new ApiError(400, 'VALIDATION_ERROR', `Сумма весов должна быть 1, сейчас ${sum.toFixed(2)}.`, { fields: { weights: 'Сумма весов — 1.' } });
    res.json({ data: web.rankSites(candidates(s), b.weights) });
  });
  route({ method: 'post', path: '/sites/:id/plant-selection', input: z.object({}).strict(), readOnly: true, summary: 'Rule-based plant selection for a site' }, (req, res) => {
    reader(actor(res)); res.json({ data: web.selectPlants(candidate(s, param(req)), speciesList(s)) });
  });
}
