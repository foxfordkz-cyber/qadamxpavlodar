// Типы по общему контракту v1 (05-SHARED-CONTRACT.txt).
// Временная копия: когда участник 1 выпустит packages/contracts, этот файл
// заменяется реэкспортом оттуда. Поля не переименовывать локально.

export type ID = string;
/** ISO 8601 с часовым поясом, хранение UTC. */
export type IsoDateTime = string;

export type DataClass = 'real' | 'demo' | 'estimate';
export type SourceType = 'municipal' | 'field_report' | 'weather' | 'care_reference' | 'manual' | 'fixture';

export interface EvidenceRef {
  id: ID;
  sourceType: SourceType;
  sourceLabel: string;
  sourceUrl?: string;
  observedAt?: IsoDateTime;
  validUntil?: IsoDateTime;
  dataClass: DataClass;
  note?: string;
}

/** Причина отсутствующего значения: поле → объяснение. */
export interface MissingData {
  field: string;
  reason: string;
}

export type PlantKind = 'tree' | 'shrub' | 'flowerbed';
export type PlantCondition = 'unknown' | 'observed_ok' | 'needs_inspection' | 'attention';

export interface Plant {
  id: ID;
  name: string;
  kind: PlantKind;
  species?: string | null;
  plantedAt?: IsoDateTime | null;
  lat: number;
  lng: number;
  condition: PlantCondition;
  lastVerifiedCareAt?: IsoDateTime | null;
  carePolicyId?: ID | null;
  evidenceIds: ID[];
  missingData?: MissingData[];
  isDemo: boolean;
  version: number;
  /** (v1.1) Растение появилось после принятой посадки по проекту. */
  projectId?: ID | null;
  speciesId?: ID | null;
}

export type CheckState = 'unknown' | 'cleared' | 'blocked';
export type FactorKey = 'greeneryGap' | 'publicUsePriority' | 'waterAvailability' | 'maintenanceFeasibility';
export type CheckKey = 'landPermission' | 'utilities' | 'access' | 'siteSuitability';

export interface SiteFactor {
  value: number | null;
  evidenceIds: ID[];
  method: string;
}

export interface SiteCheck {
  state: CheckState;
  checkedBy?: string | null;
  checkedAt?: IsoDateTime | null;
  comment?: string | null;
}

export interface GeoJsonPolygon {
  type: 'Polygon';
  /** Кольца, каждая точка строго [lng, lat]. */
  coordinates: [number, number][][];
}
export interface GeoJsonPoint {
  type: 'Point';
  coordinates: [number, number];
}

export interface CandidateSite {
  id: ID;
  name: string;
  geometry: GeoJsonPolygon | GeoJsonPoint;
  /** Пояснение точности геометрии, например «контур нарисован вручную по схеме». */
  geometryAccuracy?: string | null;
  areaM2?: number | null;
  factors: Record<FactorKey, SiteFactor>;
  checks: Record<CheckKey, SiteCheck>;
  evidenceIds: ID[];
  missingData: MissingData[];
  isDemo: boolean;
  version: number;
  // --- Расширение для задания 02 (предложение к контракту v1.1) ---
  /** Ссылка на исходный объект OSM, например way/123. */
  osmId?: string | null;
  centroid?: { lat: number; lng: number } | null;
  /** Вычисленный контекст из открытых данных: только подсказки, не проверки. */
  context?: {
    distanceToGreenM?: number | null;
    osmTrees150m?: number | null;
    socialWithin400m?: string[];
    busStops300m?: number | null;
    nearestMajorRoadM?: number | null;
    hints?: string[];
  } | null;
  /** (v1.1) Зоны, где размещение запрещено без явного разбора конфликта. */
  exclusionZones?: ExclusionZone[];
  /** (v1.1) Исходные фото участка для вида «до/после». Пусто — фото нет. */
  photos?: { id: ID; url: string; capturedAt: IsoDateTime; isDemo: boolean }[];
}

export interface ExclusionZone {
  id: ID;
  label: string;
  reason: string;
  geometry: GeoJsonPolygon;
  evidenceIds: ID[];
  dataClass: DataClass;
}

export type Level = 'low' | 'medium' | 'high';

/** Вид растения из справочника подбора (предложение к контракту v1.1). */
export interface Species {
  id: ID;
  nameRu: string;
  nameKk?: string | null;
  latin: string;
  form: 'tree' | 'shrub' | 'flower';
  evergreen: boolean;
  frostHardiness: Level;
  droughtTolerance: Level;
  saltTolerance: Level;
  matureHeightM?: [number, number] | null;
  minAreaM2: number;
  native: boolean;
  invasiveRisk: boolean;
  allergenic: boolean;
  notes: string[];
  evidenceIds: ID[];
  dataClass: DataClass;
  /** Месяцы цветения 1–12; null — неизвестно или не декоративно-цветущий. */
  floweringMonths?: number[] | null;
  careLevel?: Level | null;
  /** Диаметр кроны взрослого растения, м (для схемы и 3D). */
  crownDiameterM?: number | null;
  /** Цена за единицу, ₸. null — цена неизвестна (итог тогда неполный). */
  pricePerUnitKzt?: number | null;
  priceEvidenceId?: ID | null;
  /** Единица учёта: шт. (деревья, кусты) или шт./м² (цветы в клумбе). */
  unit?: 'pcs' | 'pcs_per_m2';
  /** Польза для города и декоративность — обобщение, dataClass estimate. */
  benefits?: string[];
  beauty?: string[];
  uses?: ('alley' | 'yard' | 'square' | 'hedge' | 'flowerbed' | 'roadside' | 'greenbelt')[];
  /** Ссылка на источник, где вид назван в посадках Павлодара. */
  pavlodarEvidenceId?: ID | null;
  /** Типичен для советского городского озеленения. */
  soviet?: boolean;
  /** Шаг посадки в ряду, м (ориентир команды). */
  spacingM?: number | null;
  /** Фото вида со свободной лицензией. */
  photo?: { src: string; page: string; author: string; license: string } | null;
}

export interface PlantSelectionItem {
  speciesId: ID;
  fit: 'suitable' | 'conditional';
  reasons: string[];
  cautions: string[];
}

export interface PlantSelection {
  siteId: ID;
  items: PlantSelectionItem[];
  excluded: { speciesId: ID; reason: string }[];
  assumptions: string[];
  missingData: MissingData[];
  limitations: string[];
  method: AiMethod;
  inputVersion: string;
  createdAt: IsoDateTime;
}

export interface CarePolicy {
  id: ID;
  label: string;
  applicableKinds: PlantKind[];
  validSeasons?: string[];
  allowedActions: TaskAction[];
  intervals?: Partial<Record<TaskAction, number>> | null;
  waterLiters?: number | null;
  constraints: string[];
  sourceEvidenceIds: ID[];
  reviewedBy?: string | null;
  isDemo: boolean;
}

export type Role = 'coordinator' | 'worker' | 'foreman' | 'admin';

export interface Worker {
  id: ID;
  displayName: string;
  role: Role;
  active: boolean;
  shiftStart: IsoDateTime;
  shiftEnd: IsoDateTime;
  startLocation?: { lat: number; lng: number } | null;
  capacityMinutes: number;
  skills?: TaskAction[];
  resourceCapacity?: { waterLiters?: number | null } | null;
}

export type TaskAction = 'inspect' | 'water' | 'weed' | 'plant';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatus = 'draft' | 'assigned' | 'in_progress' | 'submitted' | 'verified';

export interface Task {
  id: ID;
  objectType: 'plant' | 'candidate_site';
  objectId: ID;
  action: TaskAction;
  description: string;
  priority: Priority;
  priorityWeight: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  dueAt?: IsoDateTime | null;
  estimatedMinutes: number;
  /** null — норма неизвестна, а не «вода не нужна». */
  requiredWaterLiters?: number | null;
  assigneeId?: ID | null;
  scheduledStart?: IsoDateTime | null;
  scheduledEnd?: IsoDateTime | null;
  planId?: ID | null;
  status: TaskStatus;
  latestReportId?: ID | null;
  evidenceIds: ID[];
  isDemo: boolean;
  version: number;
  // --- v1.1: бригады и проекты ---
  brigadeId?: ID | null;
  /** Минимальный состав, человек; конкретных людей выбирает бригадир. */
  minCrew?: number | null;
  /** Состав, выбранный бригадиром (кабинет участника 4). Пусто — ещё не собран. */
  crewIds?: ID[];
  projectId?: ID | null;
  projectDesignVersion?: number | null;
}

export interface ReportLocation {
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAt: IsoDateTime;
}

export type ObservationCategory = 'access_problem' | 'visible_damage' | 'care_completed' | 'needs_inspection' | 'other';

export interface ConfirmedObservation {
  category: ObservationCategory;
  extractedFacts: string[];
  proposedAction?: TaskAction | null;
  confirmedBy?: ID;
  confirmedAt?: IsoDateTime;
}

export type ReviewStatus = 'pending' | 'accepted' | 'changes_requested';

export interface Report {
  id: ID;
  taskId: ID;
  authorId: ID;
  createdAt: IsoDateTime;
  photoIds: ID[];
  note: string;
  location?: ReportLocation | null;
  confirmedObservation?: ConfirmedObservation | null;
  reviewStatus: ReviewStatus;
  reviewerId?: ID | null;
  reviewComment?: string | null;
  reviewedAt?: IsoDateTime | null;
  idempotencyKey: string;
}

export interface Issue {
  id: ID;
  taskId: ID;
  objectId: ID;
  authorId: ID;
  createdAt: IsoDateTime;
  text: string;
  confirmedObservation?: ConfirmedObservation | null;
}

export type AiMethod = 'model' | 'rules' | 'recorded_demo';

export interface Recommendation {
  id: ID;
  objectId: ID;
  proposedAction: TaskAction;
  priority: Priority;
  reason: string;
  evidenceIds: ID[];
  missingData: MissingData[];
  limitations: string[];
  method: AiMethod;
  modelMetadata?: Record<string, unknown> | null;
  inputVersion: string;
  createdAt: IsoDateTime;
}

export interface ProposedAssignment {
  taskId: ID;
  workerId: ID;
  scheduledStart: IsoDateTime;
  scheduledEnd: IsoDateTime;
  travelMeters?: number | null;
  travelMinutes?: number | null;
  /** Задание уже начато/отправлено/подтверждено и новым планом не меняется. */
  locked?: boolean;
}

export type UnassignedReason =
  | 'no_capacity'
  | 'no_skill'
  | 'resource_limit'
  | 'missing_input'
  | 'blocked_access'
  | 'outside_shift'
  | 'no_active_worker';

export interface UnassignedTask {
  taskId: ID;
  reasonCode: UnassignedReason | string;
  explanation: string;
}

export interface PlanConstraints {
  planDate: string; // YYYY-MM-DD в UTC+5
  workers: { workerId: ID; available: boolean; shiftStart: IsoDateTime; shiftEnd: IsoDateTime; capacityMinutes: number; waterLiters?: number | null }[];
  travelSpeedKmh?: number | null;
  notes?: string[];
}

export interface PlanMetrics {
  totalTasks: number;
  assignedTasks: number;
  highPriorityTotal: number;
  highPriorityAssigned: number;
  assignedWeight: number;
  workMinutes: number;
  travelMeters: number;
  travelMinutes: number | null;
  knownWaterLiters: number;
  tasksWithUnknownWater: number;
  tasksWithMissingData: number;
  constraintViolations: number;
  buildMs?: number;
}

export interface Plan {
  id: ID;
  scenarioId?: ID | null;
  inputVersion: string;
  status: 'draft' | 'approved';
  constraints: PlanConstraints;
  proposedAssignments: ProposedAssignment[];
  unassignedTasks: UnassignedTask[];
  warnings: string[];
  metrics: PlanMetrics;
  method: AiMethod | 'baseline';
  createdAt: IsoDateTime;
  approvedAt?: IsoDateTime | null;
  isDemo?: boolean;
  version: number;
}

export interface PlanComparison {
  scenarioId?: ID | null;
  inputVersion: string;
  constraints: PlanConstraints;
  baseline: Plan;
  proposed: Plan;
  /** Объяснения различий простым языком, сформированные сервером/AI. */
  explanations: string[];
  travelMethod: string;
  isDemo: boolean;
}

export interface RankWeights {
  greeneryGap: number;
  publicUsePriority: number;
  waterAvailability: number;
  maintenanceFeasibility: number;
}

export interface SiteRankItem {
  siteId: ID;
  score: number | null;
  /** Балл по известным факторам; сравним только внутри группы с тем же набором missingFactors. */
  partialScore?: number | null;
  completeness: 'complete' | 'partial';
  contributions: { factor: FactorKey; value: number | null; weight: number; contribution: number | null }[];
  missingFactors: FactorKey[];
  eligibility: 'planting_candidate' | 'survey_needed' | 'blocked';
  explanation: string;
}

export interface SiteRanking {
  scenarioId?: ID | null;
  weights: RankWeights;
  items: SiteRankItem[];
  limitations: string[];
  method: AiMethod;
}

export interface DashboardMetric {
  key: string;
  label: string;
  value: number | null;
  definition: string;
  period: string;
}

export interface Me {
  id: ID;
  displayName: string;
  role: Role;
  isDemoAccount?: boolean;
}

export interface Upload {
  id: ID;
  url: string;
  contentType: string;
  isDemo?: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId: string };
}

export interface ApiSuccess<T> {
  data: T;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// v1.1 (предложение): окружение, проекты озеленения, бригады, план дня.

export interface SiteContextBuilding {
  id: ID;
  name: string | null;
  address: string | null;
  /** Только из тегов OSM (amenity/shop/office/building=school и т.п.), не по внешнему виду. */
  purpose: string | null;
  levels: number | null;
  distanceM: number;
  geometry: GeoJsonPolygon;
}
export interface SiteContextLine {
  id: ID;
  kind: string;
  name: string | null;
  distanceM: number;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}
export interface SiteContextPoint {
  id: ID;
  kind: 'entrance' | 'crossing';
  label: string | null;
  distanceM: number;
  lat: number;
  lng: number;
}
export interface SiteContext {
  siteId: ID;
  radiusM: number;
  distanceMethod: string;
  buildings: SiteContextBuilding[];
  roads: SiteContextLine[];
  entrances: SiteContextPoint[];
  crossings: SiteContextPoint[];
  evidenceIds: ID[];
  fetchedAt: IsoDateTime;
  osmBase?: string | null;
}

export type ProjectStatus = 'draft' | 'submitted' | 'approved' | 'returned';
export type ConflictType = 'exclusion_zone' | 'outside_site' | 'near_building';

export interface ProjectItem {
  id: ID;
  speciesId: ID;
  kind: 'point' | 'bed';
  /** GeoJSON строго [lng, lat]. */
  geometry: GeoJsonPoint | GeoJsonPolygon;
  quantity: number;
  note?: string;
  origin: 'manual' | 'suggested';
  conflicts: { type: ConflictType; message: string; resolution: string | null }[];
}

export interface ProjectReview {
  decision: 'approved' | 'returned';
  by: string;
  at: IsoDateTime;
  comment: string | null;
  designVersion: number;
}

export interface PlantingProject {
  id: ID;
  siteId: ID;
  title: string;
  /** Счётчик для expectedVersion (конфликты правок). */
  version: number;
  /** Версия состава: растёт, когда правят уже согласованный проект. */
  designVersion: number;
  status: ProjectStatus;
  items: ProjectItem[];
  season: string;
  createdBy: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  submittedAt?: IsoDateTime | null;
  reviews: ProjectReview[];
  /** Последняя согласованная версия состава — из неё создаются работы. */
  approved?: { designVersion: number; items: ProjectItem[]; approvedAt: IsoDateTime; by: string } | null;
  implementedAt?: IsoDateTime | null;
  isDemo: boolean;
}

export interface Brigade {
  id: ID;
  name: string;
  foremanId: ID;
  memberIds: ID[];
  active: boolean;
  shiftStart: IsoDateTime;
  shiftEnd: IsoDateTime;
  capacityMinutes: number;
  equipment: string[];
  skills: TaskAction[];
}

export interface DayPlanSummary {
  tasks: number;
  byBrigade: { brigadeId: ID; tasks: number; minutes: number }[];
  warnings: string[];
}
export interface DayPlan {
  id: ID;
  date: string;
  status: 'draft' | 'approved';
  approvedAt?: IsoDateTime | null;
  approvedBy?: string | null;
  snapshot: { taskId: ID; brigadeId: ID | null; scheduledStart: IsoDateTime | null; version: number }[];
  summary?: DayPlanSummary | null;
  version: number;
}
