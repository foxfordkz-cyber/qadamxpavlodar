import { useEffect, useState, type ReactNode } from 'react';
import { useData } from '../../../shared/api/DataProvider';
import type { OutcomeSiteData } from '../../../shared/api/outcomesClient';
import type { CandidateSite, Species } from '../../../shared/api/types';
import { newIdempotencyKey } from '../../../shared/api/transport';
import { speciesName, t, type Key } from '../../../shared/i18n';
import { useLanguage } from '../../../shared/i18n/useLanguage';
import { hrefFor, navigate, useRoute } from '../../../shared/router';
import { fmtDate } from '../../../shared/format';
import { Button, useGuarded } from '../../../shared/ui/components';
import { PageHeader } from '../PageHeader';
import { useMe } from '../me';
import { loadOutcomePlans } from './pageModel';
import { outcomeRequest } from './resource';
import { InspectionView, OutcomeError, OutcomeIssues, ProvenanceLine, SnapshotView, VariantCard } from './OutcomeViews';
import './outcomes-page.css';

const DEMO_SITE = 'site-osm-1569993037';
function useOutcomeLoad<T>(load: () => Promise<T>, key: string) {
  const { revision } = useData();
  const [tick, setTick] = useState(0);
  const requestKey = `${key}:${revision}:${tick}`;
  const [state, setState] = useState<{ key: string; data: T | null; loading: boolean; error: unknown }>({ key: '', data: null, loading: true, error: null });
  useEffect(() => outcomeRequest(load, next => setState({ ...next, key: requestKey })), [requestKey]);
  // Hide old values immediately, including the render before the effect starts.
  return { ...(state.key === requestKey ? state : { data: null, loading: true, error: null }), reload: () => setTick(n => n + 1) };
}
function Loaded({ state, children }: { state: { loading: boolean; error: unknown; reload: () => void }; children: ReactNode }) {
  if (state.loading) return <p className="gp-state" role="status">{t('state.loading')}</p>;
  if (state.error) return <OutcomeError error={state.error} retry={state.reload} />;
  return <>{children}</>;
}

export function OutcomesPage() {
  useLanguage();
  const { api, mode } = useData();
  const me = useMe();
  const route = useRoute();
  const sites = useOutcomeLoad(() => api.sites().then(r => r.data), `${mode}:${me.id}:sites`);
  const requested = route.params.get('site');
  const selected = requested ? sites.data?.find(s => s.id === requested) : sites.data?.find(s => s.id === DEMO_SITE) ?? sites.data?.[0];
  return <div className="gp-page gp-outcomes-page">
    <PageHeader title={t('nav.outcomes')} lead={t('outcomePage.lead')} />
    <Loaded state={sites}>{sites.data && <>
      <label className="gp-outcome-picker">{t('outcomePage.zone')}
        <select className="gp-input" aria-label={t('outcomePage.zone')} value={selected?.id ?? ''} onChange={e => navigate('/outcomes', { site: e.target.value })}>
          <option value="" disabled>{t('outcomePage.noData')}</option>
          {sites.data.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {selected ? <ZoneOutcomes key={`${mode}:${me.id}:${selected.id}`} site={selected} /> : <p>{t('outcomePage.noData')}</p>}
    </>}</Loaded>
  </div>;
}

function ZoneOutcomes({ site }: { site: CandidateSite }) {
  const { api, mode } = useData();
  const me = useMe();
  const [treesOnly, setTreesOnly] = useState(true);
  const [savedId, setSavedId] = useState('');
  const history = useOutcomeLoad(() => api.outcomes.list(site.id), `${site.id}:history`);
  const plans = useOutcomeLoad(() => loadOutcomePlans(api, site.id, treesOnly), `${site.id}:plans:${treesOnly}`);
  const saved = (id: string) => { setSavedId(id); history.reload(); };
  return <>
    <section className="gp-outcome-section" aria-labelledby="outcome-plan">
      <h2 id="outcome-plan">{t('outcomePage.plan')}</h2>
      <p>{t('outcomePage.planNote')}</p>
      <label className="gp-outcome-toggle"><input type="checkbox" checked={treesOnly} onChange={e => setTreesOnly(e.target.checked)} />{t('outcomePage.treesOnly')}</label>
      {!treesOnly && <p>{t('outcomePage.mixedNote')}</p>}
      <Loaded state={plans}>{plans.data && <>
        <p className="gp-small gp-muted">{t('outcomePage.bestNote')}</p>
        <div className="gp-outcome-variants gp-outcomes">{plans.data.variants.map((v, i) => <VariantCard key={v.id} variant={v} best={plans.data!.comparison.comparable && plans.data!.comparison.bestVariantIds.includes(v.id)}>
          {api.outcomes.available && me.role === 'coordinator' && <SaveForecast key={`${treesOnly}:${v.id}:${v.provenance.capturedAt}`}
            input={plans.data!.inputs[i]} onSaved={saved} />}
        </VariantCard>)}</div>
        <OutcomeIssues issues={plans.data.comparison.issues} />
        <p className="gp-small gp-muted">{t('outcomePage.expectation')}</p>
        <p className="gp-small gp-muted">{t('outcomePage.synthetic')}</p>
      </>}</Loaded>
      {mode === 'mock' && <p className="gp-small gp-muted">{t('outcomePage.localSave')}</p>}
    </section>
    <Loaded state={history}>{history.data && <>
      {history.data.cohorts.some(c => c.id.startsWith('outcome-demo-') && c.provenance.isDemo) && <p className="gp-alert gp-alert--warn">{t('outcomePage.demoHistory')}</p>}
      {history.data.cohorts.length ? <CohortSelector data={history.data} catalog={plans.data?.inputs[0]?.catalog ?? []} /> : <div className="gp-card gp-outcome-section">
        <h2>{t('outcomePage.planted')}</h2><p>{t('outcomePage.empty')}</p>
        {mode === 'mock' && <a className="gp-btn" href={hrefFor('/outcomes', { site: DEMO_SITE })}>{t('outcomePage.demoLink')}</a>}
      </div>}
      <SavedForecasts key={savedId} data={history.data} selectedId={savedId} />
    </>}</Loaded>
  </>;
}

function SaveForecast({ input, onSaved }: { input: Awaited<ReturnType<typeof loadOutcomePlans>>['inputs'][number]; onSaved: (id: string) => void }) {
  const { api } = useData();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const { run, busy } = useGuarded();
  return <div className="gp-outcome-save">
    <Button disabled={done} busy={busy} onClick={() => run(async () => {
      setError(null);
      try {
        const saved = await api.outcomes.saveForecast(input.site.id, { options: input.analysis.options,
          siteVersion: input.site.version, ratesVersion: input.provenance.ratesVersion! }, idempotencyKey);
        setDone(true); onSaved(saved.id);
      } catch (e) { setError(e); }
    })}>{t('outcomePage.save')}</Button>
    {done && <p role="status">{t('outcomePage.saved')}</p>}{error != null && <OutcomeError error={error} />}
  </div>;
}

function cohortLabel(id: string, index: number) {
  const scenarios: Record<string, Key> = { 'outcome-demo-full': 'outcomePage.scenario.full', 'outcome-demo-partial': 'outcomePage.scenario.partial', 'outcome-demo-undated': 'outcomePage.scenario.undated' };
  return scenarios[id] ? t(scenarios[id]) : t('outcomePage.cohortLabel', { n: index + 1 });
}
function CohortSelector({ data, catalog }: { data: OutcomeSiteData; catalog: Species[] }) {
  const [id, setId] = useState(data.cohorts[0]?.id ?? '');
  const cohort = data.cohorts.find(c => c.id === id && c.siteId === data.siteId);
  return <>
    <section className="gp-card gp-outcome-section">
      <h2>{t('outcomePage.planted')}</h2>
      <label className="gp-outcome-picker">{t('outcomePage.cohort')}<select className="gp-input" aria-label={t('outcomePage.cohort')} value={cohort?.id ?? ''} onChange={e => setId(e.target.value)}>
        <option value="" disabled>{t('outcomePage.noData')}</option>
        {data.cohorts.map((c, i) => <option key={c.id} value={c.id}>{cohortLabel(c.id, i)}</option>)}
      </select></label>
      <p className="gp-small gp-muted">{t('outcomePage.asOf', { date: fmtDate(data.asOf) })}</p>
      {cohort && <>
        <p>{t('outcomePage.plantedOn')}: <strong>{cohort.plantedOn ? fmtDate(cohort.plantedOn) : t('outcomePage.noData')}</strong></p>
        <ProvenanceLine label={t('outcomePage.source.planting')} value={cohort.provenance} />
        <p className="gp-small gp-muted">{t('outcomePage.registry')}</p>
        <table className="gp-table gp-small"><thead><tr><th>{t('outcomePage.species')}</th><th>{t('outcomePage.quantity')}</th></tr></thead><tbody>
          {[...new Set(cohort.plants.map(p => p.speciesId))].map(speciesId => <tr key={speciesId}><th scope="row">{speciesName((cohort.forecast?.catalog ?? catalog).find(s => s.id === speciesId), t('outcomePage.noData'))}</th><td>{cohort.plants.filter(p => p.speciesId === speciesId).length}</td></tr>)}
        </tbody></table>
      </>}
    </section>
    {cohort && <InspectionSelector key={cohort.id} data={data} cohortId={cohort.id} />}
  </>;
}
function InspectionSelector({ data, cohortId }: { data: OutcomeSiteData; cohortId: string }) {
  const inspections = data.inspections.filter(i => i.cohortId === cohortId);
  const [id, setId] = useState(inspections[0]?.id ?? '');
  return <>
    <label className="gp-outcome-picker">{t('outcomePage.inspection')}<select className="gp-input" aria-label={t('outcomePage.inspection')} value={id} onChange={e => setId(e.target.value)}>
      <option value="">{t('outcomePage.withoutInspection')}</option>
      {inspections.map(i => <option key={i.id} value={i.id}>{fmtDate(i.observedOn)}</option>)}
    </select></label>
    <InspectionView data={data} cohortId={cohortId} inspectionId={id || null} />
  </>;
}
function SavedForecasts({ data, selectedId }: { data: OutcomeSiteData; selectedId: string }) {
  const [id, setId] = useState(selectedId || data.forecasts[0]?.id || '');
  const selected = data.forecasts.find(f => f.id === id && f.snapshot.analysis.siteId === data.siteId);
  return <section className="gp-card gp-outcome-section">
    <h2>{t('outcomePage.snapshots')}</h2><p className="gp-small gp-muted">{t('outcomePage.snapshotNote')}</p>
    {data.forecasts.length ? <>
      <label className="gp-outcome-picker">{t('outcomePage.snapshots')}<select className="gp-input" aria-label={t('outcomePage.snapshots')} value={selected?.id ?? ''} onChange={e => setId(e.target.value)}>
        <option value="" disabled>{t('outcomePage.noData')}</option>
        {data.forecasts.map((f, i) => <option value={f.id} key={f.id}>{t('outcomePage.snapshot', { n: i + 1, date: fmtDate(f.snapshot.provenance.capturedAt) })}</option>)}
      </select></label>
      {selected && <SnapshotView snapshot={selected.snapshot} />}
    </> : <p>{t('outcomePage.noSnapshots')}</p>}
  </section>;
}
