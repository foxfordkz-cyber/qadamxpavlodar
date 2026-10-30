import { useState } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import type { FactorKey, Plant, PlantingProject, SiteContext, Task, Worker } from '../../../shared/api/types';
import { hrefFor, useRoute } from '../../../shared/router';
import { ProjectStatusBadge } from '../projects/status';
import { Bar, Button, CheckBadge, DataClassTag, EligBadge, ErrorNote, EvidenceList, Freshness, MissingList, Modal, PriorityBadge, Section, StateView, TaskStatusBadge } from '../../../shared/ui/components';
import { t, tr, type Key } from '../../../shared/i18n';
import { fmtArea, fmtCoord, fmtDate, fmtDateTime, fmtTime } from '../../../shared/format';
import { CHECK_KEYS, eligibilityOf, lastCheckAt } from './eligibility';
import { ChecksForm } from './ChecksForm';
import { PlantSelectionPanel } from './PlantSelectionPanel';
import { TaskForm, type TaskDraft } from '../tasks/TaskForm';
import { PlanSummary } from '../zone/PlanSummary';
import { ZoneAnalysisView, ZONE_TABS, type ZoneTab } from '../zone/ZoneAnalysisView';
import type { PlanOptions } from '../../../shared/analytics/plan';

const FACTOR_KEYS: FactorKey[] = ['greeneryGap', 'publicUsePriority', 'waterAvailability', 'maintenanceFeasibility'];

export interface ContextState {
  data: SiteContext | null;
  error: unknown;
  loading: boolean;
  radius: number;
  setRadius: (r: number) => void;
  reload: () => void;
}

export function SiteCard({ id, tasks, onClose, onChanged, context, projects, plants }: { id: string; tasks: Task[]; onClose: () => void; onChanged: () => void; context: ContextState; projects: PlantingProject[]; plants: Plant[] }) {
  const { api } = useData();
  const site = useResource(() => api.site(id), [id], 30000);
  const issues = useResource(() => api.issues({ objectId: id }), [id]);
  const workers = useResource(() => api.workers(), []);
  const [modal, setModal] = useState<null | 'checks' | 'select' | 'task'>(null);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [copied, setCopied] = useState(false);
  // Вкладка и параметры плана общие для всех вкладок анализа (ТЗ: кросс-модульный пересчёт).
  const route = useRoute();
  const [autoGrow, setAutoGrow] = useState(() => route.params.get('grow') === '1');
  const [tab, setTab] = useState<'overview' | ZoneTab>(autoGrow ? 'effect' : 'overview');
  const [planOptions, setPlanOptions] = useState<Partial<PlanOptions>>({});
  const summary = useResource(() => (tab === 'overview' ? api.zoneAnalysis(id, planOptions) : Promise.resolve(null)), [id, tab, JSON.stringify(planOptions)]);
  const s = site.data;

  const grow = () => {
    setAutoGrow(true);
    setTab('effect');
  };
  const openTask = (d: TaskDraft) => {
    setDraft(d);
    setModal('task');
  };
  const copyLink = async () => {
    const url = `${location.origin}${location.pathname}#/map?site=${encodeURIComponent(id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      prompt(t('site.link'), url);
    }
  };
  const done = () => {
    setModal(null);
    site.reload();
    issues.reload();
    onChanged();
  };

  return (
    <div className="gp-sitecard">
      <div className="gp-sitecard__head">
        <button className="gp-btn gp-btn--ghost gp-sitecard__back" onClick={onClose}>← {t('site.allZones')}</button>
        <h2>{s?.name ?? t('site.card')}</h2>
        <button className="gp-icon-btn" onClick={onClose} aria-label={t('site.close')}>✕</button>
      </div>
      <StateView loading={site.loading} error={site.error} hasData={!!s} onRetry={site.reload}>
        {s && (
          <div className="gp-sitecard__body">
            <div className="gp-btn-row gp-sitecard__badges">
              <EligBadge value={eligibilityOf(s)} />
              {s.isDemo ? <DataClassTag value="demo" /> : <DataClassTag value="real" />}
              <span className="gp-muted gp-small">{s.id} · {t('site.version', { v: s.version })}</span>
            </div>
            <Freshness updatedAt={site.updatedAt} error={site.error} loading={site.loading} onRefresh={site.reload} />
            <div className="gp-zonetabs" role="tablist" aria-label={t('site.sections')}>
              {([['overview', 'Обзор'], ...ZONE_TABS] as ['overview' | ZoneTab, string][]).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setAutoGrow(false); setTab(k); }}>{tr(label)}</button>
              ))}
            </div>
            {tab !== 'overview' ? <ZoneAnalysisView site={s} tab={tab} options={planOptions} setOptions={setPlanOptions} autoPlay={autoGrow} /> : (<>

            {summary.data && <PlanSummary a={summary.data} />}
            {/* Одно главное действие по состоянию участка: нужна проверка — обследование, есть ограничение — проверки, иначе — рост. */}
            <div className="gp-btn-row gp-sitecard__actions">
              <Button variant={eligibilityOf(s) === 'planting_candidate' ? 'primary' : undefined} onClick={grow}>▶ {t('timeMachine.play')}</Button>
              <Button variant={eligibilityOf(s) === 'survey_needed' ? 'primary' : undefined} onClick={() => openTask({ objectId: s.id, action: 'inspect', priority: 'medium', description: t('site.surveyDraft') })}>＋ {t('site.createSurvey')}</Button>
              <Button variant={eligibilityOf(s) === 'blocked' ? 'primary' : undefined} onClick={() => setModal('checks')}>✓ {t('site.editChecks')}</Button>
              <Button onClick={() => setModal('select')}>❀ {t('site.selectPlants')}</Button>
              <Button variant="ghost" onClick={copyLink}>🔗 {copied ? t('site.copied') : t('site.link')}</Button>
            </div>

            <Section title={t('site.projects')} id="sec-projects" actions={<a className="gp-btn" href={hrefFor('/projects/new', { site: s.id })}>＋ {t('site.newProject')}</a>}>
              {projects.length === 0 ? <p className="gp-muted gp-small">{t('site.noProjects')}</p> : (
                <ul className="gp-list">{projects.map((p) => <li key={p.id} className="gp-issue"><a href={hrefFor(`/projects/${encodeURIComponent(p.id)}`)}>{p.title}</a> <ProjectStatusBadge p={p} /> <span className="gp-small gp-muted">v{p.designVersion}</span></li>)}</ul>
              )}
              {plants.length > 0 && <p className="gp-small"><span aria-hidden="true">❦ </span>{t('site.plantedHere', { n: plants.length })}</p>}
            </Section>

            <NearbySection ctx={context} />

            <Section title={t('site.checks')} id="sec-checks">
              <p className="gp-small gp-muted">{t('site.checksNote')}</p>
              <ul className="gp-checks">
                {CHECK_KEYS.map((k) => {
                  const c = s.checks[k];
                  return (
                    <li key={k}>
                      <div className="gp-checks__row"><span>{t(`check.${k}` as Key)}</span><CheckBadge state={c.state} /></div>
                      {c.checkedAt ? (
                        <div className="gp-small gp-muted">{t('check.by', { who: c.checkedBy ?? '—', when: fmtDateTime(c.checkedAt) })}{c.comment ? ` — ${c.comment}` : ''}</div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <p className="gp-small">{t('site.lastCheck')}: {lastCheckAt(s) ? fmtDateTime(lastCheckAt(s)) : t('site.never')}</p>
              {!!s.context?.hints?.length && (
                <div className="gp-alert gp-alert--warn gp-small"><strong>{t('site.hints')}:</strong><ul>{s.context.hints.map((h) => <li key={h}>{h}</li>)}</ul></div>
              )}
            </Section>

            <Section title={t('site.factors')} id="sec-factors">
              <p className="gp-small gp-muted">{t('site.factorsNote')}</p>
              <dl className="gp-factors">
                {FACTOR_KEYS.map((k) => {
                  const fct = s.factors[k];
                  return (
                    <div key={k} className="gp-factor">
                      <dt>{t(`factor.${k}` as Key)} <strong>{fct.value ?? '—'}{fct.value !== null && <span className="gp-muted">/100</span>}</strong></dt>
                      <dd>
                        <Bar value={fct.value} label={t(`factor.${k}` as Key)} />
                        <div className="gp-small gp-muted">{fct.method}</div>
                      </dd>
                    </div>
                  );
                })}
              </dl>
              {s.factors.waterAvailability.value === null && <Button variant="ghost" onClick={() => setModal('checks')}>✎ {t('site.water.edit')}</Button>}
            </Section>

            <Section title={t('site.facts')} id="sec-facts">
              <dl className="gp-dl">
                <dt>{t('site.area')}</dt><dd>{fmtArea(s.areaM2)} <span className="gp-muted gp-small">({t('site.areaMethod')})</span></dd>
                {s.centroid && <><dt>{t('site.coords')}</dt><dd><code>{fmtCoord(s.centroid.lat, s.centroid.lng)}</code></dd></>}
                {s.osmId && <><dt>{t('site.osm')}</dt><dd><a href={`https://www.openstreetmap.org/${s.osmId}`} target="_blank" rel="noreferrer">{s.osmId}</a></dd></>}
                <dt>{t('site.accuracy')}</dt><dd className="gp-small">{s.geometryAccuracy ?? t('common.unknown')}</dd>
              </dl>
              {s.context && (
                <>
                  <h4 className="gp-subhead">{t('site.context')}</h4>
                  <dl className="gp-dl gp-small">
                    <dt>{t('site.toGreen')}</dt><dd>{s.context.distanceToGreenM != null ? t('common.m', { n: s.context.distanceToGreenM }) : t('common.unknown')}</dd>
                    <dt>{t('site.trees')}</dt><dd>{s.context.osmTrees150m ?? t('common.unknown')} <span className="gp-muted">{t('site.osmTreesIncomplete')}</span></dd>
                    <dt>{t('site.social')}</dt><dd>{s.context.socialWithin400m?.length ? s.context.socialWithin400m.join(', ') : t('site.notInOsm')}</dd>
                    <dt>{t('site.stops')}</dt><dd>{s.context.busStops300m ?? t('common.unknown')}</dd>
                  </dl>
                </>
              )}
              <MissingList items={s.missingData} />
            </Section>

            <Section title={t('site.tasks')} id="sec-tasks">
              <TaskHistory tasks={tasks} workers={workers.data ?? []} />
              {eligibilityOf(s) === 'planting_candidate' ? (
                <a className="gp-btn" href={hrefFor('/projects/new', { site: s.id })}>＋ {t('site.plantViaProject')}</a>
              ) : (
                <p className="gp-small gp-muted"><span aria-hidden="true">ⓘ </span>{t('site.plantingBlocked')}</p>
              )}
            </Section>

            <Section title={t('site.issues')} id="sec-issues">
              <StateView loading={issues.loading} error={issues.error} hasData={!!issues.data} onRetry={issues.reload} empty={!!issues.data && issues.data.length === 0} emptyText={t('site.noIssues')}>
                <ul className="gp-list">
                  {(issues.data ?? []).map((i) => (
                    <li key={i.id} className="gp-issue">
                      <div><strong>{i.confirmedObservation ? t(`obs.${i.confirmedObservation.category}` as Key) : t('site.issue')}</strong> · <span className="gp-muted gp-small">{fmtDateTime(i.createdAt)}, {workers.data?.find((w) => w.id === i.authorId)?.displayName ?? i.authorId}</span></div>
                      <div>{i.text}</div>
                      <div className="gp-small gp-muted">{t('site.observationTask', { id: i.taskId })}</div>
                    </li>
                  ))}
                </ul>
              </StateView>
            </Section>

            <Section title={t('data.sources')} id="sec-sources">
              <EvidenceList ids={s.evidenceIds} />
            </Section>

            </>)}
            <Modal open={modal === 'checks'} title={t('checks.title')} onClose={() => setModal(null)}>
              <ChecksForm site={s} onSaved={done} onCancel={() => setModal(null)} />
            </Modal>
            <Modal open={modal === 'select'} title={`${t('sel.title')}: ${s.name}`} onClose={() => setModal(null)} wide>
              <PlantSelectionPanel site={s} onCreateTask={(d) => openTask(d)} />
            </Modal>
            <Modal open={modal === 'task'} title={t('form.title')} onClose={() => setModal(null)}>
              {draft && <TaskForm initial={draft} onDone={done} onCancel={() => setModal(null)} />}
            </Modal>
          </div>
        )}
      </StateView>
      {site.error && site.data ? <ErrorNote error={site.error} /> : null}
    </div>
  );
}

export function TaskHistory({ tasks, workers }: { tasks: Task[]; workers: Worker[] }) {
  if (!tasks.length) return <p className="gp-muted">{t('site.noTasks')}</p>;
  const sorted = [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <ul className="gp-list gp-taskhist">
      {sorted.map((x) => (
        <li key={x.id}>
          <div className="gp-list-item__title"><span>{t(`action.${x.action}` as Key)} · {x.id}</span><TaskStatusBadge status={x.status} /></div>
          <div className="gp-list-item__meta">
            <PriorityBadge value={x.priority} />
            <span>{x.assigneeId ? workers.find((w) => w.id === x.assigneeId)?.displayName ?? x.assigneeId : t('tasks.unassigned')}</span>
            {x.status === 'verified' ? (
              <span><strong>{t('tasks.verifiedDone')}</strong>: {fmtDateTime(x.updatedAt)}</span>
            ) : x.scheduledStart ? (
              <span>{t('tasks.planned')}: {fmtDate(x.scheduledStart)} {fmtTime(x.scheduledStart)}–{fmtTime(x.scheduledEnd)}</span>
            ) : x.dueAt ? (
              <span>{t('tasks.due')}: {fmtDate(x.dueAt)}</span>
            ) : null}
            {x.isDemo && <DataClassTag value="demo" />}
          </div>
        </li>
      ))}
    </ul>
  );
}

const RADII = [30, 50, 100, 200];

/** B19: «Рядом» — только сведения из данных; пустой результат и отказ загрузки различаются. */
function NearbySection({ ctx }: { ctx: ContextState }) {
  const d = ctx.data;
  return (
    <Section title={t('ctx.title')} id="sec-nearby" actions={
      <label className="gp-kv gp-small">{t('ctx.radius')}
        <select className="gp-input" value={ctx.radius} onChange={(e) => ctx.setRadius(Number(e.target.value))}>{RADII.map((r) => <option key={r} value={r}>{r} м</option>)}</select>
      </label>
    }>
      {ctx.error ? (
        <div className="gp-alert gp-alert--bad gp-small" role="alert">{t('ctx.failed')} <button className="gp-btn gp-btn--ghost" onClick={ctx.reload}>{t('state.retry')}</button></div>
      ) : ctx.loading && !d ? (
        <p className="gp-muted gp-small">{t('state.loading')}</p>
      ) : d ? (
        <>
          <p className="gp-small gp-muted">{d.distanceMethod} {t('ctx.source', { date: fmtDateTime(d.osmBase ?? d.fetchedAt) })}</p>
          {d.buildings.length + d.roads.length + d.entrances.length + d.crossings.length === 0 ? (
            <p className="gp-small">{t('ctx.empty', { r: d.radiusM })}</p>
          ) : (
            <>
              <h4 className="gp-subhead">{t('ctx.buildings')} · {d.buildings.length}</h4>
              <ul className="gp-nearby">
                {d.buildings.slice(0, 12).map((b) => (
                  <li key={b.id}>
                    <span className="gp-nearby__d">{b.distanceM} м</span>
                    <span>{b.name ?? b.address ?? <span className="gp-muted">{t('ctx.noAddress')}</span>}{b.name && b.address ? <span className="gp-muted"> · {b.address}</span> : null}
                      <span className="gp-small gp-muted"> · {b.purpose ?? t('ctx.purposeUnknown')}{b.levels ? ` · ${t('ctx.levels', { n: b.levels })}` : ''}</span></span>
                  </li>
                ))}
              </ul>
              {d.buildings.length > 12 && <p className="gp-small gp-muted">{t('ctx.more', { n: d.buildings.length - 12 })}</p>}
              <p className="gp-small">{t('ctx.lines', { roads: d.roads.filter((r) => !/foot|path|pedestrian|cycle/.test(r.kind)).length, foot: d.roads.filter((r) => /foot|path|pedestrian|cycle/.test(r.kind)).length, ent: d.entrances.length, cross: d.crossings.length })}</p>
              {d.entrances.length === 0 && <p className="gp-small gp-muted">{t('ctx.noEntrances')}</p>}
            </>
          )}
        </>
      ) : null}
    </Section>
  );
}
