import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OutcomesContent, OutcomeStatus, OutcomesPanel } from '../src/features/coordinator/outcomes/OutcomesPanel';
import { prepareOutcomes, type OutcomesData } from '../src/features/coordinator/outcomes/model';
import { calculateOutcomeVariant } from '../src/shared/analytics/outcomes';
import { fixtureSite, fixtureInput, outcomesFixture } from './fixtures/outcomes-ui';
import { getLang, setLang, speciesName, t } from '../src/shared/i18n';

function render(data: OutcomesData) {
  return renderToStaticMarkup(createElement(OutcomesContent, { data: prepareOutcomes(fixtureSite.id, data) }));
}
test('outcomes UI: core ranks comparable variants; independent documented values are displayed', () => {
  const html = render(outcomesFixture());
  assert.equal((html.match(/gp-outcomes__card--best/g) ?? []).length, 1);
  assert.match(html, /gp-outcomes__card--best[^>]*data-variant="econom"/);
  assert.ok(html.includes((151236.64).toLocaleString('ru-RU', { maximumFractionDigits: 2 })));
  assert.ok(html.includes((3847460).toLocaleString('ru-RU')));
  assert.ok(html.includes('25,44'));
  assert.ok(html.includes('75%')); // 24 confirmed alive of 32, complete assessment.
  assert.ok(html.includes('#/reports?report=test-report-only'));
  assert.ok(html.includes(t('outcomes.synthetic')) && html.includes(t('outcomes.demoInspection')));
  assert.ok(!html.includes(t('outcomes.observed')), 'synthetic inspection is not called confirmed field evidence');
});
test('outcomes UI: missing care cost remains unknown with a corrective action, never a winning zero', () => {
  const input = fixtureInput(); input.rates.find(r => r.key === 'care.tree')!.value = null;
  const data = outcomesFixture(); data.variants = [calculateOutcomeVariant(input)];
  const html = render(data);
  assert.ok(html.includes(t('outcomes.issue.rates')) && html.includes(t('outcomes.unknown')));
  assert.doesNotMatch(html, /gp-outcomes__card--best/);
  assert.doesNotMatch(html, /<dd>0 ₸<\/dd>/);
});
test('outcomes UI: mixed planting and incompatible bases are not highlighted', () => {
  const data = outcomesFixture(); data.variants = [calculateOutcomeVariant(fixtureInput('econom', true))];
  assert.ok(render(data).includes(t('outcomes.issue.mixed')));
  data.variants = outcomesFixture().variants;
  data.variants[1].comparisonKey = 'different-source';
  const html = render(data);
  assert.ok(html.includes(t('outcomes.issue.basis')));
  assert.doesNotMatch(html, /gp-outcomes__card--best/);
});
test('outcomes UI: monthly inspection and missing original forecast display facts separately without delta', () => {
  for (const index of [1, 2]) {
    const data = outcomesFixture(); data.cohorts = [data.cohorts[index]];
    const html = render(data);
    assert.ok(html.includes(t(index === 1 ? 'outcomes.issue.anniversary' : 'outcomes.issue.snapshot')));
    assert.ok(html.includes(t('outcomes.separate')) && html.includes('75%'));
    assert.ok(!html.includes(t('outcomes.delta')));
    assert.doesNotMatch(html, /<svg|<canvas|<path/);
  }
});
test('outcomes UI: partial inspection gives coverage and unknowns, not a comparison or whole-cohort percentage', () => {
  const data = outcomesFixture(); data.cohorts = [data.cohorts[0]];
  const inspection = data.cohorts[0].latestInspection!;
  data.cohorts[0].latestInspection = { ...inspection, observations: inspection.observations.slice(0, 16) };
  const html = render(data);
  assert.ok(html.includes('50%') && html.includes(t('outcomes.issue.coverage')));
  assert.ok(!html.includes(t('outcomes.delta')) && !html.includes(t('outcomes.observedPct')));
});
test('outcomes UI: real field provenance stays separate from a demo-price forecast', () => {
  const data = outcomesFixture(); const entry = data.cohorts[0]; data.cohorts = [entry];
  entry.cohort = { ...entry.cohort, provenance: { ...entry.cohort.provenance, source: 'api', dataClass: 'real', isDemo: false } };
  entry.latestInspection = { ...entry.latestInspection!, provenance: { ...entry.latestInspection!.provenance, source: 'api', dataClass: 'real', isDemo: false } };
  const html = render(data);
  assert.ok(html.includes(t('outcomes.observed')) && html.includes(t('outcomes.demo')));
  assert.ok(!html.includes(t('outcomes.demoInspection')) && !html.includes(t('outcomes.demoCohort')));
});
test('outcomes UI: no inspection or no assessed states are not fabricated survival zeroes', () => {
  const data = outcomesFixture(); data.cohorts = [data.cohorts[0]]; data.cohorts[0].latestInspection = null;
  assert.ok(render(data).includes(t('outcomes.issue.inspection')));
  data.cohorts[0].latestInspection = { ...outcomesFixture().cohorts[0].latestInspection!, observations: [] };
  const html = render(data);
  assert.ok(html.includes(t('outcomes.noAssessed')) && html.includes(t('outcomes.unknown')));
});
test('outcomes UI: rejects foreign zone, duplicate cohort and invalid inspection instead of showing a false empty result', () => {
  const data = outcomesFixture();
  assert.throws(() => prepareOutcomes('other-zone', data));
  data.cohorts.push(data.cohorts[0]); assert.throws(() => prepareOutcomes(fixtureSite.id, data));
  const invalid = outcomesFixture(); invalid.cohorts[0].latestInspection = { ...invalid.cohorts[0].latestInspection!, cohortId: 'foreign' };
  assert.throws(() => prepareOutcomes(fixtureSite.id, invalid));
});
test('outcomes UI: Russian/Kazakh labels, speciesName and all resource states are translated', () => {
  const previous = getLang();
  try {
    for (const language of ['ru', 'kk'] as const) {
      setLang(language);
      const data = outcomesFixture(), html = render(data);
      const firstSpecies = data.catalog.find(s => s.id === data.cohorts[0].cohort.plants[0].speciesId)!;
      assert.ok(html.includes(speciesName(firstSpecies)));
      assert.ok(html.includes(t('outcomes.history')) && html.includes(t('outcomes.notValidation')));
      assert.doesNotMatch(html, /NaN|undefined|\{\w+\}/);
      if (language === 'kk') assert.doesNotMatch(html, /Расчётный прогноз|Дата посадки|Подтверждающий отчёт|Расхождение|Состояние установлено/);
      for (const status of ['loading', 'empty', 'error', 'invalid', 'unavailable'] as const) {
        assert.ok(renderToStaticMarkup(createElement(OutcomeStatus, { status })).includes(t(`outcomes.status.${status}`)));
      }
      const unavailable = renderToStaticMarkup(createElement(OutcomesPanel, { siteId: fixtureSite.id }));
      assert.ok(unavailable.includes(t('outcomes.status.unavailable')));
      assert.ok(!unavailable.includes(t('outcomes.best')));
    }
  } finally { setLang(previous); }
});
