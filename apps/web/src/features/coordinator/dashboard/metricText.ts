import { t, tr } from '../../../shared/i18n';

/** Translate display text only; retain the date and unknown server text verbatim. */
export function metricPeriod(period: string): string {
  const prefix = 'Данные OSM на ';
  return period.startsWith(prefix) ? t('metrics.osmDate', { date: period.slice(prefix.length) }) : tr(period);
}
