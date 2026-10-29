// Тестовый источник: эмулирует сервер /api/v1 по контракту в браузере.
// Проверяет версии (409), повтор Idempotency-Key, роли (401/403), отказ сети и AI (503).
// Не является сервером участника 3 — нужен, чтобы экраны работали до его готовности.
import { ApiError, type HttpMethod, type RequestOptions, type Transport } from '../transport';
import type { CandidateSite, CheckKey, CheckState, DashboardMetric, DayPlan, Me, PlantingProject, ProjectItem, Plant, Report, Role, Task } from '../types';
import { siteContext } from './context';
import { buildDrawnZone, validateDrawnPolygon } from './drawnZone';
import { computeConflicts, unresolved } from '../../projectRules';
import { centroidXY, makeProjection } from '../../geo';
import { analyzeZone, VARIANT_LABEL, type PlanOptions, type Variant } from '../../analytics/plan';
import { detectProblems, priorities, roadmap, DEFAULT_PRIORITY_WEIGHTS, type PriorityFactor } from '../../analytics/city';
import { ratesMap } from '../../analytics/rates';
import { answer } from '../../analytics/assistant';
import { SOIL_CELL_DEG, soilFor, soilForCell, SALINITY_LABEL } from '../../analytics/zone';
import greenery from '../../../../../../fixtures/osm/greenery.json';
import { catalog, osmMeta, seed, type MockDb } from './fixtures';
import { CHECKS, rankSites, selectPlants } from './rules';
import { demoPhoto } from './photo';

// v3: справочник с источниками по Павлодару. Старые данные не читаются.
const STORAGE_KEY = 'gp-mock-db-v4';

export interface MockControls {
  networkDown: boolean;
  aiDown: boolean;
  role: Role | 'anonymous';
  latencyMs: number;
}

export const mockControls: MockControls = { networkDown: false, aiDown: false, role: 'coordinator', latencyMs: 250 };
const listeners = new Set<() => void>();
export const onMockChange = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const setMockControls = (patch: Partial<MockControls>) => {
  Object.assign(mockControls, patch);
  listeners.forEach((l) => l());
};

let db: MockDb = load();
function load(): MockDb {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as MockDb;
  } catch {
    /* хранилище недоступно — работаем в памяти */
  }
  return seed();
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* только в памяти */
  }
}
export function resetMockDb() {
  db = seed();
  save();
  listeners.forEach((l) => l());
}

/** Имитация действия другого пользователя: меняет версию участка без ведома этой вкладки. */
export function simulateConcurrentEdit(): string {
  const site = db.sites.find((s) => s.checks.access.state === 'unknown')!;
  site.checks.access = { state: 'unknown', checkedBy: 'Другой координатор (демо)', checkedAt: new Date().toISOString(), comment: '[Демо] Добавлен комментарий из другой вкладки.' };
  site.version += 1;
  save();
  return site.id;
}

const me: Record<Role, Me> = {
  coordinator: { id: 'coordinator-demo', displayName: 'Специалист (демо-аккаунт)', role: 'coordinator', isDemoAccount: true },
  admin: { id: 'admin-demo', displayName: 'Администратор (демо-аккаунт)', role: 'admin', isDemoAccount: true },
  viewer: { id: 'viewer-demo', displayName: 'Просмотр (демо-аккаунт)', role: 'viewer', isDemoAccount: true },
  foreman: { id: 'w-aigerim', displayName: 'Айгерим С., бригадир (демо)', role: 'foreman', isDemoAccount: true },
  worker: { id: 'w-sanzhar', displayName: 'Санжар Т. (демо)', role: 'worker', isDemoAccount: true },
};

let reqSeq = 0;
const fail = (status: number, code: string, message: string, details?: unknown): never => {
  throw new ApiError(status, code, message, `mock-${++reqSeq}`, details);
};
const nowIso = () => new Date().toISOString();
const nextId = (p: string) => `${p}-${++db.seq}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Руководитель (admin) видит всё, что видит координатор. Права проверяет сервер, не интерфейс. */
function requireRole(...roles: Role[]) {
  if (mockControls.role === 'anonymous') fail(401, 'unauthenticated', 'Нужно войти в систему.');
  const r = mockControls.role as Role;
  // «Просмотр» читает всё; изменения для него запрещены на уровне транспорта (только GET и расчёты).
  if (r === 'admin' || r === 'viewer' || roles.includes(r)) return me[r];
  return fail(403, 'forbidden', roles.includes('coordinator') ? 'Недостаточно прав: раздел доступен координатору и руководителю.' : 'Недостаточно прав.');
}

function findSite(id: string) {
  return db.sites.find((s) => s.id === id) ?? fail(404, 'not_found', `Участок ${id} не найден.`);
}
function findTask(id: string) {
  return db.tasks.find((t) => t.id === id) ?? fail(404, 'not_found', `Задание ${id} не найдено.`);
}

function withIdempotency<T>(key: string | undefined, body: unknown, run: () => T): T {
  if (!key) return run();
  const hash = JSON.stringify(body ?? null);
  const prev = db.idempotency[key];
  if (prev) {
    if (prev.hash !== hash) fail(409, 'idempotency_conflict', 'Этот ключ повтора уже использован с другим содержимым.');
    return prev.body as T;
  }
  const result = run();
  db.idempotency[key] = { hash, status: 200, body: result };
  save();
  return result;
}

type Handler = (m: RegExpMatchArray, o: RequestOptions) => { data: unknown; meta?: Record<string, unknown> };
const routes: [HttpMethod, RegExp, Handler][] = [];
const route = (method: HttpMethod, re: RegExp, h: Handler) => routes.push([method, re, h]);

route('GET', /^\/auth\/me$/, () => {
  if (mockControls.role === 'anonymous') fail(401, 'unauthenticated', 'Сессия не найдена.');
  return { data: me[mockControls.role as Role] };
});
route('POST', /^\/auth\/login$/, (_m, o) => {
  const b = o.body as { login?: string; password?: string };
  if (!b?.login || !b?.password) fail(400, 'validation_error', 'Введите логин и пароль.');
  const byLogin: Record<string, Role> = { worker: 'worker', foreman: 'foreman', admin: 'admin', viewer: 'viewer' };
  setMockControls({ role: byLogin[b.login!] ?? 'coordinator' });
  return { data: me[mockControls.role as Role] };
});
route('POST', /^\/auth\/logout$/, () => {
  setMockControls({ role: 'anonymous' });
  return { data: null };
});

route('GET', /^\/sites$/, () => {
  requireRole('coordinator');
  return { data: db.sites, meta: { osm: osmMeta, fetchedAt: nowIso() } };
});
route('GET', /^\/sites\/([^/]+)$/, (m) => {
  requireRole('coordinator');
  return { data: findSite(decodeURIComponent(m[1])) };
});
// SRV-02: нарисованная пользователем зона. Ответ — CandidateSite с id site-user-N.
route('POST', /^\/zones$/, (_m, o) => {
  requireRole('coordinator');
  const b = (o.body ?? {}) as { name?: string; geometry?: unknown };
  const { ring, errors } = validateDrawnPolygon(b.geometry);
  if (errors.length) fail(400, 'validation_error', errors.map((e) => e.message).join(' '), { fields: { geometry: errors[0].message }, errors });
  return withIdempotency(o.idempotencyKey, o.body, () => {
    const n = 1 + db.sites.reduce((mx, s) => Math.max(mx, Number(/^site-user-(\d+)$/.exec(s.id)?.[1] ?? 0)), 0);
    const maxB = db.sites.reduce((mx, s) => Math.max(mx, s.context?.buildings200m ?? 0), 1);
    const site = buildDrawnZone(`site-user-${n}`, (b.name ?? '').trim().slice(0, 120), ring, maxB);
    db.sites.push(site);
    save();
    const soil = soilFor(site.centroid!.lat, site.centroid!.lng);
    return { data: site, meta: { soil, note: 'Почва — синтетический слой до карты почв организатора.' } };
  });
});
route('PATCH', /^\/sites\/([^/]+)$/, (m, o) => {
  requireRole('coordinator');
  const site = findSite(decodeURIComponent(m[1]));
  const b = o.body as { expectedVersion?: number; checks?: Partial<Record<CheckKey, { state: CheckState; comment: string }>>; waterAvailability?: { value: number | null; note: string } };
  if (typeof b?.expectedVersion !== 'number') fail(400, 'validation_error', 'Не передан expectedVersion.');
  if (b.expectedVersion !== site.version)
    fail(409, 'version_conflict', 'Участок изменён другим пользователем после загрузки.', { currentVersion: site.version });
  for (const [k, v] of Object.entries(b.checks ?? {})) {
    if (!CHECKS.includes(k as CheckKey) || !v) fail(400, 'validation_error', `Неизвестная проверка ${k}.`);
    if (!['unknown', 'cleared', 'blocked'].includes(v.state)) fail(400, 'validation_error', `Недопустимое состояние ${v.state}.`);
    if (v.state !== 'unknown' && !v.comment?.trim()) fail(400, 'validation_error', 'Для отметки проверки нужен комментарий.', { field: `checks.${k}.comment` });
    site.checks[k as CheckKey] = { state: v.state, comment: v.comment?.trim() || null, checkedBy: me.coordinator.displayName, checkedAt: nowIso() };
  }
  if (b.waterAvailability) {
    const v = b.waterAvailability.value;
    if (v !== null && (typeof v !== 'number' || v < 0 || v > 100)) fail(400, 'validation_error', 'Доступ к воде: число 0–100 или пусто.');
    if (!b.waterAvailability.note?.trim()) fail(400, 'validation_error', 'Укажите, откуда известно значение.', { field: 'waterAvailability.note' });
    const evId = nextId('ev-manual');
    db.evidence.push({ id: evId, sourceType: 'manual', sourceLabel: 'Внесено координатором', observedAt: nowIso(), dataClass: 'real', note: b.waterAvailability.note.trim() });
    site.factors.waterAvailability = { value: v, evidenceIds: v === null ? [] : [evId], method: `Указано координатором: ${b.waterAvailability.note.trim()}` };
    site.missingData = site.missingData.filter((x) => x.field !== 'factors.waterAvailability');
    if (v === null) site.missingData.push({ field: 'factors.waterAvailability', reason: 'Координатор отметил значение как неизвестное.' });
  }
  if (CHECKS.every((k) => site.checks[k].state !== 'unknown')) site.missingData = site.missingData.filter((x) => x.field !== 'checks');
  site.version += 1;
  save();
  return { data: site };
});
route('POST', /^\/sites\/rank-preview$/, (_m, o) => {
  requireRole('coordinator');
  const w = (o.body as { weights?: Record<string, number> })?.weights;
  if (!w) fail(400, 'validation_error', 'Не переданы веса.');
  const sum = Object.values(w!).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.011) fail(400, 'validation_error', `Сумма весов должна быть 1, сейчас ${sum.toFixed(2)}.`);
  return { data: rankSites(db.sites, w as never) };
});
route('POST', /^\/sites\/([^/]+)\/plant-selection$/, (m) => {
  requireRole('coordinator');
  if (mockControls.aiDown) fail(503, 'ai_unavailable', 'Сервис подбора недоступен. Можно выбрать виды вручную из справочника.');
  return { data: selectPlants(findSite(decodeURIComponent(m[1])), catalog) };
});
route('GET', /^\/species$/, () => ({ data: catalog }));
route('GET', /^\/evidence$/, (_m, o) => {
  const ids = String(o.query?.ids ?? '').split(',').filter(Boolean);
  return { data: db.evidence.filter((e) => ids.includes(e.id)) };
});

route('GET', /^\/workers$/, () => {
  requireRole('coordinator');
  return { data: db.workers };
});
route('GET', /^\/tasks$/, (_m, o) => {
  requireRole('coordinator');
  const q = o.query ?? {};
  const list = db.tasks.filter((t) => (!q.objectId || t.objectId === q.objectId) && (!q.status || t.status === q.status) && (!q.assigneeId || t.assigneeId === q.assigneeId));
  return { data: list, meta: { fetchedAt: nowIso() } };
});
route('POST', /^\/tasks$/, (_m, o) => {
  requireRole('coordinator');
  return {
    data: withIdempotency(o.idempotencyKey, o.body, () => {
      const b = o.body as Partial<Task>;
      const errors: Record<string, string> = {};
      if (!b.objectId) errors.objectId = 'Не выбран объект.';
      else if (b.objectType === 'candidate_site' && !db.sites.some((s) => s.id === b.objectId)) errors.objectId = 'Участок не найден.';
      if (!b.action || !['inspect', 'water', 'weed', 'plant'].includes(b.action)) errors.action = 'Не выбрано действие.';
      if (!b.priority) errors.priority = 'Не выбран приоритет.';
      if (!b.estimatedMinutes || b.estimatedMinutes <= 0) errors.estimatedMinutes = 'Длительность должна быть больше нуля.';
      if (b.action === 'water' && b.requiredWaterLiters === 0) errors.requiredWaterLiters = 'Ноль литров для полива недопустим; оставьте пустым, если норма неизвестна.';
      if (b.action === 'plant' && b.objectType === 'candidate_site') {
        const site = db.sites.find((s) => s.id === b.objectId);
        if (site && !CHECKS.every((k) => site.checks[k].state === 'cleared'))
          errors.action = 'Посадка возможна только после завершения всех проверок участка.';
      }
      const pb = o.body as Partial<Task>;
      if (b.action === 'plant' && b.objectType === 'candidate_site') {
        const pr = db.projects.find((x) => x.id === pb.projectId);
        if (!pr) errors.projectId = 'Для посадки нужен согласованный проект озеленения.';
        else if (!pr.approved) errors.projectId = 'Проект ещё не согласован руководителем.';
        else if (pr.approved.designVersion !== pb.projectDesignVersion) errors.projectId = `Согласована версия ${pr.approved.designVersion}, а в задании указана ${pb.projectDesignVersion}.`;
      }
      if (Object.keys(errors).length) fail(400, 'validation_error', 'Проверьте поля формы.', { fields: errors });
      const t: Task = {
        id: nextId('t'),
        objectType: b.objectType ?? 'candidate_site',
        objectId: b.objectId!,
        action: b.action!,
        description: b.description ?? '',
        priority: b.priority!,
        priorityWeight: { low: 1, medium: 2, high: 3, critical: 4 }[b.priority!],
        createdAt: nowIso(),
        updatedAt: nowIso(),
        dueAt: b.dueAt ?? null,
        estimatedMinutes: b.estimatedMinutes!,
        requiredWaterLiters: b.requiredWaterLiters ?? null,
        assigneeId: null,
        scheduledStart: null,
        scheduledEnd: null,
        planId: null,
        status: 'draft',
        latestReportId: null,
        evidenceIds: b.evidenceIds ?? [],
        isDemo: false,
        version: 1,
        brigadeId: null,
        minCrew: null,
        crewIds: [],
        projectId: pb.projectId ?? null,
        projectDesignVersion: pb.projectDesignVersion ?? null,
      };
      db.tasks.push(t);
      save();
      return t;
    }),
  };
});
route('POST', /^\/tasks\/([^/]+)\/assign$/, (m, o) => {
  requireRole('coordinator');
  return {
    data: withIdempotency(o.idempotencyKey, o.body, () => {
      const t = findTask(decodeURIComponent(m[1]));
      const b = o.body as { brigadeId?: string; minCrew?: number; scheduledStart?: string | null; expectedVersion?: number };
      if (b.expectedVersion !== t.version) fail(409, 'version_conflict', 'Задание изменено после загрузки.', { currentVersion: t.version });
      if (!['draft', 'assigned'].includes(t.status)) fail(409, 'invalid_state', `Задание в статусе «${t.status}» нельзя переназначить.`);
      const w = db.brigades.find((x) => x.id === b.brigadeId);
      if (!w) fail(400, 'validation_error', 'Бригада не найдена.', { fields: { brigadeId: 'Выберите бригаду.' } });
      if (!w!.active) fail(409, 'brigade_unavailable', `${w!.name} сейчас недоступна.`);
      if (!w!.skills.includes(t.action)) fail(409, 'no_skill', `У бригады ${w!.name} нет навыка для этого действия.`);
      const crew = Number(b.minCrew ?? 1);
      if (!Number.isInteger(crew) || crew < 1) fail(400, 'validation_error', 'Минимальный состав — целое число от 1.', { fields: { minCrew: 'От 1 человека.' } });
      if (crew > w!.memberIds.length) fail(409, 'crew_too_small', `В бригаде ${w!.memberIds.length} чел., а нужно минимум ${crew}.`, { fields: { minCrew: `Не больше ${w!.memberIds.length}.` } });
      const start = b.scheduledStart ?? null;
      if (start && (start < w!.shiftStart || start >= w!.shiftEnd)) fail(400, 'validation_error', 'Начало вне смены бригады.', { fields: { scheduledStart: 'Вне смены.' } });
      if (t.brigadeId !== w!.id) t.crewIds = [];
      t.brigadeId = w!.id;
      t.minCrew = crew;
      t.assigneeId = null;
      t.scheduledStart = start;
      t.scheduledEnd = start ? new Date(Date.parse(start) + t.estimatedMinutes * 60000).toISOString() : null;
      t.status = 'assigned';
      t.updatedAt = nowIso();
      t.version += 1;
      save();
      return t;
    }),
  };
});

route('GET', /^\/reports$/, (_m, o) => {
  requireRole('coordinator');
  const q = o.query ?? {};
  return { data: db.reports.filter((r) => (!q.reviewStatus || r.reviewStatus === q.reviewStatus) && (!q.taskId || r.taskId === q.taskId)), meta: { fetchedAt: nowIso() } };
});
route('POST', /^\/reports\/([^/]+)\/review$/, (m, o) => {
  requireRole('coordinator');
  return {
    data: withIdempotency(o.idempotencyKey, o.body, () => {
      const r = db.reports.find((x) => x.id === decodeURIComponent(m[1])) ?? fail(404, 'not_found', 'Отчёт не найден.');
      const b = o.body as { decision?: string; comment?: string; expectedTaskVersion?: number };
      const t = findTask(r.taskId);
      if (r.reviewStatus !== 'pending') fail(409, 'invalid_state', 'Отчёт уже проверен.');
      if (t.version !== b.expectedTaskVersion) fail(409, 'version_conflict', 'Задание изменено после загрузки отчёта.', { currentVersion: t.version });
      if (b.decision === 'changes_requested' && !b.comment?.trim()) fail(400, 'validation_error', 'Для возврата нужен комментарий.', { fields: { comment: 'Объясните, что исправить.' } });
      if (b.decision !== 'accepted' && b.decision !== 'changes_requested') fail(400, 'validation_error', 'Неизвестное решение.');
      r.reviewStatus = b.decision as 'accepted' | 'changes_requested';
      r.reviewComment = b.comment?.trim() || null;
      r.reviewerId = me.coordinator.id;
      r.reviewedAt = nowIso();
      t.status = b.decision === 'accepted' ? 'verified' : 'assigned';
      t.updatedAt = nowIso();
      t.version += 1;
      if (b.decision === 'accepted' && t.action === 'plant' && t.projectId) implementProject(t, r);
      save();
      return { report: r, task: t };
    }),
  };
});
route('GET', /^\/uploads\/([^/]+)$/, (m) => {
  const id = decodeURIComponent(m[1]);
  const u = db.uploads[id] ?? fail(404, 'not_found', 'Файл не найден.');
  return { data: { id, url: demoPhoto(u.label, id), contentType: 'image/svg+xml', isDemo: true } };
});
route('GET', /^\/issues$/, (_m, o) => {
  requireRole('coordinator');
  const q = o.query ?? {};
  return { data: db.issues.filter((i) => (!q.objectId || i.objectId === q.objectId) && (!q.taskId || i.taskId === q.taskId)) };
});

// --- v1.1: окружение, растения, бригады, проекты, план дня -------------------

route('GET', /^\/sites\/([^/]+)\/context$/, (m, o) => {
  requireRole('coordinator');
  const radius = Number(o.query?.radius ?? 100);
  if (![30, 50, 100, 200].includes(radius)) fail(400, 'validation_error', 'Радиус: 30, 50, 100 или 200 м.');
  return { data: siteContext(findSite(decodeURIComponent(m[1])), radius) };
});
route('GET', /^\/plants$/, () => {
  requireRole('coordinator');
  return { data: db.plants, meta: { fetchedAt: nowIso() } };
});
route('GET', /^\/brigades$/, () => {
  requireRole('coordinator');
  return { data: db.brigades };
});

function findProject(id: string) {
  return db.projects.find((x) => x.id === id) ?? fail(404, 'not_found', `Проект ${id} не найден.`);
}
function checkVersion(pr: PlantingProject, v: unknown) {
  if (v !== pr.version) fail(409, 'version_conflict', 'Проект изменён другим пользователем после загрузки.', { currentVersion: pr.version });
}
function validateItems(site: CandidateSite, items: ProjectItem[]) {
  const ctx = siteContext(site, 30);
  const problems: Record<string, string> = {};
  for (const it of items) {
    const sp = catalog.find((x) => x.id === it.speciesId);
    if (!sp) problems[it.id] = 'Вид не найден в справочнике.';
    else if (!(it.quantity > 0)) problems[it.id] = 'Количество должно быть больше нуля.';
    else {
      const open = unresolved(it, computeConflicts(it, site, ctx.buildings, sp));
      if (open.length) problems[it.id] = 'Не разобран конфликт: ' + open.map((c) => c.message).join(' ');
    }
  }
  if (Object.keys(problems).length) fail(400, 'unresolved_conflict', 'Есть позиции с неразобранными конфликтами или ошибками.', { items: problems });
}

route('GET', /^\/projects$/, (_m, o) => {
  requireRole('coordinator');
  const q = o.query ?? {};
  return { data: db.projects.filter((p) => (!q.siteId || p.siteId === q.siteId) && (!q.status || p.status === q.status)), meta: { fetchedAt: nowIso() } };
});
route('GET', /^\/projects\/([^/]+)$/, (m) => {
  requireRole('coordinator');
  return { data: findProject(decodeURIComponent(m[1])) };
});
route('POST', /^\/projects$/, (_m, o) => {
  const who = requireRole('coordinator');
  return {
    data: withIdempotency(o.idempotencyKey, o.body, () => {
      const b = o.body as { siteId?: string; title?: string; season?: string };
      const site = findSite(String(b.siteId));
      if (!b.title?.trim()) fail(400, 'validation_error', 'Укажите название проекта.', { fields: { title: 'Обязательно.' } });
      const pr: PlantingProject = { id: nextId('pr'), siteId: site.id, title: b.title!.trim(), version: 1, designVersion: 1, status: 'draft', items: [], season: b.season?.trim() || 'Сезон не указан', createdBy: who.displayName, createdAt: nowIso(), updatedAt: nowIso(), submittedAt: null, reviews: [], approved: null, implementedAt: null, isDemo: false };
      db.projects.push(pr);
      save();
      return pr;
    }),
  };
});
route('PATCH', /^\/projects\/([^/]+)$/, (m, o) => {
  requireRole('coordinator');
  const pr = findProject(decodeURIComponent(m[1]));
  const b = o.body as { expectedVersion?: number; items?: ProjectItem[]; title?: string; season?: string };
  checkVersion(pr, b.expectedVersion);
  if (pr.status === 'submitted') fail(409, 'invalid_state', 'Проект на согласовании: сначала отзовите его, затем правьте.');
  if (pr.implementedAt) fail(409, 'invalid_state', 'Проект уже реализован; для изменений создайте новый проект.');
  if (b.items) validateItems(findSite(pr.siteId), b.items);
  // Правка согласованного проекта — новая версия состава для повторного согласования.
  if (pr.status === 'approved') {
    pr.designVersion += 1;
    pr.status = 'draft';
  }
  if (pr.status === 'returned') pr.status = 'draft';
  if (b.items) pr.items = b.items;
  if (b.title?.trim()) pr.title = b.title.trim();
  if (b.season?.trim()) pr.season = b.season.trim();
  pr.updatedAt = nowIso();
  pr.version += 1;
  save();
  return { data: pr };
});
route('POST', /^\/projects\/([^/]+)\/submit$/, (m, o) => {
  requireRole('coordinator');
  return {
    data: withIdempotency(o.idempotencyKey, o.body, () => {
      const pr = findProject(decodeURIComponent(m[1]));
      checkVersion(pr, (o.body as { expectedVersion?: number }).expectedVersion);
      if (pr.status !== 'draft' && pr.status !== 'returned') fail(409, 'invalid_state', 'Отправить можно только черновик или возвращённый проект.');
      if (!pr.items.length) fail(400, 'validation_error', 'В проекте нет ни одной позиции.');
      validateItems(findSite(pr.siteId), pr.items);
      pr.status = 'submitted';
      pr.submittedAt = nowIso();
      pr.updatedAt = nowIso();
      pr.version += 1;
      save();
      return pr;
    }),
  };
});
route('POST', /^\/projects\/([^/]+)\/withdraw$/, (m, o) => {
  requireRole('coordinator');
  const pr = findProject(decodeURIComponent(m[1]));
  checkVersion(pr, (o.body as { expectedVersion?: number }).expectedVersion);
  if (pr.status !== 'submitted') fail(409, 'invalid_state', 'Отозвать можно только проект на согласовании.');
  pr.status = 'draft';
  pr.version += 1;
  pr.updatedAt = nowIso();
  save();
  return { data: pr };
});
route('POST', /^\/projects\/([^/]+)\/review$/, (m, o) => {
  const who = requireRole('admin');
  return {
    data: withIdempotency(o.idempotencyKey, o.body, () => {
      const pr = findProject(decodeURIComponent(m[1]));
      const b = o.body as { decision?: string; comment?: string; expectedVersion?: number };
      checkVersion(pr, b.expectedVersion);
      if (pr.status !== 'submitted') fail(409, 'invalid_state', 'Проект не находится на согласовании.');
      if (b.decision === 'returned' && !b.comment?.trim()) fail(400, 'validation_error', 'Для возврата нужен комментарий.', { fields: { comment: 'Объясните, что исправить.' } });
      if (b.decision === 'approved') {
        const site = findSite(pr.siteId);
        const open = CHECKS.filter((k) => site.checks[k].state !== 'cleared');
        if (open.length) fail(409, 'checks_incomplete', 'Посадку нельзя утвердить: проверки участка не завершены.', { checks: open });
        validateItems(site, pr.items);
        pr.approved = { designVersion: pr.designVersion, items: structuredClone(pr.items), approvedAt: nowIso(), by: who.displayName };
      } else if (b.decision !== 'returned') fail(400, 'validation_error', 'Неизвестное решение.');
      pr.status = b.decision as 'approved' | 'returned';
      pr.reviews.push({ decision: b.decision as 'approved' | 'returned', by: who.displayName, at: nowIso(), comment: b.comment?.trim() || null, designVersion: pr.designVersion });
      pr.version += 1;
      pr.updatedAt = nowIso();
      save();
      return pr;
    }),
  };
});

function dayOf(iso: string) {
  return new Date(Date.parse(iso) + 5 * 3600e3).toISOString().slice(0, 10);
}
function planSummary(date: string) {
  const tasks = db.tasks.filter((t) => t.brigadeId && t.scheduledStart && dayOf(t.scheduledStart) === date && t.status !== 'verified');
  const warnings: string[] = [];
  const byBrigade = db.brigades.map((b) => {
    const list = tasks.filter((t) => t.brigadeId === b.id);
    const minutes = list.reduce((a, t) => a + t.estimatedMinutes, 0);
    if (minutes > b.capacityMinutes) warnings.push(`${b.name}: ${minutes} мин работ при ёмкости смены ${b.capacityMinutes} мин.`);
    return { brigadeId: b.id, tasks: list.length, minutes };
  });
  for (const t of tasks) {
    const b = db.brigades.find((x) => x.id === t.brigadeId);
    if (b && t.scheduledEnd && t.scheduledEnd > b.shiftEnd) warnings.push(`${t.id}: работа заканчивается после конца смены бригады (${b.name}).`);
  }
  for (const t of tasks) if (!t.crewIds?.length) warnings.push(`${t.id}: бригада выбрана, но бригадир ещё не собрал состав (нужно ≥${t.minCrew ?? 1}).`);
  const unassigned = db.tasks.filter((t) => t.status === 'draft' && !t.brigadeId && (t.priority === 'high' || t.priority === 'critical'));
  if (unassigned.length) warnings.push(`Без бригады остаются приоритетные задания: ${unassigned.map((t) => t.id).join(', ')}.`);
  const unscheduled = db.tasks.filter((t) => t.brigadeId && !t.scheduledStart && t.status === 'assigned');
  if (unscheduled.length) warnings.push(`Без времени начала: ${unscheduled.map((t) => t.id).join(', ')} — в план дня не попали.`);
  return { tasks, summary: { tasks: tasks.length, byBrigade, warnings } };
}
route('GET', /^\/plans$/, (_m, o) => {
  requireRole('coordinator');
  const date = String(o.query?.date ?? '');
  const plan = db.plans.find((p) => p.date === date) ?? null;
  return { data: { plan, preview: planSummary(date).summary }, meta: { fetchedAt: nowIso() } };
});
route('POST', /^\/plans\/(\d{4}-\d{2}-\d{2})\/approve$/, (m, o) => {
  const who = requireRole('coordinator');
  return {
    data: withIdempotency(o.idempotencyKey, o.body, () => {
      const date = m[1];
      const b = o.body as { expectedVersion?: number | null };
      let plan = db.plans.find((p) => p.date === date) ?? null;
      if (plan && b.expectedVersion !== plan.version) fail(409, 'version_conflict', 'План изменён после загрузки.', { currentVersion: plan.version });
      const { tasks, summary } = planSummary(date);
      if (!tasks.length) fail(400, 'validation_error', 'На эту дату нет заданий с бригадой и временем начала.');
      if (!plan) {
        plan = { id: nextId('plan'), date, status: 'draft', snapshot: [], version: 0 };
        db.plans.push(plan);
      }
      plan.status = 'approved';
      plan.approvedAt = nowIso();
      plan.approvedBy = who.displayName;
      plan.snapshot = tasks.map((t) => ({ taskId: t.id, brigadeId: t.brigadeId ?? null, scheduledStart: t.scheduledStart ?? null, version: t.version }));
      plan.summary = summary;
      plan.version += 1;
      for (const t of tasks) t.planId = plan.id;
      save();
      return plan as DayPlan;
    }),
  };
});

/** После принятой посадки растения из согласованной версии становятся существующими объектами. */
function implementProject(t: Task, r: Report) {
  const pr = db.projects.find((x) => x.id === t.projectId);
  if (!pr?.approved || pr.implementedAt) return;
  const proj = makeProjection(findSite(pr.siteId).centroid!);
  for (const it of pr.approved.items) {
    const sp = catalog.find((x) => x.id === it.speciesId);
    const [lng, lat] = it.geometry.type === 'Point' ? it.geometry.coordinates : proj.toLngLat(centroidXY(it.geometry.coordinates[0].map(proj.toXY)));
    const plant: Plant = {
      id: nextId('pl'),
      name: `${sp?.nameRu ?? it.speciesId}${it.quantity > 1 ? ` × ${it.quantity}` : ''}`,
      kind: it.kind === 'bed' || sp?.form === 'flower' ? 'flowerbed' : sp?.form === 'tree' ? 'tree' : 'shrub',
      species: sp?.latin ?? null,
      plantedAt: r.createdAt,
      lat,
      lng,
      condition: 'unknown',
      lastVerifiedCareAt: null,
      carePolicyId: null,
      evidenceIds: ['ev-demo-scenario'],
      missingData: [{ field: 'condition', reason: 'Состояние после посадки ещё не осматривалось.' }],
      isDemo: pr.isDemo || t.isDemo,
      version: 1,
      projectId: pr.id,
      speciesId: it.speciesId,
    };
    db.plants.push(plant);
  }
  pr.implementedAt = nowIso();
}

/** Режим проверки: бригадир собрал состав (кабинет участника 4). */
export function simulateForemanCrew(): string | null {
  const t = db.tasks.find((x) => x.brigadeId && !x.crewIds?.length && x.status === 'assigned');
  if (!t) return null;
  const b = db.brigades.find((x) => x.id === t.brigadeId)!;
  t.crewIds = b.memberIds.slice(0, Math.max(t.minCrew ?? 1, 1));
  t.version += 1;
  t.updatedAt = nowIso();
  save();
  return t.id;
}
/** Режим проверки: работник выполнил посадку и отправил отчёт (кабинет участника 4). */
export function simulateWorkerReport(): string | null {
  const t = db.tasks.find((x) => x.action === 'plant' && x.status === 'assigned' && x.crewIds?.length) ?? db.tasks.find((x) => x.status === 'assigned' && x.crewIds?.length);
  if (!t) return null;
  const site = db.sites.find((s) => s.id === t.objectId);
  const id = nextId('r');
  db.uploads[`up-${id}`] = { label: t.action === 'plant' ? 'Высаженные растения' : 'Участок после работ' };
  db.reports.push({ id, taskId: t.id, authorId: t.crewIds![0], createdAt: nowIso(), photoIds: [`up-${id}`], note: t.action === 'plant' ? 'Высадили по схеме, полили. Одна лунка сдвинута на 1 м из-за камня.' : 'Работа выполнена.', location: site?.centroid ? { lat: site.centroid.lat + 0.00005, lng: site.centroid.lng, accuracyM: 15, capturedAt: nowIso() } : null, confirmedObservation: { category: 'care_completed', extractedFacts: ['Работа выполнена по заданию'], proposedAction: null, confirmedBy: t.crewIds![0], confirmedAt: nowIso() }, reviewStatus: 'pending', idempotencyKey: `sim-${id}` });
  t.status = 'submitted';
  t.latestReportId = id;
  t.version += 1;
  t.updatedAt = nowIso();
  save();
  return t.id;
}

// --- ТЗ акимата: анализ зоны, проблемы, приоритеты, справочники, слои, ассистент, импорт ---
const rates = () => ratesMap(db.rates);
route('POST', /^\/zones\/([^/]+)\/analysis$/, (m, o) => {
  requireRole('coordinator', 'viewer' as Role);
  const site = findSite(decodeURIComponent(m[1]));
  return { data: analyzeZone(site, catalog, rates(), ((o.body as { options?: Partial<PlanOptions> })?.options) ?? {}) };
});
route('POST', /^\/zones\/([^/]+)\/variants$/, (m, o) => {
  requireRole('coordinator', 'viewer' as Role);
  const site = findSite(decodeURIComponent(m[1]));
  const opts = ((o.body as { options?: Partial<PlanOptions> })?.options) ?? {};
  const careByVariant: Record<Variant, 1 | 2 | 3> = { econom: 1, optimal: 2, max: 3 };
  return {
    data: (['econom', 'optimal', 'max'] as Variant[]).map((v) => {
      const a = analyzeZone(site, catalog, rates(), { ...opts, variant: v, careYears: careByVariant[v] });
      const e20 = a.effect.find((e) => e.years === 20)!;
      return { variant: v, label: VARIANT_LABEL[v], careYears: a.options.careYears, plants: a.scheme.reduce((x, r) => x + r.quantity, 0), cost: a.cost.total, survival: a.survivalAvg, co2t20: e20.co2t, coolingC: e20.coolingC, rainM3: e20.rainM3, costPerTonCo2: a.costPerTonCo2 };
    }),
  };
});
route('GET', /^\/problems$/, () => {
  requireRole('coordinator', 'viewer' as Role);
  return { data: detectProblems(db.sites), meta: { fetchedAt: nowIso() } };
});
route('POST', /^\/priorities$/, (_m, o) => {
  requireRole('coordinator', 'viewer' as Role);
  const b = (o.body ?? {}) as { weights?: Record<PriorityFactor, number>; budget?: number | null };
  const items = priorities(db.sites, catalog, rates(), b.weights ?? DEFAULT_PRIORITY_WEIGHTS);
  return { data: { items, roadmap: b.budget ? roadmap(items, b.budget) : null } };
});
route('GET', /^\/rates$/, () => {
  requireRole('coordinator', 'viewer' as Role);
  return { data: { rates: db.rates, version: db.ratesVersion } };
});
route('PATCH', /^\/rates$/, (_m, o) => {
  requireRole('admin');
  const b = o.body as { key?: string; value?: number | null; source?: string; expectedVersion?: number };
  if (b.expectedVersion !== db.ratesVersion) fail(409, 'version_conflict', 'Справочник изменён другим пользователем.', { currentVersion: db.ratesVersion });
  const r = db.rates.find((x) => x.key === b.key) ?? fail(404, 'not_found', 'Нет такой расценки.');
  if (b.value !== null && (typeof b.value !== 'number' || !Number.isFinite(b.value) || b.value < 0)) fail(400, 'validation_error', 'Значение — неотрицательное число или пусто.', { fields: { value: 'Неверное число.' } });
  if (!b.source?.trim()) fail(400, 'validation_error', 'Укажите источник значения (ТЗ 5.3).', { fields: { source: 'Обязательно.' } });
  r.value = b.value ?? null;
  r.source = b.source!.trim();
  r.dataClass = 'real';
  db.ratesVersion += 1;
  save();
  return { data: { rates: db.rates, version: db.ratesVersion } };
});
route('GET', /^\/layers\/soils$/, () => {
  requireRole('coordinator', 'viewer' as Role);
  const features = [];
  for (let la = Math.floor(52.268 / SOIL_CELL_DEG.lat); la * SOIL_CELL_DEG.lat < 52.3; la++)
    for (let ln = Math.floor(76.926 / SOIL_CELL_DEG.lng); ln * SOIL_CELL_DEG.lng < 76.974; ln++) {
      const s = soilForCell(`soil-${la}-${ln}`);
      const [y0, x0] = [la * SOIL_CELL_DEG.lat, ln * SOIL_CELL_DEG.lng];
      const [y1, x1] = [y0 + SOIL_CELL_DEG.lat, x0 + SOIL_CELL_DEG.lng];
      features.push({ type: 'Feature', properties: { id: s.cellId, type: s.type, ph: s.ph, salinity: s.salinity, salinityLabel: SALINITY_LABEL[s.salinity], synthetic: true }, geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } });
    }
  return { data: { type: 'FeatureCollection', features }, meta: { synthetic: true, note: 'Синтетический слой почв: заменить картой почв организатора.' } };
});
route('GET', /^\/layers\/greenery$/, () => {
  requireRole('coordinator', 'viewer' as Role);
  return { data: greenery, meta: { source: 'OpenStreetMap (ODbL)', note: 'До получения карты насаждений организатора.' } };
});
route('POST', /^\/assistant$/, (_m, o) => {
  requireRole('coordinator', 'viewer' as Role);
  if (mockControls.aiDown) fail(503, 'ai_unavailable', 'Ассистент недоступен. Все модули работают вручную.');
  const b = o.body as { message?: string; siteId?: string | null };
  if (!b?.message?.trim()) fail(400, 'validation_error', 'Пустой запрос.');
  const reply = answer(b.message!, { siteId: b.siteId ?? null }, db.sites, catalog, rates());
  db.history = [...(db.history ?? []), { at: nowIso(), q: b.message!.slice(0, 300), intent: reply.intent, zones: reply.zones.map((z) => z.id) }].slice(-50);
  save();
  return { data: reply };
});
route('GET', /^\/assistant\/history$/, () => {
  requireRole('coordinator', 'viewer' as Role);
  return { data: db.history ?? [] };
});
route('POST', /^\/imports\/preview$/, (_m, o) => {
  requireRole('coordinator');
  const b = o.body as { format?: string; features?: { geometry?: { type?: string; coordinates?: unknown } | null; properties?: Record<string, unknown> }[] };
  const feats = b.features ?? [];
  const issues: { row: number; level: 'error' | 'warning'; text: string }[] = [];
  const flat = (c: unknown): number[][] => (Array.isArray(c) && typeof c[0] === 'number' ? [c as number[]] : Array.isArray(c) ? (c as unknown[]).flatMap(flat) : []);
  const boxes: { i: number; b: number[] }[] = [];
  feats.forEach((f, i) => {
    if (!f.geometry || !f.geometry.coordinates) { issues.push({ row: i + 1, level: 'error', text: 'Нет геометрии.' }); return; }
    const pts = flat(f.geometry.coordinates);
    if (!pts.length) { issues.push({ row: i + 1, level: 'error', text: 'Пустые координаты.' }); return; }
    const bad = pts.find(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y));
    if (bad) issues.push({ row: i + 1, level: 'error', text: 'Нечисловые координаты.' });
    else if (pts.some(([x, y]) => Math.abs(x) > 180 || Math.abs(y) > 90)) issues.push({ row: i + 1, level: 'error', text: 'Координаты вне диапазона градусов — похоже на метровую систему (например, UTM). Нужен WGS 84 (EPSG:4326).' });
    else if (pts.some(([x, y]) => y > 70 && x < 60)) issues.push({ row: i + 1, level: 'warning', text: 'Похоже, перепутаны долгота и широта.' });
    else if (!pts.every(([x, y]) => x > 75 && x < 79 && y > 51 && y < 53.5)) issues.push({ row: i + 1, level: 'warning', text: 'Объект вне Павлодара.' });
    const missingProps = ['name'].filter((k) => !f.properties?.[k]);
    if (missingProps.length) issues.push({ row: i + 1, level: 'warning', text: `Не заполнено: ${missingProps.join(', ')}.` });
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    boxes.push({ i, b: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  });
  for (let a = 0; a < boxes.length; a++)
    for (let c = a + 1; c < boxes.length; c++) {
      const [p, q] = [boxes[a].b, boxes[c].b];
      if (p[0] < q[2] && q[0] < p[2] && p[1] < q[3] && q[1] < p[3] && feats[boxes[a].i].geometry?.type === 'Polygon' && feats[boxes[c].i].geometry?.type === 'Polygon')
        issues.push({ row: boxes[a].i + 1, level: 'warning', text: `Возможно пересечение с объектом ${boxes[c].i + 1} (по габаритам).` });
    }
  const errors = new Set(issues.filter((x) => x.level === 'error').map((x) => x.row));
  return { data: { format: b.format ?? 'geojson', total: feats.length, valid: feats.length - errors.size, invalid: errors.size, issues: issues.slice(0, 200), committed: false, note: 'Предпросмотр: в базу ничего не записано. Сохранение — после подтверждения (участник 3).' } };
});

route('GET', /^\/dashboard$/, () => {
  requireRole('coordinator');
  const elig = (s: CandidateSite) => {
    const st = CHECKS.map((k) => s.checks[k].state);
    return st.includes('blocked') ? 'blocked' : st.every((x) => x === 'cleared') ? 'cleared' : 'needs';
  };
  const weekAgo = Date.now() - 7 * 864e5;
  const metrics: DashboardMetric[] = [
    { key: 'sites_total', label: 'Кандидатов из OSM', value: db.sites.length, definition: 'Газоны и травяные участки OSM 150–25 000 м² вне существующих парков.', period: `Данные OSM на ${osmMeta.osmBase?.slice(0, 10)}` },
    { key: 'sites_need_check', label: 'Нужна проверка', value: db.sites.filter((s) => elig(s) === 'needs').length, definition: 'Хотя бы одна из четырёх проверок не выполнена, ограничений нет.', period: 'Сейчас' },
    { key: 'sites_blocked', label: 'Есть ограничение', value: db.sites.filter((s) => elig(s) === 'blocked').length, definition: 'Хотя бы одна проверка отмечена человеком как ограничение.', period: 'Сейчас' },
    { key: 'sites_cleared', label: 'Проверки завершены', value: db.sites.filter((s) => elig(s) === 'cleared').length, definition: 'Все четыре проверки отмечены человеком как пройденные.', period: 'Сейчас' },
    { key: 'tasks_open', label: 'Открытые задания', value: db.tasks.filter((t) => ['draft', 'assigned', 'in_progress'].includes(t.status)).length, definition: 'Черновики, назначенные и начатые задания.', period: 'Сейчас' },
    { key: 'unassigned_priority', label: 'Без исполнителя (высокий приоритет)', value: db.tasks.filter((t) => t.status === 'draft' && (t.priority === 'high' || t.priority === 'critical')).length, definition: 'Черновики с приоритетом «высокий» или «критичный» без назначения.', period: 'Сейчас' },
    { key: 'reports_pending', label: 'Отчёты ждут проверки', value: db.reports.filter((r) => r.reviewStatus === 'pending').length, definition: 'Отчёты со статусом проверки «ожидает».', period: 'Сейчас' },
    { key: 'projects_review', label: 'Проекты на согласовании', value: db.projects.filter((p) => p.status === 'submitted').length, definition: 'Проекты озеленения, отправленные руководителю и ещё не рассмотренные.', period: 'Сейчас' },
    { key: 'projects_approved', label: 'Проекты согласованы', value: db.projects.filter((p) => p.approved && !p.implementedAt).length, definition: 'Есть согласованная версия, посадка ещё не принята по отчёту. «Согласован» ≠ «посажено».', period: 'Сейчас' },
    { key: 'verified_7d', label: 'Подтверждено выполнено', value: db.tasks.filter((t) => t.status === 'verified' && Date.parse(t.updatedAt) >= weekAgo).length, definition: 'Задания, принятые координатором по отчёту.', period: 'Последние 7 дней' },
  ];
  return { data: metrics, meta: { fetchedAt: nowIso() } };
});

export function createMockTransport(): Transport {
  return {
    kind: 'mock',
    async request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}) {
      await sleep(mockControls.latencyMs * (0.6 + Math.random() * 0.8));
      if (mockControls.networkDown) throw new ApiError(0, 'network_error', 'Сервер недоступен или нет сети.');
      const readOnlyPost = /^\/(zones\/[^/]+\/(analysis|variants)|priorities|assistant|sites\/rank-preview|sites\/[^/]+\/plant-selection|auth\/(login|logout))$/.test(path);
      if (mockControls.role === 'viewer' && method !== 'GET' && !readOnlyPost) throw new ApiError(403, 'forbidden', 'Роль «Просмотр»: изменения недоступны.', `mock-${++reqSeq}`);
      for (const [m, re, h] of routes) {
        if (m !== method) continue;
        const match = path.match(re);
        if (match) {
          const res = h(match, { query: opts.query, idempotencyKey: opts.idempotencyKey, body: structuredClone(opts.body) });
          // Копия, чтобы экран не мог изменить «серверные» данные по ссылке.
          return structuredClone(res) as { data: T; meta?: Record<string, unknown> };
        }
      }
      return fail(404, 'not_found', `Маршрут ${method} ${path} не найден в тестовом источнике.`);
    },
  };
}

// Для сквозной проверки из консоли браузера (только dev-сборка).
if (import.meta.env.DEV) Object.assign(globalThis, { __gpMock: { controls: mockControls, setMockControls, simulateConcurrentEdit, simulateForemanCrew, simulateWorkerReport, resetMockDb } });
