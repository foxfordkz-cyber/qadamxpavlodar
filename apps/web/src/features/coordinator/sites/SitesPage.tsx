import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import type { CandidateSite, PlantingProject, Task } from '../../../shared/api/types';
import { Button, EligBadge, Freshness, StateView } from '../../../shared/ui/components';
import { t, type Key } from '../../../shared/i18n';
import { fmtArea } from '../../../shared/format';
import { hrefFor, navigate, useRoute } from '../../../shared/router';
import { LazySiteMap as SiteMap } from '../map/LazySiteMap';
import { validateSiteGeometry } from '../map/geo';
import { applyFilters, download, emptyFilters, isFiltered, sitesToCsv, type SiteFilters } from './filters';
import { eligibilityOf } from './eligibility';
import { highlightTitle } from './highlightTitle';
import { SiteCard } from './SiteCard';
import { Metrics } from '../dashboard/Metrics';
import type { PriorityItem } from '../../../shared/analytics/city';
import { usePriorityWeights, WeightSliders } from '../tz/PriorityWeights';
import { DrawBar, MapSearch } from '../map/MapTools';
import { useMe } from '../me';
import type { GeoHit } from '../../../shared/api/geocode';
import { GROWTH_YEARS, growthFrame, timeMachine, useTimeMachine, YEAR_LABEL } from '../zone/timeMachine';

export function SitesPage() {
  const { api } = useData();
  const route = useRoute();
  const selectedId = route.params.get('site');
  // Зоны из ответа ассистента или дорожной карты (#/map?hl=id1,id2&hlt=заголовок) — подсветка переживает выбор зоны.
  const hlKey = route.params.get('hl') ?? '';
  const hlTitle = highlightTitle(route.params.get('hlt'), route.params.get('hlb'));
  const hlIds = useMemo(() => hlKey.split(',').filter(Boolean).slice(0, 30), [hlKey]);
  const [hlSeq, setHlSeq] = useState(0);
  useEffect(() => { if (hlKey) setHlSeq((x) => x + 1); }, [hlKey]);
  const highlight = useMemo(() => (hlIds.length ? { ids: hlIds, seq: hlSeq } : null), [hlIds, hlSeq]);
  const keepHl = hlKey ? { hl: hlKey, hlt: route.params.get('hlt'), hlb: route.params.get('hlb') } : {};
  const clearHl = () => navigate('/map', { site: selectedId }, true);
  // Машина времени включается во вкладке «Эффект» карточки, а посадка растёт здесь, на карте, — только у открытой зоны.
  const tm = useTimeMachine();
  const growth = useMemo(() => (tm.scene && tm.scene.siteId === selectedId ? growthFrame(tm.scene, tm.year) : null), [tm, selectedId]);
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
  // Телефон: карточка зоны — шторка на полэкрана над картой; ручка разворачивает её целиком.
  const [sheetFull, setSheetFull] = useState(false);

  const sites = useMemo(() => sitesRes.data?.data ?? [], [sitesRes.data]);
  const tasks = useMemo(() => tasksRes.data?.data ?? [], [tasksRes.data]);
  const visible = useMemo(() => applyFilters(sites, tasks, f), [sites, tasks, f]);
  const badGeometry = useMemo(() => sites.map((s) => [s, validateSiteGeometry(s)] as const).filter(([, e]) => e), [sites]);
  const validSites = useMemo(() => visible.filter((s) => !validateSiteGeometry(s)), [visible]);
  const elig = useCallback((s: CandidateSite) => eligibilityOf(s), []);
  const [layers, setLayers] = useState<LayerState>(readLayers);
  const toggleLayer = (k: keyof LayerState) => setLayers((l) => { const n = { ...l, [k]: !l[k], ...(k === 'problems' && !l.problems ? { priority: false } : {}), ...(k === 'priority' && !l.priority ? { problems: false } : {}) }; try { localStorage.setItem('gp-layers', JSON.stringify(n)); } catch { /* без хранилища */ } return n; });
  const soilsRes = useResource(() => (layers.soils ? api.soilsLayer() : Promise.resolve(null)), [layers.soils]);
  const greenRes = useResource(() => (layers.greenery ? api.greeneryLayer() : Promise.resolve(null)), [layers.greenery]);
  const problemsRes = useResource(() => (layers.problems ? api.problems() : Promise.resolve(null)), [layers.problems]);
  // Веса двигаются прямо на карте: слой перекрашивается после паузы 300 мс (сервер кэширует расчёт по весам).
  const prio = usePriorityWeights();
  const prioRes = useResource(() => (layers.priority ? api.priorities(prio.debounced, null) : Promise.resolve(null)), [layers.priority, JSON.stringify(prio.debounced)]);
  const zoneTint = useMemo(() => {
    if (layers.problems && problemsRes.data) {
      const sev: Record<string, number> = {};
      const rank = { high: 3, medium: 2, low: 1 };
      for (const p of problemsRes.data.data.problems) sev[p.siteId] = Math.max(sev[p.siteId] ?? 0, rank[p.severity]);
      return Object.fromEntries(Object.entries(sev).map(([id, v]) => [id, v === 3 ? '#b3261e' : v === 2 ? '#e0892b' : '#e8cf5a']));
    }
    if (layers.priority && prioRes.data) return Object.fromEntries(prioRes.data.items.map((p) => [p.siteId, prioColor(p.index)]));
    return null;
  }, [layers.problems, layers.priority, problemsRes.data, prioRes.data]);
  const planned = useMemo(() => (layers.proposed ? plannedPoints(projectsRes.data?.data ?? []) : []), [projectsRes.data, layers.proposed]);

  // Клик по зоне на карте камеру не двигает; выбор из списка и переходы извне (ассистент, «Проблемы»,
  // «Приоритеты», ссылка на карточку) приводят камеру к зоне.
  const pickedHere = useRef<string | null>(null);
  const select = (id: string, fromList: boolean) => {
    pickedHere.current = id;
    navigate('/map', { site: id, ...keepHl }, true);
    if (fromList) {
      setFocusSeq((x) => x + 1);
      setTab('map');
    }
  };
  useEffect(() => {
    if (selectedId && selectedId !== pickedHere.current) setFocusSeq((x) => x + 1);
    pickedHere.current = null;
  }, [selectedId]);
  const names = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites]);

  // ТЗ 3.1.4: поиск по адресу и рисование зоны. Рисует специалист; сервер повторяет проверку роли и контура.
  const me = useMe();
  const canDraw = me.role === 'coordinator';
  const [drawPoints, setDrawPoints] = useState<[number, number][] | null>(null);
  const [target, setTarget] = useState<{ lng: number; lat: number; bbox?: [number, number, number, number]; label: string; seq: number } | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  // Ассистент («нарисуй зону») открывает карту с ?draw=1: включаем рисование и убираем параметр из адреса.
  const drawParam = route.params.get('draw');
  useEffect(() => {
    if (drawParam !== '1') return;
    if (canDraw) { setSavedNote(null); setDrawPoints([]); setTab('map'); }
    navigate('/map', { site: selectedId, ...keepHl }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawParam, canDraw]);
  const pickPlace = (h: GeoHit) => {
    if (h.zoneId) { setTarget(null); select(h.zoneId, true); return; }
    setTarget((prev) => ({ lng: h.lng, lat: h.lat, ...(h.bbox ? { bbox: h.bbox } : {}), label: h.label, seq: (prev?.seq ?? 0) + 1 }));
    setTab('map');
  };
  const toolbarExtra = drawPoints ? (
    <DrawBar points={drawPoints} onUndo={() => setDrawPoints((p) => (p ? p.slice(0, -1) : p))} onCancel={() => setDrawPoints(null)}
      onSaved={(site, note) => {
        setDrawPoints(null);
        setSavedNote(t('sites.saved', { name: site.name, id: site.id }) + (note ? ` ${note}` : ''));
        sitesRes.reload();
        select(site.id, true);
      }} />
  ) : (
    <>
      <MapSearch onPick={pickPlace} />
      {canDraw && <button type="button" className="gp-btn gp-btn--secondary" onClick={() => { setSavedNote(null); setDrawPoints([]); setTab('map'); }} title={t('sites.drawTitle')}>✎ {t('sites.draw')}</button>}
    </>
  );
  useEffect(() => {
    if (!savedNote) return;
    const id = setTimeout(() => setSavedNote(null), 8000);
    return () => clearTimeout(id);
  }, [savedNote]);
  const set = <K extends keyof SiteFilters>(k: K, v: SiteFilters[K]) => setF((p) => ({ ...p, [k]: v }));
  const osmMeta = sitesRes.data?.meta?.osm as { osmBase?: string } | undefined;
  // С открытой карточкой на обычном экране карте мало места: панели поверх неё закрывают саму зону.
  const tightMap = !!selectedId && matchMedia('(max-width: 1600px)').matches;

  return (
    <div className={`gp-sites ${selectedId ? 'gp-sites--card' : ''} ${growth ? 'gp-sites--growth' : ''} ${highlight ? 'gp-sites--hl' : ''}`} data-tab={tab}>
      <aside className="gp-sites__list gp-card" aria-label={t('filters.title')}>
        {highlight && <HighlightList title={hlTitle} ids={hlIds} names={names} selectedId={selectedId} onPick={(id) => select(id, true)} onClear={clearHl} />}
        <div className="gp-sites__filters">
          <Metrics compact />
          <label className="gp-sr" htmlFor="site-q">{t('filters.search')}</label>
          <input id="site-q" className="gp-input" type="search" placeholder={t('filters.search')} value={f.q} onChange={(e) => set('q', e.target.value)} />
          {/* Фильтры свёрнуты: на ноутбуке они занимали половину колонки и оставляли в списке две зоны. */}
          <details className="gp-filters-more" open={isFiltered(f)}>
          <summary>{t('filters.title')}</summary>
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
          </details>
          <div className="gp-sites__count" aria-live="polite">
            <strong>{t('filters.found', { n: visible.length, total: sites.length })}</strong>
            {isFiltered(f) && <Button variant="ghost" onClick={() => setF(emptyFilters)}>✕ {t('filters.reset')}</Button>}
          </div>
          <Freshness updatedAt={sitesRes.updatedAt} error={sitesRes.error} loading={sitesRes.loading} onRefresh={() => { sitesRes.reload(); tasksRes.reload(); }} />
        </div>
        <StateView loading={sitesRes.loading} error={sitesRes.error} hasData={!!sitesRes.data} onRetry={sitesRes.reload} empty={!!sitesRes.data && visible.length === 0} emptyText={t('filters.empty')} emptyAction={<Button onClick={() => setF(emptyFilters)}>✕ {t('filters.reset')}</Button>}>
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
          <div className="gp-alert gp-alert--bad" role="alert">{t('sites.badGeometry', { list: badGeometry.map(([s, e]) => `${s.id} (${e})`).join('; ') })}</div>
        )}
        <SiteMap sites={validSites} eligibility={elig} selectedId={selectedId} onSelect={(id) => select(id, false)} focusSeq={focusSeq} context={ctxRes.data} plants={layers.greenery ? plantsRes.data?.data ?? [] : []} planned={planned} soils={layers.soils ? (soilsRes.data?.data as never) : null} greenery={layers.greenery ? (greenRes.data?.data as never) : null} zoneTint={zoneTint}
          drawPoints={drawPoints} onDrawPoint={(p) => setDrawPoints((prev) => (prev ? [...prev, p] : prev))} target={target} toolbarExtra={toolbarExtra} highlight={highlight} growth={growth} />
        {savedNote && <div className="gp-alert gp-alert--ok gp-map__saved" role="status">{savedNote}</div>}
        {growth && (
          <div className="gp-tm-bar gp-card" role="group" aria-label={t('timeMachine.barLabel')}>
            <strong aria-hidden="true">⏳</strong>
            <div className="gp-segment">
              {GROWTH_YEARS.map((y) => <label key={y}><input type="radio" name="tm-bar" checked={tm.year === y} onChange={() => timeMachine.setYear(y)} />{t(YEAR_LABEL[y])}</label>)}
            </div>
            {tm.scene && <button className="gp-icon-btn" onClick={() => (tm.playing ? timeMachine.stop() : timeMachine.play(tm.scene!))} aria-label={t(tm.playing ? 'timeMachine.stop' : 'timeMachine.play')}>{tm.playing ? '⏸' : '▶'}</button>}
            <button className="gp-icon-btn" onClick={() => timeMachine.hide()} aria-label={t('timeMachine.hide')}>✕</button>
          </div>
        )}
        {highlight && (
          <div className="gp-hl-pill gp-card" role="status">
            <span className="gp-hl__n" aria-hidden="true">{hlIds.length}</span><span>{hlTitle}</span>
            <button className="gp-icon-btn" onClick={clearHl} aria-label={t('highlight.clearLabel')}>✕</button>
          </div>
        )}
        <LayerPanel collapsed={tightMap} layers={layers} toggle={toggleLayer} loading={soilsRes.loading || greenRes.loading || problemsRes.loading || prioRes.loading}
          priority={layers.priority ? <PriorityControls prio={prio} items={prioRes.data?.items ?? null} names={names} onPick={(id) => select(id, true)} /> : null} />
        <MapLegend osmBase={osmMeta?.osmBase} autoClose={tightMap} />
      </section>
      <FirstRunHint canDraw={canDraw} />

      {selectedId && (
        <aside className={`gp-sites__card gp-card ${sheetFull ? 'is-full' : ''}`} aria-label={t('site.card')}>
          <button className="gp-sheet__handle" aria-expanded={sheetFull} onClick={() => setSheetFull((v) => !v)}>
            <span aria-hidden="true" />{sheetFull ? t('sites.sheetCollapse') : t('sites.sheetExpand')}
          </button>
          <SiteCard id={selectedId} tasks={tasks.filter((x) => x.objectId === selectedId)} onClose={() => navigate('/map', keepHl, true)} onChanged={() => { sitesRes.reload(); tasksRes.reload(); }}
            context={{ data: ctxRes.data ?? null, error: ctxRes.error, loading: ctxRes.loading, radius, setRadius, reload: ctxRes.reload }}
            projects={(projectsRes.data?.data ?? []).filter((p) => p.siteId === selectedId)} plants={(plantsRes.data?.data ?? []).filter((p) => (projectsRes.data?.data ?? []).some((pr) => pr.id === p.projectId && pr.siteId === selectedId))} />
        </aside>
      )}

      <div className="gp-sites__tabs" role="tablist" aria-label={t('sites.view')}>
        <button role="tab" aria-selected={tab === 'list'} onClick={() => setTab('list')}>☰ {t('sites.list')}</button>
        <button role="tab" aria-selected={tab === 'map'} onClick={() => setTab('map')}>◫ {t('sites.map')}</button>
      </div>
    </div>
  );
}

const HINT_KEY = 'gp-first-run-v1';
function hintSeen() {
  try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return true; }
}

/** Первый вход: три шага работы с картой. Закрывается навсегда (кнопкой или Esc). */
function FirstRunHint({ canDraw }: { canDraw: boolean }) {
  const [open, setOpen] = useState(() => !hintSeen());
  const close = useCallback(() => {
    setOpen(false);
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* без хранилища — покажется ещё раз */ }
  }, []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, close]);
  if (!open) return null;
  return (
    <section className="gp-firstrun gp-card" aria-labelledby="firstrun-h">
      <h2 id="firstrun-h" className="gp-subhead">{t('firstRun.title')}</h2>
      <ol>
        <li><strong>{t('firstRun.chooseTitle')}</strong> {t('firstRun.choose')}{canDraw && <> {t('firstRun.draw')}</>}</li>
        <li><strong>{t('firstRun.analysisTitle')}</strong> {t('firstRun.analysis')}</li>
        <li><strong>{t('firstRun.askTitle')}</strong> {t('firstRun.ask')}</li>
      </ol>
      <div className="gp-btn-row">
        <button className="gp-btn gp-btn--primary" onClick={close} autoFocus>{t('firstRun.start')}</button>
        <a className="gp-btn gp-btn--ghost" href={hrefFor('/guide')} onClick={close}>{t('firstRun.guide')}</a>
      </div>
    </section>
  );
}

/** Зоны из ответа ассистента или дорожной карты — с той же нумерацией, что на карте. */
function HighlightList({ title, ids, names, selectedId, onPick, onClear }: { title: string; ids: string[]; names: Map<string, string>; selectedId: string | null; onPick: (id: string) => void; onClear: () => void }) {
  return (
    <section className="gp-hl" aria-label={title}>
      <div className="gp-hl__head">
        <strong>{title}</strong>
        <button className="gp-btn gp-btn--ghost" onClick={onClear}>✕ {t('highlight.clear')}</button>
      </div>
      <ol className="gp-hl__list">
        {ids.map((id, i) => (
          <li key={id}>
            <button className="gp-hl__item" aria-current={id === selectedId} onClick={() => onPick(id)}><span className="gp-hl__n" aria-hidden="true">{i + 1}</span>{names.get(id) ?? id}</button>
          </li>
        ))}
      </ol>
    </section>
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

interface LayerState { soils: boolean; greenery: boolean; problems: boolean; priority: boolean; proposed: boolean }
function readLayers(): LayerState {
  const d = { soils: false, greenery: true, problems: false, priority: false, proposed: true };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem('gp-layers') ?? '{}') };
  } catch {
    return d;
  }
}
const prioColor = (i: number) => (i >= 70 ? '#1f6e3a' : i >= 55 ? '#4f9a3f' : i >= 40 ? '#9cc45a' : '#d9e8a8');

const PRIO_SCALE: [string, string][] = [['#1f6e3a', '70+'], ['#4f9a3f', '55–69'], ['#9cc45a', '40–54'], ['#d9e8a8', '<40']];

/** ТЗ 3.7.2 на карте: веса факторов, шкала цвета и лидеры рейтинга при текущих весах. */
function PriorityControls({ prio, items, names, onPick }: { prio: ReturnType<typeof usePriorityWeights>; items: PriorityItem[] | null; names: Map<string, string>; onPick: (id: string) => void }) {
  return (
    <div className="gp-layers__prio">
      <div className="gp-layers__scale" aria-label={t('layers.priorityScale')}>
        {PRIO_SCALE.map(([c, l]) => <span key={l}><i style={{ background: c }} aria-hidden="true" />{l}</span>)}
      </div>
      <details open>
        <summary>{t('layers.weights')}</summary>
        <WeightSliders weights={prio.weights} onChange={prio.setWeights} idPrefix="mw" />
        <div className="gp-layers__row">
          {!prio.isDefault && <button className="gp-btn gp-btn--ghost" onClick={prio.reset}>{t('layers.default')}</button>}
          <a className="gp-small" href={hrefFor('/priorities')}>{t('layers.budget')}</a>
        </div>
      </details>
      {items && items.length > 0 && (
        <ol className="gp-layers__top" aria-label={t('highlight.priority')}>
          {items.slice(0, 3).map((it) => (
            <li key={it.siteId}><button className="gp-link" onClick={() => onPick(it.siteId)}>{names.get(it.siteId) ?? it.siteId}</button> <strong>{it.index}</strong></li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** ТЗ 3.1.3: многослойная карта — пользователь включает и отключает слои. */
function LayerPanel({ collapsed, layers, toggle, loading, priority }: { collapsed: boolean; layers: LayerState; toggle: (k: keyof LayerState) => void; loading: boolean; priority?: ReactNode }) {
  const rows: [keyof LayerState, string, string][] = [
    ['soils', t('layers.soils'), t('layers.soilsHint')],
    ['greenery', t('layers.greenery'), t('layers.greeneryHint')],
    ['problems', t('highlight.problems'), t('layers.problemsHint')],
    ['priority', t('layers.priority'), t('layers.priorityHint')],
    ['proposed', t('layers.proposed'), t('layers.proposedHint')],
  ];
  return (
    <details className="gp-layers gp-card" open={!collapsed && !matchMedia('(max-width: 760px)').matches}>
      <summary><strong>{t('layers.title')}</strong> {loading && <span className="gp-spinner" aria-label={t('layers.loading')} />}</summary>
      {rows.map(([k, label, hint]) => (
        <Fragment key={k}>
          <label className="gp-check" title={hint}><input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} />{label}{k === 'soils' && <span className="gp-badge gp-badge--demo">{t('layers.synthetic')}</span>}</label>
          {k === 'priority' && priority}
        </Fragment>
      ))}
    </details>
  );
}

function SiteRow({ s, tasks, selected, onSelect }: { s: CandidateSite; tasks: Task[]; selected: boolean; onSelect: () => void }) {
  const open = tasks.filter((x) => x.objectId === s.id && x.status !== 'verified').length;
  return (
    <li>
      <button className="gp-list-item" aria-current={selected} onClick={onSelect}>
        <span className="gp-list-item__title"><span>{s.name}</span><EligBadge value={eligibilityOf(s)} /></span>
        <span className="gp-list-item__meta">
          <span>{fmtArea(s.areaM2)}</span>
          {open > 0 && <span>· {t('sites.taskCount', { n: open })}</span>}
          {!!s.context?.hints?.length && <span title={s.context.hints.join(' ')}>· <span aria-hidden="true">⚠</span> {t('sites.hintCount', { n: s.context.hints.length })}</span>}
          {s.isDemo && <span>· {t('data.demo')}</span>}
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
function MapLegend({ osmBase, autoClose }: { osmBase?: string; autoClose: boolean }) {
  const [saved, setModeState] = useState<LegendMode>(readLegendMode);
  // Карточка зоны сжимает карту: легенда сворачивается, но открытая вручную остаётся открытой.
  const [opened, setOpened] = useState(false);
  useEffect(() => { if (!autoClose) setOpened(false); }, [autoClose]);
  const mode = autoClose && !opened ? 'closed' : saved;
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
      <button className="gp-legend gp-legend--closed gp-card" onClick={() => { setOpened(true); if (saved === 'closed') setMode('compact'); }} aria-expanded="false">
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
      {mode === 'full' && <p className="gp-small gp-muted">{t('map.osmCandidatesNote')}{osmBase ? t('sites.osmSnapshot', { date: osmBase.slice(0, 10) }) : ''} {t('legend.resizeHint')}</p>}
    </section>
  );
}
