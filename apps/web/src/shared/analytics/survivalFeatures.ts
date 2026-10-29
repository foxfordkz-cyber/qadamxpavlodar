import type { Species } from '../api/types';
import type { Salinity } from './zone';

export interface SurvivalConditions {
  salinity: Salinity | null;
  ph: number | null;
  waterKnown: boolean;
  watering: 'regular' | 'rare' | 'none';
  roadM: number | null;
  variant: 'econom' | 'optimal' | 'max';
  improveSoil: boolean;
}

// Stable order is part of the persisted model contract. No species ID/name is a feature.
export const SURVIVAL_FEATURES = [
  'intercept', 'shrub', 'flower', 'frostMedium', 'frostLow', 'droughtVulnerability',
  'saltVulnerability', 'salinity', 'saltDeficit', 'rareWatering', 'noWatering',
  'droughtRare', 'droughtNone', 'waterUnknown', 'unknownWaterVulnerable',
  'nearRoadSensitive', 'roadUnknown', 'alkalineSensitive', 'phUnknown',
  'largeTree', 'soilImproved', 'saltWithoutWater', 'salinityWaterStress', 'salinityUnknown',
] as const;
export type SurvivalFeature = typeof SURVIVAL_FEATURES[number];
const level = { low: 0, medium: 1, high: 2 };
const salinity = { none: 0, low: 1, medium: 2, high: 3 };

export function survivalFeatures(sp: Species, c: SurvivalConditions): number[] {
  const drought = (2 - level[sp.droughtTolerance]) / 2;
  const salt = (2 - level[sp.saltTolerance]) / 2;
  const sal = c.salinity === null ? 0 : salinity[c.salinity];
  const deficit = Math.max(0, sal - (c.improveSoil ? 1 : 0) - [0, 2, 3][level[sp.saltTolerance]]) / 3;
  const rare = Number(c.watering === 'rare'), none = Number(c.watering === 'none');
  const unknownWater = Number(!c.waterKnown);
  const values: Record<SurvivalFeature, number> = {
    intercept: 1, shrub: Number(sp.form === 'shrub'), flower: Number(sp.form === 'flower'),
    frostMedium: Number(sp.frostHardiness === 'medium'),
    frostLow: Number(sp.frostHardiness === 'low' && sp.form !== 'flower'),
    droughtVulnerability: drought, saltVulnerability: salt, salinity: sal / 3,
    saltDeficit: deficit, rareWatering: rare, noWatering: none,
    droughtRare: drought * rare, droughtNone: drought * none,
    waterUnknown: unknownWater, unknownWaterVulnerable: unknownWater * drought,
    nearRoadSensitive: Number(c.roadM !== null && c.roadM < 40 && sp.saltTolerance === 'low'),
    roadUnknown: Number(c.roadM === null),
    alkalineSensitive: c.ph === null ? 0 : Math.max(0, c.ph - 8.2) * Number(sp.form === 'tree' && (sp.evergreen || sp.saltTolerance === 'low')),
    phUnknown: Number(c.ph === null), largeTree: Number(c.variant === 'max' && sp.form === 'tree'),
    soilImproved: Number(c.improveSoil), saltWithoutWater: deficit * (none + rare * 0.5),
    salinityWaterStress: sal / 3 * (none + rare * 0.5),
    salinityUnknown: Number(c.salinity === null),
  };
  return SURVIVAL_FEATURES.map(k => values[k]);
}
