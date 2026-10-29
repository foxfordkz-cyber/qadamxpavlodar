import assert from 'node:assert/strict';
import model from '../src/shared/analytics/survivalModel.json';
import { species } from '../src/shared/api/mock/species';
import { calibrationRange, evaluate, probability, rocAuc, wilsonInterval } from '../src/shared/analytics/logistic';
import { predictSurvival } from '../src/shared/analytics/survival';
import { SALT_RISK_FEATURES, SURVIVAL_FEATURES, survivalFeatures, type SurvivalConditions } from '../src/shared/analytics/survivalFeatures';
import { fmtPp } from '../src/shared/format';
import { syntheticRows, train, SEED } from './survival-training';
import { readLiterature } from './survival-literature';

assert.equal(model.method, 'logistic-regression');
assert.equal(model.trainedOn, 'synthetic');
assert.deepEqual(model.features, [...SURVIVAL_FEATURES]);
assert.equal(model.seed, SEED);
assert.ok(!model.features.includes('salinity'), 'no standalone salinity effect');
for (const f of SALT_RISK_FEATURES) assert.ok(model.coefficients[model.features.indexOf(f)] <= 0, `${f} must not reward salt stress`);
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
for (const feature of ['frostLow', 'salinityUnknown']) {
  const index = model.features.indexOf(feature);
  for (const sample of [rows.slice(0, model.trainingN), holdout]) assert.ok(sample.some(r => r.x[index] === 1), `${feature} must occur in both splits`);
  assert.notEqual(model.coefficients[index], 0, `${feature} has learned support`);
}
assert.deepEqual(calibrationRange(0.5, []), { low: 0, high: 1, n: 0 }, 'empty bin is unknown');
const [lo, hi] = wilsonInterval(0.5, 100);
assert.ok(Math.abs(lo - 0.4038315) < 0.00001 && Math.abs(hi - 0.5961685) < 0.00001);
const wide = wilsonInterval(0.5, 10);
assert.ok(wide[0] < lo && wide[1] > hi, 'more calibration observations reduce uncertainty');
const calibrated = calibrationRange(0.55, Array.from({ length: 10 }, (_, i) => ({ lower: i / 10, upper: (i + 1) / 10, n: 100, predicted: 0.55, observed: 0.55 })));
assert.ok(calibrated.high - calibrated.low < 0.20, 'interval estimates probability, not individual outcome RMSE');
assert.equal(fmtPp(1.8), '+1.8 п.п.');
assert.equal(fmtPp(-1.8), '-1.8 п.п.');
assert.equal(fmtPp(0), '0 п.п.');
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
  const unknown = predictSurvival(sp, { ...c, salinity: null });
  assert.ok(unknown.warnings.some(w => w.includes('Засоление неизвестно')));
  const missingX = survivalFeatures(sp, { ...c, salinity: null }), mediumX = survivalFeatures(sp, { ...c, salinity: 'medium' });
  for (const f of SALT_RISK_FEATURES) assert.equal(missingX[SURVIVAL_FEATURES.indexOf(f)], mediumX[SURVIVAL_FEATURES.indexOf(f)], 'unknown salinity is not imputed as none');

  // All species, watering/variant/soil choices and representative known/missing conditions.
  for (const watering of ['regular', 'rare', 'none'] as const)
    for (const improveSoil of [false, true]) for (const waterKnown of [false, true])
      for (const variant of ['econom', 'optimal', 'max'] as const)
        for (const ph of [null, 6.2, 9]) for (const roadM of [null, 20, 160]) {
          let previous = 1, previousY1 = 100;
          for (const salinity of ['none', 'low', 'medium', 'high'] as const) {
            const conditions = { salinity, watering, improveSoil, waterKnown, variant, ph, roadM };
            const p = probability(survivalFeatures(sp, conditions), model.coefficients), y1 = predictSurvival(sp, conditions).y1;
            assert.ok(p <= previous + 1e-12 && y1 <= previousY1, `${sp.id}: salinity must never improve survival`);
            previous = p; previousY1 = y1;
          }
        }
}
console.log(`Survival OK: n=${model.n}, holdout=${model.validationN}, ROC-AUC=${model.rocAuc.toFixed(6)}, Brier=${model.brier.toFixed(6)} (synthetic only)`);
