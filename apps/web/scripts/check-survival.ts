import assert from 'node:assert/strict';
import model from '../src/shared/analytics/survivalModel.json';
import { species } from '../src/shared/api/mock/species';
import { evaluate, rocAuc } from '../src/shared/analytics/logistic';
import { predictSurvival } from '../src/shared/analytics/survival';
import { SURVIVAL_FEATURES, survivalFeatures, type SurvivalConditions } from '../src/shared/analytics/survivalFeatures';
import { syntheticRows, train, SEED } from './survival-training';
import { readLiterature } from './survival-literature';

assert.equal(model.method, 'logistic-regression');
assert.equal(model.trainedOn, 'synthetic');
assert.deepEqual(model.features, [...SURVIVAL_FEATURES]);
assert.equal(model.seed, SEED);
const bases = readLiterature(species);
const rows = syntheticRows(species, model.basePct, bases);
assert.deepEqual(rows, syntheticRows(species, model.basePct, bases), 'dataset reproducibility');
const holdout = rows.slice(model.trainingN);
const metrics = evaluate(holdout, model.coefficients);
assert.equal(metrics.rocAuc, model.rocAuc);
assert.equal(metrics.brier, model.brier);
assert.ok(metrics.rocAuc !== null && metrics.rocAuc >= 0.70);
assert.equal(metrics.calibration.length, 10);
assert.equal(metrics.calibration.reduce((n, b) => n + b.n, 0), model.validationN);
assert.deepEqual(train(species, model.basePct, bases).coefficients, model.coefficients, 'training reproducibility');
assert.equal(rocAuc([0, 1], [0.1, 0.9]), 1);
assert.equal(rocAuc([0, 1], [0.5, 0.5]), 0.5);
assert.equal(rocAuc([0, 1], [0.9, 0.1]), 0);
assert.equal(rocAuc([1, 1], [0.1, 0.9]), null);
const c: SurvivalConditions = { salinity: 'high', ph: 8.6, waterKnown: false, watering: 'regular', roadM: 20, variant: 'optimal', improveSoil: false };
for (const sp of species) {
  const regular = predictSurvival(sp, c), dry = predictSurvival(sp, { ...c, watering: 'none' });
  assert.deepEqual(regular, predictSurvival(sp, c));
  assert.deepEqual(survivalFeatures(sp, c), survivalFeatures({ ...sp, id: 'unseen-id' }, c), 'ID must not be a feature');
  for (const r of [regular, dry, predictSurvival(sp, { ...c, salinity: null, ph: null, roadM: null })]) {
    assert.ok(r.y1 >= 0 && r.y1 <= 100 && r.low <= r.y1 && r.high >= r.y1);
    assert.ok(r.risks.every(x => Number.isFinite(x.pp)));
  }
  if (sp.saltTolerance === 'low') assert.ok(dry.y1 < regular.y1, `${sp.id}: watering monotonicity`);
}
console.log(`Survival OK: n=${model.n}, holdout=${model.validationN}, ROC-AUC=${model.rocAuc.toFixed(6)}, Brier=${model.brier.toFixed(6)} (synthetic only)`);
