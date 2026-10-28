// Процедурные 3D-макеты растений из ярусов fill-extrusion (без внешних моделей).
// Форма — условность по типу вида: хвойное — ярусный конус, лиственное — округлая крона,
// кустарник — низкий округлый объём, клумба — слой цветов. Размеры — из справочника.
import type { Species } from '../../../shared/api/types';
import { circleRing, makeProjection, type XY } from '../../../shared/geo';

export type Stage = 'planting' | 'five' | 'mature';
/** Доля взрослых размеров на стадии — условность визуализации, не прогноз роста. */
export const STAGE_K: Record<Stage, { h: number; crown: number }> = { planting: { h: 0.15, crown: 0.25 }, five: { h: 0.5, crown: 0.6 }, mature: { h: 1, crown: 1 } };

type Proj = ReturnType<typeof makeProjection>;
export interface Part {
  type: 'Feature';
  properties: { height: number; base: number; color: string };
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
}

const FLOWER_COLOR: Record<string, string> = {
  'sp-tagetes': '#e69a1f', 'sp-hemerocallis': '#e07a2c', 'sp-iris-sibirica': '#6c5bb5', 'sp-echinacea': '#c75a8c',
  'sp-sedum-spectabile': '#d77fa6', 'sp-salvia-nemorosa': '#7a5fc0', 'sp-petunia': '#c2408f',
};
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join('')}`;
};
const ring = (proj: Proj, c: XY, r: number, n = 12) => [circleRing(c, Math.max(0.08, r), n).map(proj.toLngLat)];
const part = (proj: Proj, c: XY, r: number, base: number, height: number, color: string, n = 12): Part => ({
  type: 'Feature', properties: { base, height: Math.max(base + 0.05, height), color }, geometry: { type: 'Polygon', coordinates: ring(proj, c, r, n) },
});

export function plantParts(proj: Proj, c: XY, sp: Species | undefined, stage: Stage): Part[] {
  const k = STAGE_K[stage];
  const hMax = sp?.matureHeightM ? (sp.matureHeightM[0] + sp.matureHeightM[1]) / 2 : 2;
  const H = Math.max(0.4, hMax * k.h);
  const R = Math.max(0.25, ((sp?.crownDiameterM ?? 1.5) / 2) * k.crown);
  const out: Part[] = [];
  if (sp?.form === 'tree') {
    out.push(part(proj, c, Math.max(0.1, R * 0.09), 0, H * (sp.evergreen ? 0.25 : 0.42), '#6b5236', 8));
    if (sp.evergreen) {
      // Хвойное: 6 ярусов, радиус убывает к вершине.
      const tiers = 6;
      const base = H * 0.18;
      for (let i = 0; i < tiers; i++) {
        const z0 = base + ((H - base) * i) / tiers;
        const z1 = base + ((H - base) * (i + 1.25)) / tiers;
        out.push(part(proj, c, R * (1 - i / tiers) * 0.95 + 0.1, z0, Math.min(H, z1), shade('#2f5a32', 0.85 + i * 0.05)));
      }
    } else {
      // Лиственное: округлая крона из 6 ярусов по профилю окружности.
      const tiers = 6;
      const cb = H * 0.38;
      const half = (H - cb) / 2;
      for (let i = 0; i < tiers; i++) {
        const z0 = cb + ((H - cb) * i) / tiers;
        const z1 = cb + ((H - cb) * (i + 1)) / tiers;
        const mid = (z0 + z1) / 2 - (cb + half);
        const rr = R * Math.sqrt(Math.max(0.12, 1 - (mid / half) ** 2));
        out.push(part(proj, c, rr, z0, z1, shade('#5f8a33', 0.85 + i * 0.05)));
      }
    }
  } else if (sp?.form === 'shrub') {
    const tiers = 3;
    for (let i = 0; i < tiers; i++) {
      const z0 = (H * i) / tiers;
      const rr = R * (i === 1 ? 1 : 0.8);
      out.push(part(proj, c, rr, z0, (H * (i + 1)) / tiers, shade('#7c9c3a', 0.9 + i * 0.07)));
    }
  } else {
    out.push(part(proj, c, R, 0, Math.max(0.15, H), FLOWER_COLOR[sp?.id ?? ''] ?? '#c0688a', 8));
  }
  return out;
}

/** Клумба: зелёное основание и цветной слой цветения поверх. */
export function bedParts(ringLngLat: [number, number][], sp: Species | undefined, stage: Stage): Part[] {
  const hMax = sp?.matureHeightM ? (sp.matureHeightM[0] + sp.matureHeightM[1]) / 2 : 0.4;
  const h = Math.max(0.12, hMax * STAGE_K[stage].h);
  const color = FLOWER_COLOR[sp?.id ?? ''] ?? (sp?.form === 'shrub' ? '#7c9c3a' : '#c0688a');
  return [
    { type: 'Feature', properties: { base: 0, height: h * 0.6, color: '#6f8f3a' }, geometry: { type: 'Polygon', coordinates: [ringLngLat] } },
    { type: 'Feature', properties: { base: h * 0.6, height: h, color }, geometry: { type: 'Polygon', coordinates: [ringLngLat] } },
  ];
}
