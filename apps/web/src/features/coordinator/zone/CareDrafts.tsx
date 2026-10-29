import { useRef, useState } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import { newIdempotencyKey } from '../../../shared/api/transport';
import type { CareDraft, CareSchedule } from '../../../shared/analytics/careSchedule';
import { t } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/components';

export function CareDrafts({ siteId }: { siteId: string }) {
  const { api } = useData(), me = useResource(() => api.me(), []);
  const [months, setMonths] = useState('3'), [visits, setVisits] = useState(''), [budget, setBudget] = useState('');
  const [schedule, setSchedule] = useState<CareSchedule | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [states, setStates] = useState<Record<string, { pending?: boolean; taskId?: string; error?: string }>>({});
  // Reuse both key and exact body on retry after a lost response. Regeneration preserves outcomes.
  const attempts = useRef(new Map<string, { key: string; body: Omit<CareDraft, 'id' | 'objectName' | 'dataClass' | 'estimatedCostKzt'> }>());
  const inFlight = useRef(new Set<string>());
  async function generate(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { setSchedule(await api.careSchedule(siteId, { months: Number(months), ...(visits === '' ? {} : { crewVisitsPerMonth: Number(visits) }), ...(budget === '' ? {} : { budgetKzt: Number(budget) }) })); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  async function create(draft: CareDraft) {
    if (inFlight.current.has(draft.id) || states[draft.id]?.taskId) return;
    inFlight.current.add(draft.id);
    const { id, objectName: _name, dataClass: _dataClass, estimatedCostKzt: _cost, ...body } = draft;
    if (!attempts.current.has(id)) attempts.current.set(id, { key: newIdempotencyKey(), body });
    const attempt = attempts.current.get(id)!;
    setStates(s => ({ ...s, [id]: { pending: true } }));
    try {
      const task = await api.createTask(attempt.body, attempt.key);
      setStates(s => ({ ...s, [id]: { taskId: task.id } }));
    } catch (err) { setStates(s => ({ ...s, [id]: { error: err instanceof Error ? err.message : String(err) } })); }
    finally { inFlight.current.delete(id); }
  }
  return <section aria-labelledby="care-drafts-title">
    <h3 id="care-drafts-title" className="gp-subhead">{t('care.drafts')}</h3>
    <form onSubmit={generate} className="gp-btn-row gp-zone__controls">
      <label>{t('care.months')}<input className="gp-input" type="number" min="1" max="12" step="1" required value={months} onChange={e => setMonths(e.target.value)} /></label>
      <label>{t('care.visits')}<input className="gp-input" type="number" min="0" max="31" step="1" value={visits} onChange={e => setVisits(e.target.value)} /></label>
      <label>{t('care.budget')}<input className="gp-input" type="number" min="0" step="any" value={budget} onChange={e => setBudget(e.target.value)} /></label>
      <Button type="submit" disabled={busy || inFlight.current.size > 0}>{t(busy ? 'care.generating' : 'care.generate')}</Button>
    </form>
    {error && <p role="alert" className="gp-alert gp-alert--warn">{error}</p>}
    {schedule && <>
      {schedule.warnings.map(w => <p className="gp-small gp-alert gp-alert--warn" key={w}>{w}</p>)}
      <p role="status">{t('care.count', { n: schedule.tasks.length })}</p>
      {!schedule.tasks.length ? <p>{t('care.empty')}</p> : <div className="gp-table-wrap"><table className="gp-table gp-small">
        <thead><tr>{(['care.object', 'care.operation', 'care.date', 'care.minutes', 'care.water', 'care.status'] as const).map(k => <th key={k}>{t(k)}</th>)}</tr></thead>
        <tbody>{schedule.tasks.map(d => { const state = states[d.id]; return <tr key={d.id}>
          <td>{d.objectName}</td><td>{d.description}</td><td>{d.dueAt ? new Date(d.dueAt).toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty' }) : t('care.noData')}</td>
          <td>{d.estimatedMinutes}</td><td>{d.requiredWaterLiters ?? t('care.noData')}</td>
          <td aria-live="polite">{state?.taskId ? t('care.created', { id: state.taskId }) : <>
            {state?.error && <p role="alert">{t('care.rejected', { message: state.error })}</p>}
            <Button disabled={busy || state?.pending || me.data?.role !== 'coordinator'} onClick={() => void create(d)}>{t(state?.pending ? 'care.creating' : state?.error ? 'care.retry' : 'care.create')}</Button>
          </>}</td>
        </tr>; })}</tbody>
      </table></div>}
    </>}
  </section>;
}
