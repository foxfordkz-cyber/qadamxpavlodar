import type { Species } from '../src/shared/api/types';
import { SALT_RISK_FEATURES, SURVIVAL_FEATURES, survivalFeatures, type SurvivalConditions } from '../src/shared/analytics/survivalFeatures';
import { evaluate, fitLogistic, type TrainingRow } from '../src/shared/analytics/logistic';

export const SEED = 20261029;
export function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export interface SyntheticRow extends TrainingRow { conditions: SurvivalConditions; trueProbability: number }

/** Expert pp penalties plus interactions and latent noise; deliberately not logistic inference. */
export function syntheticRows(catalog: Species[], base: number, bases = new Map<string, number>(), seed = SEED): SyntheticRow[] {
  const rng = random(seed), choose = <T,>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const rows: SyntheticRow[] = [];
  for (const template of [...catalog].sort((a, b) => a.id.localeCompare(b.id))) {
    for (let i = 0; i < 240; i++) {
      // Synthetic stress augmentation, not a change to botanical catalog facts.
      const sp: Species = i % 12 === 0 && template.form !== 'flower' ? { ...template, frostHardiness: 'low' } : template;
      const actualSalinity = choose(['none', 'low', 'medium', 'high'] as const);
      const c: SurvivalConditions = {
        salinity: rng() < 0.08 ? null : actualSalinity, ph: rng() < 0.08 ? null : 6.2 + rng() * 2.8,
        waterKnown: rng() < 0.5, watering: choose(['regular', 'rare', 'none'] as const),
        roadM: rng() < 0.1 ? null : rng() * 160, variant: choose(['econom', 'optimal', 'max'] as const), improveSoil: rng() < 0.5,
      };
      // Hidden salinity still affects the outcome when its measurement is missing from x.
      const sal = { none: 0, low: 1, medium: 2, high: 3 }[actualSalinity];
      const deficit = Math.max(0, sal - Number(c.improveSoil) - { low: 0, medium: 2, high: 3 }[sp.saltTolerance]);
      let pp = (bases.get(sp.id) ?? base) - 8 * deficit;
      if (c.watering === 'none') pp -= { high: 6, medium: 14, low: 25 }[sp.droughtTolerance];
      if (c.watering === 'rare') pp -= { high: 2, medium: 6, low: 12 }[sp.droughtTolerance];
      if (!c.waterKnown && sp.droughtTolerance !== 'high') pp -= 3;
      if (sp.frostHardiness === 'medium') pp -= 6;
      if (sp.frostHardiness === 'low' && sp.form !== 'flower') pp -= 18;
      if (c.roadM !== null && c.roadM < 40 && sp.saltTolerance === 'low') pp -= 7;
      if (c.ph !== null && c.ph > 8.2 && sp.form === 'tree' && (sp.evergreen || sp.saltTolerance === 'low')) pp -= 5 * (c.ph - 8.2);
      if (c.variant === 'max' && sp.form === 'tree') pp -= 2;
      // Additional expert interactions: combined salt/water stress is stronger than their sum.
      if (c.watering === 'none') pp -= 6 * deficit;
      if (c.watering === 'rare') pp -= 3 * deficit;
      // Salt-tolerant plants also face water stress in saline soil: an explicit synthetic assumption.
      pp -= 20 * sal / 3 * (c.watering === 'none' ? 1 : c.watering === 'rare' ? 0.5 : 0);
      pp += (rng() + rng() + rng() - 1.5) * 6;
      const trueProbability = Math.max(0.03, Math.min(0.98, pp / 100));
      rows.push({ x: survivalFeatures(sp, c), y: rng() < trueProbability ? 1 : 0, trueProbability, conditions: c });
    }
  }
  // Shuffle before splitting; no row is used in both sets.
  for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  return rows;
}

export function train(catalog: Species[], base: number, bases = new Map<string, number>(), seed = SEED) {
  const rows = syntheticRows(catalog, base, bases, seed), split = Math.floor(rows.length * 0.8);
  const training = rows.slice(0, split), validation = rows.slice(split);
  const coefficients = fitLogistic(training, 600, 0.035, 0.0002, SALT_RISK_FEATURES.map(f => SURVIVAL_FEATURES.indexOf(f)));
  return { coefficients, n: rows.length, trainingN: training.length, validationN: validation.length, ...evaluate(validation, coefficients) };
}
