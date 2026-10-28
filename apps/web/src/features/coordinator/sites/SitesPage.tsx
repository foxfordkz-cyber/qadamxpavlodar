import { useCallback, useMemo, useState } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import type { CandidateSite, PlantingProject, Task } from '../../../shared/api/types';
import { Button, EligBadge, Freshness, StateView } from '../../../shared/ui/components';
import { t, type Key } from '../../../shared/i18n';
import { fmtArea } from '../../../shared/format';
import { navigate, useRoute } from '../../../shared/router';
import { LazySiteMap as SiteMap } from '../map/LazySiteMap';
import { validateSiteGeometry } from '../map/geo';
import { applyFilters, download, emptyFilters, isFiltered, sitesToCsv, type SiteFilters } from './filters';
import { eligibilityOf } from './eligibility';
import { SiteCard } from './SiteCard';
import { Metrics } from '../dashboard/Metrics';

export function SitesPage() {
  const { api } = useData();
  const route = useRoute();
  const selectedId = route.params.get('site');
  // Опрос раз в 30 с: изменения с сервера (проверки, отчёты) видны без перезагрузки.
  const sitesRes = useResource(() => api.sites(), [], 30000);
  const tasksRes = useResource(() => api.tasks(), [], 30000);
  const plantsRes = useResource(() => api.plants(), [], 30000);
  const projectsRes = useResource(() => api.projects(), [], 30000);
  // Окружение грузится один раз на участок и радиус — не при каждом движении карты (B19).
  const [radius, setRadius] = useState(50);
  const ctxRes = useResource(() => (selectedId ? api.siteContext(selectedId, radius) : Promise.resolve(null)), [selectedId, radius]);
  const [f, setF] = useState<SiteFilters>(emptyFilters);
  const [focusSeq, setFocusSeq] = useState(0);
  const [tab, setTab] = useState<'list' | 'map'>('list');

  const sites = useMemo(() => sitesRes.data?.data ?? [], [sitesRes.data]);
  const tasks = useMemo(() => tasksRes.data?.data ?? [], [tasksRes.data]);
  const visible = useMemo(() => applyFilters(sites, tasks, f), [sites, tasks, f]);
  const badGeometry = useMemo(() => sites.map((s) => [s, validateSiteGeometry(s)] as const).filter(([, e]) => e), [sites]);
  const validSites = useMemo(() => visible.filter((s) => !validateSiteGeometry(s)), [visible]);
  const elig = useCallback((s: CandidateSite) => eligibilityOf(s), []);
  const planned = useMemo(() => plannedPoints(projectsRes.data?.data ?? []), [projectsRes.data]);

  const select = (id: string, fromList: boolean) => {
    navigate('/map', { site: id }, true);
    if (fromList) {
      setFocusSeq((x) => x + 1);
      setTab('map');
    }
  };
  const set = <K extends keyof SiteFilters>(k: K, v: SiteFilters[K]) => setF((p) => ({ ...p, [k]: v }));
  const osmMeta = sitesRes.data?.meta?.osm as { osmBase?: string } | undefined;

  return (
    <div className={`gp-sites ${selectedId ? 'gp-sites--card' : ''}`} data-tab={tab}>
      <aside className="gp-sites__list gp-card" aria-label={t('filters.title')}>
        <div className="gp-sites__filters">
          <Metrics compact />
          <label className="gp-sr" htmlFor="site-q">{t('filters.search')}</label>
          <input id="site-q" className="gp-input" type="search" placeholder={t('filters.search')} value={f.q} onChange={(e) => set('q', e.target.value)} />
          <div className="gp-grid-2 gp-filters-grid">
            <label className="gp-field"><span className="gp-field__label">{t('filters.status')}</span>
              <select className="gp-input" value={f.elig} onChange={(e) => set('elig', e.target.value as SiteFilters['elig'])}>
                <option value="all">{t('filters.all')}</option>
                <option value="survey_needed">{t('elig.survey_needed')}</option>
                <option value="blocked">{t('elig.blocked')}</option>
                <option value="planting_candidate">{t('elig.planting_candidate')}</option>
              </select>
            </label>
            <label className="gp-field"><span className="gp-field__label">{t('filters.area')}</span>
              <select className="gp-input" value={f.area} onChange={(e) => set('area', e.target.value as SiteFilters['area'])}>
                <option value="any">{t('filters.area.any')}</option>
                <option value="small">{t('filters.area.small')}</option>
                <option value="medium">{t('filters.area.medium')}</option>
                <option value="large">{t('filters.area.large')}</option>
              </select>
            </label>
            <label className="gp-field"><span className="gp-field__label">{t('filters.hasTask')}</span>
              <select className="gp-input" value={f.task} onChange={(e) => set('task', e.target.value as SiteFilters['task'])}>
                <option value="any">{t('filters.hasTask.any')}</option>
                <option value="open">{t('filters.hasTask.open')}</option>
                <option value="none">{t('filters.hasTask.none')}</option>
              </select>
            </label>
            <label className="gp-check gp-filters-hints"><input type="checkbox" checked={f.hints} onChange={(e) => set('hints', e.target.checked)} />{t('filters.hints')}</label>
          </div>
          <div className="gp-sites__count" aria-live="polite">
            <strong>{t('filters.found', { n: visible.length, total: sites.length })}</strong>
            {isFiltered(f) && <Button variant="ghost" onClick={() => setF(emptyFilters)}>✕ {t('filters.reset')}</Button>}
          </div>
          <Freshness updatedAt={sitesRes.updatedAt} error={sitesRes.error} loading={sitesRes.loading} onRefresh={() => { sitesRes.reload(); tasksRes.reload(); }} />
        </div>
        <StateView loading={sitesRes.loading} error={sitesRes.error} hasData={!!sitesRes.data} onRetry={sitesRes.reload} empty={!!sitesRes.data && visible.length === 0} emptyText={t('filters.empty')}>
          <ul className="gp-list gp-sites__items">
            {visible.map((s) => <SiteRow key={s.id} s={s} tasks={tasks} selected={s.id === selectedId} onSelect={() => select(s.id, true)} />)}
          </ul>
        </StateView>
        {visible.length > 0 && (
          <div className="gp-sites__foot">
            <Button variant="ghost" onClick={() => download('green-pavlodar-sites.csv', sitesToCsv(visible))}>⤓ {t('filters.export')}</Button>
          </div>
        )}
      </aside>

      <section className="gp-sites__map" aria-label={t('map.title')}>
        {badGeometry.length > 0 && (
          <div className="gp-alert gp-alert--bad" role="alert">Не показаны на карте из-за координат: {badGeometry.map(([s, e]) => `${s.id} (${e})`).join('; ')}</div>
        )}
        <SiteMap sites={validSites} eligibility={elig} selectedId={selectedId} onSelect={(id) => select(id, false)} focusSeq={focusSeq} context={ctxRes.data} plants={plantsRes.data?.data ?? []} planned={planned} />
        <MapLegend osmBase={osmMeta?.osmBase} />
      </section>

      {selectedId && (
        <aside className="gp-sites__card gp-card" aria-label={t('site.card')}>
          <SiteCard id={selectedId} tasks={tasks.filter((x) => x.objectId === selectedId)} onClose={() => navigate('/map', {}, true)} onChanged={() => { sitesRes.reload(); tasksRes.reload(); }}
            context={{ data: ctxRes.data ?? null, error: ctxRes.error, loading: ctxRes.loading, radius, setRadius, reload: ctxRes.reload }}
            projects={(projectsRes.data?.data ?? []).filter((p) => p.siteId === selectedId)} plants={(plantsRes.data?.data ?? []).filter((p) => (projectsRes.data?.data ?? []).some((pr) => pr.id === p.projectId && pr.siteId === selectedId))} />
        </aside>
      )}

      <div className="gp-sites__tabs" role="tablist" aria-label="Вид">
        <button role="tab" aria-selected={tab === 'list'} onClick={() => setTab('list')}>☰ Список</button>
        <button role="tab" aria-selected={tab === 'map'} onClick={() => setTab('map')}>◫ Карта</button>
      </div>
    </div>
  );
}

/** Позиции согласуемых и черновых проектов, ещё не реализованных: после приёмки они не дублируют существующие растения. */
function plannedPoints(projects: PlantingProject[]) {
  return projects
    .filter((p) => !p.implementedAt)
    .flatMap((p) => p.items.map((it) => {
      const [lng, lat] = it.geometry.type === 'Point' ? it.geometry.coordinates : it.geometry.coordinates[0][0];
      return { lng, lat, label: p.title };
    }));
}

function SiteRow({ s, tasks, selected, onSelect }: { s: CandidateSite; tasks: Task[]; selected: boolean; onSelect: () => void }) {
  const open = tasks.filter((x) => x.objectId === s.id && x.status !== 'verified').length;
  return (
    <li>
      <button className="gp-list-item" aria-current={selected} onClick={onSelect}>
        <span className="gp-list-item__title"><span>{s.name}</span><EligBadge value={eligibilityOf(s)} /></span>
        <span className="gp-list-item__meta">
          <span>{fmtArea(s.areaM2)}</span>
          <span>· {s.id}</span>
          {open > 0 && <span>· заданий: {open}</span>}
          {!!s.context?.hints?.length && <span title={s.context.hints.join(' ')}>· <span aria-hidden="true">⚠</span> подсказки: {s.context.hints.length}</span>}
          {s.isDemo && <span>· демо</span>}
        </span>
      </button>
    </li>
  );
}

type LegendMode = 'closed' | 'compact' | 'full';
const LEGEND_KEY = 'gp-legend-mode';

function readLegendMode(): LegendMode {
  try {
    const v = localStorage.getItem(LEGEND_KEY);
    if (v === 'closed' || v === 'compact' || v === 'full') return v;
  } catch {
    /* без хранилища — значение по умолчанию */
  }
  return matchMedia('(max-width: 760px)').matches ? 'closed' : 'compact';
}

/** Легенда: свернуть, компактно (значки), полностью (с пояснениями; угол тянется мышью). */
function MapLegend({ osmBase }: { osmBase?: string }) {
  const [mode, setModeState] = useState<LegendMode>(readLegendMode);
  const setMode = (m: LegendMode) => {
    setModeState(m);
    try {
      localStorage.setItem(LEGEND_KEY, m);
    } catch {
      /* не сохраняется — не страшно */
    }
  };
  const rows: [string, Key, Key][] = [
    ['survey', 'map.legend.survey', 'legend.short.survey'],
    ['blocked', 'map.legend.blocked', 'legend.short.blocked'],
    ['cleared', 'map.legend.cleared', 'legend.short.cleared'],
    ['selected', 'map.legend.selected', 'legend.short.selected'],
    ['building', 'map.legend.buildings', 'legend.short.buildings'],
    ['ctx', 'map.legend.context', 'legend.short.context'],
    ['existing', 'map.legend.existing', 'legend.short.existing'],
    ['planned', 'map.legend.planned', 'legend.short.planned'],
  ];
  if (mode === 'closed')
    return (
      <button className="gp-legend gp-legend--closed gp-card" onClick={() => setMode('compact')} aria-expanded="false">
        <span aria-hidden="true">▤ </span>{t('map.legend')}
      </button>
    );
  return (
    <section className={`gp-legend gp-legend--${mode} gp-card`} aria-label={t('map.legend')}>
      <div className="gp-legend__head">
        <strong>{t('map.legend')}</strong>
        <div className="gp-legend__btns" role="group" aria-label={t('legend.size')}>
          <button onClick={() => setMode('compact')} aria-pressed={mode === 'compact'} title={t('legend.compact')} aria-label={t('legend.compact')}>▭</button>
          <button onClick={() => setMode('full')} aria-pressed={mode === 'full'} title={t('legend.full')} aria-label={t('legend.full')}>▢</button>
          <button onClick={() => setMode('closed')} title={t('legend.close')} aria-label={t('legend.close')}>✕</button>
        </div>
      </div>
      <ul>
        {rows.map(([sw, full, short]) => (
          <li key={sw}><span className={`gp-swatch gp-swatch--${sw}`} aria-hidden="true" /> {t(mode === 'full' ? full : short)}</li>
        ))}
      </ul>
      {mode === 'full' && <p className="gp-small gp-muted">{t('map.osmCandidatesNote')}{osmBase ? ` Снимок OSM: ${osmBase.slice(0, 10)}.` : ''} {t('legend.resizeHint')}</p>}
    </section>
  );
}
