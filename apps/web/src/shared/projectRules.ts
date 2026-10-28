// Правила конфликтов размещения (B20). Одна реализация для клиента (подсказка сразу)
// и тестового сервера (окончательная проверка). Реальный сервер повторяет те же правила.
import type { CandidateSite, ConflictType, ProjectItem, SiteContextBuilding, Species } from './api/types';
import { distShapes, makeProjection, pointInRing, type XY } from './geo';

/** Ориентиры команды до сверки с нормами СП РК: расстояние от стены здания до оси растения. */
export const MIN_DISTANCE_TO_BUILDING_M: Record<Species['form'], number> = { tree: 5, shrub: 1.5, flower: 0 };

export interface Conflict {
  type: ConflictType;
  message: string;
}

export function itemPoints(item: Pick<ProjectItem, 'geometry'>): [number, number][] {
  return item.geometry.type === 'Point' ? [item.geometry.coordinates] : item.geometry.coordinates[0];
}

export function computeConflicts(item: Pick<ProjectItem, 'geometry' | 'speciesId'>, site: CandidateSite, buildings: SiteContextBuilding[], species: Species | undefined): Conflict[] {
  const proj = makeProjection(site.centroid!);
  const pts: XY[] = itemPoints(item).map(proj.toXY);
  const siteRing: XY[] = site.geometry.type === 'Polygon' ? site.geometry.coordinates[0].map(proj.toXY) : [];
  const out: Conflict[] = [];
  if (siteRing.length && pts.some((p) => !pointInRing(p, siteRing) && distShapes([p], siteRing, false, true) > 0.3))
    out.push({ type: 'outside_site', message: 'Часть размещения выходит за границу участка.' });
  for (const z of site.exclusionZones ?? []) {
    const zr = z.geometry.coordinates[0].map(proj.toXY);
    const hit = pts.some((p) => pointInRing(p, zr)) || (item.geometry.type === 'Polygon' && distShapes(pts, zr) === 0);
    if (hit) out.push({ type: 'exclusion_zone', message: `Зона исключения «${z.label}»: ${z.reason}` });
  }
  const min = species ? MIN_DISTANCE_TO_BUILDING_M[species.form] : 0;
  if (min > 0) {
    for (const b of buildings) {
      const d = distShapes(pts, b.geometry.coordinates[0].map(proj.toXY), item.geometry.type === 'Polygon', true);
      if (d < min) {
        out.push({ type: 'near_building', message: `До здания${b.address ? ` (${b.address})` : ''} ≈${d.toFixed(1)} м — меньше ориентира ${min} м для формы «${species!.form === 'tree' ? 'дерево' : 'кустарник'}».` });
        break;
      }
    }
  }
  return out;
}

/** Конфликты, которые есть по правилам, но не разобраны человеком (нет resolution). */
export function unresolved(item: ProjectItem, computed: Conflict[]): Conflict[] {
  return computed.filter((c) => !item.conflicts.some((x) => x.type === c.type && x.resolution?.trim()));
}

export interface CostEstimate {
  known: number;
  missing: { speciesId: string; quantity: number }[];
  complete: boolean;
}
export function estimateCost(items: ProjectItem[], catalog: Species[]): CostEstimate {
  const by = new Map(catalog.map((s) => [s.id, s]));
  let known = 0;
  const missing = new Map<string, number>();
  for (const it of items) {
    const p = by.get(it.speciesId)?.pricePerUnitKzt;
    if (p == null) missing.set(it.speciesId, (missing.get(it.speciesId) ?? 0) + it.quantity);
    else known += p * it.quantity;
  }
  return { known, missing: [...missing].map(([speciesId, quantity]) => ({ speciesId, quantity })), complete: missing.size === 0 };
}
