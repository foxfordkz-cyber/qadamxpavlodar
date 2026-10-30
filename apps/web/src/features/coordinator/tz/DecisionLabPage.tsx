import { useEffect, useState } from 'react';
import { useData } from '../../../shared/api/DataProvider';
import { ApiError } from '../../../shared/api/transport';
import type { DecisionPlans, Plan, Watering } from '../../../shared/analytics/decisionLab';
import { PRIORITY_LABEL, type PriorityFactor } from '../../../shared/analytics/city';
import { getLang, t, type Key } from '../../../shared/i18n';
import { navigate } from '../../../shared/router';
import { StateView } from '../../../shared/ui/components';
import { PageHeader } from '../PageHeader';
import './decisionLab.css';

const parseNumber = (value: string) => value.trim() ? Number(value.replace(',', '.')) : NaN;
const number = (value: number | null, digits = 1) => value === null ? t('lab.unknown') : value.toLocaleString(getLang() === 'kk' ? 'kk-KZ' : 'ru-RU', { maximumFractionDigits: digits });
const money = (value: number) => `${number(value, 0)} ₸`;
const signed = (value: number | null, unit: string) => value === null ? t('lab.notComparable') : `${value > 0 ? '+' : ''}${number(value)} ${unit}`;
const factorKey: Record<PriorityFactor, Key> = {
  deficit: 'lab.factor.deficit', density: 'lab.factor.density', social: 'lab.factor.social',
  load: 'lab.factor.load', soil: 'lab.factor.soil', benefit: 'lab.factor.benefit',
};
function explanation(text: string) {
  const factor = (Object.keys(PRIORITY_LABEL) as PriorityFactor[]).find(k => text.startsWith(`${PRIORITY_LABEL[k]}:`));
  return factor ? `${t(factorKey[factor])}${text.slice(PRIORITY_LABEL[factor].length)}` : text;
}

function PlanCard({ plan, watering }: { plan: Plan; watering: Watering }) {
  const [mapGroup, setMapGroup] = useState(0);
  const groups = Math.ceil(plan.zones.length / 30);
  const group = Math.min(mapGroup, Math.max(0, groups - 1));
  const mapZones = plan.zones.slice(group * 30, (group + 1) * 30);
  const current = plan.scenario;
  const changed = watering !== 'regular';
  return <article className="gp-card gp-lab-card" aria-labelledby={`lab-${plan.id}`} data-plan={plan.id}>
    <div className="gp-lab-card__head">
      <p className="gp-eyebrow">{t('lab.strategy')}</p>
      <h2 id={`lab-${plan.id}`}>{t(plan.nameKey)}</h2>
      <p className="gp-small gp-muted">{t(`lab.strategy.${plan.id}`)}</p>
      {plan.resilience && <p className={`gp-lab-badge ${plan.resilience === 'best' ? 'is-best' : ''}`}>{t(plan.resilience === 'best' ? 'lab.best' : 'lab.similar')}</p>}
    </div>
    <dl className="gp-lab-metrics">
      <div><dt>{t('lab.zones')}</dt><dd data-metric="zones">{current.zones}</dd></div>
      <div><dt>{t('lab.spent')}</dt><dd data-metric="spent">{money(plan.baseline.spentKzt)}</dd></div>
      <div><dt>{t('lab.remaining')}</dt><dd>{money(plan.baseline.remainingKzt)}</dd></div>
      <div><dt>{t('lab.water')}</dt><dd data-metric="water">{number(current.waterM3)}</dd></div>
      <div><dt>{t('lab.survival')}</dt><dd data-metric="survival">{number(current.survivalY3)}{current.survivalY3 !== null && '%'}</dd></div>
      <div><dt>{t('lab.co2')}</dt><dd data-metric="co2">{number(current.co2t20, 2)}</dd></div>
      <div><dt>{t('lab.canopy')}</dt><dd>{number(current.canopyM2, 0)}</dd></div>
    </dl>
    {changed && current.zones > 0 && <div className="gp-lab-delta">
      <h3>{t('lab.change')}</h3>
      <p>{t('lab.deltaSurvival', { value: signed(plan.delta.survivalPp, t('lab.pp')) })}</p>
      <p>{t('lab.deltaCo2', { value: signed(plan.delta.co2Pct, '%') })}</p>
      <p>{t('lab.deltaWater', { value: signed(plan.delta.waterPct, '%') })}</p>
      <p>{t('lab.scenarioCost', { value: money(current.spentKzt) })}</p>
      {current.remainingKzt < 0 && <p className="gp-lab-overrun" role="status">{t('lab.overrun', { value: money(-current.remainingKzt) })}</p>}
    </div>}
    {!current.zones && <p className="gp-lab-empty">{t('lab.emptyPlan')}</p>}
    {groups > 1 && <label className="gp-lab-map-group">{t('lab.mapGroup')}
      <select className="gp-input" value={group} onChange={e => setMapGroup(Number(e.target.value))}>
        {Array.from({ length: groups }, (_, i) => <option key={i} value={i}>{t('lab.mapRange', { from: i * 30 + 1, to: Math.min((i + 1) * 30, plan.zones.length), total: plan.zones.length })}</option>)}
      </select>
    </label>}
    <button className="gp-btn gp-btn--secondary gp-lab-map" disabled={!current.zones}
      onClick={() => navigate('/map', { hl: mapZones.map(z => z.siteId).join(','), hlt: t(plan.nameKey) + (groups > 1 ? ` · ${t('lab.mapRange', { from: group * 30 + 1, to: Math.min((group + 1) * 30, plan.zones.length), total: plan.zones.length })}` : '') })}>
      {t('lab.map')}
    </button>
    {current.zones > 0 && <details className="gp-lab-reasons">
      <summary>{t('lab.why')}</summary>
      <ol>{plan.zones.map(zone => <li key={zone.siteId} data-site-id={zone.siteId}>
        <strong>{zone.name}</strong>
        <p>{t('lab.zoneCost', { value: money(zone.costKzt) })}</p>
        <p>{t('lab.zoneWater', { value: number(zone.waterM3) })}</p>
        <p className="gp-muted">{zone.explanation.map(explanation).join(' · ')}</p>
      </li>)}</ol>
    </details>}
  </article>;
}

export function DecisionLabPage() {
  const { api, revision } = useData();
  const [budget, setBudget] = useState('50');
  const [water, setWater] = useState('');
  const [watering, setWatering] = useState<Watering>('regular');
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ data: DecisionPlans | null; error: unknown; key: string }>({ data: null, error: null, key: '' });
  const budgetKzt = parseNumber(budget) * 1e6;
  const waterLimitM3 = water.trim() ? parseNumber(water) : null;
  const valid = Number.isFinite(budgetKzt) && budgetKzt > 0 && (waterLimitM3 === null || Number.isFinite(waterLimitM3) && waterLimitM3 >= 0);
  const requestKey = JSON.stringify([budget, water, watering, revision, retry]);
  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.decisionLab({ budgetKzt, waterLimitM3, watering }, controller.signal).then(
        data => { if (!controller.signal.aborted) setState({ data, error: null, key: requestKey }); },
        error => { if (!controller.signal.aborted) setState({ data: null, error, key: requestKey }); },
      );
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [api, budgetKzt, waterLimitM3, watering, valid, requestKey]);
  const loading = valid && requestKey !== state.key;
  const data = !loading && valid ? state.data : null;
  const rawError = !valid ? new Error(t('lab.invalid')) : !loading ? state.error : null;
  const error = rawError && valid && !(rawError instanceof ApiError && [0, 401, 403].includes(rawError.status)) ? new Error(t('lab.error')) : rawError;
  return <div className="gp-page gp-lab">
    <PageHeader eyebrow={t('lab.eyebrow')} title={t('nav.lab')} lead={t('lab.lead')} />
    <section className="gp-card gp-lab-controls" aria-label={t('lab.controls')}>
      <label>{t('lab.budget')}<input className="gp-input" inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} /></label>
      <label>{t('lab.limit')}<input className="gp-input" inputMode="decimal" value={water} placeholder={t('lab.unlimited')} onChange={e => setWater(e.target.value)} /></label>
      <fieldset><legend>{t('lab.watering')}</legend><div className="gp-lab-options">
        {(['regular', 'rare', 'none'] as const).map(option => <label key={option} className={watering === option ? 'is-selected' : ''}>
          <input type="radio" name="lab-watering" value={option} checked={watering === option} onChange={() => setWatering(option)} />{t(`lab.watering.${option}`)}
        </label>)}
      </div></fieldset>
    </section>
    <p className="gp-small gp-muted">{t('lab.fixedHint')}</p>
    <section className="gp-lab-results" aria-label={t('lab.results')} aria-busy={loading} aria-live="polite">
      <StateView loading={loading} error={error} hasData={!!data} onRetry={valid ? () => setRetry(x => x + 1) : undefined}>
        {data && <>
          {data.plans.every(p => !p.zones.length) && <p className="gp-lab-empty" role="status">{t('lab.empty')}</p>}
          <div className="gp-lab-grid">{data.plans.map(plan => <PlanCard key={plan.id} plan={plan} watering={watering} />)}</div>
          <details className="gp-lab-assumptions"><summary>{t('lab.assumptions')}</summary>
            <ul>{data.assumptions.filter(key => !['lab.assumption.estimate', 'lab.assumption.water'].includes(key)).map(key => <li key={key}>{t(key as Key)}</li>)}</ul>
          </details>
        </>}
      </StateView>
    </section>
    <aside className="gp-lab-note"><p>{t('lab.assumption.estimate')}</p><p>{t('lab.assumption.water')}</p></aside>
  </div>;
}
