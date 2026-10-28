import type { CandidateSite, PlantSelection, ProjectItem, SiteContextBuilding, Species } from '../../../shared/api/types';
import { bboxXY, makeProjection, pointInRing, type XY } from '../../../shared/geo';
import { computeConflicts } from '../../../shared/projectRules';

/**
 * Черновое размещение по результату подбора: деревья по сетке с шагом в диаметр кроны,
 * между ними кустарники. Точки с конфликтами пропускаются. Результат — предложение
 * (origin: 'suggested'), которое человек правит; это не готовый проект.
 */
export function suggestLayout(site: CandidateSite, selection: PlantSelection, catalog: Map<string, Species>, buildings: SiteContextBuilding[], newId: () => string, max = 14): ProjectItem[] {
  const proj = makeProjection(site.centroid!);
  if (site.geometry.type !== 'Polygon') return [];
  const ring: XY[] = site.geometry.coordinates[0].map(proj.toXY);
  const b = bboxXY(ring);
  const pick = (form: Species['form'], n: number) =>
    selection.items.filter((i) => i.fit === 'suitable' && catalog.get(i.speciesId)?.form === form).slice(0, n).map((i) => catalog.get(i.speciesId)!);
  const trees = pick('tree', 2);
  const shrubs = pick('shrub', 2);
  const out: ProjectItem[] = [];
  const tryPlace = (sp: Species, xy: XY) => {
    if (out.length >= max || !pointInRing(xy, ring)) return false;
    const item = { geometry: { type: 'Point' as const, coordinates: proj.toLngLat(xy) }, speciesId: sp.id };
    if (computeConflicts(item, site, buildings, sp).length) return false;
    const near = out.some((o) => {
      const [x, y] = proj.toXY((o.geometry as { coordinates: [number, number] }).coordinates);
      const other = catalog.get(o.speciesId);
      return Math.hypot(x - xy[0], y - xy[1]) < ((sp.crownDiameterM ?? 2) + (other?.crownDiameterM ?? 2)) / 2;
    });
    if (near) return false;
    out.push({ id: newId(), speciesId: sp.id, kind: 'point', geometry: item.geometry, quantity: 1, origin: 'suggested', conflicts: [] });
    return true;
  };
  // Узлы сетки обходятся в «разбросанном» порядке (золотое сечение), чтобы при лимите
  // max позиции распределились по всему участку, а не заполнили один его край.
  const spread = <T,>(arr: T[]) => arr.map((v, i) => ({ v, k: (i * 0.6180339887) % 1 })).sort((a, b) => a.k - b.k).map((x) => x.v);
  const perSpecies = Math.ceil(max / Math.max(1, trees.length + shrubs.length));
  for (const [list, stepMul] of [[trees, 1], [shrubs, 0.7]] as const) {
    list.forEach((sp, si) => {
      const step = Math.max(3, (sp.crownDiameterM ?? 4) * stepMul + 1);
      const nodes: XY[] = [];
      for (let y = b.minY + step / 2 + si * (step / 2); y < b.maxY; y += step * 1.5)
        for (let x = b.minX + step / 2; x < b.maxX; x += step) nodes.push([x, y]);
      let placed = 0;
      for (const n of spread(nodes)) if (placed < perSpecies && tryPlace(sp, n)) placed++;
    });
  }
  return out;
}

export type TemplateKind = 'alley' | 'hedge';

/**
 * Шаблоны из гайда: «аллея» — ряд деревьев вдоль самой длинной стороны участка,
 * «живая изгородь» — ряд кустов у этой же стороны. Шаг — из справочника (spacingM).
 * Точки с конфликтами пропускаются; результат — предложение, которое правит человек.
 */
export function templateLayout(kind: TemplateKind, site: CandidateSite, sp: Species, buildings: SiteContextBuilding[], newId: () => string, max = 60): { items: ProjectItem[]; skipped: number } {
  const proj = makeProjection(site.centroid!);
  if (site.geometry.type !== 'Polygon') return { items: [], skipped: 0 };
  const ring: XY[] = site.geometry.coordinates[0].map(proj.toXY);
  let best = 0;
  let bestLen = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const len = Math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1]);
    if (len > bestLen) { bestLen = len; best = i; }
  }
  const [a, b] = [ring[best], ring[best + 1]];
  const ux = (b[0] - a[0]) / bestLen;
  const uy = (b[1] - a[1]) / bestLen;
  // Нормаль внутрь участка: проверяем, с какой стороны лежит центр.
  let nx = -uy;
  let ny = ux;
  const c = ring.reduce((acc, p) => [acc[0] + p[0] / ring.length, acc[1] + p[1] / ring.length], [0, 0]);
  if ((c[0] - a[0]) * nx + (c[1] - a[1]) * ny < 0) { nx = -nx; ny = -ny; }
  const offset = kind === 'alley' ? Math.max(2, (sp.crownDiameterM ?? 4) / 2 + 0.7) : 0.8;
  const step = sp.spacingM ?? (kind === 'alley' ? 6 : 0.7);
  const items: ProjectItem[] = [];
  let skipped = 0;
  for (let d = step / 2; d < bestLen && items.length < max; d += step) {
    const xy: XY = [a[0] + ux * d + nx * offset, a[1] + uy * d + ny * offset];
    if (!pointInRing(xy, ring)) { skipped++; continue; }
    const geometry = { type: 'Point' as const, coordinates: proj.toLngLat(xy) };
    if (computeConflicts({ geometry, speciesId: sp.id }, site, buildings, sp).length) { skipped++; continue; }
    items.push({ id: newId(), speciesId: sp.id, kind: 'point', geometry, quantity: 1, origin: 'suggested', conflicts: [] });
  }
  return { items, skipped };
}
