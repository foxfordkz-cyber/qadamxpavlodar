// «Машина времени» зоны: схема посадки из расчёта (analyzeZone) раскладывается по контуру и растёт
// на основной карте через 5, 10 и 20 лет. Рост — те же доли, что в расчёте экоэффекта (plan.ts ecoEffect),
// выпавшие растения убираются по прогнозу приживаемости за 3 года. Это иллюстрация расчёта, не проект посадки.
import { useSyncExternalStore } from 'react';
import type { Key } from '../../../shared/i18n';
import type { CandidateSite, ProjectItem, Species } from '../../../shared/api/types';
import type { ZoneAnalysis } from '../../../shared/analytics/plan';
import { distPointLine, longAxis, makeProjection, pointInRing, type XY } from '../../../shared/geo';

export type GrowthYear = 0 | 5 | 10 | 20;
export const GROWTH_YEARS: GrowthYear[] = [0, 5, 10, 20];
// Keys are resolved at render time, including after a language switch.
export const YEAR_LABEL: Record<GrowthYear, Key> = { 0: 'timeMachine.year0', 5: 'timeMachine.year5', 10: 'timeMachine.year10', 20: 'timeMachine.year20' };
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

/** Край зоны вдоль улицы: длинная сторона контура (по длинной оси), обращённая к ближайшей дороге из окружения.
 *  u — вдоль улицы, n — внутрь зоны; edgeT(s) — где на отметке s начинается газон (контур OSM неровный). */
interface StreetEdge { a: XY; u: XY; n: XY; len: number; edgeT: (s: number) => number | null }
function streetEdge(ring: XY[], roads: XY[][]): StreetEdge {
  const u = longAxis(ring);
  const v: XY = [-u[1], u[0]];
  const st = ring.map(([x, y]) => [x * u[0] + y * u[1], x * v[0] + y * v[1]] as XY);
  const [s0, s1] = [Math.min(...st.map((p) => p[0])), Math.max(...st.map((p) => p[0]))];
  const [t0, t1] = [Math.min(...st.map((p) => p[1])), Math.max(...st.map((p) => p[1]))];
  const xy = (s: number, t: number): XY => [u[0] * s + v[0] * t, u[1] * s + v[1] * t];
  // Какая из двух длинных сторон ближе к дорогам; без дорог — та, что ниже по t (любая, но устойчиво).
  const side = (t: number) => {
    if (!roads.length) return 0;
    let sum = 0;
    for (let k = 1; k < 10; k++) sum += Math.min(...roads.map((r) => distPointLine(xy(s0 + ((s1 - s0) * k) / 10, t), r)));
    return sum;
  };
  const low = side(t0) <= side(t1);
  const n: XY = low ? v : [-v[0], -v[1]];
  const a = xy(s0, low ? t0 : t1);
  const at0 = (s: number, t: number): XY => [a[0] + u[0] * s + n[0] * t, a[1] + u[1] * s + n[1] * t];
  const edgeT = (s: number) => {
    for (let t = 0; t <= Math.min(12, t1 - t0); t += 0.25) if (pointInRing(at0(s, t), ring)) return t;
    return null;
  };
  return { a, u, n, len: s1 - s0, edgeT };
}
const at = (e: StreetEdge, s: number, t: number): XY => [e.a[0] + e.u[0] * s + e.n[0] * t, e.a[1] + e.u[1] * s + e.n[1] * t];
const along = (e: StreetEdge, [x, y]: XY): XY => [(x - e.a[0]) * e.u[0] + (y - e.a[1]) * e.u[1], (x - e.a[0]) * e.n[0] + (y - e.a[1]) * e.n[1]];

/** Узлы посадки рядами параллельно улице, не ближе minT к краю газона. */
function grid(ring: XY[], step: number, e: StreetEdge, minT: number, shift = 0): XY[] {
  const t1 = Math.max(...ring.map((p) => along(e, p)[1]));
  const out: XY[] = [];
  for (let row = 0, t = step / 2; t < t1; t += step, row++)
    for (let s = step / 2 + (row % 2 ? step / 2 : 0) + shift; s < e.len; s += step) {
      const p = at(e, s, t);
      const edge = e.edgeT(s);
      if (edge !== null && t >= edge + minT && pointInRing(p, ring)) out.push(p);
    }
  return out;
}

export function buildGrowthScene(site: CandidateSite, a: ZoneAnalysis, species: Map<string, Species>, roads: [number, number][][] = []): GrowthScene | null {
  if (site.geometry.type !== 'Polygon' || !site.centroid) return null;
  const proj = makeProjection(site.centroid);
  const ring = site.geometry.coordinates[0].map(proj.toXY);
  const edge = streetEdge(ring, roads.map((r) => r.map(proj.toXY)));
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
  // Виды чередуются в ряду, а не стоят блоками.
  const queue = (tier: 'tree' | 'shrub', max: number) => {
    const out: string[] = [];
    const left = rows(tier).map((r) => ({ id: r.speciesId, n: r.quantity }));
    while (out.length < max && left.some((x) => x.n > 0)) for (const x of left) if (x.n > 0 && out.length < max) { out.push(x.id); x.n--; }
    return out;
  };
  // Цветы — ровный бордюр вдоль улицы: отступ 0,7 м от края, ширина 1 м, длина — по числу растений.
  const flowers = rows('flower');
  const flowerQty = flowers.reduce((n, r) => n + r.quantity, 0);
  const INSET = 0.7;
  const WIDTH = 1;
  const border = flowerQty > 0 ? INSET + WIDTH : 0;
  if (flowerQty > 0) {
    // Каждый вид — свой отрезок бордюра подряд вдоль улицы; длина отрезка — по числу растений и шагу посадки.
    const parts = flowers.map((r) => {
      const sp = species.get(r.speciesId);
      const step = Math.max(0.2, sp?.spacingM ?? sp?.crownDiameterM ?? 0.35);
      return { r, need: (r.quantity * step * step) / WIDTH };
    });
    const GAP = 0.3;
    // Где вдоль улицы есть газон: отрезок, на котором край найден на всём протяжении.
    const STEP = 2;
    const runs: [number, number][] = [];
    for (let sv = 1; sv <= edge.len - 1; sv += STEP) {
      const ok = edge.edgeT(sv) !== null;
      const last = runs[runs.length - 1];
      if (ok && last && last[1] === sv - STEP) last[1] = sv; else if (ok) runs.push([sv, sv]);
    }
    const run = runs.sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
    if (run && run[1] - run[0] >= 3) {
      const avail = run[1] - run[0] - GAP * (parts.length - 1);
      const need = parts.reduce((n, x) => n + x.need, 0);
      const k = Math.min(1, avail / need);
      let from = run[0] + (avail - Math.min(avail, need)) / 2;
      // Полоса повторяет край газона: точки через 2 м по реальной границе, отступ INSET, ширина WIDTH.
      const strip = (a0: number, b0: number) => {
        const ss: number[] = [];
        for (let sv = a0; sv < b0; sv += STEP) ss.push(sv);
        ss.push(b0);
        const inner = ss.map((sv) => at(edge, sv, (edge.edgeT(sv) ?? 0) + INSET));
        const outer = ss.map((sv) => at(edge, sv, (edge.edgeT(sv) ?? 0) + INSET + WIDTH)).reverse();
        return [...inner, ...outer, inner[0]!];
      };
      parts.forEach(({ r, need: len0 }, i) => {
        const to = Math.min(run[1], from + Math.max(0.8, len0 * k));
        if (to - from < 0.5) return;
        items.push({ item: { id: `${site.id}:border:${i}`, speciesId: r.speciesId, kind: 'bed', geometry: { type: 'Polygon', coordinates: [strip(from, to).map(proj.toLngLat)] }, quantity: r.quantity, origin: 'suggested', conflicts: [] }, survives: 1 });
        from = to + GAP;
      });
    }
  }
  // Деревья — ряды вдоль улицы с шагом в среднюю крону, за бордюром; кусты — между ними, тоже рядами.
  const treeStep = Math.max(4, crown('tree') + 1);
  const treeNodes = spread(grid(ring, treeStep, edge, border + 0.5));
  const trees = queue('tree', Math.min(MAX_TREES, treeNodes.length));
  trees.forEach((sp, i) => items.push(point(sp, treeNodes[i]!, i)));
  const taken = treeNodes.slice(0, trees.length);
  const clear = Math.max(1, crown('tree') / 2 + 0.4);
  const shrubStep = Math.max(1.6, crown('shrub') * 0.9 + 0.4);
  const shrubNodes = spread(grid(ring, shrubStep, edge, border + 0.3, shrubStep / 3).filter(([x, y]) => !taken.some(([tx, ty]) => Math.hypot(x - tx, y - ty) < clear)));
  const shrubs = queue('shrub', Math.min(MAX_SHRUBS, shrubNodes.length));
  shrubs.forEach((sp, i) => items.push(point(sp, shrubNodes[i]!, 10000 + i)));
  const total = rows('tree').reduce((n, r) => n + r.quantity, 0) + rows('shrub').reduce((n, r) => n + r.quantity, 0);
  return { siteId: site.id, origin: site.centroid, ring: site.geometry.coordinates[0], species, items, shown: trees.length + shrubs.length, total };
}

const STREET = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)(_link)?$/;
/** Улицы рядом с зоной: ряды и бордюр цветов выстраиваются вдоль ближайшей. Тротуары и проезды
 *  к домам вплотную к газону не в счёт — иначе бордюр уходит к подъездам, а не к улице. */
export function streetLines(all: { kind: string; geometry: { coordinates: [number, number][] } }[]) {
  const streets = all.filter((r) => STREET.test(r.kind));
  return (streets.length ? streets : all).map((r) => r.geometry.coordinates);
}

/** Растения на карте в выбранный год: при посадке — все, дальше — только прижившиеся. */
export function growthFrame(scene: GrowthScene, year: GrowthYear) {
  const items = scene.items.filter((x) => year === 0 || x.survives).map((x) => x.item);
  return { origin: scene.origin, ring: scene.ring, items, species: scene.species, k: growthK(year), key: `${scene.siteId}:${year}` };
}
export type GrowthFrame = ReturnType<typeof growthFrame>;

// Общее состояние карточки зоны и карты: машину времени включают во вкладке «Эффект», а растёт она на основной карте.
let state: { scene: GrowthScene | null; year: GrowthYear; playing: boolean } = { scene: null, year: 10, playing: false };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
// Показ роста: посадка → 5 → 10 → 20 лет. Первый шаг ждёт, пока камера долетит до зоны.
const PLAY_STEP_MS = 1900;
const PLAY_FLIGHT_MS = 1500;
let playTimer: ReturnType<typeof setTimeout> | null = null;
const stopTimer = () => { if (playTimer) clearTimeout(playTimer); playTimer = null; };
export const timeMachine = {
  show(scene: GrowthScene | null, year: GrowthYear) { stopTimer(); state = { scene, year, playing: false }; emit(); },
  setYear(year: GrowthYear) { stopTimer(); state = { ...state, year, playing: false }; emit(); },
  hide() { stopTimer(); if (state.scene || state.playing) { state = { ...state, scene: null, playing: false }; emit(); } },
  play(scene: GrowthScene) {
    stopTimer();
    const flying = state.scene !== scene;
    state = { scene, year: 0, playing: true };
    emit();
    const next = (i: number) => {
      playTimer = setTimeout(() => {
        const year = GROWTH_YEARS[i]!;
        const last = i === GROWTH_YEARS.length - 1;
        playTimer = null;
        state = { ...state, year, playing: !last };
        emit();
        if (!last) next(i + 1);
      }, PLAY_STEP_MS + (i === 1 && flying ? PLAY_FLIGHT_MS : 0));
    };
    next(1);
  },
  current: () => state,
  stop() { stopTimer(); if (state.playing) { state = { ...state, playing: false }; emit(); } },
};
export function useTimeMachine() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);
}
