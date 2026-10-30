import { tr } from '../../../shared/i18n';
import { useRef, useState } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import { ApiError, newIdempotencyKey } from '../../../shared/api/transport';
import type { ID, Priority, Task, TaskAction } from '../../../shared/api/types';
import { Button, ErrorNote, Field, TaskStatusBadge, useGuarded } from '../../../shared/ui/components';
import { t, type Key } from '../../../shared/i18n';
import { fmtDateTime, fmtTime, localInputToIso } from '../../../shared/format';
import { eligibilityOf } from '../sites/eligibility';

export interface TaskDraft {
  objectId: ID;
  action: TaskAction;
  priority: Priority;
  description: string;
  speciesIds?: ID[];
  /** Для посадки: согласованный проект и версия состава. */
  projectId?: ID;
  projectDesignVersion?: number;
  projectTitle?: string;
  estimatedMinutes?: number;
}

const ACTIONS: TaskAction[] = ['inspect', 'plant', 'water', 'weed'];
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical'];

export function TaskForm({ initial, onDone, onCancel }: { initial: TaskDraft; onDone: () => void; onCancel: () => void }) {
  const { api, bump } = useData();
  const sites = useResource(() => api.sites(), []);
  const brigades = useResource(() => api.brigades(), []);
  const [v, setV] = useState({
    objectId: initial.objectId,
    action: initial.action,
    priority: initial.priority,
    description: initial.description,
    due: '',
    minutes: String(initial.estimatedMinutes ?? (initial.action === 'plant' ? 120 : 60)),
    water: '',
    waterUnknown: true,
    brigadeId: '',
    minCrew: initial.action === 'plant' ? '2' : '1',
    start: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<Task | null>(null);
  const [assigned, setAssigned] = useState<Task | null>(null);
  const [assignError, setAssignError] = useState<unknown>(null);
  const { run, busy } = useGuarded();
  // Один ключ повтора на одинаковое содержимое: повторная отправка не создаст дубль.
  const keyRef = useRef<{ hash: string; key: string } | null>(null);

  const site = sites.data?.data.find((s) => s.id === v.objectId);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((p) => ({ ...p, [k]: val }));
  const brigade = brigades.data?.find((b) => b.id === v.brigadeId);
  const isPlanting = v.action === 'plant';

  const validate = () => {
    const e: Record<string, string> = {};
    if (!v.objectId) e.objectId = 'Выберите участок — задание привязывается к объекту на карте.';
    const m = Number(v.minutes);
    if (!Number.isFinite(m) || m <= 0) e.minutes = 'Укажите длительность больше нуля — иначе задание нельзя распределить по смене.';
    if (isPlanting && site && eligibilityOf(site) !== 'planting_candidate') e.action = t('site.plantingBlocked');
    if (isPlanting && !initial.projectId) e.action = t('form.needProject');
    if (!v.waterUnknown) {
      const w = Number(v.water);
      if (!v.water.trim() || !Number.isFinite(w) || w <= 0) e.water = 'Введите литры больше нуля или отметьте «Норма неизвестна».';
    }
    if (v.due && !localInputToIso(v.due)) e.due = 'Неверная дата.';
    if (brigade) {
      const crew = Number(v.minCrew);
      if (!Number.isInteger(crew) || crew < 1) e.minCrew = 'Целое число от 1.';
      else if (crew > brigade.memberIds.length) e.minCrew = t('dynamic.007', { p0: String(brigade.memberIds.length) });
      if (!brigade.skills.includes(v.action)) e.brigadeId = t('dynamic.008', { p0: String(t(`action.${v.action}` as Key)) });
      if (!brigade.active) e.brigadeId = t('dynamic.009', { p0: String(brigade.name) });
    }
    setErrors(e);
    return !Object.keys(e).length;
  };

  const submit = () =>
    run(async () => {
      setError(null);
      setAssignError(null);
      if (!validate()) return;
      const body = {
        objectType: 'candidate_site' as const,
        objectId: v.objectId,
        action: v.action,
        priority: v.priority,
        description: v.description.trim(),
        dueAt: v.due ? localInputToIso(v.due) : null,
        estimatedMinutes: Number(v.minutes),
        requiredWaterLiters: v.waterUnknown ? null : Number(v.water),
        evidenceIds: [] as string[],
        projectId: initial.projectId ?? null,
        projectDesignVersion: initial.projectDesignVersion ?? null,
      };
      const hash = JSON.stringify(body);
      if (keyRef.current?.hash !== hash) keyRef.current = { hash, key: newIdempotencyKey() };
      let task = created;
      if (!task) {
        try {
          task = await api.createTask(body, keyRef.current.key);
          setCreated(task);
          bump();
        } catch (e) {
          const fields = (e as ApiError).details as { fields?: Record<string, string> } | undefined;
          if (fields?.fields) setErrors(fields.fields);
          setError(e);
          return;
        }
      }
      if (v.brigadeId && task) {
        try {
          const a = await api.assignTask(task.id, { brigadeId: v.brigadeId, minCrew: Number(v.minCrew), scheduledStart: v.start ? localInputToIso(v.start) : null, expectedVersion: task.version }, `assign-${task.id}-${v.brigadeId}-${v.minCrew}-${v.start}`);
          setAssigned(a);
          bump();
        } catch (e) {
          setAssignError(e);
        }
      }
    });

  if (created && (!v.brigadeId || assigned || assignError)) {
    const final = assigned ?? created;
    const br = brigades.data?.find((b) => b.id === final.brigadeId);
    return (
      <div>
        <h3>{t('form.serverResult')}</h3>
        <div className="gp-alert gp-alert--ok" role="status">
          <span aria-hidden="true">✓ </span>{t('form.created', { id: final.id, status: t(`status.${final.status}` as Key), v: final.version })}
        </div>
        <dl className="gp-dl">
          <dt>{tr("Статус")}</dt><dd><TaskStatusBadge status={final.status} /></dd>
          <dt>{t('form.brigade')}</dt><dd>{br ? t('dynamic.010', { p0: String(br.name), p1: String(final.minCrew) }) : t('tasks.unassigned')}</dd>
          {br && <><dt>{t('tasks.crew')}</dt><dd>{t('tasks.crewPending')}</dd></>}
          {final.scheduledStart && <><dt>{t('tasks.planned')}</dt><dd>{fmtDateTime(final.scheduledStart)} – {fmtTime(final.scheduledEnd)}</dd></>}
          {final.projectId && <><dt>{t('form.project')}</dt><dd>{initial.projectTitle ?? final.projectId}{tr(", версия состава")}{" "}{final.projectDesignVersion}</dd></>}
          <dt>{tr("Вода")}</dt><dd>{final.requiredWaterLiters == null ? t('form.waterUnknown') : t('dynamic.011', { p0: String(final.requiredWaterLiters) })}</dd>
          <dt>{tr("Создано (время сервера)")}</dt><dd>{fmtDateTime(final.createdAt)}</dd>
        </dl>
        {assignError ? <div className="gp-alert gp-alert--warn" role="alert">{t('form.assignFailed', { message: (assignError as Error).message })}</div> : null}
        <Button variant="primary" onClick={onDone}>{t('common.close')}</Button>
      </div>
    );
  }

  const sitesList = sites.data?.data ?? [];
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      {initial.projectId && (
        <div className="gp-alert gp-alert--ok gp-small"><strong>{t('form.project')}:</strong> {initial.projectTitle ?? initial.projectId} · {t('form.projectVersion', { v: initial.projectDesignVersion ?? '?' })}</div>
      )}
      <Field label={t('form.object')} required error={errors.objectId}>
        {(id, d) => (
          <select id={id} aria-describedby={d} className="gp-input" value={v.objectId} onChange={(e) => set('objectId', e.target.value)} disabled={!!created || !!initial.projectId}>
            <option value="">—</option>
            {sitesList.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.id}</option>)}
          </select>
        )}
      </Field>
      <div className="gp-grid-2">
        <Field label={t('form.action')} required error={errors.action}>
          {(id, d) => (
            <select id={id} aria-describedby={d} className="gp-input" value={v.action} onChange={(e) => set('action', e.target.value as TaskAction)} disabled={!!created || !!initial.projectId}>
              {ACTIONS.map((a) => <option key={a} value={a}>{t(`action.${a}` as Key)}</option>)}
            </select>
          )}
        </Field>
        <Field label={t('form.priority')} required error={errors.priority}>
          {(id, d) => (
            <select id={id} aria-describedby={d} className="gp-input" value={v.priority} onChange={(e) => set('priority', e.target.value as Priority)} disabled={!!created}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{t(`priority.${p}` as Key)}</option>)}
            </select>
          )}
        </Field>
        <Field label={t('form.minutes')} required hint={t('form.minutesWhy')} error={errors.minutes}>
          {(id, d) => <input id={id} aria-describedby={d} className="gp-input" inputMode="numeric" value={v.minutes} onChange={(e) => set('minutes', e.target.value)} disabled={!!created} />}
        </Field>
        <Field label={t('form.due')} error={errors.due}>
          {(id, d) => <input id={id} aria-describedby={d} className="gp-input" type="datetime-local" value={v.due} onChange={(e) => set('due', e.target.value)} disabled={!!created} />}
        </Field>
      </div>
      {(v.action === 'water' || isPlanting) && (
        <Field label={t('form.water')} hint={t('form.waterWhy')} error={errors.water}>
          {(id, d) => (
            <div className="gp-btn-row">
              <input id={id} aria-describedby={d} className="gp-input gp-input--short" inputMode="decimal" value={v.water} disabled={v.waterUnknown || !!created} onChange={(e) => set('water', e.target.value)} />
              <label className="gp-check"><input type="checkbox" checked={v.waterUnknown} disabled={!!created} onChange={(e) => set('waterUnknown', e.target.checked)} />{t('form.waterUnknown')}</label>
            </div>
          )}
        </Field>
      )}
      <Field label={t('form.description')}>
        {(id, d) => <textarea id={id} aria-describedby={d} className="gp-input" value={v.description} onChange={(e) => set('description', e.target.value)} disabled={!!created} />}
      </Field>
      <fieldset className="gp-fieldset">
        <legend>{t('form.assignSection')}</legend>
        <p className="gp-small gp-muted">{t('form.brigadeWhy')}</p>
        <div className="gp-grid-2">
          <Field label={t('form.brigade')} error={errors.brigadeId}>
            {(id, d) => (
              <select id={id} aria-describedby={d} className="gp-input" value={v.brigadeId} onChange={(e) => set('brigadeId', e.target.value)}>
                <option value="">{t('form.noBrigade')}</option>
                {(brigades.data ?? []).map((b) => <option key={b.id} value={b.id} disabled={!b.active}>{b.name} · {b.memberIds.length}{" "}{tr("чел. ·")}{" "}{fmtTime(b.shiftStart)}–{fmtTime(b.shiftEnd)}</option>)}
              </select>
            )}
          </Field>
          {v.brigadeId && (
            <Field label={t('form.minCrew')} required error={errors.minCrew} hint={brigade ? `${t('form.equipment')}: ${brigade.equipment.join(', ') || '—'}` : undefined}>
              {(id, d) => <input id={id} aria-describedby={d} className="gp-input gp-input--short" inputMode="numeric" value={v.minCrew} onChange={(e) => set('minCrew', e.target.value)} />}
            </Field>
          )}
          {v.brigadeId && (
            <Field label={t('tasks.start')} hint={brigade ? t('dynamic.012', { p0: String(fmtDateTime(brigade.shiftStart)), p1: String(fmtTime(brigade.shiftEnd)) }) : undefined}>
              {(id, d) => <input id={id} aria-describedby={d} className="gp-input" type="datetime-local" value={v.start} onChange={(e) => set('start', e.target.value)} />}
            </Field>
          )}
        </div>
      </fieldset>
      {Object.keys(errors).length > 0 && <div className="gp-alert gp-alert--bad" role="alert">{t('form.fixErrors')}</div>}
      <ErrorNote error={error} notSaved />
      {created && <div className="gp-alert gp-alert--info">{tr("Задание")}{" "}{created.id}{" "}{tr("уже создано на сервере; повторяется только назначение.")}</div>}
      <div className="gp-btn-row">
        <Button variant="primary" type="submit" busy={busy}>{busy ? t('form.saving') : t('form.submit')}</Button>
        <Button type="button" onClick={onCancel}>{t('form.cancel')}</Button>
      </div>
    </form>
  );
}
