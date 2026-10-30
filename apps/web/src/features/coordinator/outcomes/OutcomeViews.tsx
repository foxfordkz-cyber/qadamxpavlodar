import type { ReactNode } from 'react';
import type { DeepReadonly, OutcomeForecastSnapshot, OutcomeIssue, OutcomeProvenance, OutcomeVariant } from '../../../shared/api/outcomes';
import type { OutcomeSiteData } from '../../../shared/api/outcomesClient';
import { Badge, Button, DataClassTag } from '../../../shared/ui/components';
import { speciesName, t, tr, type Key } from '../../../shared/i18n';
import { fmtDate, fmtDateTime } from '../../../shared/format';
import { ISSUE_KEYS, outcomeDelta, outcomeError, outcomeNumber, selectOutcomeInspection } from './pageModel';

export function OutcomeError({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div className="gp-alert gp-alert--bad" role="alert"><p>{outcomeError(error)}</p>{retry && <Button onClick={retry}>{t('state.retry')}</Button>}</div>;
}
export function OutcomeIssues({ issues }: { issues: readonly OutcomeIssue[] }) {
  const codes = [...new Set(issues.map(i => i.code))];
  return codes.length ? <ul className="gp-outcome-issues">{codes.map(code => <li key={code}>{t(ISSUE_KEYS[code])}</li>)}</ul> : null;
}
export function OutcomeStat({ label, value, id }: { label: string; value: ReactNode; id?: string }) {
  return <div data-testid={id}><dt>{label}</dt><dd>{value}</dd></div>;
}
export function ProvenanceLine({ label, value }: { label: string; value: DeepReadonly<OutcomeProvenance> | null }) {
  return <div className="gp-outcome-source"><strong>{label}</strong>{value ? <>
    <DataClassTag value={value.dataClass} />{value.isDemo && <Badge tone="demo">{t('outcomePage.demo')}</Badge>}
    <span>{fmtDateTime(value.capturedAt)} (UTC+5)</span>
    <small>{value.evidenceIds.length ? t('outcomePage.evidence', { ids: value.evidenceIds.join(', ') }) : t('outcomePage.noData')}</small>
  </> : <span>{t('outcomePage.noData')}</span>}</div>;
}

export function VariantCard({ variant: v, best, children }: { variant: DeepReadonly<OutcomeVariant>; best: boolean; children?: ReactNode }) {
  return <article className={`gp-card gp-outcome-variant${best ? ' gp-outcome-variant--best' : ''}`} data-testid={`outcome-${v.variant}`}>
    <h3>{t(`outcomePage.${v.variant}`)}</h3>
    {best && <Badge tone="ok">{t('outcomePage.best')}</Badge>}
    <dl className="gp-outcome-stats">
      <OutcomeStat label={t('outcomePage.treeCount')} value={outcomeNumber(v.treeCount)} />
      <OutcomeStat label={t('outcomePage.expectedTrees')} value={outcomeNumber(v.expectedTreesY3)} />
      <OutcomeStat label={t('outcomePage.totalCost')} value={outcomeNumber(v.cost.totalKzt, ' ₸', 0)} />
      <OutcomeStat label={t('outcomePage.unitCost')} value={outcomeNumber(v.costPerExpectedTreeKzt, ' ₸', 0)} />
    </dl>
    <Badge tone="info">{t('outcomePage.estimate')}</Badge>{v.isDemo && <Badge tone="demo">{t('outcomePage.demo')}</Badge>}
    <OutcomeIssues issues={v.issues} />{children}
  </article>;
}

const costLabels: Record<string, Key> = { material: 'outcomePage.material', prep: 'outcomePage.prep', work: 'outcomePage.work', care: 'outcomePage.care', reserve: 'outcomePage.reserve' };
export function SnapshotView({ snapshot: s }: { snapshot: OutcomeForecastSnapshot }) {
  return <div className="gp-outcome-snapshot">
    <ProvenanceLine label={t('outcomePage.source.forecast')} value={s.provenance} />
    <p>{t('outcomePage.synthetic')}</p>
    <div className="gp-table-wrap" role="region" aria-label={t('outcomePage.snapshotCost')} tabIndex={0}>
      <table className="gp-table gp-small"><caption>{t('outcomePage.snapshotCost')}</caption><tbody>
        {s.outcome.cost.items.map(item => <tr key={item.key}><th scope="row">{t(costLabels[item.key] ?? 'outcomePage.noData')}</th>
          <td>{outcomeNumber(item.amountKzt, ' ₸', 0)}</td><td><DataClassTag value={item.dataClass} /></td></tr>)}
        <tr><th scope="row">{t('outcomePage.totalCost')}</th><td colSpan={2}>{outcomeNumber(s.outcome.cost.totalKzt, ' ₸', 0)}</td></tr>
      </tbody></table>
    </div>
    <OutcomeIssues issues={s.outcome.issues} />
    <div className="gp-table-wrap" role="region" aria-label={t('outcomePage.source.forecast')} tabIndex={0}>
      <table className="gp-table gp-small"><thead><tr><th>{t('outcomePage.species')}</th><th>{t('outcomePage.year1')}</th><th>{t('outcomePage.range')}</th><th>{t('outcomePage.year2')}</th><th>{t('outcomePage.year3')}</th></tr></thead>
        <tbody>{s.analysis.survival.map(row => <tr key={row.speciesId}>
          <th scope="row">{speciesName(s.catalog.find(sp => sp.id === row.speciesId), t('outcomePage.noData'))}</th>
          <td>{outcomeNumber(row.y1, '%')}</td><td>{outcomeNumber(row.low, '%')}–{outcomeNumber(row.high, '%')}</td>
          <td>{outcomeNumber(row.y2, '%')}</td><td>{outcomeNumber(row.y3, '%')}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="gp-small gp-muted">{t('outcomePage.rangeNote')}</p>
    <details><summary>{t('outcomePage.source.prices')}</summary>
      <ul className="gp-outcome-prices">{s.rates.filter(r => r.group === 'cost').map(r => <li key={r.key}>
        <span>{tr(r.label)}: {outcomeNumber(r.value)} {tr(r.unit)}</span> <DataClassTag value={r.dataClass} />
        <small>{tr(r.source)}</small>
      </li>)}</ul>
    </details>
  </div>;
}

export function InspectionView({ data, cohortId, inspectionId }: { data: OutcomeSiteData; cohortId: string; inspectionId: string | null }) {
  let selected: ReturnType<typeof selectOutcomeInspection>;
  try { selected = selectOutcomeInspection(data, data.siteId, cohortId, inspectionId); }
  catch (error) { return <OutcomeError error={error} />; }
  const { cohort, inspection, summary: s, comparison: c } = selected;
  return <>
    <section className="gp-card gp-outcome-section" aria-labelledby="outcome-observed">
      <h2 id="outcome-observed">{t('outcomePage.observed')}</h2>
      <ProvenanceLine label={t('outcomePage.source.inspection')} value={inspection?.provenance ?? null} />
      <dl className="gp-outcome-stats gp-outcome-stats--wide">
        {(['total', 'inspected', 'assessed', 'alive', 'dead', 'unknown', 'notInspected'] as const).map(key =>
          <OutcomeStat key={key} id={`outcome-stat-${key}`} label={t(`outcomePage.${key}`)} value={outcomeNumber(s[key])} />)}
        <OutcomeStat label={t('outcomePage.coverage')} value={outcomeNumber(s.inspectionCoveragePct, '%')} />
        <OutcomeStat label={t('outcomePage.assessmentCoverage')} value={outcomeNumber(s.assessmentCoveragePct, '%')} />
        <OutcomeStat label={t('outcomePage.assessedSurvival')} value={outcomeNumber(s.survivalAmongAssessedPct, '%')} />
        <OutcomeStat id="outcome-whole" label={t('outcomePage.wholeSurvival')} value={outcomeNumber(s.wholeCohortSurvivalPct, '%')} />
      </dl>
      <p className="gp-small gp-muted">{t('outcomePage.unknownNote')}</p>
    </section>
    <section className="gp-card gp-outcome-section" aria-labelledby="outcome-compare">
      <h2 id="outcome-compare">{t('outcomePage.compare')}</h2>
      <Badge tone={c.comparable ? 'ok' : 'warn'}>{c.comparable ? t('outcomePage.comparable', { years: c.horizonYears! }) : t('outcomePage.notComparable')}</Badge>
      <OutcomeIssues issues={c.issues} />
      {c.comparable && <dl className="gp-outcome-stats gp-outcome-stats--wide" data-testid="outcome-comparison">
        <OutcomeStat label={t('outcomePage.expected')} value={outcomeNumber(c.expectedSurvivalPct, '%')} />
        <OutcomeStat label={t('outcomePage.actual')} value={outcomeNumber(c.observedSurvivalPct, '%')} />
        <OutcomeStat id="outcome-delta" label={t('outcomePage.delta')} value={outcomeDelta(c.differencePp)} />
      </dl>}
      <p className="gp-small gp-muted">{t('outcomePage.notAccuracy')}</p>
      {cohort.forecast && <details><summary>{t('outcomePage.forecastDate')}: {fmtDate(cohort.forecast.provenance.capturedAt)}</summary><SnapshotView snapshot={cohort.forecast} /></details>}
    </section>
  </>;
}
