import { useEffect, useId, useState, type ReactNode } from 'react';
import { getLang, speciesName, t, type Key } from '../../../shared/i18n';
import { useLanguage } from '../../../shared/i18n/useLanguage';
import type { OutcomeIssue, OutcomeIssueCode, OutcomeVariant } from '../../../shared/api/outcomes';
import { Badge, Button } from '../../../shared/ui/components';
import { hrefFor } from '../../../shared/router';
import { prepareOutcomes, type OutcomesLoader, type OutcomesView } from './model';
import './outcomes.css';

const issueKeys = {
  empty_scheme: 'outcomes.issue.scheme', invalid_quantity: 'outcomes.issue.scheme',
  missing_species: 'outcomes.issue.species', species_tier_mismatch: 'outcomes.issue.species',
  invalid_probability: 'outcomes.issue.forecast', missing_survival: 'outcomes.issue.forecast', duplicate_survival: 'outcomes.issue.forecast',
  invalid_rate: 'outcomes.issue.rates', missing_rate: 'outcomes.issue.rates', duplicate_rate: 'outcomes.issue.rates', invalid_price: 'outcomes.issue.rates',
  missing_area: 'outcomes.issue.area', invalid_cost: 'outcomes.issue.cost', cost_mismatch: 'outcomes.issue.cost',
  analysis_site_mismatch: 'outcomes.issue.site', mixed_planting: 'outcomes.issue.mixed', no_trees: 'outcomes.issue.noTrees',
  wrong_horizon: 'outcomes.issue.horizon', zero_expected_trees: 'outcomes.issue.zeroExpected', incomplete_cost: 'outcomes.issue.cost',
  incompatible_basis: 'outcomes.issue.basis', insufficient_variants: 'outcomes.issue.variants',
  missing_planting_date: 'outcomes.issue.plantingDate', missing_forecast: 'outcomes.issue.snapshot', no_inspection: 'outcomes.issue.inspection',
  unmatched_horizon: 'outcomes.issue.anniversary', incomplete_inspection: 'outcomes.issue.coverage', cohort_mismatch: 'outcomes.issue.cohort',
} satisfies Record<OutcomeIssueCode, Key>;

function Issues({ issues }: { issues: readonly OutcomeIssue[] }) {
  const keys = [...new Set(issues.map(issue => issueKeys[issue.code]))];
  return keys.length ? <ul className="gp-outcomes__issues">{keys.map(key => <li key={key}>{t(key)}</li>)}</ul> : null;
}
const number = (value: number | null) => value === null ? t('outcomes.unknown') : value.toLocaleString(getLang() === 'kk' ? 'kk-KZ' : 'ru-RU', { maximumFractionDigits: 2 });
const money = (value: number | null) => value === null ? t('outcomes.unknown') : `${number(value)} ₸`;
const percent = (value: number | null) => value === null ? t('outcomes.unknown') : `${number(value)}%`;
const date = (value: string | null) => value === null ? t('outcomes.unknown') : new Intl.DateTimeFormat(getLang() === 'kk' ? 'kk-KZ' : 'ru-RU', { timeZone: 'Asia/Almaty' }).format(new Date(value.length === 10 ? `${value}T00:00:00+05:00` : value));

export function OutcomeStatus({ status, onRetry }: { status: 'unavailable' | 'loading' | 'empty' | 'error' | 'invalid'; onRetry?: () => void }) {
  return <div className="gp-outcomes__status" role={status === 'error' || status === 'invalid' ? 'alert' : 'status'}>
    <p>{t(`outcomes.status.${status}`)}</p>
    {onRetry && <Button onClick={onRetry}>{t('state.retry')}</Button>}
  </div>;
}

type Resource = { load: OutcomesLoader; siteId: string; requestKey: string; tick: number } & (
  { status: 'loading' | 'error' | 'invalid'; data?: never } | { status: 'ready'; data: OutcomesView }
);

/** No default endpoint or demo fallback. The unfinished adapter is explicit in production. */
export function OutcomesPanel({ siteId, requestKey = '', load }: { siteId: string; requestKey?: string; load?: OutcomesLoader }) {
  useLanguage();
  const [tick, setTick] = useState(0);
  const [resource, setResource] = useState<Resource | null>(null);
  const headingId = useId();
  useEffect(() => {
    if (!load) return;
    const controller = new AbortController();
    const identity = { load, siteId, requestKey, tick };
    setResource({ ...identity, status: 'loading' });
    Promise.resolve().then(() => load(controller.signal)).then(data => {
      if (controller.signal.aborted) return;
      try { setResource({ ...identity, status: 'ready', data: prepareOutcomes(siteId, data) }); }
      catch { setResource({ ...identity, status: 'invalid' }); }
    }, () => { if (!controller.signal.aborted) setResource({ ...identity, status: 'error' }); });
    return () => controller.abort();
  }, [load, siteId, requestKey, tick]);
  const current = resource?.load === load && resource?.siteId === siteId && resource?.requestKey === requestKey && resource?.tick === tick ? resource : null;
  const status = !load ? 'unavailable' : current?.status ?? 'loading';
  return <section className="gp-outcomes" aria-labelledby={headingId} aria-busy={status === 'loading'}>
    <header className="gp-outcomes__header"><p className="gp-outcomes__eyebrow">{t('outcomes.eyebrow')}</p><h3 id={headingId}>{t('outcomes.title')}</h3>
      <p>{t('outcomes.lead')}</p></header>
    {status === 'ready' && current?.status === 'ready'
      ? <OutcomesContent key={`${siteId}:${requestKey}`} data={current.data} />
      : <OutcomeStatus status={status === 'ready' ? 'loading' : status} onRetry={status === 'error' || status === 'invalid' ? () => setTick(x => x + 1) : undefined} />}
  </section>;
}

const costLabels = { material: 'outcomes.cost.material', prep: 'outcomes.cost.prep', work: 'outcomes.cost.work', care: 'outcomes.cost.care', reserve: 'outcomes.cost.reserve' } satisfies Record<string, Key>;
export function CostCard({ variant, best, eligible, children }: { variant: OutcomeVariant; best: boolean; eligible: boolean; children?: ReactNode }) {
  return <article className={`gp-outcomes__card${best ? ' gp-outcomes__card--best' : ''}`} data-variant={variant.id}>
    <h4>{t(`outcomes.variant.${variant.variant}`)}</h4>
    <div className="gp-outcomes__tags"><Badge tone="info">{t('outcomes.forecast')}</Badge>{variant.isDemo && <Badge tone="demo">{t('outcomes.demo')}</Badge>}
      {best && <Badge tone="ok">{t('outcomes.best')}</Badge>}</div>
    <p className="gp-small gp-muted">{t('outcomes.synthetic')}</p>
    <dl className="gp-outcomes__metrics"><div className="gp-outcomes__main-metric"><dt>{t('outcomes.unitCost')}</dt><dd>{money(variant.costPerExpectedTreeKzt)}</dd></div>
      <div><dt>{t('outcomes.expected')}</dt><dd>{number(variant.expectedTreesY3)}</dd></div>
      <div><dt>{t('outcomes.treeCount')}</dt><dd>{number(variant.treeCount)}</dd></div>
      <div><dt>{t('outcomes.total')}</dt><dd>{money(variant.cost.totalKzt)}</dd></div>
    </dl>
    <h5>{t('outcomes.plantingCosts')}</h5>
    <dl className="gp-outcomes__metrics">{(['material', 'prep', 'work'] as const).map(key => <div key={key}><dt>{t(costLabels[key])}</dt><dd>{money(variant.cost.items.find(i => i.key === key)?.amountKzt ?? null)}</dd></div>)}</dl>
    <dl className="gp-outcomes__metrics">{(['care', 'reserve'] as const).map(key => <div key={key}><dt>{t(costLabels[key])}{key === 'care' ? ` · ${t('outcomes.years', { n: variant.cost.careYears })}` : ''}</dt><dd>{money(variant.cost.items.find(i => i.key === key)?.amountKzt ?? null)}</dd></div>)}</dl>
    <p className="gp-small">{t(variant.cost.complete ? 'outcomes.complete' : 'outcomes.incomplete')} · {t(eligible ? 'outcomes.eligible' : 'outcomes.ineligible')}</p>
    <Issues issues={variant.issues} />
    {children}
  </article>;
}

export function OutcomesContent({ data }: { data: OutcomesView }) {
  const [selectedId, setSelectedId] = useState(data.cohorts[0]?.cohort.id ?? '');
  const selectId = useId();
  const selected = data.cohorts.find(c => c.cohort.id === selectedId) ?? data.cohorts[0];
  return <>
    {data.variants.length ? <>
      <p className="gp-small">{t(data.comparison.comparable ? 'outcomes.comparable' : 'outcomes.notComparable')}</p>
      <Issues issues={data.comparison.issues} />
      <div className="gp-outcomes__grid">{data.variants.map(variant => <CostCard key={variant.id} variant={variant}
        best={data.comparison.comparable && data.comparison.bestVariantIds.includes(variant.id)} eligible={data.comparison.eligibleVariantIds.includes(variant.id)} />)}</div>
    </> : <OutcomeStatus status="empty" />}
    <section className="gp-outcomes__history" aria-labelledby={`${selectId}-title`}>
      <h3 id={`${selectId}-title`}>{t('outcomes.history')}</h3>
      {selected ? <>
        <label htmlFor={selectId}>{t('outcomes.cohort')}</label>
        <select id={selectId} className="gp-input" value={selected.cohort.id} onChange={e => setSelectedId(e.target.value)}>
          {data.cohorts.map(({ cohort }) => <option key={cohort.id} value={cohort.id}>{t('outcomes.cohortOption', { id: cohort.id, date: date(cohort.plantedOn) })}</option>)}
        </select>
        <CohortDetail entry={selected} catalog={data.catalog} />
      </> : <p className="gp-outcomes__status">{t('outcomes.noCohorts')}</p>}
    </section>
  </>;
}

function CohortDetail({ entry, catalog }: { entry: OutcomesView['cohorts'][number]; catalog: OutcomesView['catalog'] }) {
  const { cohort, latestInspection, summary, comparison } = entry;
  const byId = new Map([...catalog, ...(cohort.forecast?.catalog ?? [])].map(species => [species.id, species]));
  const composition = new Map<string, number>();
  for (const plant of cohort.plants) composition.set(plant.speciesId, (composition.get(plant.speciesId) ?? 0) + 1);
  const reportIds = [...new Set(latestInspection?.observations.flatMap(o => o.reportId ? [o.reportId] : []) ?? [])];
  const snapshot = cohort.forecast;
  return <div className="gp-outcomes__cohort">
    <div className="gp-outcomes__tags">{cohort.provenance.isDemo && <Badge tone="demo">{t('outcomes.demoCohort')}</Badge>}</div>
    <dl className="gp-outcomes__metrics"><div><dt>{t('outcomes.plantedOn')}</dt><dd>{date(cohort.plantedOn)}</dd></div></dl>
    {!cohort.plantedOn && <Issues issues={[{ code: 'missing_planting_date' }]} />}
    <h4>{t('outcomes.composition')}</h4><ul>{[...composition].map(([id, count]) => <li key={id}>{speciesName(byId.get(id), t('outcomes.unknownSpecies'))} · {number(count)}</li>)}</ul>
    <div className="gp-outcomes__grid gp-outcomes__grid--pair">
      <section className="gp-outcomes__card">
        <h4>{t('outcomes.originalForecast')}</h4>
        {snapshot ? <>
          <div className="gp-outcomes__tags"><Badge tone="info">{t('outcomes.forecast')}</Badge>{snapshot.outcome.isDemo && <Badge tone="demo">{t('outcomes.demo')}</Badge>}</div>
          <p className="gp-small gp-muted">{t('outcomes.synthetic')}</p>
          <dl className="gp-outcomes__metrics"><div><dt>{t('outcomes.capturedAt')}</dt><dd>{date(snapshot.provenance.capturedAt)}</dd></div>
            <div><dt>{t('outcomes.horizon')}</dt><dd>{t('outcomes.years', { n: snapshot.outcome.horizonYears })}</dd></div>
            <div><dt>{t('outcomes.expected')}</dt><dd>{number(snapshot.outcome.expectedTreesY3)}</dd></div></dl>
          <Issues issues={snapshot.outcome.issues} />
        </> : <Issues issues={[{ code: 'missing_forecast' }]} />}
      </section>
      <section className="gp-outcomes__card">
        <h4>{t('outcomes.lastInspection')}</h4>
        {latestInspection ? <>
          <Badge tone={summary.isDemo ? 'demo' : summary.dataClass === 'real' ? 'ok' : 'info'}>{t(summary.isDemo ? 'outcomes.demoInspection' : summary.dataClass === 'real' ? 'outcomes.observed' : 'outcomes.estimatedInspection')}</Badge>
          <dl className="gp-outcomes__metrics"><div><dt>{t('outcomes.observedOn')}</dt><dd>{date(latestInspection.observedOn)}</dd></div>
            {(['alive', 'dead', 'unknown'] as const).map(key => <div key={key}><dt>{t(`outcomes.${key}`)}</dt><dd>{number(summary[key])}</dd></div>)}
            <div><dt>{t('outcomes.inspectionCoverage')}</dt><dd>{percent(summary.inspectionCoveragePct)}</dd></div>
            <div><dt>{t('outcomes.assessmentCoverage')}</dt><dd>{percent(summary.assessmentCoveragePct)}</dd></div>
            <div><dt>{t('outcomes.survivalAssessed')}</dt><dd>{percent(summary.survivalAmongAssessedPct)}</dd></div>
          </dl>
          {summary.survivalAmongAssessedPct === null && <p className="gp-small">{t('outcomes.noAssessed')}</p>}
          <p className="gp-small gp-muted">{t('outcomes.coverageHint')}</p>
          {reportIds.length ? <ul className="gp-outcomes__reports">{reportIds.map((id, i) => <li key={id}><a href={hrefFor('/reports', { report: id })}>{t('outcomes.report', { n: i + 1 })}</a></li>)}</ul> : <p className="gp-small">{t('outcomes.noReport')}</p>}
        </> : <Issues issues={[{ code: 'no_inspection' }]} />}
      </section>
    </div>
    {comparison.comparable ? <div className="gp-outcomes__comparison">
      <h4>{t('outcomes.matched', { n: comparison.horizonYears! })}</h4>
      <dl className="gp-outcomes__metrics"><div><dt>{t('outcomes.forecastPct')}</dt><dd>{percent(comparison.expectedSurvivalPct)}</dd></div>
        <div><dt>{t('outcomes.observedPct')}</dt><dd>{percent(comparison.observedSurvivalPct)}</dd></div>
        <div><dt>{t('outcomes.delta')}</dt><dd>{comparison.differencePp === null ? t('outcomes.unknown') : t('outcomes.pp', { n: `${comparison.differencePp > 0 ? '+' : ''}${number(comparison.differencePp)}` })}</dd></div></dl>
      <p>{t('outcomes.notValidation')}</p>
    </div> : <div className="gp-outcomes__comparison"><p>{t('outcomes.separate')}</p><Issues issues={comparison.issues} /></div>}
    <p className="gp-small gp-muted">{t('outcomes.noCurve')}</p>
  </div>;
}
