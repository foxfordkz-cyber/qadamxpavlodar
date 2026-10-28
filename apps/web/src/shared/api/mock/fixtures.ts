// Начальные данные тестового источника. Участки — реальные контуры OSM
// (fixtures/osm/sites.json); работники, задания, отчёты и проверки — демонстрационные.
import osm from '../../../../../../fixtures/osm/sites.json';
import type { Brigade, CandidateSite, DayPlan, EvidenceRef, ExclusionZone, Issue, PlantingProject, Plant, Report, Task, Worker } from '../types';
import { pavlodarEvidence, priceEvidence, species, speciesEvidence } from './species';
import { contextEvidence } from './context';
import { centroidXY, makeProjection, type XY } from '../../geo';

export interface MockDb {
  seededAt: string;
  sites: CandidateSite[];
  evidence: EvidenceRef[];
  workers: Worker[];
  brigades: Brigade[];
  projects: PlantingProject[];
  plants: Plant[];
  plans: DayPlan[];
  tasks: Task[];
  reports: Report[];
  issues: Issue[];
  uploads: Record<string, { label: string }>;
  idempotency: Record<string, { hash: string; status: number; body: unknown }>;
  seq: number;
}

const demoEvidence: EvidenceRef[] = [
  { id: 'ev-demo-scenario', sourceType: 'fixture', sourceLabel: 'Демонстрационный сценарий команды', dataClass: 'demo', note: 'Работники, задания, отчёты и отмеченные проверки придуманы для показа работы продукта.' },
  { id: 'ev-demo-water', sourceType: 'fixture', sourceLabel: 'Демо: доступ к воде указан командой', dataClass: 'demo', note: 'Значение не измерено, введено для демонстрации полного рейтинга.' },
  { id: 'ev-team-duration', sourceType: 'manual', sourceLabel: 'Оценка длительности обследования командой', dataClass: 'estimate', note: '45–90 минут в зависимости от площади; не хронометраж.' },
  speciesEvidence,
  priceEvidence,
  ...pavlodarEvidence,
  contextEvidence,
  { id: 'ev-demo-zones', sourceType: 'fixture', sourceLabel: 'Демо: зоны исключения нарисованы командой', dataClass: 'demo', note: 'Не схема сетей. Нужны для проверки, что редактор не даёт сажать в запретной зоне без разбора.' },
];

// Смена 28.10.2026, 09:00–17:00 по UTC+5 = 04:00–12:00 UTC.
const shift = { shiftStart: '2026-10-28T04:00:00Z', shiftEnd: '2026-10-28T12:00:00Z' };
const workers: Worker[] = [
  { id: 'w-aigerim', displayName: 'Айгерим С. (демо)', role: 'foreman', active: true, ...shift, capacityMinutes: 420, skills: ['inspect', 'plant', 'water', 'weed'], startLocation: { lat: 52.2857, lng: 76.9455 }, resourceCapacity: { waterLiters: null } },
  { id: 'w-dmitry', displayName: 'Дмитрий К. (демо)', role: 'worker', active: true, ...shift, capacityMinutes: 420, skills: ['inspect', 'weed'], startLocation: { lat: 52.2857, lng: 76.9455 }, resourceCapacity: { waterLiters: null } },
  { id: 'w-nurlan', displayName: 'Нурлан Б. (демо)', role: 'foreman', active: true, shiftStart: '2026-10-28T08:00:00Z', shiftEnd: '2026-10-28T12:00:00Z', capacityMinutes: 240, skills: ['inspect', 'plant'], startLocation: null, resourceCapacity: { waterLiters: null } },
  { id: 'w-sanzhar', displayName: 'Санжар Т. (демо)', role: 'worker', active: true, ...shift, capacityMinutes: 420, skills: ['plant', 'water', 'weed'], startLocation: null, resourceCapacity: { waterLiters: null } },
  { id: 'w-olga', displayName: 'Ольга П. (демо)', role: 'worker', active: false, shiftStart: '2026-10-28T08:00:00Z', shiftEnd: '2026-10-28T12:00:00Z', capacityMinutes: 240, skills: ['plant', 'weed'], startLocation: null, resourceCapacity: { waterLiters: null } },
];

const brigades: Brigade[] = [
  { id: 'br-1', name: 'Бригада №1 (демо)', foremanId: 'w-aigerim', memberIds: ['w-aigerim', 'w-dmitry', 'w-sanzhar'], active: true, ...shift, capacityMinutes: 420, equipment: ['Газель с бортом', 'Бочка 1000 л'], skills: ['inspect', 'plant', 'water', 'weed'] },
  { id: 'br-2', name: 'Бригада №2 (демо)', foremanId: 'w-nurlan', memberIds: ['w-nurlan', 'w-olga'], active: true, shiftStart: '2026-10-28T08:00:00Z', shiftEnd: '2026-10-28T12:00:00Z', capacityMinutes: 240, equipment: ['Мотобур'], skills: ['inspect', 'plant'] },
];

/** Демо-зона исключения: полоса вдоль первой стороны контура на долю depth к центру. */
function demoZone(site: CandidateSite, label: string, reason: string, depth = 0.3): ExclusionZone {
  const proj = makeProjection(site.centroid!);
  const ring = (site.geometry as { coordinates: [number, number][][] }).coordinates[0].map(proj.toXY);
  const c = centroidXY(ring);
  const [a, b] = [ring[0], ring[1]];
  const toward = (p: XY): XY => [p[0] + (c[0] - p[0]) * depth, p[1] + (c[1] - p[1]) * depth];
  const poly = [a, b, toward(b), toward(a), a].map(proj.toLngLat);
  return { id: 'ez-' + site.id, label, reason, geometry: { type: 'Polygon', coordinates: [poly] }, evidenceIds: ['ev-demo-zones'], dataClass: 'demo' };
}

const at = (h: number, day = 27) => `2026-10-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00Z`;

export function seed(): MockDb {
  const sites = structuredClone(osm.sites) as unknown as CandidateSite[];
  const S = (i: number) => sites[i];
  const human = (comment: string) => ({ checkedBy: 'Координатор (демо)', checkedAt: at(6, 26), comment: `[Демо-проверка] ${comment}` });

  // Участок 5: найдено ограничение по сетям.
  S(5).checks.utilities = { state: 'blocked', ...human('По схеме сетей проходит теплотрасса, посадка деревьев запрещена.') };
  S(5).checks.access = { state: 'cleared', ...human('Подъезд с улицы есть.') };
  // Участок 6: все проверки пройдены, указан доступ к воде — пример готового кандидата.
  for (const k of ['landPermission', 'utilities', 'access', 'siteSuitability'] as const)
    S(6).checks[k] = { state: 'cleared', ...human('Проверено на месте вместе с работником.') };
  S(6).factors.waterAvailability = { value: 70, evidenceIds: ['ev-demo-water'], method: 'Демо: рядом поливочный кран двора, значение указано командой.' };
  S(6).missingData = S(6).missingData.filter((m) => m.field !== 'factors.waterAvailability' && m.field !== 'checks');
  S(6).version = 2;
  S(6).exclusionZones = [demoZone(S(6), 'Охранная зона теплосети (демо)', 'Над теплотрассой нельзя сажать деревья и кустарники.', 0.35)];
  S(5).exclusionZones = [demoZone(S(5), 'Теплотрасса (демо)', 'Проверка сетей отмечена как ограничение.', 0.6)];

  const task = (p: Partial<Task> & Pick<Task, 'id' | 'objectId' | 'status' | 'priority'>): Task => ({
    objectType: 'candidate_site',
    action: 'inspect',
    description: 'Обследовать участок: границы, доступ, видимые сети, состояние почвы. Сделать фото.',
    priorityWeight: { low: 1, medium: 2, high: 3, critical: 4 }[p.priority],
    createdAt: at(5),
    updatedAt: at(5),
    dueAt: at(12, 29),
    estimatedMinutes: 60,
    requiredWaterLiters: null,
    assigneeId: null,
    scheduledStart: null,
    scheduledEnd: null,
    planId: null,
    latestReportId: null,
    evidenceIds: ['ev-demo-scenario', 'ev-team-duration'],
    isDemo: true,
    version: 1,
    ...p,
  });

  const tasks: Task[] = [
    task({ id: 't-101', objectId: S(0).id, status: 'assigned', priority: 'high', assigneeId: 'w-aigerim', brigadeId: 'br-1', minCrew: 2, crewIds: ['w-aigerim', 'w-dmitry'], scheduledStart: '2026-10-28T04:30:00Z', scheduledEnd: '2026-10-28T06:00:00Z', estimatedMinutes: 90, version: 2 }),
    task({ id: 't-102', objectId: S(1).id, status: 'submitted', priority: 'high', assigneeId: 'w-dmitry', brigadeId: 'br-1', minCrew: 1, crewIds: ['w-dmitry'], latestReportId: 'r-201', version: 4, updatedAt: at(9) }),
    task({ id: 't-103', objectId: S(2).id, status: 'submitted', priority: 'medium', assigneeId: 'w-aigerim', brigadeId: 'br-1', minCrew: 1, crewIds: ['w-aigerim'], latestReportId: 'r-202', version: 4, updatedAt: at(10) }),
    task({ id: 't-104', objectId: S(3).id, status: 'draft', priority: 'medium' }),
    task({ id: 't-105', objectId: S(7).id, status: 'draft', priority: 'critical', description: 'Срочно обследовать: жители сообщили о вывозе грунта.', dueAt: at(12, 28) }),
    task({ id: 't-107', objectId: S(4).id, status: 'assigned', priority: 'medium', assigneeId: null, brigadeId: 'br-2', minCrew: 2, crewIds: [], scheduledStart: '2026-10-28T08:30:00Z', scheduledEnd: '2026-10-28T09:30:00Z', version: 2 }),
    task({ id: 't-106', objectId: S(6).id, status: 'verified', priority: 'medium', assigneeId: 'w-aigerim', brigadeId: 'br-1', minCrew: 1, crewIds: ['w-aigerim'], latestReportId: 'r-200', version: 5, updatedAt: at(6, 26) }),
  ];

  const reports: Report[] = [
    { id: 'r-200', taskId: 't-106', authorId: 'w-aigerim', createdAt: at(5, 26), photoIds: ['up-1'], note: 'Участок ровный, подъезд есть, кран во дворе рабочий.', location: { lat: S(6).centroid!.lat, lng: S(6).centroid!.lng, accuracyM: 12, capturedAt: at(5, 26) }, confirmedObservation: { category: 'care_completed', extractedFacts: ['Подъезд есть', 'Есть поливочный кран'], proposedAction: null, confirmedBy: 'w-aigerim', confirmedAt: at(5, 26) }, reviewStatus: 'accepted', reviewerId: 'coordinator-demo', reviewComment: 'Принято.', reviewedAt: at(6, 26), idempotencyKey: 'seed-200' },
    { id: 'r-201', taskId: 't-102', authorId: 'w-dmitry', createdAt: at(9), photoIds: ['up-2', 'up-3'], note: 'Часть участка огорожена забором стройки, вход только с южной стороны. Люк колодца у края.', location: { lat: S(1).centroid!.lat + 0.0003, lng: S(1).centroid!.lng - 0.0002, accuracyM: 25, capturedAt: at(9) }, confirmedObservation: { category: 'access_problem', extractedFacts: ['Часть участка огорожена стройкой', 'Вход только с юга', 'У края люк колодца'], proposedAction: 'inspect', confirmedBy: 'w-dmitry', confirmedAt: at(9) }, reviewStatus: 'pending', idempotencyKey: 'seed-201' },
    { id: 'r-202', taskId: 't-103', authorId: 'w-aigerim', createdAt: at(10), photoIds: ['up-4'], note: 'Осмотрела, сетей не видно.', location: null, confirmedObservation: null, reviewStatus: 'pending', idempotencyKey: 'seed-202' },
  ];

  const issues: Issue[] = [
    { id: 'i-301', taskId: 't-102', objectId: S(1).id, authorId: 'w-dmitry', createdAt: at(9), text: 'Нет доступа к северной части: забор стройки.', confirmedObservation: { category: 'access_problem', extractedFacts: ['Забор стройки на северной части'], proposedAction: null, confirmedBy: 'w-dmitry', confirmedAt: at(9) } },
  ];

  // Проект на согласовании на участке с непроверенными условиями: утвердить нельзя, можно вернуть.
  const p2 = S(2);
  const pp = makeProjection(p2.centroid!);
  const [cx, cy] = pp.toXY([p2.centroid!.lng, p2.centroid!.lat]);
  const pt = (dx: number, dy: number) => pp.toLngLat([cx + dx, cy + dy]);
  const projects: PlantingProject[] = [
    {
      id: 'pr-201', siteId: p2.id, title: 'Живая изгородь: ' + p2.name, version: 3, designVersion: 1, status: 'submitted',
      items: [
        { id: 'pi-1', speciesId: 'sp-caragana-arborescens', kind: 'point', geometry: { type: 'Point', coordinates: pt(-6, 0) }, quantity: 1, origin: 'manual', conflicts: [] },
        { id: 'pi-2', speciesId: 'sp-caragana-arborescens', kind: 'point', geometry: { type: 'Point', coordinates: pt(-3, 0) }, quantity: 1, origin: 'manual', conflicts: [] },
        { id: 'pi-3', speciesId: 'sp-syringa-vulgaris', kind: 'point', geometry: { type: 'Point', coordinates: pt(0, 0) }, quantity: 1, origin: 'manual', conflicts: [] },
        { id: 'pi-4', speciesId: 'sp-sedum-spectabile', kind: 'bed', geometry: { type: 'Polygon', coordinates: [[pt(3, -2), pt(8, -2), pt(8, 2), pt(3, 2), pt(3, -2)]] }, quantity: 60, origin: 'manual', conflicts: [] },
      ],
      season: 'Весна 2027 (демо)', createdBy: 'Координатор (демо)', createdAt: at(8, 26), updatedAt: at(9, 26), submittedAt: at(9, 26), reviews: [], approved: null, implementedAt: null, isDemo: true,
    },
  ];
  const plans: DayPlan[] = [];
  const plants: Plant[] = [];

  return {
    seededAt: new Date().toISOString(),
    sites,
    brigades,
    projects,
    plants,
    plans,
    evidence: [...(osm.evidence as EvidenceRef[]), ...demoEvidence],
    workers,
    tasks,
    reports,
    issues,
    uploads: { 'up-1': { label: 'Участок, вид с юга' }, 'up-2': { label: 'Забор стройки' }, 'up-3': { label: 'Люк у края участка' }, 'up-4': { label: 'Общий вид' } },
    idempotency: {},
    seq: 1000,
  };
}

export const catalog = species;
export const osmMeta = { osmBase: osm.osmBase, generatedAt: osm.generatedAt, license: osm.license, bbox: osm.bbox };
