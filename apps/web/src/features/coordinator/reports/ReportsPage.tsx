import { useMemo, useState } from 'react';
import { PageHeader } from '../PageHeader';
import { useData, useResource } from '../../../shared/api/DataProvider';
import { ApiError } from '../../../shared/api/transport';
import type { Report, Task } from '../../../shared/api/types';
import { Badge, Button, ErrorNote, Field, Freshness, StateView, TaskStatusBadge, useGuarded } from '../../../shared/ui/components';
import { t, type Key } from '../../../shared/i18n';
import { fmtDateTime } from '../../../shared/format';
import { hrefFor, navigate, useRoute } from '../../../shared/router';
import { distanceM } from '../map/geo';

export function ReportsPage() {
  const { api } = useData();
  const route = useRoute();
  const [tab, setTab] = useState<'pending' | 'reviewed'>('pending');
  const reports = useResource(() => api.reports(), [], 30000);
  const tasks = useResource(() => api.tasks(), [], 30000);
  const workers = useResource(() => api.workers(), []);
  const all = useMemo(() => reports.data?.data ?? [], [reports.data]);
  const shown = all.filter((r) => (tab === 'pending' ? r.reviewStatus === 'pending' : r.reviewStatus !== 'pending')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selectedId = route.params.get('report');
  const selected = all.find((r) => r.id === selectedId) ?? null;
  const taskOf = (r: Report) => tasks.data?.data.find((x) => x.id === r.taskId);
  // GET /workers отдаёт только работников; проверяющий-координатор показывается по ID.
  const name = (id?: string | null) => workers.data?.find((w) => w.id === id)?.displayName ?? (id ? `${t('shell.role.coordinator')} · ${id}` : '—');

  return (
    <div className="gp-page">
      <PageHeader eyebrow={t('reports.eyebrow')} title={t('reports.title')} lead={t('reports.lead')} actions={<Freshness updatedAt={reports.updatedAt} error={reports.error} loading={reports.loading} onRefresh={() => { reports.reload(); tasks.reload(); }} />} />
      <div className="gp-reports">
        <aside className="gp-card gp-reports__list">
          <div className="gp-segment" role="radiogroup" aria-label={t('reports.title')}>
            <label><input type="radio" name="rtab" checked={tab === 'pending'} onChange={() => setTab('pending')} />{t('reports.pending')} ({all.filter((r) => r.reviewStatus === 'pending').length})</label>
            <label><input type="radio" name="rtab" checked={tab === 'reviewed'} onChange={() => setTab('reviewed')} />{t('reports.reviewed')}</label>
          </div>
          <StateView loading={reports.loading} error={reports.error} hasData={!!reports.data} onRetry={reports.reload} empty={!!reports.data && shown.length === 0} emptyText={t('reports.empty')} emptyAction={<a className="gp-btn" href={hrefFor('/tasks')}>План работ: назначить задание</a>}>
            <ul className="gp-list">
              {shown.map((r) => {
                const task = taskOf(r);
                return (
                  <li key={r.id}>
                    <button className="gp-list-item" aria-current={r.id === selectedId} onClick={() => navigate('/reports', { report: r.id }, true)}>
                      <span className="gp-list-item__title">
                        <span>{r.id} · {task ? t(`action.${task.action}` as Key) : r.taskId}</span>
                        {r.reviewStatus === 'pending' ? <Badge tone="warn" icon="◕">{t('reports.pending')}</Badge> : r.reviewStatus === 'accepted' ? <Badge tone="ok" icon="✓">{t('reports.decisionAccepted')}</Badge> : <Badge tone="bad" icon="↩">{t('reports.decisionReturned')}</Badge>}
                      </span>
                      <span className="gp-report-row">
                        {r.photoIds[0] ? <Photo id={r.photoIds[0]} thumb /> : <span className="gp-report-row__nophoto" aria-hidden="true">∅</span>}
                        <span className="gp-list-item__meta">{name(r.authorId)}<br />{fmtDateTime(r.createdAt)} · фото: {r.photoIds.length}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </StateView>
        </aside>
        <section className="gp-card gp-reports__detail" aria-live="polite">
          {selected ? (
            <ReportDetail key={selected.id} report={selected} task={taskOf(selected)} authorName={name(selected.authorId)} reviewerName={name(selected.reviewerId)} onChanged={() => { reports.reload(); tasks.reload(); }} />
          ) : (
            <div className="gp-state">{t('reports.select')}</div>
          )}
        </section>
      </div>
    </div>
  );
}

function ReportDetail({ report, task, authorName, reviewerName, onChanged }: { report: Report; task?: Task; authorName: string; reviewerName: string; onChanged: () => void }) {
  const { api, bump } = useData();
  const site = useResource(() => (task ? api.site(task.objectId) : Promise.resolve(null)), [task?.objectId]);
  const [comment, setComment] = useState('');
  const [commentErr, setCommentErr] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ report: Report; task: Task } | null>(null);
  const { run, busy } = useGuarded();
  const dist = report.location && site.data?.centroid ? Math.round(distanceM(report.location, site.data.centroid)) : null;

  const decide = (decision: 'accepted' | 'changes_requested') =>
    run(async () => {
      setError(null);
      if (decision === 'changes_requested' && !comment.trim()) {
        setCommentErr(t('reports.commentWhy'));
        return;
      }
      setCommentErr('');
      if (!task) return;
      try {
        const r = await api.reviewReport(report.id, { decision, comment, expectedTaskVersion: task.version }, `review-${report.id}-${decision}-${task.version}`);
        setResult(r);
        bump();
      } catch (e) {
        setError(e);
      }
    });

  return (
    <div className="gp-report">
      <div className="gp-section__head">
        <h2>{report.id}</h2>
        {task && <TaskStatusBadge status={task.status} />}
      </div>
      <dl className="gp-dl">
        <dt>{t('reports.task')}</dt>
        <dd>{task ? <>{t(`action.${task.action}` as Key)} · {task.id} · <a href={hrefFor('/map', { site: task.objectId })}>{site.data?.name ?? task.objectId}</a></> : report.taskId}</dd>
        <dt>{t('reports.author')}</dt><dd>{authorName}</dd>
        <dt>{t('reports.sent')}</dt><dd>{fmtDateTime(report.createdAt)}</dd>
      </dl>

      <h3 className="gp-subhead">{t('reports.photos')}</h3>
      <p className="gp-small gp-muted">{t('reports.photoNote')}</p>
      {report.photoIds.length ? <div className="gp-photos">{report.photoIds.map((id) => <Photo key={id} id={id} />)}</div> : <p className="gp-muted">{t('reports.noPhotos')}</p>}

      <h3 className="gp-subhead">{t('reports.note')}</h3>
      <blockquote className="gp-quote">{report.note || '—'}</blockquote>

      <h3 className="gp-subhead">{t('reports.observation')}</h3>
      {report.confirmedObservation ? (
        <div>
          <Badge tone="info">{t(`obs.${report.confirmedObservation.category}` as Key)}</Badge>
          <ul>{report.confirmedObservation.extractedFacts.map((f) => <li key={f}>{f}</li>)}</ul>
          <p className="gp-small gp-muted">Подтвердил работник: {authorName}, {fmtDateTime(report.confirmedObservation.confirmedAt)}. Наблюдение не меняет проверки участка автоматически.</p>
        </div>
      ) : (
        <p className="gp-muted">{t('reports.noObservation')}</p>
      )}

      <h3 className="gp-subhead">{t('reports.location')}</h3>
      {report.location ? (
        <p>
          <code>{report.location.lat.toFixed(5)}, {report.location.lng.toFixed(5)}</code>
          {dist !== null && <> — {t('reports.distance', { m: dist, acc: report.location.accuracyM })}</>}
          <br />
          <span className="gp-small gp-muted">{t('reports.locationNote')} {fmtDateTime(report.location.capturedAt)}</span>
        </p>
      ) : (
        <p className="gp-muted">{t('reports.noLocation')}</p>
      )}

      {report.reviewStatus !== 'pending' ? (
        <div className={`gp-alert ${report.reviewStatus === 'accepted' ? 'gp-alert--ok' : 'gp-alert--warn'}`}>
          {report.reviewStatus === 'accepted' ? t('reports.decisionAccepted') : t('reports.decisionReturned')}: {reviewerName}, {fmtDateTime(report.reviewedAt)}{report.reviewComment ? ` — ${report.reviewComment}` : ''}
        </div>
      ) : result ? (
        <div className="gp-alert gp-alert--ok" role="status">
          ✓ {t('reports.accepted', { id: result.task.id, status: t(`status.${result.task.status}` as Key) })} <Button variant="ghost" onClick={onChanged}>{t('state.refresh')}</Button>
        </div>
      ) : (
        <div className="gp-review">
          <h3 className="gp-subhead">{t('reports.review')}</h3>
          <Field label={t('reports.comment')} hint={t('reports.commentWhy')} error={commentErr}>
            {(id, d) => <textarea id={id} aria-describedby={d} className="gp-input" value={comment} onChange={(e) => setComment(e.target.value)} />}
          </Field>
          {error instanceof ApiError && error.isConflict ? (
            <div className="gp-alert gp-alert--warn" role="alert">{error.message} {t('state.notSaved')} <Button onClick={onChanged}>{t('conflict.reload')}</Button></div>
          ) : (
            <ErrorNote error={error} notSaved />
          )}
          <div className="gp-btn-row">
            <Button variant="primary" busy={busy} disabled={!task} onClick={() => decide('accepted')}>✓ {t('reports.accept')}</Button>
            <Button variant="danger" busy={busy} disabled={!task} onClick={() => decide('changes_requested')}>↩ {t('reports.return')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Photo({ id, thumb }: { id: string; thumb?: boolean }) {
  const { api } = useData();
  const u = useResource(() => api.upload(id), [id]);
  if (thumb) return u.data ? <img className="gp-report-row__thumb" src={u.data.url} alt="" /> : <span className="gp-report-row__nophoto" aria-hidden="true">…</span>;
  return (
    <figure className="gp-photo">
      <StateView loading={u.loading} error={u.error} hasData={!!u.data}>
        {u.data && (
          <a href={u.data.url} target="_blank" rel="noreferrer">
            <img src={u.data.url} alt={`Фото ${id}${u.data.isDemo ? ' (демо-заглушка)' : ''}`} loading="lazy" />
          </a>
        )}
      </StateView>
      <figcaption className="gp-small">{id}{u.data?.isDemo ? ' · демо' : ''}</figcaption>
    </figure>
  );
}
