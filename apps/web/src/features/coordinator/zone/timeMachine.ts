// «Машина времени» зоны: схема посадки из расчёта (analyzeZone) раскладывается по контуру и растёт
// на основной карте через 5, 10 и 20 лет. Рост — те же доли, что в расчёте экоэффекта (plan.ts ecoEffect),
// выпавшие растения убираются по прогнозу приживаемости за 3 года. Это иллюстрация расчёта, не проект посадки.
import { useSyncExternalStore } from 'react';
import type { CandidateSite, ProjectItem, Species } from '../../../shared/api/types';
import type { ZoneAnalysis } from '../../../shared/analytics/plan';
import { bboxXY, circleRing, makeProjection, pointInRing, ringAreaXY, type XY } from '../../../shared/geo';

export type GrowthYear = 0 | 5 | 10 | 20;
export const GROWTH_YEARS: GrowthYear[] = [0, 5, 10, 20];
export const YEAR_LABEL: Record<GrowthYear, string> = { 0: 'Посадка', 5: '5 лет', 10: '10 лет', 20: '20 лет' };
/** Доля роста к году — как в ecoEffect; площадь кроны ∝ min(1, g + 0.1), поэтому радиус — корень из неё. */
const GROWTH = { 5: 0.3, 10: 0.6, 20: 1 } as const;
const PLANTING = { h: 0.15, crown: 0.25 };
export const growthK = (year: GrowthYear) => (year === 0 ? PLANTING : { h: GROWTH[year], crown: Math.sqrt(Math.min(1, GROWTH[year] + 0.1)) });

// Больше моделей браузер на слабом ноутбуке не потянет; остальное — в подписи «показано N из M».
const MAX_TREES = 120;
const MAX_SHRUBS = 220;

interface GrowthItem { item: ProjectItem; survives: number }
export interface GrowthScene {
  siteId: string;
  origin: { lat: number; lng: number };
  ring: [number, number][] | null;
  species: Map<string, Species>;
  items: GrowthItem[];
  shown: number;
  total: number;
}

/** Детерминированный «случай» по строке — раскладка и выпады не меняются между перерисовками. */
function rand(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}
// Узлы обходятся в «разбросанном» порядке (золотое сечение): при нехватке мест посадки распределены по всей зоне.
const spread = <T,>(arr: T[]) => arr.map((v, i) => ({ v, k: (i * 0.6180339887) % 1 })).sort((a, b) => a.k - b.k).map((x) => x.v);

function grid(ring: XY[], step: number, offset = 0): XY[] {
  const b = bboxXY(ring);
  const out: XY[] = [];
  for (let y = b.minY + step / 2 + offset; y < b.maxY; y += step)
    for (let x = b.minX + step / 2 + offset; x < b.maxX; x += step) if (pointInRing([x, y], ring)) out.push([x, y]);
  return out;
}

export function buildGrowthScene(site: CandidateSite, a: ZoneAnalysis, species: Map<string, Species>): GrowthScene | null {
  if (site.geometry.type !== 'Polygon' || !site.centroid) return null;
  const proj = makeProjection(site.centroid);
  const ring = site.geometry.coordinates[0].map(proj.toXY);
  const survival = new Map(a.survival.map((s) => [s.speciesId, s.y3 / 100]));
  const items: GrowthItem[] = [];
  const point = (speciesId: string, xy: XY, i: number): GrowthItem => {
    const id = `${site.id}:${speciesId}:${i}`;
    return { item: { id, speciesId, kind: 'point', geometry: { type: 'Point', coordinates: proj.toLngLat(xy) }, quantity: 1, origin: 'suggested', conflicts: [] }, survives: rand(id) < (survival.get(speciesId) ?? 0.8) ? 1 : 0 };
  };
  const rows = (tier: 'tree' | 'shrub' | 'flower') => a.scheme.filter((r) => r.tier === tier && r.quantity > 0);
  const crown = (tier: 'tree' | 'shrub') => {
    const list = rows(tier).map((r) => species.get(r.speciesId)?.crownDiameterM ?? (tier === 'tree' ? 4 : 1.2));
    return list.length ? list.reduce((x, y) => x + y, 0) / list.length : 0;
  };
  // Деревья — по сетке с шагом в среднюю крону; виды чередуются, а не стоят блоками.
  const queue = (tier: 'tree' | 'shrub', max: number) => {
    const out: string[] = [];
    const left = rows(tier).map((r) => ({ id: r.speciesId, n: r.quantity }));
    while (out.length < max && left.some((x) => x.n > 0)) for (const x of left) if (x.n > 0 && out.length < max) { out.push(x.id); x.n--; }
    return out;
  };
  const treeNodes = spread(grid(ring, Math.max(4, crown('tree') + 1)));
  const trees = queue('tree', Math.min(MAX_TREES, treeNodes.length));
  trees.forEach((sp, i) => items.push(point(sp, treeNodes[i]!, i)));
  const taken = treeNodes.slice(0, trees.length);
  const clear = Math.max(1, crown('tree') / 2 + 0.4);
  const shrubStep = Math.max(1.6, crown('shrub') * 0.9 + 0.4);
  const shrubNodes = spread(grid(ring, shrubStep, shrubStep / 3).filter(([x, y]) => !taken.some(([tx, ty]) => Math.hypot(x - tx, y - ty) < clear)));
  const shrubs = queue('shrub', Math.min(MAX_SHRUBS, shrubNodes.length));
  shrubs.forEach((sp, i) => items.push(point(sp, shrubNodes[i]!, 10000 + i)));
  // Цветы — одна клумба у центра: 9 растений на м², не больше 15% площади зоны.
  const flowers = rows('flower');
  const flowerQty = flowers.reduce((n, r) => n + r.quantity, 0);
  if (flowerQty > 0) {
    const area = Math.min(flowerQty / 9, ringAreaXY([...ring]) * 0.15);
    const c: XY = pointInRing([0, 0], ring) ? [0, 0] : (shrubNodes[shrubs.length] ?? treeNodes[trees.length] ?? [0, 0]);
    const bedRing = circleRing(c, Math.max(0.8, Math.sqrt(area / Math.PI)), 18).map(proj.toLngLat);
    items.push({ item: { id: `${site.id}:bed`, speciesId: flowers[0]!.speciesId, kind: 'bed', geometry: { type: 'Polygon', coordinates: [bedRing] }, quantity: flowerQty, origin: 'suggested', conflicts: [] }, survives: 1 });
  }
  const total = rows('tree').reduce((n, r) => n + r.quantity, 0) + rows('shrub').reduce((n, r) => n + r.quantity, 0);
  return { siteId: site.id, origin: site.centroid, ring: site.geometry.coordinates[0], species, items, shown: trees.length + shrubs.length, total };
}

/** Растения на карте в выбранный год: при посадке — все, дальше — только прижившиеся. */
export function growthFrame(scene: GrowthScene, year: GrowthYear) {
  const items = scene.items.filter((x) => year === 0 || x.survives).map((x) => x.item);
  return { origin: scene.origin, ring: scene.ring, items, species: scene.species, k: growthK(year), key: `${scene.siteId}:${year}` };
}
export type GrowthFrame = ReturnType<typeof growthFrame>;

// Общее состояние карточки зоны и карты: машину времени включают во вкладке «Эффект», а растёт она на основной карте.
let state: { scene: GrowthScene | null; year: GrowthYear } = { scene: null, year: 10 };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const timeMachine = {
  show(scene: GrowthScene | null, year: GrowthYear) { state = { scene, year }; emit(); },
  setYear(year: GrowthYear) { state = { ...state, year }; emit(); },
  hide() { if (state.scene) { state = { ...state, scene: null }; emit(); } },
};
export function useTimeMachine() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);
}
