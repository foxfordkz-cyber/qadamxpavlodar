import { useData, useResource } from '../../../shared/api/DataProvider';
import { ErrorNote } from '../../../shared/ui/components';
import { t, tr } from '../../../shared/i18n';
import { metricPeriod } from './metricText';

/** Сводные показатели с сервера. Определение и период видны рядом, не только в подсказке. */
export function Metrics({ compact }: { compact?: boolean }) {
  const { api } = useData();
  const r = useResource(() => api.dashboard(), [], 30000);
  const items = r.data?.data ?? [];
  if (r.error && !r.data) return <ErrorNote error={r.error} />;
  if (compact) {
    const pick = items.filter((m) => ['sites_need_check', 'sites_blocked', 'sites_cleared', 'reports_pending'].includes(m.key));
    return (
      <dl className="gp-metrics-compact" aria-label={t('dash.title')}>
        {pick.map((m) => <div key={m.key}><dt>{tr(m.label)}</dt><dd>{m.value ?? '—'}</dd></div>)}
      </dl>
    );
  }
  return (
    <section aria-label={t('dash.title')} className="gp-metrics">
      {items.map((m) => (
        <div key={m.key} className="gp-card gp-metric">
          <div className="gp-metric__value">{m.value ?? '—'}</div>
          <div className="gp-metric__label">{tr(m.label)}</div>
          <div className="gp-small gp-muted">{metricPeriod(m.period)}</div>
          <details><summary>{t('dash.definition')}</summary>{tr(m.definition)}</details>
        </div>
      ))}
    </section>
  );
}
