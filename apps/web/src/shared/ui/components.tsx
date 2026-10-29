// Общие элементы интерфейса. Используются кабинетом координатора и кабинетом работника (участник 4).
import { useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ApiError } from '../api/transport';
import type { AiMethod, CheckState, DataClass, EvidenceRef, ID, MissingData, Priority, TaskStatus } from '../api/types';
import { t, type Key } from '../i18n';
import { fmtDateTime, fmtTime } from '../format';
import { useData, useResource } from '../api/DataProvider';

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'demo';

export function Badge({ tone = 'neutral', icon, children, title }: { tone?: Tone; icon?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`gp-badge gp-badge--${tone}`} title={title}>
      {icon && <span aria-hidden="true" className="gp-badge__icon">{icon}</span>}
      {children}
    </span>
  );
}

// Состояние различается значком и текстом, не только цветом.
const CHECK_UI: Record<CheckState, [Tone, string]> = { unknown: ['warn', '?'], cleared: ['ok', '✓'], blocked: ['bad', '✕'] };
export const CheckBadge = ({ state }: { state: CheckState }) => {
  const [tone, icon] = CHECK_UI[state];
  return <Badge tone={tone} icon={icon}>{t(`check.${state}` as Key)}</Badge>;
};

const ELIG_UI: Record<string, [Tone, string]> = { survey_needed: ['warn', '?'], blocked: ['bad', '✕'], planting_candidate: ['ok', '✓'] };
export const EligBadge = ({ value }: { value: 'survey_needed' | 'blocked' | 'planting_candidate' }) => {
  const [tone, icon] = ELIG_UI[value];
  return <Badge tone={tone} icon={icon}>{t(`elig.${value}` as Key)}</Badge>;
};

const STATUS_UI: Record<TaskStatus, [Tone, string]> = {
  draft: ['neutral', '○'],
  assigned: ['info', '◔'],
  in_progress: ['info', '◑'],
  submitted: ['warn', '◕'],
  verified: ['ok', '✓'],
};
export const TaskStatusBadge = ({ status }: { status: TaskStatus }) => {
  const [tone, icon] = STATUS_UI[status];
  return <Badge tone={tone} icon={icon}>{t(`status.${status}` as Key)}</Badge>;
};

const PRIO_UI: Record<Priority, [Tone, string]> = { low: ['neutral', '▁'], medium: ['neutral', '▃'], high: ['warn', '▅'], critical: ['bad', '▇'] };
export const PriorityBadge = ({ value }: { value: Priority }) => {
  const [tone, icon] = PRIO_UI[value];
  return <Badge tone={tone} icon={icon}>{t(`priority.${value}` as Key)}</Badge>;
};

const DC_UI: Record<DataClass | 'unknown', [Tone, string]> = { real: ['info', '●'], demo: ['demo', '◇'], estimate: ['neutral', '≈'], unknown: ['warn', '?'] };
export const DataClassTag = ({ value }: { value: DataClass | 'unknown' }) => {
  const [tone, icon] = DC_UI[value];
  return <Badge tone={tone} icon={icon}>{t(`data.${value}` as Key)}</Badge>;
};

export const MethodTag = ({ method }: { method: AiMethod }) => (
  <Badge tone={method === 'model' ? 'info' : method === 'recorded_demo' ? 'demo' : 'neutral'} icon={method === 'model' ? '✦' : method === 'rules' ? '≡' : '▶'} title={t(`method.${method}.long` as Key)}>
    {t(`method.${method}` as Key)}
  </Badge>
);
/** Режим расчёта с расшифровкой текстом (не только во всплывающей подсказке). */
export const MethodLine = ({ method }: { method: AiMethod }) => (
  <p className="gp-method"><MethodTag method={method} /> <span>{t(`method.${method}.long` as Key)}</span></p>
);

export function Button({ variant = 'secondary', busy, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; busy?: boolean }) {
  return (
    <button {...rest} className={`gp-btn gp-btn--${variant} ${rest.className ?? ''}`} disabled={rest.disabled || busy} aria-busy={busy || undefined}>
      {busy && <span className="gp-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Защита важных действий от двойного нажатия: пока запрос идёт, повтор игнорируется. */
export function useGuarded() {
  const inflight = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (inflight.current) return undefined;
    inflight.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, []);
  return { run, busy };
}

export function ErrorNote({ error, notSaved }: { error: unknown; notSaved?: boolean }) {
  if (!error) return null;
  const e = error as ApiError;
  const msg = e instanceof ApiError ? (e.status === 0 ? t('state.network') : e.status === 403 ? t('state.forbidden') : e.status === 401 ? t('state.unauthenticated') : e.message) : String((error as Error).message ?? error);
  return (
    <div className="gp-alert gp-alert--bad" role="alert">
      <strong>{notSaved ? t('state.notSaved') + ' ' : ''}</strong>
      {msg}
      {e instanceof ApiError && e.requestId && <div className="gp-muted gp-small">{t('state.requestId', { id: e.requestId })}</div>}
    </div>
  );
}

/** Единая обработка загрузки, отказа сети, нет прав и пустых данных. */
export function StateView({ loading, error, empty, emptyText, emptyAction, onRetry, children, hasData }: { loading: boolean; error: unknown; empty?: boolean; emptyText?: string; /** Что сделать дальше: кнопка или ссылка под пустым списком. */ emptyAction?: ReactNode; onRetry?: () => void; children?: ReactNode; hasData?: boolean }) {
  if (loading && !hasData) return <div className="gp-state" role="status"><span className="gp-spinner" aria-hidden="true" /> {t('state.loading')}</div>;
  const e = error as ApiError;
  const authLost = e instanceof ApiError && (e.status === 401 || e.status === 403);
  // Без права доступа прежние данные не показываем, даже если они уже загружены.
  if (error && (!hasData || authLost)) {
    const icon = e instanceof ApiError && (e.status === 401 || e.status === 403) ? '🔒' : '⚠';
    return (
      <div className="gp-state gp-state--error" role="alert">
        <span aria-hidden="true" className="gp-state__icon">{icon}</span>
        <ErrorNote error={error} />
        {onRetry && <Button onClick={onRetry}>{t('state.retry')}</Button>}
      </div>
    );
  }
  if (empty) return <div className="gp-state gp-state--empty"><span aria-hidden="true" className="gp-state__icon">∅</span>{emptyText ?? t('state.empty')}{emptyAction && <div className="gp-state__action">{emptyAction}</div>}</div>;
  return <>{children}</>;
}

/** Время обновления; если последняя попытка не удалась — явное предупреждение об устаревании. */
export function Freshness({ updatedAt, error, loading, onRefresh }: { updatedAt: string | null; error: unknown; loading: boolean; onRefresh: () => void }) {
  return (
    <div className="gp-fresh" aria-live="polite">
      {error && updatedAt ? (
        <span className="gp-fresh__stale"><span aria-hidden="true">⚠ </span>{t('state.stale', { time: fmtTime(updatedAt) })}</span>
      ) : updatedAt ? (
        <span className="gp-muted">{t('state.updated', { time: fmtTime(updatedAt) })}</span>
      ) : null}
      <Button variant="ghost" onClick={onRefresh} busy={loading} aria-label={t('state.refresh')}>↻ {t('state.refresh')}</Button>
    </div>
  );
}

export function Field({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: string; error?: string; children: (id: string, describedBy: string | undefined) => ReactNode }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={`gp-field ${error ? 'gp-field--error' : ''}`}>
      <label htmlFor={id} className="gp-field__label">
        {label} {required && <span className="gp-req">({t('form.required')})</span>}
      </label>
      {children(id, [hintId, errId].filter(Boolean).join(' ') || undefined)}
      {hint && <div id={hintId} className="gp-field__hint">{hint}</div>}
      {error && <div id={errId} className="gp-field__error" role="alert"><span aria-hidden="true">✕ </span>{error}</div>}
    </div>
  );
}

export function Section({ title, children, actions, id }: { title: string; children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section className="gp-section" aria-labelledby={id}>
      <div className="gp-section__head">
        <h3 id={id}>{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function MissingList({ items }: { items: MissingData[] }) {
  if (!items.length) return null;
  return (
    <div className="gp-missing">
      <h4><span aria-hidden="true">? </span>{t('data.missing')}</h4>
      <ul>{items.map((m) => <li key={m.field}>{m.reason}</li>)}</ul>
    </div>
  );
}

export function Limitations({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="gp-limits">
      <h4><span aria-hidden="true">ⓘ </span>{t('data.limitations')}</h4>
      <ul>{items.map((m) => <li key={m}>{m}</li>)}</ul>
    </div>
  );
}

export function EvidenceList({ ids }: { ids: ID[] }) {
  const { api } = useData();
  const key = ids.join(',');
  const r = useResource<EvidenceRef[]>(() => (ids.length ? api.evidence(ids) : Promise.resolve([])), [key]);
  if (!ids.length) return <p className="gp-muted">{t('data.unknown')}</p>;
  return (
    <StateView loading={r.loading} error={r.error} hasData={!!r.data} onRetry={r.reload}>
      <ul className="gp-evidence">
        {(r.data ?? []).map((e) => (
          <li key={e.id}>
            <DataClassTag value={e.dataClass} /> <strong>{e.sourceLabel}</strong>
            {e.observedAt && <span className="gp-muted"> · {fmtDateTime(e.observedAt)}</span>}
            {e.note && <div className="gp-small">{e.note}</div>}
            {e.sourceUrl && <div className="gp-small"><a href={e.sourceUrl} target="_blank" rel="noreferrer">{e.sourceUrl}</a></div>}
          </li>
        ))}
      </ul>
    </StateView>
  );
}

/** Модальное окно на <dialog>: фокус и Esc обрабатывает браузер. */
export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  // onClose — только когда окно закрыл пользователь (Esc, ✕), а не программное закрытие при смене окна.
  return (
    <dialog ref={ref} className={`gp-modal ${wide ? 'gp-modal--wide' : ''}`} onClose={() => openRef.current && onClose()} aria-labelledby={titleId}>
      <div className="gp-modal__head">
        <h2 id={titleId}>{title}</h2>
        <button className="gp-icon-btn" onClick={onClose} aria-label={t('common.close')}>✕</button>
      </div>
      <div className="gp-modal__body">{open && children}</div>
    </dialog>
  );
}

export const Bar = ({ value, label }: { value: number | null; label: string }) => (
  <div className="gp-bar" role="img" aria-label={`${label}: ${value ?? t('factor.noData')}`}>
    {value === null ? <span className="gp-bar__none">{t('factor.noData')}</span> : <span className="gp-bar__fill" style={{ width: `${value}%` }} />}
  </div>
);
