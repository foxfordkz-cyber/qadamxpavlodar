import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { species } from '../src/shared/api/mock/species';
import { DEFAULT_RATES, ratesMap } from '../src/shared/analytics/rates';
import { SALT_RISK_FEATURES, SURVIVAL_FEATURES } from '../src/shared/analytics/survivalFeatures';
import { SEED, train } from './survival-training';

import { readLiterature } from './survival-literature';
const bases = readLiterature(species);
const base = ratesMap(DEFAULT_RATES)['surv.base'];
if (base == null) throw new Error('Нет базовой доли surv.base; обучение остановлено');
const result = train(species, base, bases);
const model = {
  version: 'survival-logistic-v2', trainedAt: process.env.SURVIVAL_TRAINED_AT ?? new Date().toISOString(), seed: SEED,
  method: 'logistic-regression', trainedOn: 'synthetic', features: [...SURVIVAL_FEATURES], ...result,
  basePct: base, baselineSource: bases.size ? 'fixtures/pavlodar/survival-literature.csv + rates[surv.base] fallback' : 'rates[surv.base]',
  literatureSpecies: bases.size, split: 'seeded shuffle, first 80% train, remaining 20% holdout',
  nonpositiveFeatures: SALT_RISK_FEATURES,
  intervalMethod: 'calibration-bin probability envelope: radius=max(abs(mean prediction - Wilson95 lower), abs(Wilson95 upper - mean prediction)); empty bin=[0,1]; not individual 95% coverage',
};
if (model.rocAuc === null) throw new Error('Validation requires both outcome classes');
writeFileSync(resolve('src/shared/analytics/survivalModel.json'), JSON.stringify(model, null, 2) + '\n');
console.log(JSON.stringify({ n: result.n, validationN: result.validationN, rocAuc: result.rocAuc, brier: result.brier, baselineSource: model.baselineSource }));
