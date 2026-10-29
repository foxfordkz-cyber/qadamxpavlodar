import { newIdempotencyKey, type Transport } from './transport';
import type {
  Brigade, CandidateSite, CheckKey, GeoJsonPolygon, CheckState, DashboardMetric, DayPlan, DayPlanSummary, EvidenceRef, ID, Issue, Me, Plant, PlantingProject, PlantSelection,
  Priority, ProjectItem, RankWeights, Report, SiteContext, SiteRanking, Species, Task, TaskAction, TaskStatus, Upload, Worker,
} from './types';
import type { PlanOptions, Variant, ZoneAnalysis } from '../analytics/plan';
import type { PriorityFactor, PriorityItem, Problem } from '../analytics/city';
import type { RateEntry } from '../analytics/rates';
import type { AssistantReply } from '../analytics/assistant';
import type { referenceFacts } from './pavlodar';

export interface VariantSummary { variant: Variant; label: string; careYears: number; plants: number; cost: number; survival: { y1: number; y2: number; y3: number }; co2t20: number; coolingC: number; rainM3: number; costPerTonCo2: number | null }
export interface ImportPreview { format: string; total: number; valid: number; invalid: number; issues: { row: number; level: 'error' | 'warning'; text: string }[]; committed: boolean; note: string }
type FC = { type: 'FeatureCollection'; features: { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] };

export interface TaskFilters {
  objectId?: ID;
  status?: TaskStatus;
  assigneeId?: ID;
}

export interface NewTask {
  objectType: 'plant' | 'candidate_site';
  objectId: ID;
  action: TaskAction;
  description: string;
  priority: Priority;
  dueAt: string | null;
  estimatedMinutes: number;
  requiredWaterLiters: number | null;
  evidenceIds: ID[];
  projectId?: ID | null;
  projectDesignVersion?: number | null;
}

export interface SitePatch {
  expectedVersion: number;
  checks?: Partial<Record<CheckKey, { state: CheckState; comment: string }>>;
  waterAvailability?: { value: number | null; note: string };
}

/** Все методы экрана координатора. Пути — /api/v1 из общего контракта; помеченные (v1.1) — предложение. */
export function createApi(t: Transport) {
  const d = async <T,>(p: Promise<{ data: T; meta?: Record<string, unknown> }>) => (await p).data;
  return {
    kind: t.kind,
    me: () => d(t.request<Me>('GET', '/auth/me')),
    login: (login: string, password: string) => d(t.request<Me>('POST', '/auth/login', { body: { login, password } })),
    logout: () => d(t.request<null>('POST', '/auth/logout', { body: {} })),

    sites: () => t.request<CandidateSite[]>('GET', '/sites'),
    site: (id: ID) => d(t.request<CandidateSite>('GET', `/sites/${encodeURIComponent(id)}`)),
    /** (контракт 29.10) Нарисованная зона: проверка полигона, площадь, окружение, почва в meta. */
    createZone: (body: { name?: string; geometry: GeoJsonPolygon }, idempotencyKey: string) =>
      t.request<CandidateSite>('POST', '/zones', { body, idempotencyKey }),
    patchSite: (id: ID, patch: SitePatch) =>
      d(t.request<CandidateSite>('PATCH', `/sites/${encodeURIComponent(id)}`, { body: patch, idempotencyKey: newIdempotencyKey() })),
    rankPreview: (weights: RankWeights) => d(t.request<SiteRanking>('POST', '/sites/rank-preview', { body: { weights } })),
    /** (v1.1) подбор растений для участка. */
    plantSelection: (id: ID) => d(t.request<PlantSelection>('POST', `/sites/${encodeURIComponent(id)}/plant-selection`, { body: {} })),
    /** (v1.1) справочник видов. */
    species: () => d(t.request<Species[]>('GET', '/species')),
    /** (v1.1) расшифровка ссылок на источники. */
    evidence: (ids: ID[]) => d(t.request<EvidenceRef[]>('GET', '/evidence', { query: { ids: ids.join(',') } })),

    workers: () => d(t.request<Worker[]>('GET', '/workers')),
    tasks: (f: TaskFilters = {}) => t.request<Task[]>('GET', '/tasks', { query: { ...f } }),
    createTask: (task: NewTask, idempotencyKey: string) => d(t.request<Task>('POST', '/tasks', { body: task, idempotencyKey })),
    /** Назначение бригаде; конкретных людей выбирает бригадир (кабинет участника 4). */
    assignTask: (id: ID, body: { brigadeId: ID; minCrew: number; scheduledStart: string | null; expectedVersion: number }, idempotencyKey: string) =>
      d(t.request<Task>('POST', `/tasks/${encodeURIComponent(id)}/assign`, { body, idempotencyKey })),

    reports: (q: { reviewStatus?: string; taskId?: ID } = {}) => t.request<Report[]>('GET', '/reports', { query: q }),
    reviewReport: (id: ID, body: { decision: 'accepted' | 'changes_requested'; comment: string; expectedTaskVersion: number }, idempotencyKey: string) =>
      d(t.request<{ report: Report; task: Task }>('POST', `/reports/${encodeURIComponent(id)}/review`, { body, idempotencyKey })),
    /** (v1.1) метаданные загруженного фото. */
    upload: (id: ID) => d(t.request<Upload>('GET', `/uploads/${encodeURIComponent(id)}`)),
    /** (v1.1) проблемы, отправленные работниками. */
    issues: (q: { objectId?: ID; taskId?: ID }) => d(t.request<Issue[]>('GET', '/issues', { query: q })),

    dashboard: () => t.request<DashboardMetric[]>('GET', '/dashboard'),

    // --- v1.1 (предложение): окружение, растения, бригады, проекты, план дня ---
    siteContext: (id: ID, radiusM: number) => d(t.request<SiteContext>('GET', `/sites/${encodeURIComponent(id)}/context`, { query: { radius: radiusM } })),
    plants: () => t.request<Plant[]>('GET', '/plants'),
    brigades: () => d(t.request<Brigade[]>('GET', '/brigades')),
    projects: (q: { siteId?: ID; status?: string } = {}) => t.request<PlantingProject[]>('GET', '/projects', { query: q }),
    project: (id: ID) => d(t.request<PlantingProject>('GET', `/projects/${encodeURIComponent(id)}`)),
    createProject: (body: { siteId: ID; title: string; season: string }, idempotencyKey: string) => d(t.request<PlantingProject>('POST', '/projects', { body, idempotencyKey })),
    saveProject: (id: ID, body: { expectedVersion: number; items?: ProjectItem[]; title?: string; season?: string }) =>
      d(t.request<PlantingProject>('PATCH', `/projects/${encodeURIComponent(id)}`, { body, idempotencyKey: newIdempotencyKey() })),
    submitProject: (id: ID, expectedVersion: number) => d(t.request<PlantingProject>('POST', `/projects/${encodeURIComponent(id)}/submit`, { body: { expectedVersion }, idempotencyKey: `submit-${id}-v${expectedVersion}` })),
    withdrawProject: (id: ID, expectedVersion: number) => d(t.request<PlantingProject>('POST', `/projects/${encodeURIComponent(id)}/withdraw`, { body: { expectedVersion }, idempotencyKey: `withdraw-${id}-v${expectedVersion}` })),
    reviewProject: (id: ID, body: { decision: 'approved' | 'returned'; comment: string; expectedVersion: number }) =>
      d(t.request<PlantingProject>('POST', `/projects/${encodeURIComponent(id)}/review`, { body, idempotencyKey: `review-${id}-${body.decision}-v${body.expectedVersion}` })),
    dayPlan: (date: string) => d(t.request<{ plan: DayPlan | null; preview: DayPlanSummary }>('GET', '/plans', { query: { date } })),
    // --- ТЗ акимата ---
    zoneAnalysis: (id: ID, options: Partial<PlanOptions>) => d(t.request<ZoneAnalysis>('POST', `/zones/${encodeURIComponent(id)}/analysis`, { body: { options } })),
    zoneVariants: (id: ID, options: Partial<PlanOptions>) => d(t.request<VariantSummary[]>('POST', `/zones/${encodeURIComponent(id)}/variants`, { body: { options } })),
    problems: () => t.request<{ problems: Problem[]; notDetectable: string[] }>('GET', '/problems'),
    priorities: (weights: Record<PriorityFactor, number>, budget: number | null) => d(t.request<{ items: PriorityItem[]; roadmap: { chosen: PriorityItem[]; spent: number; left: number; co2t20: number; method: string } | null }>('POST', '/priorities', { body: { weights, budget } })),
    rates: () => d(t.request<{ rates: RateEntry[]; version: number }>('GET', '/rates')),
    patchRate: (body: { key: string; value: number | null; source: string; expectedVersion: number }) => d(t.request<{ rates: RateEntry[]; version: number }>('PATCH', '/rates', { body, idempotencyKey: newIdempotencyKey() })),
    soilsLayer: () => t.request<FC>('GET', '/layers/soils'),
    greeneryLayer: () => t.request<FC>('GET', '/layers/greenery'),
    ask: (message: string, siteId: ID | null) => d(t.request<AssistantReply>('POST', '/assistant', { body: { message, siteId } })),
    assistantHistory: () => d(t.request<{ at: string; q: string; intent: string; zones: string[] }[]>('GET', '/assistant/history')),
    /** Проверенные данные о Павлодаре: факты со ссылками на источники, источники, климатические нормы. */
    referenceFacts: () => t.request<ReturnType<typeof referenceFacts>['data']>('GET', '/reference/facts'),
    importPreview: (format: string, features: unknown[]) => d(t.request<ImportPreview>('POST', '/imports/preview', { body: { format, features } })),
    approveDayPlan: (date: string, expectedVersion: number | null) =>
      d(t.request<DayPlan>('POST', `/plans/${date}/approve`, { body: { expectedVersion }, idempotencyKey: `plan-${date}-v${expectedVersion ?? 0}` })),
  };
}

export type Api = ReturnType<typeof createApi>;
