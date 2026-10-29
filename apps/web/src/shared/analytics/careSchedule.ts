import type { CandidateSite, Plant, Species } from '../api/types';
import type { NewTask } from '../api/api';
import { pointInRing } from '../geo';
import { ru } from '../i18n/ru';
import { careCalendar, DEFAULT_OPTIONS, type CareRow } from './plan';
import type { Rates } from './rates';
import { soilFor } from './zone';

export interface CareRequest { months: number; crewVisitsPerMonth?: number; budgetKzt?: number }
export interface CareDraft extends NewTask { id: string; objectName: string; estimatedCostKzt: null; dataClass: 'estimate' }
export interface CareSchedule { tasks: CareDraft[]; warnings: string[]; method: 'rules' }
const msg = (key: keyof typeof ru, values: Record<string, string | number> = {}) => ru[key].replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ''));

/** Same strict validation in mock and real route (the latter also exposes a Zod API schema). */
export function parseCareRequest(value: unknown): CareRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(ru['care.invalid']);
  const b = value as Record<string, unknown>;
  if (Object.keys(b).some(k => !['months', 'crewVisitsPerMonth', 'budgetKzt'].includes(k)) || !Number.isInteger(b.months) || Number(b.months) < 1 || Number(b.months) > 12 ||
    (b.crewVisitsPerMonth !== undefined && (typeof b.crewVisitsPerMonth !== 'number' || !Number.isInteger(b.crewVisitsPerMonth) || b.crewVisitsPerMonth < 0 || b.crewVisitsPerMonth > 31)) ||
    (b.budgetKzt !== undefined && (typeof b.budgetKzt !== 'number' || !Number.isFinite(b.budgetKzt) || b.budgetKzt < 0))) throw new Error(ru['care.invalid']);
  return b as unknown as CareRequest;
}

/** Spatial membership, including holes; no inference from proximity or unaccepted project items. */
export function plantsInZone(site: CandidateSite, plants: Plant[]): Plant[] {
  if (site.geometry.type !== 'Polygon') return [];
  const [outer, ...holes] = site.geometry.coordinates;
  return plants.filter(p => Number.isFinite(p.lng) && Number.isFinite(p.lat) && pointInRing([p.lng, p.lat], outer) && !holes.some(h => pointInRing([p.lng, p.lat], h)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Next full calendar months in Pavlodar (UTC+5). Pure function; now is injected for tests. */
export function buildCareSchedule(site: CandidateSite, plants: Plant[], catalog: Species[], rates: Rates, input: CareRequest, now = new Date()): CareSchedule {
  const request = parseCareRequest(input), tasks: CareDraft[] = [], warnings = new Set<string>([ru['care.estimateNote']]);
  const local = new Date(now.getTime() + 5 * 3600_000), year = local.getUTCFullYear(), month = local.getUTCMonth();
  const registered = plantsInZone(site, plants), byId = new Map(catalog.map(s => [s.id, s]));
  const center = site.centroid;
  // A missing centroid never becomes a made-up soil sample.
  const soil = center ? soilFor(center.lat, center.lng) : { salinity: null };
  if (!center) warnings.add(ru['care.noSoil']);
  if (!registered.length) warnings.add(ru['care.noPlants']);
  const targets: (Plant | null)[] = registered.length ? registered : [null];
  for (const plant of targets) {
    const exact = plant?.speciesId ? byId.get(plant.speciesId) : undefined;
    const matches = catalog.filter(s => plant?.species && s.latin === plant.species);
    const sp = exact ?? (matches.length === 1 ? matches[0] : undefined);
    if (plant && !sp) warnings.add(msg('care.noSpecies', { name: plant.name }));
    const calendar = sp ? careCalendar([{ speciesId: sp.id, tier: sp.form, quantity: 1, locked: false }], byId, soil, DEFAULT_OPTIONS, rates).care : null;
    for (let offset = 1; offset <= request.months; offset++) {
      const date = new Date(Date.UTC(year, month + offset, 1));
      const y = date.getUTCFullYear(), m = date.getUTCMonth(), days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const rows: CareRow[] = calendar?.filter(c => c.month === m + 1) ?? [{ month: m + 1, operation: ru['care.inspect'], detail: ru['care.inspectDetail'], visits: 1, taskAction: 'inspect' }];
      for (const [rowIndex, row] of rows.entries()) {
        const action = plant ? row.taskAction ?? 'inspect' : 'inspect';
        if (calendar && !row.taskAction && !row.operation.startsWith('Осмотр')) warnings.add(ru['care.unsupported']);
        const water = action === 'water' && (row.waterLitersPerVisit ?? 0) > 0 ? row.waterLitersPerVisit! : null;
        if (action === 'water' && water === null) warnings.add(ru['care.noWater']);
        for (let visit = 0; visit < row.visits; visit++) {
          const day = Math.max(1, Math.floor((visit + 1) * days / (row.visits + 1)));
          const dueAt = new Date(Date.UTC(y, m, day, 7)).toISOString();
          tasks.push({ id: `${site.id}:${plant?.id ?? 'site'}:${y}-${m + 1}:${rowIndex}:${visit}`, objectName: plant?.name ?? site.name,
            objectType: plant ? 'plant' : 'candidate_site', objectId: plant?.id ?? site.id, action,
            description: msg(action === 'inspect' ? 'care.inspectTask' : 'care.task', { operation: row.operation, detail: row.detail }),
            priority: 'medium', dueAt, estimatedMinutes: action === 'inspect' ? 15 : 20, requiredWaterLiters: water,
            evidenceIds: [...new Set(plant?.evidenceIds ?? site.evidenceIds)], estimatedCostKzt: null, dataClass: 'estimate' });
        }
      }
    }
  }
  tasks.sort((a, b) => a.dueAt!.localeCompare(b.dueAt!) || a.id.localeCompare(b.id));
  const allowed = request.crewVisitsPerMonth ?? rates['care.visits'];
  if (allowed == null) warnings.add(ru['care.noVisits']);
  else {
    const dates = new Map<string, Set<string>>();
    for (const task of tasks) { const ym = task.dueAt!.slice(0, 7); if (!dates.has(ym)) dates.set(ym, new Set()); dates.get(ym)!.add(task.dueAt!.slice(0, 10)); }
    for (const [ym, set] of dates) if (set.size > allowed) warnings.add(msg('care.visitsExceeded', { month: ym, count: set.size, allowed }));
  }
  warnings.add(request.budgetKzt === undefined ? ru['care.costUnknown'] : msg('care.budgetUnknown', { budget: request.budgetKzt }));
  return { tasks, warnings: [...warnings], method: 'rules' };
}
