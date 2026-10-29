import { speciesName } from '../../../shared/i18n';
import { useMemo, useState } from 'react';
import { PageHeader } from '../PageHeader';
import { useData, useResource } from '../../../shared/api/DataProvider';
import { ApiError } from '../../../shared/api/transport';
import type { PlantingProject } from '../../../shared/api/types';
import { Badge, Button, CheckBadge, ErrorNote, Field, Freshness, StateView, useGuarded } from '../../../shared/ui/components';
import { t, type Key } from '../../../shared/i18n';
import { fmtDateTime } from '../../../shared/format';
import { hrefFor, navigate, useRoute } from '../../../shared/router';
import { estimateCost } from '../../../shared/projectRules';
import { CHECK_KEYS } from '../sites/eligibility';
import { SchemeEditor } from '../projects/SchemeEditor';
import { ProjectStatusBadge } from '../projects/status';
import { useMe } from '../me';

export function ApprovalPage() {
  const { api } = useData();
  const me = useMe();
  const route = useRoute();
  const projects = useResource(() => api.projects(), [], 30000);
  const sites = useResource(() => api.sites(), []);
  const all = projects.data?.data ?? [];
  const queue = all.filter((p) => p.status === 'submitted').sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''));
  const done = all.filter((p) => p.reviews.length && p.status !== 'submitted').slice(0, 10);
  const selected = all.find((p) => p.id === route.params.get('project')) ?? null;
  const siteName = (id: string) => sites.data?.data.find((s) => s.id === id)?.name ?? id;

  if (me.role !== 'admin') return <div className="gp-page"><div className="gp-state gp-state--error" role="alert">🔒 {t('approval.adminOnly')}</div></div>;
  return (
    <div className="gp-page">
      <PageHeader eyebrow={t('approval.eyebrow')} title={t('approval.title')} lead={t('approval.lead')} actions={<Freshness updatedAt={projects.updatedAt} error={projects.error} loading={projects.loading} onRefresh={projects.reload} />} />
      <div className="gp-reports">
        <aside className="gp-card gp-reports__list">
          <StateView loading={projects.loading} error={projects.error} hasData={!!projects.data} onRetry={projects.reload}>
            <h2 className="gp-eyebrow gp-pad">{t('approval.queue')} · {queue.length}</h2>
            {queue.length === 0 && <p className="gp-muted gp-pad">{t('approval.empty')} <a href={hrefFor('/projects')}>{t('empty.allProjects')}</a></p>}
            <ul className="gp-list">{queue.map((p) => <Row key={p.id} p={p} site={siteName(p.siteId)} selected={p.id === selected?.id} />)}</ul>
            {done.length > 0 && <><h2 className="gp-eyebrow gp-pad">{t('approval.done')}</h2><ul className="gp-list">{done.map((p) => <Row key={p.id} p={p} site={siteName(p.siteId)} selected={p.id === selected?.id} />)}</ul></>}
          </StateView>
        </aside>
        <section className="gp-card gp-reports__detail">
          {selected ? <Review key={selected.id} project={selected} onChanged={projects.reload} /> : <div className="gp-state">{t('approval.select')}</div>}
        </section>
      </div>
    </div>
  );
}

function Row({ p, site, selected }: { p: PlantingProject; site: string; selected: boolean }) {
  return (
    <li>
      <button className="gp-list-item" aria-current={selected} onClick={() => navigate('/approval', { project: p.id }, true)}>
        <span className="gp-list-item__title"><span>{p.title}</span><ProjectStatusBadge p={p} /></span>
        <span className="gp-list-item__meta">{site} · v{p.designVersion} · {fmtDateTime(p.submittedAt ?? p.updatedAt)}</span>
      </button>
    </li>
  );
}

function Review({ project, onChanged }: { project: PlantingProject; onChanged: () => void }) {
  const { api, bump } = useData();
  const site = useResource(() => api.site(project.siteId), [project.siteId]);
  const context = useResource(() => api.siteContext(project.siteId, 50), [project.siteId]);
  const catalog = useResource(() => api.species(), []);
  const plants = useResource(() => api.plants(), []);
  const [comment, setComment] = useState('');
  const [commentErr, setCommentErr] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<PlantingProject | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { run, busy } = useGuarded();
  const byId = useMemo(() => new Map((catalog.data ?? []).map((s) => [s.id, s])), [catalog.data]);
  const openChecks = site.data ? CHECK_KEYS.filter((k) => site.data!.checks[k].state !== 'cleared') : [];
  const cost = estimateCost(project.items, catalog.data ?? []);
  const nearest = context.data?.buildings[0];
  const conflicts = project.items.flatMap((i) => i.conflicts);

  const decide = (decision: 'approved' | 'returned') => run(async () => {
    setError(null);
    if (decision === 'returned' && !comment.trim()) { setCommentErr(t('approval.commentWhy')); return; }
    setCommentErr('');
    try {
      setResult(await api.reviewProject(project.id, { decision, comment, expectedVersion: project.version }));
      bump();
    } catch (e) { setError(e); }
  });

  return (
    <StateView loading={site.loading || catalog.loading} error={site.error ?? catalog.error} hasData={!!site.data && !!catalog.data} onRetry={site.reload}>
      {site.data && (
        <div className="gp-review-proj">
          <div className="gp-section__head">
            <div><h2>{project.title}</h2><p className="gp-small gp-muted"><a href={hrefFor('/map', { site: site.data.id })}>{site.data.name}</a> · {t('approval.versionLine', { v: project.designVersion, by: project.createdBy, at: fmtDateTime(project.submittedAt) })}</p></div>
            <ProjectStatusBadge p={result ?? project} />
          </div>
          <a className="gp-btn gp-btn--ghost" href={hrefFor(`/projects/${encodeURIComponent(project.id)}`)}>{t('approval.openEditor')}</a>

          <h3 className="gp-subhead">{t('site.checks')}</h3>
          <ul className="gp-checks">{CHECK_KEYS.map((k) => <li key={k}><div className="gp-checks__row"><span>{t(`check.${k}` as Key)}</span><CheckBadge state={site.data!.checks[k].state} /></div></li>)}</ul>
          {openChecks.length > 0 && <div className="gp-alert gp-alert--bad gp-small" role="alert"><span aria-hidden="true">✕ </span>{t('approval.blockedChecks', { list: openChecks.map((k) => t(`check.${k}` as Key)).join(', ') })}</div>}

          <h3 className="gp-subhead">{t('approval.scheme')}</h3>
          <SchemeEditor site={site.data} context={context.data ?? null} items={project.items} species={byId} existingPlants={(plants.data?.data ?? []).filter((p) => p.projectId !== project.id)} selectedId={selected} onSelect={setSelected} tool="select" activeSpecies={null} readOnly />

          <h3 className="gp-subhead">{t('approval.composition')}</h3>
          <table className="gp-table gp-small">
            <thead><tr><th>{t('ed.bom.species')}</th><th>{t('ed.bom.qty')}</th><th>{t('approval.notes')}</th></tr></thead>
            <tbody>
              {project.items.map((it) => (
                <tr key={it.id} className={it.id === selected ? 'is-selected' : ''} onClick={() => setSelected(it.id)}>
                  <td>{speciesName(byId.get(it.speciesId), it.speciesId)} <span className="gp-muted">({it.kind === 'bed' ? t('ed.kind.bed') : t('ed.kind.point')})</span></td>
                  <td>{it.quantity}</td>
                  <td>{it.conflicts.map((c) => <div key={c.type}><Badge tone="bad" icon="!">{c.message}</Badge> {t('ed.bom.resolution')}: {c.resolution}</div>)}{byId.get(it.speciesId)?.invasiveRisk && <Badge tone="bad" icon="!">{t('species.invasive')}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="gp-small">{cost.complete ? `${t('approval.cost')}: ${cost.known.toLocaleString('ru-RU')} ₸ (${t('data.demo')})` : cost.known ? t('ed.bom.costPartial', { sum: cost.known.toLocaleString('ru-RU') }) : t('ed.bom.costUnknown')}</p>

          <h3 className="gp-subhead">{t('approval.surroundings')}</h3>
          {context.error ? <ErrorNote error={context.error} /> : context.data ? (
            <p className="gp-small">{t('approval.ctxLine', { b: context.data.buildings.length, e: context.data.entrances.length, c: context.data.crossings.length })}{nearest ? ` ${t('approval.nearest', { addr: nearest.address ?? t('common.unknown'), d: nearest.distanceM })}` : ''}</p>
          ) : <p className="gp-muted">{t('state.loading')}</p>}
          {conflicts.length > 0 && <div className="gp-alert gp-alert--warn gp-small">{t('approval.conflictsResolved', { n: conflicts.length })}</div>}

          <h3 className="gp-subhead">{t('approval.sketch')}</h3>
          <p className="gp-small gp-muted">{t('approval.noSketch')}</p>

          {result ? (
            <div className={`gp-alert ${result.status === 'approved' ? 'gp-alert--ok' : 'gp-alert--warn'}`} role="status">✓ {t('approval.result', { status: t(`project.status.${result.status}` as Key), v: result.designVersion })} <Button variant="ghost" onClick={onChanged}>{t('state.refresh')}</Button></div>
          ) : project.status === 'submitted' ? (
            <div className="gp-review">
              <Field label={t('reports.comment')} hint={t('approval.commentWhy')} error={commentErr}>
                {(id, d) => <textarea id={id} aria-describedby={d} className="gp-input" value={comment} onChange={(e) => setComment(e.target.value)} />}
              </Field>
              {error instanceof ApiError && error.code === 'checks_incomplete' ? <div className="gp-alert gp-alert--bad" role="alert">{error.message} {t('state.notSaved')}</div> : <ErrorNote error={error} notSaved />}
              <div className="gp-btn-row">
                <Button variant="primary" busy={busy} disabled={openChecks.length > 0} onClick={() => decide('approved')}>✓ {t('approval.approve')}</Button>
                <Button variant="danger" busy={busy} onClick={() => decide('returned')}>↩ {t('approval.return')}</Button>
              </div>
              {openChecks.length > 0 && <p className="gp-small gp-muted">{t('approval.approveDisabled')}</p>}
            </div>
          ) : (
            <p className="gp-small gp-muted">{t('approval.notInQueue')}</p>
          )}
          {project.reviews.length > 0 && (
            <>
              <h3 className="gp-subhead">{t('approval.history')}</h3>
              <ul className="gp-small">{project.reviews.map((r) => <li key={r.at}>{fmtDateTime(r.at)} · v{r.designVersion} · {r.by}: {t(`project.status.${r.decision}` as Key)}{r.comment ? ` — ${r.comment}` : ''}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </StateView>
  );
}
