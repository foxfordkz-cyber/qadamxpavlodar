// Слой соответствий (SRV-06): контракт экранов (types.ts, тестовый источник) ↔ контракт V2 сервера apps/server.
// Единственное место, где сводятся расхождения имён:
//   brigades ↔ crews (+ профили людей), projects ↔ designs (designVersion ↔ revision, returned ↔ changes_requested),
//   species ↔ plant-catalog (id вида = id позиции каталога), assigneeId/crewIds ↔ assignedWorkerIds, minCrew ↔ minWorkers,
//   checks.state ↔ checks.status (checkedBy/checkedAt ↔ reviewedByName/reviewedAt), коды ошибок V2 → коды экранов.
// Включается только в режиме ?source=api (DataProvider); тестовый источник не меняется.
// Сервер импортирует отсюда siteFromV2, чтобы расчёты ТЗ получали участок в той же форме, что и экраны.
import { ApiError, newIdempotencyKey, type HttpMethod, type RequestOptions, type Transport } from './transport';
import type { ApiSuccess, Brigade, CandidateSite, CheckKey, CheckState, Issue, PlantingProject, Priority, ProjectItem, ProjectReview, Report, SiteCheck, Species, Task, TaskAction, Worker } from './types';
import { daySummary } from './dayPlan';

type Doc = Record<string, any>;
export const WEB_CHECKS: CheckKey[] = ['landPermission', 'utilities', 'access', 'siteSuitability'];

// --- Участки ---------------------------------------------------------------

export function siteFromV2(doc: Doc): CandidateSite {
  const checks = {} as Record<CheckKey, SiteCheck>;
  for (const k of WEB_CHECKS) {
    const c = doc.checks?.[k];
    checks[k] = c
      ? { state: (c.status === 'not_applicable' ? 'cleared' : (c.status ?? 'unknown')) as CheckState, comment: c.comment ?? null, checkedBy: c.reviewedByName ?? c.reviewedBy ?? null, checkedAt: c.reviewedAt ?? null }
      : { state: 'unknown' };
  }
  // В старых записях V2 missingData — строки; экраны ждут {field, reason}.
  const missingData = (doc.missingData ?? []).map((m: unknown) => (typeof m === 'string' ? { field: 'site', reason: m } : m));
  return { ...doc, checks, missingData, evidenceIds: doc.evidenceIds ?? [], isDemo: !!doc.isDemo } as CandidateSite;
}

/** Отметка «не проверено» на сервере тоже требует комментарий; для «пройдено» и «ограничение» его пишет человек. */
export function checksToV2(checks: Partial<Record<CheckKey, { state: CheckState; comment: string }>>) {
  return Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, { status: v!.state, comment: v!.comment?.trim() || (v!.state === 'unknown' ? 'Проверка не выполнена.' : '') }]));
}

// --- Люди и бригады ----------------------------------------------------------

export function workerFromV2(u: Doc): Worker {
  const p = u.profile ?? {};
  return { id: u.id, displayName: u.displayName, role: u.role, active: u.active, shiftStart: p.shiftStart ?? '', shiftEnd: p.shiftEnd ?? '', capacityMinutes: p.capacityMinutes ?? 0, skills: p.skills ?? [], startLocation: p.startLocation ?? null };
}

export function brigadeFromV2(c: Doc, workers: Worker[], resources: Doc[] = []): Brigade {
  const memberIds = [...new Set<string>([c.foremanId, ...(c.members ?? []).filter((m: Doc) => m.active).map((m: Doc) => m.userId)])];
  const people = memberIds.map((id) => workers.find((w) => w.id === id)).filter((w): w is Worker => !!w);
  const starts = people.map((p) => p.shiftStart).filter(Boolean).sort();
  const ends = people.map((p) => p.shiftEnd).filter(Boolean).sort();
  return {
    id: c.id, name: c.name, foremanId: c.foremanId, memberIds, active: c.active,
    shiftStart: starts[0] ?? '', shiftEnd: ends.at(-1) ?? '',
    capacityMinutes: Math.max(0, ...people.map((p) => p.capacityMinutes)),
    equipment: (c.resourceIds ?? []).map((id: string) => resources.find((r) => r.id === id)?.label ?? id),
    skills: [...new Set(people.flatMap((p) => p.skills ?? []))] as TaskAction[],
  };
}

// --- Задания, отчёты, проблемы ----------------------------------------------

const PRIORITY_RANK: Record<Priority, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const PRIORITY_WEIGHT_V2: Record<Priority, number> = { low: 25, medium: 50, high: 75, critical: 100 };

export function taskFromV2(t: Doc): Task {
  return {
    id: t.id, objectType: t.objectType, objectId: t.objectId, action: t.action, description: t.description, priority: t.priority,
    priorityWeight: PRIORITY_RANK[t.priority as Priority] ?? 2, createdAt: t.createdAt, updatedAt: t.updatedAt, dueAt: t.dueAt ?? null,
    estimatedMinutes: t.estimatedMinutes, requiredWaterLiters: t.requiredWaterLiters ?? null,
    assigneeId: t.assignedWorkerIds?.[0] ?? null, scheduledStart: t.scheduledStart ?? null, scheduledEnd: t.scheduledEnd ?? null,
    planId: t.planId ?? null, status: t.status, latestReportId: t.latestReportId ?? null, evidenceIds: t.evidenceIds ?? [], isDemo: !!t.isDemo, version: t.version,
    brigadeId: t.assignedCrewId ?? null, minCrew: t.minWorkers ?? null, crewIds: t.assignedWorkerIds ?? [],
    projectId: t.approvedDesignId ?? null, projectDesignVersion: t.approvedDesignVersion ?? null,
  };
}

export const reportFromV2 = (r: Doc): Report => ({ ...r, photoIds: r.photoIds ?? [], note: r.note ?? '' }) as Report;
export const issueFromV2 = (i: Doc, objectId: string): Issue => ({ id: i.id, taskId: i.taskId, objectId, authorId: i.authorId, createdAt: i.createdAt, text: i.text, confirmedObservation: i.confirmedObservation ?? null });

// --- Проекты озеленения ↔ designs --------------------------------------------

const PROJECT_STATUS: Record<string, PlantingProject['status']> = { draft: 'draft', submitted: 'submitted', changes_requested: 'returned', approved: 'approved' };

export function itemFromV2(p: Doc): ProjectItem {
  const geometry = p.geometry?.type === 'MultiPoint' ? { type: 'Point', coordinates: p.geometry.coordinates[0] } : p.geometry;
  return {
    id: p.id, speciesId: p.catalogItemId, kind: p.kind ?? (geometry?.type === 'Polygon' ? 'bed' : 'point'), geometry, quantity: p.quantity ?? 1,
    ...(p.note ? { note: p.note } : {}), origin: p.origin ?? 'manual', conflicts: p.conflicts ?? [],
  };
}

export function itemToV2(i: ProjectItem, evidenceIds: string[]) {
  return {
    id: i.id, catalogItemId: i.speciesId, geometry: i.geometry, quantity: i.quantity,
    quantityMethod: i.kind === 'bed' ? 'Клумба: количество задал специалист в редакторе' : 'Позиция поставлена специалистом в редакторе',
    spacingM: null, bedAreaM2: null, phase: null, carePolicyId: null, evidenceIds,
    kind: i.kind, ...(i.note?.trim() ? { note: i.note.trim() } : {}), origin: i.origin,
    conflicts: (i.conflicts ?? []).map((c) => ({ type: c.type, message: c.message, resolution: c.resolution?.trim() || null })),
  };
}

export function projectFromDesign(d: Doc, revisions: Doc[] = []): PlantingProject {
  const history = revisions.length ? revisions : [d];
  const reviews: ProjectReview[] = history
    .filter((r) => r.status === 'approved' || r.status === 'changes_requested')
    .map((r) => ({ decision: r.status === 'approved' ? 'approved' : 'returned', by: r.reviewedByName ?? r.approvedByName ?? r.reviewedBy ?? r.approvedBy ?? '—', at: r.reviewedAt ?? r.approvedAt ?? r.updatedAt, comment: r.reviewComment ?? null, designVersion: r.revision }));
  const approved = [...history].reverse().find((r) => r.status === 'approved') ?? null;
  return {
    id: d.id, siteId: d.siteId, title: d.name, version: d.version, designVersion: d.revision, status: PROJECT_STATUS[d.status] ?? 'draft',
    items: (d.plantingItems ?? []).map(itemFromV2), season: d.season ?? 'Сезон не указан', createdBy: d.createdByName ?? d.createdBy,
    createdAt: d.createdAt, updatedAt: d.updatedAt, submittedAt: d.submittedAt ?? null, reviews,
    approved: approved ? { designVersion: approved.revision, items: (approved.plantingItems ?? []).map(itemFromV2), approvedAt: approved.approvedAt, by: approved.approvedByName ?? approved.approvedBy } : null,
    implementedAt: null, isDemo: !!d.isDemo,
  };
}

// --- Ошибки -----------------------------------------------------------------

const CODE: Record<string, string> = {
  VERSION_CONFLICT: 'version_conflict', SITE_CHECKS_INCOMPLETE: 'checks_incomplete', AUTH_REQUIRED: 'unauthenticated', SESSION_REVOKED: 'unauthenticated',
  FORBIDDEN: 'forbidden', VALIDATION_ERROR: 'validation_error', NOT_FOUND: 'not_found', IDEMPOTENCY_CONFLICT: 'idempotency_conflict',
  INVALID_TRANSITION: 'invalid_state', DESIGN_UNDER_REVIEW: 'invalid_state', INTEGRATION_UNAVAILABLE: 'integration_unavailable',
};
const MESSAGE: Record<string, string> = {
  VERSION_CONFLICT: 'Данные изменены другим пользователем после загрузки. Обновите и повторите.',
  SITE_CHECKS_INCOMPLETE: 'Посадку нельзя утвердить: проверки участка не завершены.',
  AUTH_REQUIRED: 'Нужно войти в систему.', SESSION_REVOKED: 'Сессия завершена: войдите снова.',
  INVALID_CREDENTIALS: 'Неверный логин или пароль.', LOGIN_RATE_LIMIT: 'Слишком много попыток входа. Повторите через 15 минут.',
  FORBIDDEN: 'Недостаточно прав для этой роли.', CSRF_REQUIRED: 'Сессия устарела: обновите страницу.',
  NOT_FOUND: 'Объект не найден.', IDEMPOTENCY_CONFLICT: 'Этот ключ повтора уже использован с другим содержимым.',
  INVALID_TRANSITION: 'Это действие недоступно в текущем статусе.', DESIGN_UNDER_REVIEW: 'Проект на согласовании: сначала отзовите его, затем правьте.',
  DESIGN_EMPTY: 'В проекте нет ни одной позиции.', APPROVED_DESIGN_REQUIRED: 'Для посадки нужен согласованный проект озеленения.',
  INVALID_ACTION_TARGET: 'На сервере полив и прополка назначаются только зарегистрированному растению, не участку.',
  SITE_CHANGED: 'Проверки участка изменились после отправки: отправьте проект заново.',
  CREW_INACTIVE: 'Бригада или бригадир сейчас неактивны.', INTERVAL_TOO_SHORT: 'Интервал короче длительности задания.',
  AFTER_DEADLINE: 'Назначение выходит за срок задания.', ZONE_NOT_ANALYZABLE: 'Для расчёта нужен контур зоны (полигон).',
  INTEGRATION_UNAVAILABLE: 'Сервис не подключён. Ручные операции доступны.',
};

export function errorFromV2(e: unknown): unknown {
  if (!(e instanceof ApiError) || e.status === 0 || !/^[A-Z_]+$/.test(e.code)) return e;
  let details = e.details;
  let message = MESSAGE[e.code] ?? e.message;
  if (e.code === 'VALIDATION_ERROR' && Array.isArray(e.details)) {
    const fields: Record<string, string> = {};
    for (const i of e.details as { path?: (string | number)[]; message?: string }[]) fields[String(i.path?.[0] ?? 'form')] ??= i.message ?? 'Неверное значение.';
    details = { fields, issues: e.details };
    message = `Проверьте поля: ${Object.keys(fields).join(', ')}.`;
  }
  return new ApiError(e.status, CODE[e.code] ?? e.code.toLowerCase(), message, e.requestId, details);
}

const invalid = (field: string, text: string) => new ApiError(400, 'validation_error', text, undefined, { fields: { [field]: text } });

// --- Транспорт ---------------------------------------------------------------

type Result = ApiSuccess<unknown>;
type Handler = (m: RegExpMatchArray, o: RequestOptions) => Promise<Result>;

/** Обёртка над HTTP-транспортом: пути и формы экранов → маршруты V2; остальное (маршруты ТЗ) — без изменений. */
export function createV2CompatTransport(http: Transport, base = '/api/v1'): Transport {
  const get = async <T = Doc,>(path: string, query?: RequestOptions['query']) => (await http.request<T>('GET', path, { query })).data;
  const all = async (path: string, query: RequestOptions['query'] = {}) => {
    const out: Doc[] = [];
    for (let offset = 0; ; offset += 200) {
      const r = await http.request<Doc[]>('GET', path, { query: { ...query, limit: 200, offset } });
      out.push(...r.data);
      if (r.data.length < 200 || out.length >= Number(r.meta?.total ?? out.length)) return out;
    }
  };
  const send = async <T = Doc,>(method: HttpMethod, path: string, body: unknown, key?: string) =>
    (await http.request<T>(method, path, { body, idempotencyKey: key ?? newIdempotencyKey() })).data;
  const enc = encodeURIComponent;
  let speciesCache: Promise<Species[]> | null = null;
  const speciesEvidence = async (speciesId: string, fallback: string[]) => {
    speciesCache ??= get<Species[]>('/species').catch((e) => { speciesCache = null; throw e; });
    const ids = (await speciesCache).find((s) => s.id === speciesId)?.evidenceIds ?? [];
    return ids.length ? ids : fallback;
  };
  const brigades = async () => {
    const [crews, people, resources] = await Promise.all([get<Doc[]>('/crews'), get<Doc[]>('/workers'), get<Doc[]>('/resources').catch(() => [])]);
    const workers = people.map(workerFromV2);
    return crews.map((c) => brigadeFromV2(c, workers, resources as Doc[]));
  };
  const project = async (id: string) => {
    const d = await get(`/designs/${enc(id)}`);
    return projectFromDesign(d, d.revisions ?? []);
  };
  const tasks = async (q: { status?: string; assigneeId?: string; objectId?: string } = {}) =>
    (await all('/tasks', { status: q.status, workerId: q.assigneeId })).map(taskFromV2).filter((t) => !q.objectId || t.objectId === q.objectId);
  const saveDesignItems = async (siteEvidence: string[], items: ProjectItem[]) =>
    Promise.all(items.map(async (i) => itemToV2(i, await speciesEvidence(i.speciesId, siteEvidence))));

  const routes: [HttpMethod, RegExp, Handler][] = [
    ['GET', /^\/sites$/, async () => {
      const [docs, sources] = await Promise.all([all('/sites'), get('/layers/sources').catch(() => ({}))]);
      return { data: docs.map(siteFromV2), meta: { osm: (sources as Doc).osm ?? null, fetchedAt: new Date().toISOString() } };
    }],
    ['GET', /^\/sites\/([^/]+)$/, async (m) => ({ data: siteFromV2(await get(`/sites/${m[1]}`)) })],
    ['PATCH', /^\/sites\/([^/]+)$/, async (m, o) => {
      const b = o.body as { expectedVersion: number; checks?: Parameters<typeof checksToV2>[0]; waterAvailability?: { value: number | null; note: string } };
      const body = { expectedVersion: b.expectedVersion, ...(b.checks ? { checks: checksToV2(b.checks) } : {}), ...(b.waterAvailability ? { waterAvailability: b.waterAvailability } : {}) };
      return { data: siteFromV2(await send('PATCH', `/sites/${m[1]}`, body, o.idempotencyKey)) };
    }],
    ['POST', /^\/zones$/, async (_m, o) => {
      const r = await http.request<Doc>('POST', '/zones', o);
      return { data: siteFromV2(r.data), meta: r.meta };
    }],
    ['GET', /^\/sites\/([^/]+)\/context$/, async (m, o) => ({ data: await get(`/zones/${m[1]}/context`, o.query) })],
    ['GET', /^\/evidence$/, async (_m, o) => {
      const ids = String(o.query?.ids ?? '').split(',').filter(Boolean);
      return { data: ids.length ? (await all('/evidence')).filter((e) => ids.includes(e.id)) : [] };
    }],
    ['GET', /^\/plants$/, async () => ({ data: await all('/plants'), meta: { fetchedAt: new Date().toISOString() } })],
    ['GET', /^\/workers$/, async () => ({ data: (await get<Doc[]>('/workers')).map(workerFromV2) })],
    ['GET', /^\/brigades$/, async () => ({ data: await brigades() })],

    ['GET', /^\/tasks$/, async (_m, o) => ({ data: await tasks(o.query as never), meta: { fetchedAt: new Date().toISOString() } })],
    ['POST', /^\/tasks$/, async (_m, o) => {
      const b = o.body as Partial<Task>;
      if (b.action === 'plant' && b.objectType === 'candidate_site') {
        // На сервере посадку выпускает только согласованная версия проекта.
        if (!b.projectId) throw invalid('projectId', 'Для посадки нужен согласованный проект озеленения.');
        const d = await get(`/designs/${enc(b.projectId)}`);
        const created = await send<Doc[]>('POST', `/designs/${enc(b.projectId)}/create-tasks`, { expectedVersion: d.version, revision: b.projectDesignVersion ?? d.revision, estimatedMinutes: b.estimatedMinutes, minWorkers: 1, requiredSkills: ['plant'] }, o.idempotencyKey);
        return { data: taskFromV2(created[0]) };
      }
      let evidenceIds = b.evidenceIds ?? [];
      if (!evidenceIds.length && b.objectId) evidenceIds = (await get(`/${b.objectType === 'plant' ? 'plants' : 'sites'}/${enc(b.objectId)}`).catch(() => ({ evidenceIds: [] }))).evidenceIds ?? [];
      const body = {
        objectType: b.objectType ?? 'candidate_site', objectId: b.objectId, action: b.action, description: b.description?.trim() || 'Без описания',
        priority: b.priority, priorityWeight: PRIORITY_WEIGHT_V2[b.priority as Priority] ?? 50, dueAt: b.dueAt ?? null, estimatedMinutes: b.estimatedMinutes,
        requiredWaterLiters: b.requiredWaterLiters ?? null, minWorkers: 1, requiredSkills: b.action ? [b.action] : [], evidenceIds,
      };
      return { data: taskFromV2(await send('POST', '/tasks', body, o.idempotencyKey)) };
    }],
    ['POST', /^\/tasks\/([^/]+)\/assign$/, async (m, o) => {
      const b = o.body as { brigadeId: string; minCrew: number; scheduledStart: string | null; expectedVersion: number };
      if (!b.scheduledStart) throw invalid('scheduledStart', 'Сервер назначает бригаду на конкретное время: укажите начало работ.');
      const t = await get(`/tasks/${m[1]}`);
      const end = new Date(Date.parse(b.scheduledStart) + t.estimatedMinutes * 60000).toISOString();
      const body = { expectedVersion: b.expectedVersion, crewId: b.brigadeId, scheduledStart: b.scheduledStart, scheduledEnd: end, resourceIds: [], minWorkers: b.minCrew };
      return { data: taskFromV2(await send('POST', `/tasks/${m[1]}/assign`, body, o.idempotencyKey)) };
    }],
    ['GET', /^\/reports$/, async (_m, o) => ({ data: (await all('/reports', o.query)).map(reportFromV2), meta: { fetchedAt: new Date().toISOString() } })],
    ['POST', /^\/reports\/([^/]+)\/review$/, async (m, o) => {
      const b = o.body as { decision: 'accepted' | 'changes_requested'; comment: string; expectedTaskVersion: number };
      const r = await get(`/reports/${m[1]}`);
      const comment = b.comment?.trim() || (b.decision === 'accepted' ? 'Принято без комментария.' : '');
      const out = await send('POST', `/reports/${m[1]}/review`, { expectedVersion: b.expectedTaskVersion, expectedReportVersion: r.version, decision: b.decision, comment, acceptGeometryDeviation: false }, o.idempotencyKey);
      return { data: { report: reportFromV2(out.report), task: taskFromV2(out.task) } };
    }],
    // Фото на сервере — приватный файл image/webp, читается по cookie той же сессии.
    ['GET', /^\/uploads\/([^/]+)$/, async (m) => ({ data: { id: decodeURIComponent(m[1]), url: `${base}/uploads/${m[1]}`, contentType: 'image/webp', isDemo: false } })],
    ['GET', /^\/issues$/, async (_m, o) => {
      const q = o.query ?? {};
      const list = q.taskId ? [taskFromV2(await get(`/tasks/${enc(String(q.taskId))}`))] : await tasks({ objectId: q.objectId ? String(q.objectId) : undefined });
      const issues = await Promise.all(list.map(async (t) => (await get<Doc[]>(`/tasks/${enc(t.id)}/issues`)).map((i) => issueFromV2(i, t.objectId))));
      return { data: issues.flat() };
    }],
    ['GET', /^\/dashboard$/, async () => http.request('GET', '/dashboard/metrics')],

    ['GET', /^\/projects$/, async (_m, o) => {
      const q = o.query ?? {};
      const designs = await all('/designs');
      // Старшие ревизии подгружаем целиком: «согласовано» может остаться в прошлой ревизии.
      const list = await Promise.all(designs.map((d) => (d.revision > 1 ? project(d.id) : projectFromDesign(d))));
      return { data: list.filter((p) => (!q.siteId || p.siteId === q.siteId) && (!q.status || p.status === q.status)), meta: { fetchedAt: new Date().toISOString() } };
    }],
    ['GET', /^\/projects\/([^/]+)$/, async (m) => ({ data: await project(decodeURIComponent(m[1])) })],
    ['POST', /^\/projects$/, async (_m, o) => {
      const b = o.body as { siteId: string; title: string; season: string };
      if (!b.title?.trim()) throw invalid('title', 'Укажите название проекта.');
      const [site, context] = await Promise.all([get(`/sites/${enc(b.siteId)}`), get(`/sites/${enc(b.siteId)}/context`)]);
      const body = { siteId: b.siteId, name: b.title.trim(), objective: b.title.trim(), season: b.season?.trim() || null, contextVersion: context.version, plantingItems: [], exclusionZones: [], sourcePhotoIds: [], evidenceIds: site.evidenceIds };
      return { data: projectFromDesign(await send('POST', '/designs', body, o.idempotencyKey)) };
    }],
    ['PATCH', /^\/projects\/([^/]+)$/, async (m, o) => {
      const b = o.body as { expectedVersion: number; items?: ProjectItem[]; title?: string; season?: string };
      const d = await get(`/designs/${m[1]}`);
      const body: Doc = { expectedVersion: b.expectedVersion };
      if (b.items) body.plantingItems = await saveDesignItems(d.evidenceIds ?? [], b.items);
      if (b.title?.trim()) body.name = b.title.trim();
      if (b.season?.trim()) body.season = b.season.trim();
      await send('PATCH', `/designs/${m[1]}`, body, o.idempotencyKey);
      return { data: await project(decodeURIComponent(m[1])) };
    }],
    ['POST', /^\/projects\/([^/]+)\/submit$/, async (m, o) => {
      await send('POST', `/designs/${m[1]}/submit`, { expectedVersion: (o.body as Doc).expectedVersion }, o.idempotencyKey);
      return { data: await project(decodeURIComponent(m[1])) };
    }],
    ['POST', /^\/projects\/([^/]+)\/withdraw$/, async (m, o) => {
      await send('POST', `/designs/${m[1]}/withdraw`, { expectedVersion: (o.body as Doc).expectedVersion }, o.idempotencyKey);
      return { data: await project(decodeURIComponent(m[1])) };
    }],
    ['POST', /^\/projects\/([^/]+)\/review$/, async (m, o) => {
      const b = o.body as { decision: 'approved' | 'returned'; comment: string; expectedVersion: number };
      const comment = b.comment?.trim() || (b.decision === 'approved' ? 'Согласовано без комментария.' : '');
      await send('POST', `/designs/${m[1]}/review`, { expectedVersion: b.expectedVersion, decision: b.decision === 'returned' ? 'changes_requested' : b.decision, comment }, o.idempotencyKey);
      return { data: await project(decodeURIComponent(m[1])) };
    }],

    // План дня: сводка считается по заданиям и бригадам сервера тем же кодом, что в тестовом источнике.
    ['GET', /^\/plans$/, async (_m, o) => {
      const [list, crews] = await Promise.all([tasks(), brigades()]);
      return { data: { plan: null, preview: daySummary(String(o.query?.date ?? ''), list, crews).summary }, meta: { fetchedAt: new Date().toISOString() } };
    }],
    ['POST', /^\/plans\/(\d{4}-\d{2}-\d{2})\/approve$/, async () => {
      throw new ApiError(503, 'integration_unavailable', 'Утверждение плана дня на сервере идёт через адаптер планирования (/plans/preview), он ещё не подключён. Назначения бригадам уже сохранены на сервере.');
    }],
  ];

  return {
    kind: http.kind,
    async request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}) {
      try {
        for (const [m, re, h] of routes) {
          if (m !== method) continue;
          const match = path.match(re);
          if (match) return (await h(match, opts)) as ApiSuccess<T>;
        }
        return await http.request<T>(method, path, opts);
      } catch (e) {
        throw errorFromV2(e);
      }
    },
  };
}
