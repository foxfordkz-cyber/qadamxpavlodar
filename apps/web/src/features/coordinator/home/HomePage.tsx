import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import type { DashboardMetric } from '../../../shared/api/types';
import { ErrorNote } from '../../../shared/ui/components';
import { t, type Key } from '../../../shared/i18n';
import { fmtDate } from '../../../shared/format';
import { hrefFor } from '../../../shared/router';
import { eligibilityOf } from '../sites/eligibility';
import { useMe } from '../me';
import { ForestSilhouette, StageArt } from './art';
import photos from './cityPhotos.json';

const HeroMap = lazy(() => import('./HeroMap').then((m) => ({ default: m.HeroMap })));

// Обзор — пульт сценария, а не заставка: все числа приходят с сервера, каждая плитка ведёт к работе.
export function HomePage() {
  const { api } = useData();
  const me = useMe();
  const dash = useResource(() => api.dashboard(), [], 30000);
  const sites = useResource(() => api.sites(), []);
  const m = useMemo(() => new Map((dash.data?.data ?? []).map((x) => [x.key, x])), [dash.data]);
  const v = (k: string) => m.get(k)?.value ?? null;
  const list = sites.data?.data ?? [];
  const waterUnknown = list.filter((s) => s.factors.waterAvailability.value === null).length;
  const osmBase = (sites.data?.meta?.osm as { osmBase?: string } | undefined)?.osmBase;
  const [mapFailed, setMapFailed] = useState(false);
  const onMapFail = useCallback(() => setMapFailed(true), []);

  const hero: { href: string; key: Key; value: number | null; hint: Key }[] = [
    { href: '/map', key: 'nav.map', value: v('sites_total'), hint: 'home.tile.map' },
    { href: '/projects', key: 'nav.projects', value: v('projects_review'), hint: 'home.tile.projects' },
    { href: '/tasks', key: 'nav.tasks', value: v('tasks_open'), hint: 'home.tile.tasks' },
    { href: '/reports', key: 'nav.reports', value: v('reports_pending'), hint: 'home.tile.reports' },
  ];

  return (
    <div className="gp-home">
      <section className="gp-hero" aria-labelledby="hero-h">
        {mapFailed ? <ForestSilhouette /> : <Suspense fallback={<ForestSilhouette />}><HeroMap sites={list} onFail={onMapFail} /></Suspense>}
        <div className="gp-hero__veil" aria-hidden="true" />
        {!mapFailed && <p className="gp-hero__caption">{t('home.hero.mapCaption')}</p>}
        <div className="gp-hero__inner">
          <div className="gp-hero__text">
            <p className="gp-eyebrow gp-hero__eyebrow">{t('home.eyebrow')}</p>
            <h1 id="hero-h" className="gp-hero__title">{t('home.title')}</h1>
            <p className="gp-hero__lead">{t('home.lead')}</p>
            <div className="gp-btn-row">
              <a className="gp-btn gp-btn--lime" href={hrefFor('/map')}>{t('home.cta.map')}</a>
              {me.role === 'admin' && <a className="gp-btn gp-btn--outline-light" href={hrefFor('/approval')}>{t('nav.approval')}{v('projects_review') ? ` · ${v('projects_review')}` : ''}</a>}
            </div>
          </div>
          <div className="gp-hero__tiles">
            {hero.map((h) => (
              <a key={h.href} className="gp-hero-tile" href={hrefFor(h.href)}>
                <span className="gp-hero-tile__label">{t(h.key)}</span>
                <span className="gp-hero-tile__value">{h.value ?? '—'}</span>
                <span className="gp-hero-tile__hint">{t(h.hint)}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <div className="gp-home__body">
        <section className="gp-home-sec" aria-labelledby="why-h">
          <p className="gp-eyebrow">01 · {t('home.why.eyebrow')}</p>
          <div className="gp-home-sec__grid">
            <h2 id="why-h" className="gp-home-sec__title">{t('home.why.title')}</h2>
            <div>
              <p className="gp-home-sec__lead">{t('home.why.lead')}</p>
              <ul className="gp-facts">
                <li><strong>{list.length || '—'}</strong> {t('home.why.f1')}</li>
                <li><strong>{list.filter((s) => eligibilityOf(s) === 'survey_needed').length || '—'}</strong> {t('home.why.f2')}</li>
                <li><strong>{waterUnknown || '—'}</strong> {t('home.why.f3')}</li>
              </ul>
              <p className="gp-small gp-muted">{t('home.why.source', { date: osmBase ? fmtDate(osmBase) : '—' })}</p>
            </div>
          </div>
        </section>

        <section className="gp-home-sec" aria-labelledby="city-h">
          <p className="gp-eyebrow">· {t('home.city.eyebrow')}</p>
          <h2 id="city-h" className="gp-home-sec__title">{t('home.city.title')}</h2>
          <p className="gp-small gp-muted">{t('home.city.note')}</p>
          <CityGallery />
        </section>

        <section className="gp-home-sec" aria-labelledby="now-h">
          <p className="gp-eyebrow">02 · {t('home.now.eyebrow')}</p>
          <h2 id="now-h" className="gp-home-sec__title">{t('home.now.title')}</h2>
          <ErrorNote error={dash.error} />
          <div className="gp-tiles">
            {(dash.data?.data ?? []).map((x) => <MetricTile key={x.key} m={x} />)}
          </div>
        </section>

        <section className="gp-home-sec" aria-labelledby="stages-h">
          <p className="gp-eyebrow">03 · {t('home.stages.eyebrow')}</p>
          <h2 id="stages-h" className="gp-home-sec__title">{t('home.stages.title')}</h2>
          <p className="gp-home-sec__lead">{t('home.stages.lead')}</p>
          <Stages counts={{ sites: v('sites_need_check'), checks: v('sites_cleared'), projects: v('projects_review'), approved: v('projects_approved'), tasks: v('tasks_open'), reports: v('reports_pending') }} />
        </section>
      </div>
    </div>
  );
}

interface Photo { title: string; tag?: string; src: string; page: string; author: string; license: string; licenseUrl: string }

const TAGS: [string, string][] = [['all', 'Все'], ['green', 'Зелень'], ['street', 'Улицы'], ['river', 'Иртыш'], ['city', 'Город']];

function CityGallery() {
  const [tag, setTag] = useState('all');
  const list = (photos as Photo[]).filter((p) => tag === 'all' || p.tag === tag);
  return (
    <>
      <div className="gp-segment gp-city__tags" role="radiogroup" aria-label="Тема фото">
        {TAGS.map(([k, v]) => <label key={k}><input type="radio" name="city-tag" checked={tag === k} onChange={() => setTag(k)} />{v} · {k === 'all' ? photos.length : (photos as Photo[]).filter((p) => p.tag === k).length}</label>)}
      </div>
      <div className="gp-city">{list.map((p, i) => <CityPhoto key={p.src} p={p} big={i === 0} />)}</div>
    </>
  );
}

/** Фото города со свободной лицензией и подписью автора. Это иллюстрация, а не снимок участка. */
function CityPhoto({ p, big }: { p: Photo; big: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className={`gp-city__item ${big ? 'gp-city__item--big' : ''}`}>
      {failed ? <div className="gp-city__failed">{t('home.city.failed')}</div> : <img src={p.src} alt={p.title} loading="lazy" decoding="async" onError={() => setFailed(true)} />}
      <figcaption>
        <strong>{p.title}</strong>
        <span className="gp-small">{t('home.city.credit', { author: p.author })} · {p.licenseUrl ? <a href={p.licenseUrl} target="_blank" rel="noreferrer">{p.license}</a> : p.license} · <a href={p.page} target="_blank" rel="noreferrer">Wikimedia Commons</a></span>
      </figcaption>
    </figure>
  );
}

const TILE_LINK: Record<string, string> = {
  sites_total: '/map', sites_need_check: '/map', sites_blocked: '/map', sites_cleared: '/map', tasks_open: '/tasks',
  unassigned_priority: '/tasks', reports_pending: '/reports', verified_7d: '/reports', projects_review: '/projects', projects_approved: '/projects',
};

function MetricTile({ m }: { m: DashboardMetric }) {
  return (
    // Сначала число и что это, ниже — точное определение мелко: сводку читают с одного взгляда.
    <a className="gp-tile gp-tile--metric" href={hrefFor(TILE_LINK[m.key] ?? '/')}>
      <span className="gp-tile__head">
        <span className="gp-tile__value">{m.value ?? '—'}</span>
        <span className="gp-tile__label">{m.label}</span>
      </span>
      <span className="gp-small gp-muted gp-tile__def">{m.definition}</span>
      <span className="gp-tile__period">{m.period}</span>
    </a>
  );
}

const STAGES = [
  { n: 1, art: 'site', href: '/map', count: 'sites' },
  { n: 2, art: 'check', href: '/map', count: 'checks' },
  { n: 3, art: 'design', href: '/projects', count: 'projects' },
  { n: 4, art: 'approve', href: '/projects', count: 'approved' },
  { n: 5, art: 'plant', href: '/tasks', count: 'tasks' },
  { n: 6, art: 'care', href: '/reports', count: 'reports' },
] as const;

function Stages({ counts }: { counts: Record<string, number | null> }) {
  const [open, setOpen] = useState(1);
  return (
    <ol className="gp-stages">
      {STAGES.map((st) => {
        const isOpen = open === st.n;
        return (
          <li key={st.n} className={`gp-stage ${isOpen ? 'gp-stage--open' : ''}`}>
            <h3 className="gp-stage__h">
              <button className="gp-stage__btn" aria-expanded={isOpen} aria-controls={`stage-${st.n}`} onClick={() => setOpen(isOpen ? 0 : st.n)}>
                <span className="gp-stage__n">{st.n}.</span>
                <span className="gp-stage__title">{t(`home.stage${st.n}.title` as Key)}</span>
                <span className="gp-stage__chev" aria-hidden="true">{isOpen ? '︿' : '﹀'}</span>
              </button>
            </h3>
            <div id={`stage-${st.n}`} className="gp-stage__panel" hidden={!isOpen}>
              <StageArt kind={st.art} />
              <div className="gp-stage__text">
                <p>{t(`home.stage${st.n}.text` as Key)}</p>
                <p className="gp-stage__count"><strong>{counts[st.count] ?? '—'}</strong> {t(`home.stage${st.n}.count` as Key)}</p>
                <a className="gp-btn gp-btn--primary" href={hrefFor(st.href)}>{t('home.stage.go')}</a>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
