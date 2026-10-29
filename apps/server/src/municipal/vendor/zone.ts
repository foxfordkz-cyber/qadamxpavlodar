// @ts-nocheck
// Team rules snapshot: coordinator 8456529; no LLM or calibrated prediction.
// Факты о зоне для расчётов: почва, назначение, нагрузка. Почвы — синтетический слой
// до получения карты почв организатора (ТЗ 5.1: синтетика с обязательной пометкой).
import type { CandidateSite } from './types.js';

export type SoilType = 'каштановая' | 'супесчаная' | 'суглинистая' | 'чернозём южный' | 'солонцеватая';
export type Salinity = 'none' | 'low' | 'medium' | 'high';
export type Purpose = 'park' | 'square' | 'yard' | 'street' | 'sanitary' | 'school';

export interface SoilInfo {
  cellId: string;
  type: SoilType;
  ph: number;
  salinity: Salinity;
  moisture: 'низкая' | 'средняя' | 'высокая';
  fertility: 'низкое' | 'среднее' | 'высокое';
  synthetic: true;
}

export const PURPOSE_LABEL: Record<Purpose, string> = { park: 'Парк', square: 'Сквер', yard: 'Двор', street: 'Улица', sanitary: 'Санитарно-защитная полоса', school: 'Школьная территория' };
export const SALINITY_LABEL: Record<Salinity, string> = { none: 'нет', low: 'слабое', medium: 'среднее', high: 'сильное' };

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** Ячейки синтетической карты почв 400×400 м. Детерминированы: одна ячейка — одни значения. */
export const SOIL_CELL_DEG = { lat: 0.0036, lng: 0.0059 };
export function soilCellId(lat: number, lng: number) {
  return `soil-${Math.floor(lat / SOIL_CELL_DEG.lat)}-${Math.floor(lng / SOIL_CELL_DEG.lng)}`;
}
export function soilForCell(cellId: string): SoilInfo {
  const r = (k: string) => hash(cellId + k);
  const types: SoilType[] = ['каштановая', 'супесчаная', 'суглинистая', 'чернозём южный', 'солонцеватая'];
  const type = types[Math.floor(r('t') * types.length)];
  const sr = r('s') + (type === 'солонцеватая' ? 0.35 : 0);
  const salinity: Salinity = sr > 1.05 ? 'high' : sr > 0.8 ? 'medium' : sr > 0.55 ? 'low' : 'none';
  const ph = Math.round((7 + r('p') * 1.5 + (salinity === 'high' ? 0.4 : 0)) * 10) / 10;
  const moisture = (['низкая', 'средняя', 'высокая'] as const)[Math.floor(r('m') * 2.6)];
  const fertility = type === 'чернозём южный' ? 'высокое' : type === 'супесчаная' ? 'низкое' : 'среднее';
  return { cellId, type, ph, salinity, moisture, fertility, synthetic: true };
}
export const soilFor = (lat: number, lng: number) => soilForCell(soilCellId(lat, lng));

/** Назначение по окружению из OSM; специалист может поменять в панели зоны. */
export function guessPurpose(site: CandidateSite): Purpose {
  const social = site.context?.socialWithin400m ?? [];
  const road = site.context?.nearestMajorRoadM ?? null;
  const area = site.areaM2 ?? 0;
  if (social.some((s) => /школа|детсад/.test(s)) && (site.context?.distanceToGreenM ?? 999) > 50) return 'school';
  if (road !== null && road < 40) return 'street';
  if (area > 8000) return 'park';
  if (area > 2500) return 'square';
  return 'yard';
}

/** Освещённость: оценка по числу зданий рядом (тень от застройки). Это прокси, не расчёт инсоляции. */
export function lightLevel(site: CandidateSite, buildings200: number): 'солнце' | 'полутень' | 'тень' {
  if (buildings200 > 40 && (site.areaM2 ?? 0) < 1500) return 'тень';
  if (buildings200 > 20) return 'полутень';
  return 'солнце';
}
