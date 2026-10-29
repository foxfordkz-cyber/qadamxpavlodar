import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../PageHeader';
import { useData, useResource } from '../../../shared/api/DataProvider';
import type { PlantingProject } from '../../../shared/api/types';
import { newIdempotencyKey } from '../../../shared/api/transport';
import { Button, ErrorNote, Field, Freshness, StateView, useGuarded } from '../../../shared/ui/components';
import { t } from '../../../shared/i18n';
import { fmtDateTime } from '../../../shared/format';
import { hrefFor, navigate, useRoute } from '../../../shared/router';
import { ProjectStatusBadge } from './status';
import { ProjectEditor } from './ProjectEditor';

export function ProjectsPage() {
  const route = useRoute();
  const id = route.path.split('/')[2];
  if (id === 'new') return <NewProject siteId={route.params.get('site')} />;
  if (id) return <ProjectEditor id={decodeURIComponent(id)} />;
  return <ProjectList />;
}

function ProjectList() {
  const { api } = useData();
  const projects = useResource(() => api.projects(), [], 30000);
  const sites = useResource(() => api.sites(), []);
  const siteName = useMemo(() => new Map((sites.data?.data ?? []).map((s) => [s.id, s.name])), [sites.data]);
  const list = [...(projects.data?.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className="gp-page">
      <PageHeader eyebrow={t('projects.eyebrow')} title={t('projects.title')} lead={t('projects.howTo')} actions={<><a className="gp-btn" href={hrefFor('/guide')}>{t('nav.guide')}</a><a className="gp-btn gp-btn--primary" href={hrefFor('/map')}>{t('projects.pickOnMap')}</a><Freshness updatedAt={projects.updatedAt} error={projects.error} loading={projects.loading} onRefresh={projects.reload} /></>} />
      <StateView loading={projects.loading} error={projects.error} hasData={!!projects.data} onRetry={projects.reload} empty={!!projects.data && list.length === 0} emptyText={t('projects.empty')} emptyAction={<a className="gp-btn gp-btn--primary" href={hrefFor('/map')}>Выбрать участок на карте</a>}>
        <div className="gp-tiles">
          {list.map((p) => <ProjectTile key={p.id} p={p} site={siteName.get(p.siteId) ?? p.siteId} />)}
        </div>
      </StateView>
    </div>
  );
}

function ProjectTile({ p, site }: { p: PlantingProject; site: string }) {
  const qty = p.items.reduce((a, i) => a + i.quantity, 0);
  return (
    <a className="gp-tile" href={hrefFor(`/projects/${encodeURIComponent(p.id)}`)}>
      <span>
        <ProjectStatusBadge p={p} />
        <span className="gp-tile__title">{p.title}</span>
        <span className="gp-small gp-muted">{site}</span>
      </span>
      <span>
        <span className="gp-tile__value">{qty}</span>
        <span className="gp-tile__label"> {t('projects.plantsCount', { n: p.items.length })}</span>
        <span className="gp-tile__period">{t('projects.versionLine', { v: p.designVersion, at: fmtDateTime(p.updatedAt) })}{p.isDemo ? ' · демо' : ''}</span>
      </span>
    </a>
  );
}

/** Создание проекта для участка: сервер возвращает черновик, затем открывается редактор. */
function NewProject({ siteId }: { siteId: string | null }) {
  const { api } = useData();
  const site = useResource(() => (siteId ? api.site(siteId) : Promise.resolve(null)), [siteId]);
  const [title, setTitle] = useState('');
  const [season, setSeason] = useState('Весна 2027');
  const [error, setError] = useState<unknown>(null);
  const [key] = useState(newIdempotencyKey);
  const { run, busy } = useGuarded();
  useEffect(() => {
    if (site.data && !title) setTitle(`Озеленение: ${site.data.name}`);
  }, [site.data, title]);
  if (!siteId) return <div className="gp-page"><div className="gp-alert gp-alert--warn">{t('projects.pickSite')} <a href={hrefFor('/map')}>{t('nav.map')}</a></div></div>;
  return (
    <div className="gp-page">
      <StateView loading={site.loading} error={site.error} hasData={!!site.data} onRetry={site.reload}>
        <form className="gp-card gp-newproject" onSubmit={(e) => { e.preventDefault(); run(async () => { setError(null); try { const p = await api.createProject({ siteId, title, season }, key); navigate(`/projects/${encodeURIComponent(p.id)}`, {}, true); } catch (err) { setError(err); } }); }}>
          <p className="gp-eyebrow">{site.data?.name}</p>
          <h1 className="gp-h1">{t('projects.new')}</h1>
          <Field label={t('projects.fieldTitle')} required>{(id) => <input id={id} className="gp-input" value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label={t('projects.fieldSeason')} hint={t('projects.seasonHint')}>{(id) => <input id={id} className="gp-input" value={season} onChange={(e) => setSeason(e.target.value)} />}</Field>
          <ErrorNote error={error} notSaved />
          <div className="gp-btn-row">
            <Button variant="primary" type="submit" busy={busy} disabled={!title.trim()}>{t('projects.create')}</Button>
            <a className="gp-btn" href={hrefFor('/map', { site: siteId })}>{t('form.cancel')}</a>
          </div>
        </form>
      </StateView>
    </div>
  );
}
