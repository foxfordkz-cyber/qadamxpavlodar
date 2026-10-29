// Ответы маршрутов ТЗ, собранные из модулей shared/analytics. Общие для тестового источника и сервера apps/server,
// поэтому формы ответов и определения метрик в режимах mock и api совпадают.
import greenery from '../../../../../fixtures/osm/greenery.json';
import type { CandidateSite, DashboardMetric, PlantingProject, Report, Task } from './types';
import { VARIANT_LABEL, type PlanOptions, type Variant, type ZoneAnalysis } from '../analytics/plan';
import { SALINITY_LABEL, SOIL_CELL_DEG, soilForCell } from '../analytics/zone';

export const DISTRICT_BBOX = { south: 52.268, west: 76.926, north: 52.3, east: 76.974 };

/** Синтетическая сетка почв по району (до карты почв организатора). */
export function soilsLayer() {
  const features = [];
  for (let la = Math.floor(DISTRICT_BBOX.south / SOIL_CELL_DEG.lat); la * SOIL_CELL_DEG.lat < DISTRICT_BBOX.north; la++)
    for (let ln = Math.floor(DISTRICT_BBOX.west / SOIL_CELL_DEG.lng); ln * SOIL_CELL_DEG.lng < DISTRICT_BBOX.east; ln++) {
      const s = soilForCell(`soil-${la}-${ln}`);
      const [y0, x0] = [la * SOIL_CELL_DEG.lat, ln * SOIL_CELL_DEG.lng];
      const [y1, x1] = [y0 + SOIL_CELL_DEG.lat, x0 + SOIL_CELL_DEG.lng];
      features.push({ type: 'Feature', properties: { id: s.cellId, type: s.type, ph: s.ph, salinity: s.salinity, salinityLabel: SALINITY_LABEL[s.salinity], synthetic: true }, geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } });
    }
  return { data: { type: 'FeatureCollection', features }, meta: { synthetic: true, note: 'Синтетический слой почв: заменить картой почв организатора.' } };
}

export function greeneryLayer() {
  return { data: greenery, meta: { source: 'OpenStreetMap (ODbL)', note: 'До получения карты насаждений организатора.' } };
}

/** Три варианта (эконом / оптимум / максимум) для сравнения; analyze — расчёт зоны с нужными параметрами. */
export function variantSummaries(opts: Partial<PlanOptions>, analyze: (o: Partial<PlanOptions>) => ZoneAnalysis) {
  const careByVariant: Record<Variant, 1 | 2 | 3> = { econom: 1, optimal: 2, max: 3 };
  return (['econom', 'optimal', 'max'] as Variant[]).map((v) => {
    const a = analyze({ ...opts, variant: v, careYears: careByVariant[v] });
    const e20 = a.effect.find((e) => e.years === 20)!;
    return { variant: v, label: VARIANT_LABEL[v], careYears: a.options.careYears, plants: a.scheme.reduce((x, r) => x + r.quantity, 0), cost: a.cost.total, survival: a.survivalAvg, co2t20: e20.co2t, coolingC: e20.coolingC, rainM3: e20.rainM3, costPerTonCo2: a.costPerTonCo2 };
  });
}

const CHECK_KEYS = ['landPermission', 'utilities', 'access', 'siteSuitability'] as const;

export function dashboardMetrics(input: { sites: CandidateSite[]; tasks: Task[]; reports: Report[]; projects: PlantingProject[]; osmBase?: string | null }): DashboardMetric[] {
  const { sites, tasks, reports, projects } = input;
  const elig = (s: CandidateSite) => {
    const st = CHECK_KEYS.map((k) => s.checks[k].state);
    return st.includes('blocked') ? 'blocked' : st.every((x) => x === 'cleared') ? 'cleared' : 'needs';
  };
  const weekAgo = Date.now() - 7 * 864e5;
  return [
    { key: 'sites_total', label: 'Кандидатов из OSM', value: sites.length, definition: 'Газоны и травяные участки OSM 150–25 000 м² вне существующих парков, плюс зоны, нарисованные специалистом.', period: `Данные OSM на ${input.osmBase?.slice(0, 10) ?? '—'}` },
    { key: 'sites_need_check', label: 'Нужна проверка', value: sites.filter((s) => elig(s) === 'needs').length, definition: 'Хотя бы одна из четырёх проверок не выполнена, ограничений нет.', period: 'Сейчас' },
    { key: 'sites_blocked', label: 'Есть ограничение', value: sites.filter((s) => elig(s) === 'blocked').length, definition: 'Хотя бы одна проверка отмечена человеком как ограничение.', period: 'Сейчас' },
    { key: 'sites_cleared', label: 'Проверки завершены', value: sites.filter((s) => elig(s) === 'cleared').length, definition: 'Все четыре проверки отмечены человеком как пройденные.', period: 'Сейчас' },
    { key: 'tasks_open', label: 'Открытые задания', value: tasks.filter((t) => ['draft', 'assigned', 'in_progress'].includes(t.status)).length, definition: 'Черновики, назначенные и начатые задания.', period: 'Сейчас' },
    { key: 'unassigned_priority', label: 'Без исполнителя (высокий приоритет)', value: tasks.filter((t) => t.status === 'draft' && (t.priority === 'high' || t.priority === 'critical')).length, definition: 'Черновики с приоритетом «высокий» или «критичный» без назначения.', period: 'Сейчас' },
    { key: 'reports_pending', label: 'Отчёты ждут проверки', value: reports.filter((r) => r.reviewStatus === 'pending').length, definition: 'Отчёты со статусом проверки «ожидает».', period: 'Сейчас' },
    { key: 'projects_review', label: 'Проекты на согласовании', value: projects.filter((p) => p.status === 'submitted').length, definition: 'Проекты озеленения, отправленные руководителю и ещё не рассмотренные.', period: 'Сейчас' },
    { key: 'projects_approved', label: 'Проекты согласованы', value: projects.filter((p) => p.approved && !p.implementedAt).length, definition: 'Есть согласованная версия, посадка ещё не принята по отчёту. «Согласован» ≠ «посажено».', period: 'Сейчас' },
    { key: 'verified_7d', label: 'Подтверждено выполнено', value: tasks.filter((t) => t.status === 'verified' && Date.parse(t.updatedAt) >= weekAgo).length, definition: 'Задания, принятые координатором по отчёту.', period: 'Последние 7 дней' },
  ];
}
