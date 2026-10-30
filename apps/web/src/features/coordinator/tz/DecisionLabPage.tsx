import { useEffect, useMemo, useState } from 'react';
import { useData } from '../../../shared/api/DataProvider';
import { ApiError } from '../../../shared/api/transport';
import { evaluateDecisionPlans, waterStress, labAlternatives, applyLabAlternative, type DecisionPlans, type Plan, type Watering, type Goal } from '../../../shared/analytics/decisionLab';
import { getLang, t, type Key } from '../../../shared/i18n';
import { navigate } from '../../../shared/router';
import { StateView } from '../../../shared/ui/components';
import { PageHeader } from '../PageHeader';
import './decisionLab.css';

const parseNumber = (v: string) => v.trim() ? Number(v.replace(',', '.')) : NaN;
const number = (v: number | null, digits = 1) => v === null ? t('lab.unknown') : v.toLocaleString(getLang() === 'kk' ? 'kk-KZ' : 'ru-RU', { maximumFractionDigits: digits });
const money = (v: number | null) => v === null ? t('lab.unknown') : `${number(v, 0)} ₸`;
const signed = (v: number | null, unit: string) => v === null ? t('lab.notComparable') : `${v > 0 ? '+' : ''}${number(v)} ${unit}`;
const tr = (key: string) => t(key as Key);

function PlanCard({ plan, watering, limit, reduction, previous }: { plan: Plan; watering: Watering; limit: number | null; reduction: number; previous?: Plan }) {
  const [mapGroup, setMapGroup] = useState(0);
  const groups = Math.ceil(plan.zones.length / 30), group = Math.min(mapGroup, Math.max(0, groups - 1));
  const mapZones = plan.zones.slice(group * 30, (group + 1) * 30), current = plan.scenario;
  const stress = waterStress(current.waterM3, limit, reduction);
  const added = previous ? plan.zones.filter(z => !previous.zones.some(p => p.siteId === z.siteId)) : [];
  const removed = previous ? previous.zones.filter(z => !plan.zones.some(p => p.siteId === z.siteId)) : [];
  return <article className="gp-card gp-lab-card" aria-labelledby={`lab-${plan.id}`} data-plan={plan.id}>
    <div className="gp-lab-card__head"><p className="gp-eyebrow">{t('lab.strategy')}</p><h2 id={`lab-${plan.id}`}>{t(plan.nameKey)}</h2>
      <p className="gp-small gp-muted">{t(`lab.strategy.${plan.id}`)}</p>
      {plan.resilience && <p className="gp-lab-badge">{t(plan.resilience === 'best' ? 'lab.best' : 'lab.similar')}</p>}
    </div>
    <dl className="gp-lab-metrics">
      <div><dt>{t('lab.zones')}</dt><dd data-metric="zones">{current.zones}</dd></div>
      <div><dt>{t('lab.uniqueSocial')}</dt><dd>{new Set(plan.zones.flatMap(z => z.social.map(p => p.id))).size}</dd></div>
      <div><dt>{t('lab.trees')}</dt><dd data-metric="trees">{number(current.trees, 0)}</dd></div>
      <div><dt>{t('lab.expected')}</dt><dd data-metric="expected">{number(current.expectedTreesY3)}</dd></div>
      <div><dt>{t('lab.spent')}</dt><dd data-metric="spent">{money(current.spentKzt)}</dd></div>
      <div><dt>{t('lab.remaining')}</dt><dd>{money(current.remainingKzt)}</dd></div>
      <div><dt>{t('lab.water')}</dt><dd data-metric="water">{number(current.waterM3)}</dd></div>
      <div><dt>{t('lab.survival')}</dt><dd data-metric="survival">{number(current.survivalY3)}{current.survivalY3 !== null && '%'}</dd></div>
      <div><dt>{t('lab.co2')}</dt><dd data-metric="co2">{number(current.co2t20, 2)}</dd></div>
      <div><dt>{t('lab.canopy')}</dt><dd>{number(current.canopyM2, 0)}</dd></div>
      <div><dt>{t('lab.unitCost')}</dt><dd>{money(current.costPerExpectedTreeKzt)}</dd></div>
    </dl>
    {current.costPerExpectedTreeKzt === null && <p className="gp-small gp-muted">{t('lab.mixedPrice')}</p>}
    {current.remainingKzt !== null && current.remainingKzt < 0 && <p role="status" className="gp-lab-overrun">{t('lab.overrun', { value: money(-current.remainingKzt) })}</p>}
    {limit !== null && <div className="gp-lab-delta" data-testid={`water-stress-${plan.id}`}>
      <p>{t('lab.available')}: <strong>{number(stress.availableM3)} м³</strong></p>
      <p>{t('lab.deficitWater')}: <strong data-metric="deficit">{number(stress.deficitM3)}</strong> м³</p>
      <p>{t('lab.coverageWater')}: {number(stress.coveragePct)}{stress.coveragePct !== null && '%'}</p>
      <p>{t(stress.deficitM3 === null ? 'lab.waterUnknown' : stress.deficitM3 > 0 ? 'lab.waterExceeded' : 'lab.waterFits')}</p>
    </div>}
    {watering !== 'regular' && current.zones > 0 && <div className="gp-lab-delta"><h3>{t('lab.change')}</h3>
      <div className="gp-lab-table" tabIndex={0} role="region" aria-label={t('lab.change')}><table><thead><tr><th>{t('lab.metric')}</th><th>{t('lab.base')}</th><th>{t('lab.scenario')}</th></tr></thead><tbody>
        {(['expectedTreesY3', 'survivalY3', 'waterM3', 'co2t20', 'canopyM2', 'spentKzt'] as const).map((key, i) => <tr key={key}><th>{t((['lab.expected','lab.survival','lab.water','lab.co2','lab.canopy','lab.spent'] as Key[])[i])}</th><td>{number(plan.baseline[key])}</td><td>{number(current[key])}</td></tr>)}
      </tbody></table></div>
      <p>{t('lab.deltaSurvival', { value: signed(plan.delta.survivalPp, t('lab.pp')) })}</p>
      <p>{t('lab.deltaCo2', { value: signed(plan.delta.co2Pct, '%') })}</p><p>{t('lab.deltaWater', { value: signed(plan.delta.waterPct, '%') })}</p>
    </div>}
    {previous && <div className="gp-lab-delta" data-testid="lab-rebuilt"><h3>{t('lab.rebuilt')}</h3>
      <p>{t('lab.added')}: {added.map(z => z.name).join('; ') || '—'}</p><p>{t('lab.removed')}: {removed.map(z => z.name).join('; ') || '—'}</p>
      <p>{t('lab.spent')}: {money(previous.baseline.spentKzt)} → {money(plan.baseline.spentKzt)}</p>
      <p>{t('lab.water')}: {number(previous.baseline.waterM3)} → {number(plan.baseline.waterM3)}</p>
      <p>{t('lab.expected')}: {number(previous.baseline.expectedTreesY3)} → {number(plan.baseline.expectedTreesY3)}</p>
    </div>}
    {!current.zones && <p className="gp-lab-empty">{t('lab.emptyPlan')}</p>}
    {groups > 1 && <label className="gp-lab-map-group">{t('lab.mapGroup')}<select className="gp-input" value={group} onChange={e => setMapGroup(Number(e.target.value))}>
      {Array.from({ length: groups }, (_, i) => <option key={i} value={i}>{t('lab.mapRange', { from: i * 30 + 1, to: Math.min((i + 1) * 30, plan.zones.length), total: plan.zones.length })}</option>)}
    </select></label>}
    <button className="gp-btn gp-btn--secondary gp-lab-map" disabled={!current.zones} onClick={() => navigate('/map', { hl: mapZones.map(z => z.siteId).join(','), hlt: t(plan.nameKey) + (groups > 1 ? ` · ${group + 1}/${groups}` : '') })}>{t('lab.map')}</button>
    <details className="gp-lab-reasons"><summary>{t('lab.why')}</summary>
      <dl>{current.costItems.map(i => <div key={i.key}><dt>{tr(`lab.cost.${i.key}`)}</dt><dd>{money(i.amountKzt)}</dd></div>)}</dl>
      <ol>{plan.zones.map(z => <li key={z.siteId} data-site-id={z.siteId} data-scheme={JSON.stringify(z.analysis.scheme.map(s => [s.speciesId, s.quantity]))}>
        <strong>{z.name}</strong><p>{t('lab.zoneCost', { value: money(z.costKzt) })}</p><p>{t('lab.zoneWater', { value: number(z.waterM3) })}</p><p>{t('lab.expected')}: {number(z.expectedTreesY3)}</p>
        <p>{z.explanation.map(e => `${tr(e.key)}: ${number(e.value)}/100`).join(' · ')}</p>
        {z.site.context?.greenShare200m == null && <p>{t('lab.missingGreen')}</p>}
        <p>{t('lab.socialEvidence')}: {z.social.length || t('lab.noEvidence')}</p>
        {z.social.map(p => <p key={p.id}>{tr(`lab.social.${p.kind}`)} · {p.name || p.id} · {number(p.distanceM)} м · <a href={p.source} target="_blank" rel="noreferrer">OpenStreetMap</a></p>)}
      </li>)}</ol>
      <h3>{t('lab.excluded')}</h3><ul>{plan.excluded.map(z => <li key={z.siteId}>{z.name}: {tr(`lab.exclude.${z.reason}`)}</li>)}</ul>
    </details>
  </article>;
}
function Risks({ data, onChange }: { data: DecisionPlans; onChange: (d: DecisionPlans) => void }) {
  const [risk, setRisk] = useState<'dry'|'winter'|'delay'>('dry');
  const [planId, setPlanId] = useState<Plan['id']>('survival'), [siteId, setSiteId] = useState('');
  const plan = data.plans.find(p => p.id === planId)!;
  const zone = plan.zones.find(z => z.siteId === siteId) ?? plan.zones[0];
  const options = useMemo(() => zone ? labAlternatives(zone, data.basis, risk) : [], [zone, data.basis, risk]);
  const speciesName = (id: string) => { const s = data.basis.catalog.find(s => s.id === id)!; return getLang() === 'kk' ? s.nameKk || s.nameRu : s.nameRu; };
  return <section className="gp-card gp-lab-risks"><h2>{t('lab.risks')}</h2>
    <div className="gp-lab-controls"><label>{t('lab.risk')}<select className="gp-input" value={risk} onChange={e => setRisk(e.target.value as typeof risk)}>{(['dry','winter','delay'] as const).map(r => <option key={r} value={r}>{tr(`lab.risk.${r}`)}</option>)}</select></label>
      <label>{t('lab.strategy')}<select className="gp-input" value={planId} onChange={e => setPlanId(e.target.value as Plan['id'])}>{data.plans.map(p => <option key={p.id} value={p.id}>{t(p.nameKey)}</option>)}</select></label>
      <label>{t('lab.zone')}<select className="gp-input" value={zone?.siteId ?? ''} onChange={e => setSiteId(e.target.value)}>{plan.zones.map(z => <option key={z.siteId} value={z.siteId}>{z.name}</option>)}</select></label></div>
    <p>{tr(`lab.riskNote.${risk}`)}</p><p className="gp-lab-note">{t('lab.noClimateNumbers')}</p>
    {zone && <><ul>{zone.analysis.scheme.filter(r => r.tier === 'tree').map(row => { const sp = data.basis.catalog.find(s => s.id === row.speciesId)!; return <li key={row.speciesId}>{speciesName(row.speciesId)}: {t('lab.drought')} — {tr(`lab.level.${sp.droughtTolerance}`)}; {t('lab.frost')} — {tr(`lab.level.${sp.frostHardiness}`)}</li>; })}</ul>
      {risk === 'delay' && <p>{t('lab.careTasks')}: {zone.analysis.care.reduce((n, row) => n + row.visits, 0)}</p>}
      <h3>{t('lab.alternatives')}</h3>{!options.length && <p>{t('lab.noAlternatives')}</p>}
      {options.map(a => <div key={`${a.from}-${a.to}`} className="gp-lab-delta"><p>{speciesName(a.from)} → {speciesName(a.to)}</p><p>{t('lab.extraCost')}: {signed(a.extraKzt, '₸')}</p>
        <button className="gp-btn gp-btn--secondary" disabled={a.extraKzt === null} onClick={() => onChange(applyLabAlternative(data, planId, zone.siteId, a))}>{t('lab.applyAlternative')}</button></div>)}
    </>}
  </section>;
}
export function DecisionLabPage() {
  const { api, revision } = useData();
  const [budget, setBudget] = useState('50'), [water, setWater] = useState(''), [goal, setGoal] = useState<Goal>('balanced');
  const [watering, setWatering] = useState<Watering>('regular'), [reduction, setReduction] = useState('0');
  const [testLimit, setTestLimit] = useState(''), [retry, setRetry] = useState(0), [previous, setPrevious] = useState<DecisionPlans | null>(null);
  const [state, setState] = useState<{ data: DecisionPlans | null; error: unknown; key: string; sourceRevision: number }>({ data: null, error: null, key: '', sourceRevision: revision });
  const budgetKzt = parseNumber(budget) * 1e6, waterLimitM3 = water.trim() ? parseNumber(water) : null;
  const valid = Number.isFinite(budgetKzt) && budgetKzt > 0 && (waterLimitM3 === null || Number.isFinite(waterLimitM3) && waterLimitM3 >= 0);
  const requestKey = JSON.stringify([budget, water, goal, retry]);
  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    const timer = setTimeout(() => api.decisionLab({ budgetKzt, waterLimitM3, goal, watering: 'regular' }, controller.signal).then(
      data => { if (!controller.signal.aborted) setState({ data, error: null, key: requestKey, sourceRevision: revision }); },
      error => { if (!controller.signal.aborted) setState({ data: null, error, key: requestKey, sourceRevision: revision }); }), 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [api, budgetKzt, waterLimitM3, goal, valid, requestKey]);
  const loading = valid && state.key !== requestKey;
  const raw = valid && !loading ? state.data : null;
  const data = useMemo(() => raw ? evaluateDecisionPlans(raw, watering) : null, [raw, watering]);
  const pct = parseNumber(reduction), customLimit = testLimit.trim() ? parseNumber(testLimit) : null;
  const stressValid = Number.isFinite(pct) && pct >= 0 && pct <= 100 && (customLimit === null || Number.isFinite(customLimit) && customLimit >= 0);
  const limit = waterLimitM3 ?? customLimit;
  const available = stressValid ? waterStress(null, limit, pct).availableM3 : null;
  const suggested = data && data.plans.every(p => p.baseline.waterM3 !== null) ? Math.max(...data.plans.map(p => p.baseline.waterM3!)) : null;
  const rawError = !valid ? new Error(t('lab.invalid')) : !loading ? state.error : null;
  const error = rawError && valid && !(rawError instanceof ApiError && [0, 401, 403].includes(rawError.status)) ? new Error(t('lab.error')) : rawError;
  const resetComparison = () => { setPrevious(null); setReduction('0'); setTestLimit(''); setWatering('regular'); };
  return <div className="gp-page gp-lab">
    <PageHeader eyebrow={t('lab.eyebrow')} title={t('nav.lab')} lead={t('lab.lead')} />
    <section className="gp-card gp-lab-controls" aria-label={t('lab.controls')}>
      <label>{t('lab.budget')}<input className="gp-input" inputMode="decimal" value={budget} onChange={e => { setBudget(e.target.value); resetComparison(); }} /></label>
      <label>{t('lab.limit')}<input className="gp-input" inputMode="decimal" value={water} placeholder={t('lab.unlimited')} onChange={e => { setWater(e.target.value); resetComparison(); }} /></label>
      <label>{t('lab.goal')}<select className="gp-input" value={goal} onChange={e => { setGoal(e.target.value as Goal); resetComparison(); }}>{(['balanced','schools','deficit','social'] as const).map(g => <option key={g} value={g}>{tr(`lab.goal.${g}`)}</option>)}</select></label>
    </section>
    <p className="gp-small gp-muted">{t('lab.fixedHint')}</p>
    {revision !== state.sourceRevision && <p role="status">{t('lab.referenceChanged')}</p>}
    <button className="gp-btn gp-btn--secondary" onClick={() => { resetComparison(); setRetry(n => n + 1); }}>{t('lab.refresh')}</button>
    <section className="gp-card gp-lab-controls" aria-label={t('lab.testPlan')}>
      <h2>{t('lab.testPlan')}</h2>
      <label>{t('lab.reduction')}<input className="gp-input" inputMode="decimal" value={reduction} onChange={e => setReduction(e.target.value)} /></label>
      <div className="gp-lab-options">{[0,10,30,50].map(n => <button key={n} className="gp-btn gp-btn--secondary" aria-pressed={pct === n} onClick={() => setReduction(String(n))}>{n ? `−${n}%` : '0%'}</button>)}</div>
      {waterLimitM3 === null && <label>{t('lab.referenceWater')}<input className="gp-input" inputMode="decimal" value={testLimit} onChange={e => setTestLimit(e.target.value)} /></label>}
      {waterLimitM3 === null && suggested !== null && <button className="gp-btn gp-btn--secondary" onClick={() => setTestLimit(String(suggested))}>{t('lab.useSuggested', { value: number(suggested) })}</button>}
      <fieldset><legend>{t('lab.watering')}</legend><div className="gp-lab-options">{(['regular','rare','none'] as const).map(w => <label key={w} className={watering === w ? 'is-selected' : ''}><input type="radio" name="lab-watering" checked={watering === w} onChange={() => setWatering(w)} />{t(`lab.watering.${w}`)}</label>)}</div></fieldset>
      <p>{t('lab.waterNotSurvival')}</p>
      {!stressValid && <p role="alert">{t('lab.invalidStress')}</p>}
      <button className="gp-btn" disabled={!data || available === null || !stressValid} onClick={() => { setPrevious(data); setWater(String(available)); setReduction('0'); setTestLimit(''); setWatering('regular'); }}>{t('lab.rebuild')}</button>
    </section>
    <section className="gp-lab-results" aria-label={t('lab.results')} aria-busy={loading} aria-live="polite">
      <StateView loading={loading} error={error} hasData={!!data} onRetry={valid ? () => setRetry(x => x + 1) : undefined}>{data && <>
        {data.identical && <p role="status" className="gp-lab-empty">{t('lab.identical')}</p>}
        {data.plans.every(p => !p.zones.length) && <p role="status" className="gp-lab-empty">{t('lab.empty')}</p>}
        <p className="gp-small">{t('lab.snapshot')}: {t(data.basis.provenance.source === 'mock' ? 'lab.source.mock' : 'lab.source.api')} · {new Date(data.basis.provenance.capturedAt).toLocaleString(getLang() === 'kk' ? 'kk-KZ' : 'ru-RU', { timeZone: 'Asia/Qyzylorda' })} (UTC+5) · {t('lab.rateVersion')}: {data.basis.provenance.ratesVersion ?? t('lab.unknown')}</p>
        <div className="gp-lab-grid">{data.plans.map(p => <PlanCard key={p.id} plan={p} watering={watering} limit={stressValid ? limit : null} reduction={stressValid ? pct : 0} previous={previous?.plans.find(b => b.id === p.id)} />)}</div>
        <Risks data={data} onChange={next => setState({ data: next, error: null, key: requestKey, sourceRevision: state.sourceRevision })} />
        <details className="gp-lab-assumptions"><summary>{t('lab.assumptions')}</summary><ul>{data.assumptions.map(k => <li key={k}>{tr(k)}</li>)}</ul></details>
      </>}</StateView>
    </section>
    <aside className="gp-lab-note"><p>{t('lab.assumption.estimate')}</p><p>{t('lab.assumption.water')}</p></aside>
  </div>;
}
