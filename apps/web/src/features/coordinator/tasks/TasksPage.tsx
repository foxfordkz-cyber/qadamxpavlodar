import { tr } from '../../../shared/i18n';
import { useMemo, useState } from 'react';
import { PageHeader } from '../PageHeader';
import { useData, useResource } from '../../../shared/api/DataProvider';
import { ApiError } from '../../../shared/api/transport';
import type { Brigade, CandidateSite, DayPlan, Task, Worker } from '../../../shared/api/types';
import { Badge, Button, DataClassTag, ErrorNote, Freshness, Modal, PriorityBadge, StateView, TaskStatusBadge, useGuarded } from '../../../shared/ui/components';
import { t, type Key } from '../../../shared/i18n';
import { fmtDate, fmtDateTime, fmtTime, localInputToIso } from '../../../shared/format';
import { hrefFor } from '../../../shared/router';
import { TaskForm } from './TaskForm';
import { DayTimeline } from './DayTimeline';
import { Metrics } from '../dashboard/Metrics';

const LOCKED = new Set(['in_progress', 'submitted', 'verified']);
const dayOf = (iso: string) => new Date(Date.parse(iso) + 5 * 3600e3).toISOString().slice(0, 10);

export function TasksPage() {
  const { api, bump } = useData();
  const [date, setDate] = useState('2026-10-28');
  const tasks = useResource(() => api.tasks(), [], 30000);
  const brigades = useResource(() => api.brigades(), []);
  const workers = useResource(() => api.workers(), []);
  const sites = useResource(() => api.sites(), []);
  const plan = useResource(() => api.dayPlan(date), [date], 30000);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const list = useMemo(() => tasks.data?.data ?? [], [tasks.data]);
  const siteById = useMemo(() => new Map((sites.data?.data ?? []).map((s) => [s.id, s])), [sites.data]);
  const people = useMemo(() => new Map((workers.data ?? []).map((w) => [w.id, w])), [workers.data]);
  const unassigned = list.filter((x) => !x.brigadeId && x.status === 'draft').sort((a, b) => b.priorityWeight - a.priorityWeight || (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));
  const approved = plan.data?.plan?.status === 'approved' ? plan.data.plan : null;
  const changedIds = useMemo(() => changedSince(approved, list, date), [approved, list, date]);

  return (
    <div className="gp-page">
      <PageHeader eyebrow={t('tasks.eyebrow')} title={t('tasks.title')} lead={t('tasks.lead')} actions={<>
        <label className="gp-kv gp-small">{t('tasks.date')} <input className="gp-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <Freshness updatedAt={tasks.updatedAt} error={tasks.error} loading={tasks.loading} onRefresh={() => { tasks.reload(); plan.reload(); }} />
        <Button variant="primary" onClick={() => setCreating(true)}>＋ {t('tasks.new')}</Button>
      </>} />

      <PlanBar plan={plan.data?.plan ?? null} changed={changedIds.size} onApprove={() => setConfirm(true)} loading={plan.loading} error={plan.error} />
      <Metrics />

      <StateView loading={tasks.loading || brigades.loading} error={tasks.error ?? brigades.error} hasData={!!tasks.data && !!brigades.data} onRetry={() => { tasks.reload(); brigades.reload(); }}>
        <div className="gp-tasks">
          <section className="gp-card gp-tasks__unassigned" aria-labelledby="unassigned-h">
            <div className="gp-section__head"><h2 id="unassigned-h"><span aria-hidden="true">⚠ </span>{t('tasks.unassigned')}: {unassigned.length}</h2></div>
            <p className="gp-small gp-muted">{t('tasks.unassignedNote')}</p>
            {unassigned.length === 0 ? <p className="gp-muted">{t('tasks.empty')} <a href={hrefFor('/map')}>Задание на обследование создаётся в карточке участка на карте →</a></p> : (
              <ul className="gp-list">
                {unassigned.map((x) => <TaskRow key={x.id} task={x} site={siteById.get(x.objectId)} brigades={brigades.data ?? []} onChanged={() => { tasks.reload(); plan.reload(); }} reason={t('tasks.reason.noBrigade')} />)}
              </ul>
            )}
          </section>
          <section aria-labelledby="byworker-h" className="gp-tasks__workers">
            <h2 id="byworker-h">{t('tasks.byBrigade', { date: fmtDate(`${date}T07:00:00Z`) })}</h2>
            {(brigades.data ?? []).map((b) => (
              <BrigadeColumn key={b.id} brigade={b} people={people} date={date} changed={changedIds} tasks={list.filter((x) => x.brigadeId === b.id)} siteById={siteById} />
            ))}
          </section>
        </div>
      </StateView>

      <Modal open={creating} title={t('form.title')} onClose={() => setCreating(false)}>
        <TaskForm initial={{ objectId: '', action: 'inspect', priority: 'medium', description: '' }} onDone={() => { setCreating(false); tasks.reload(); plan.reload(); }} onCancel={() => setCreating(false)} />
      </Modal>
      <Modal open={confirm} title={t('plan.approveTitle', { date: fmtDate(`${date}T07:00:00Z`) })} onClose={() => setConfirm(false)}>
        {plan.data && <ApprovePlan date={date} plan={plan.data.plan} preview={plan.data.preview} brigades={brigades.data ?? []} onDone={() => { setConfirm(false); bump(); }} onCancel={() => setConfirm(false)} />}
      </Modal>
    </div>
  );
}

/** Задания дня, у которых бригада, время или версия разошлись с утверждённым снимком. */
function changedSince(plan: DayPlan | null, tasks: Task[], date: string) {
  const out = new Set<string>();
  if (!plan) return out;
  const snap = new Map(plan.snapshot.map((x) => [x.taskId, x]));
  for (const t of tasks) {
    const inDay = t.scheduledStart && dayOf(t.scheduledStart) === date && t.brigadeId;
    const s = snap.get(t.id);
    if (inDay && !s) out.add(t.id);
    else if (s && (s.brigadeId !== (t.brigadeId ?? null) || s.scheduledStart !== (t.scheduledStart ?? null))) out.add(t.id);
  }
  return out;
}

function PlanBar({ plan, changed, onApprove, loading, error }: { plan: DayPlan | null; changed: number; onApprove: () => void; loading: boolean; error: unknown }) {
  const approved = plan?.status === 'approved';
  return (
    <div className={`gp-planbar ${approved ? 'gp-planbar--approved' : 'gp-planbar--draft'}`} role="status">
      {approved ? (
        <span><Badge tone="ok" icon="✓">{t('plan.approved')}</Badge> {t('plan.approvedBy', { by: plan!.approvedBy ?? '—', at: fmtDateTime(plan!.approvedAt) })} · v{plan!.version}</span>
      ) : (
        <span><Badge tone="neutral" icon="✎">{t('plan.draft')}</Badge> {t('plan.draftNote')}</span>
      )}
      {approved && changed > 0 && <Badge tone="warn" icon="Δ">{t('plan.changedAfter', { n: changed })}</Badge>}
      <Button variant="primary" onClick={onApprove} disabled={loading}>{approved ? t('plan.reapprove') : t('plan.approve')}</Button>
      <ErrorNote error={error} />
    </div>
  );
}

function ApprovePlan({ date, plan, preview, brigades, onDone, onCancel }: { date: string; plan: DayPlan | null; preview: NonNullable<DayPlan['summary']>; brigades: Brigade[]; onDone: () => void; onCancel: () => void }) {
  const { api } = useData();
  const [result, setResult] = useState<DayPlan | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { run, busy } = useGuarded();
  const summary = result?.summary ?? preview;
  const name = (id: string) => brigades.find((b) => b.id === id)?.name ?? id;
  return (
    <div>
      {result ? <div className="gp-alert gp-alert--ok" role="status">✓ {t('plan.serverApproved', { at: fmtDateTime(result.approvedAt), v: result.version })}</div> : <p className="gp-small">{t('plan.confirmNote')}</p>}
      <dl className="gp-dl">
        <dt>{t('plan.sumTasks')}</dt><dd><strong>{summary.tasks}</strong></dd>
        {summary.byBrigade.map((b) => <div key={b.brigadeId} style={{ display: 'contents' }}><dt>{name(b.brigadeId)}</dt><dd>{b.tasks} · {b.minutes}{" "}{tr("мин")}</dd></div>)}
      </dl>
      {summary.warnings.length > 0 ? (
        <div className="gp-alert gp-alert--warn"><strong>{t('plan.warnings')}</strong><ul>{summary.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>
      ) : <p className="gp-small">{t('plan.noWarnings')}</p>}
      <ErrorNote error={error} notSaved />
      <div className="gp-btn-row">
        {result ? <Button variant="primary" onClick={onDone}>{t('common.close')}</Button> : (
          <>
            <Button variant="primary" busy={busy} disabled={summary.tasks === 0} onClick={() => run(async () => { setError(null); try { setResult(await api.approveDayPlan(date, plan?.version ?? null)); } catch (e) { setError(e); } })}>{t('plan.approveConfirm', { n: summary.tasks })}</Button>
            <Button onClick={onCancel}>{t('form.cancel')}</Button>
          </>
        )}
      </div>
    </div>
  );
}

function BrigadeColumn({ brigade, people, tasks, siteById, date, changed }: { brigade: Brigade; people: Map<string, Worker>; tasks: Task[]; siteById: Map<string, CandidateSite>; date: string; changed: Set<string> }) {
  const day = tasks.filter((x) => !x.scheduledStart || dayOf(x.scheduledStart) === date);
  const used = day.filter((x) => x.status !== 'verified').reduce((a, x) => a + x.estimatedMinutes, 0);
  const over = used > brigade.capacityMinutes;
  const sorted = [...day].sort((a, b) => (a.scheduledStart ?? '9').localeCompare(b.scheduledStart ?? '9'));
  const nm = (id: string) => people.get(id)?.displayName ?? id;
  return (
    <div className="gp-card gp-worker">
      <div className="gp-worker__head">
        <h3 className="gp-display gp-brigade__name">{brigade.name}</h3>
        {brigade.active ? <span className="gp-small">{t('tasks.shift', { from: fmtTime(brigade.shiftStart), to: fmtTime(brigade.shiftEnd) })}</span> : <Badge tone="neutral">{t('tasks.inactive')}</Badge>}
      </div>
      <dl className="gp-dl gp-small">
        <dt>{t('tasks.foreman')}</dt><dd>{nm(brigade.foremanId)}</dd>
        <dt>{t('tasks.members')}</dt><dd>{brigade.memberIds.map((id) => `${nm(id)}${people.get(id)?.active === false ? ' (нет смены)' : ''}`).join(', ')}</dd>
        <dt>{t('form.equipment')}</dt><dd>{brigade.equipment.join(', ') || t('common.unknown')}</dd>
      </dl>
      <div className="gp-worker__load">
        <div className="gp-bar"><span className="gp-bar__fill" style={{ width: `${Math.min(100, (used / brigade.capacityMinutes) * 100)}%`, background: over ? 'var(--gp-red)' : undefined }} /></div>
        <span className="gp-small">{t('tasks.load', { used, cap: brigade.capacityMinutes })}{over && <strong className="gp-caution"> · <span aria-hidden="true">✕</span> {t('tasks.overload')}</strong>}</span>
      </div>
      <DayTimeline brigade={brigade} tasks={day} siteName={(id) => siteById.get(id)?.name ?? id} />
      {sorted.length === 0 ? <p className="gp-muted gp-small">{t('tasks.empty')}</p> : (
        <ol className="gp-timeline">
          {sorted.map((x) => (
            <li key={x.id} className={`gp-timeline__item gp-timeline__item--${x.status} ${changed.has(x.id) ? 'gp-timeline__item--changed' : ''}`}>
              <span className="gp-timeline__time">{x.scheduledStart ? `${fmtTime(x.scheduledStart)}–${fmtTime(x.scheduledEnd)}` : t('tasks.noTime')}</span>
              <span>
                <a href={hrefFor('/map', { site: x.objectId })}>{siteById.get(x.objectId)?.name ?? x.objectId}</a>
                <span className="gp-list-item__meta">
                  <TaskStatusBadge status={x.status} /> {t(`action.${x.action}` as Key)} · {t('tasks.minutes', { n: x.estimatedMinutes })} · {x.id}
                  {x.isDemo && <DataClassTag value="demo" />}
                  {LOCKED.has(x.status) && <Badge tone="neutral" icon="🔒">{t('plan.locked')}</Badge>}
                  {changed.has(x.id) && <Badge tone="warn" icon="Δ">{t('plan.changed')}</Badge>}
                </span>
                {x.crewIds?.length ? (
                  <span className="gp-small">{t('tasks.crew')}: {x.crewIds.map(nm).join(', ')}</span>
                ) : (
                  <span className="gp-small gp-crew-pending"><span aria-hidden="true">⚠ </span>{t('tasks.crewNotAssembled', { n: x.minCrew ?? 1 })}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TaskRow({ task, site, brigades, onChanged, reason }: { task: Task; site?: CandidateSite; brigades: Brigade[]; onChanged: () => void; reason: string }) {
  const { api, bump } = useData();
  const [brigadeId, setBrigadeId] = useState('');
  const [minCrew, setMinCrew] = useState('1');
  const [start, setStart] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Task | null>(null);
  const { run, busy } = useGuarded();
  const assign = () =>
    run(async () => {
      setError(null);
      try {
        const r = await api.assignTask(task.id, { brigadeId, minCrew: Number(minCrew), scheduledStart: start ? localInputToIso(start) : null, expectedVersion: task.version }, `assign-${task.id}-v${task.version}-${brigadeId}-${minCrew}-${start}`);
        setResult(r);
        bump();
      } catch (e) {
        setError(e);
      }
    });
  const conflict = error instanceof ApiError && error.isConflict && error.code === 'version_conflict';
  return (
    <li className="gp-taskrow">
      <div className="gp-list-item__title">
        <a href={hrefFor('/map', { site: task.objectId })}>{site?.name ?? task.objectId}</a>
        <PriorityBadge value={task.priority} />
      </div>
      <div className="gp-list-item__meta">
        <TaskStatusBadge status={task.status} /> {t(`action.${task.action}` as Key)} · {t('tasks.minutes', { n: task.estimatedMinutes })} · {task.id}
        {task.dueAt && <span>· {t('tasks.due')}: {fmtDateTime(task.dueAt)}</span>}
        {task.isDemo && <DataClassTag value="demo" />}
      </div>
      <p className="gp-small gp-muted">{t('tasks.reason')}: {reason}</p>
      {result ? (
        <div className="gp-alert gp-alert--ok gp-small" role="status">✓ {t('tasks.assignedResult', { id: result.id, status: t(`status.${result.status}` as Key), brigade: brigades.find((b) => b.id === result.brigadeId)?.name ?? '—', v: result.version })} <Button variant="ghost" onClick={onChanged}>{t('state.refresh')}</Button></div>
      ) : (
        <div className="gp-assign">
          <label className="gp-sr" htmlFor={`as-${task.id}`}>{t('form.brigade')}</label>
          <select id={`as-${task.id}`} className="gp-input" value={brigadeId} onChange={(e) => setBrigadeId(e.target.value)}>
            <option value="">{t('form.brigade')}…</option>
            {brigades.map((b) => <option key={b.id} value={b.id} disabled={!b.active || !b.skills.includes(task.action)}>{b.name}{!b.skills.includes(task.action) ? ' — нет навыка' : ''}</option>)}
          </select>
          <label className="gp-sr" htmlFor={`mc-${task.id}`}>{t('form.minCrew')}</label>
          <input id={`mc-${task.id}`} className="gp-input" inputMode="numeric" value={minCrew} onChange={(e) => setMinCrew(e.target.value)} aria-label={t('form.minCrew')} title={t('form.minCrew')} />
          <label className="gp-sr" htmlFor={`st-${task.id}`}>{t('tasks.start')}</label>
          <input id={`st-${task.id}`} className="gp-input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          <Button variant="primary" disabled={!brigadeId} busy={busy} onClick={assign}>{t('tasks.assign')}</Button>
        </div>
      )}
      {conflict ? (
        <div className="gp-alert gp-alert--warn" role="alert">{t('conflict.text', { v: String((error.details as { currentVersion?: number })?.currentVersion ?? '?') })} <Button onClick={onChanged}>{t('conflict.reload')}</Button></div>
      ) : <ErrorNote error={error} notSaved />}
    </li>
  );
}
