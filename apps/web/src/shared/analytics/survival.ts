import raw from './survivalModel.json';
import { probability, sigmoid } from './logistic';
import { SURVIVAL_FEATURES, survivalFeatures, type SurvivalConditions } from './survivalFeatures';
import type { Species } from '../api/types';
import { ru } from '../i18n/ru';

if (JSON.stringify(raw.features) !== JSON.stringify(SURVIVAL_FEATURES) || raw.coefficients.length !== SURVIVAL_FEATURES.length || !raw.coefficients.every(Number.isFinite)) {
  throw new Error('Survival model schema mismatch; run train:survival');
}
export const survivalModel = {
  method: 'logistic-regression' as const, trainedOn: 'synthetic' as const,
  version: raw.version, rocAuc: raw.rocAuc, brier: raw.brier, n: raw.n, validationN: raw.validationN,
};

export function predictSurvival(sp: Species, conditions: SurvivalConditions) {
  const x = survivalFeatures(sp, conditions), p = probability(x, raw.coefficients);
  // Ordered additive decomposition in probability space. Sums to p minus intercept probability;
  // attribution depends on the documented feature order and is not a causal treatment effect.
  let z = raw.coefficients[0];
  const risks: { label: string; pp: number }[] = [];
  for (let i = 1; i < x.length; i++) {
    const next = z + x[i] * raw.coefficients[i], pp = 100 * (sigmoid(next) - sigmoid(z));
    if (Math.abs(pp) >= 0.05) risks.push({ label: ru[`survival.feature.${SURVIVAL_FEATURES[i]}` as keyof typeof ru] ?? SURVIVAL_FEATURES[i], pp: Math.round(pp * 10) / 10 });
    z = next;
  }
  const spread = raw.residualRmse * 100;
  const y1 = Math.round(p * 100);
  return { y1, low: Math.max(0, Math.round(p * 100 - spread)), high: Math.min(100, Math.round(p * 100 + spread)), risks };
}
