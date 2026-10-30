import { t } from '../../../shared/i18n';
import type { ZoneAnalysis } from '../../../shared/analytics/plan';

const money = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2).replace('.', ',')} ${t('zone.summary.mln')} ₸` : `${Math.round(n).toLocaleString('ru-RU')} ₸`);

/** Решение по зоне в трёх строках: что посадить, сколько стоит и что будет через 20 лет. Числа — из расчёта зоны. */
export function PlanSummary({ a }: { a: ZoneAnalysis }) {
  const plants = a.scheme.reduce((n, r) => n + r.quantity, 0);
  const e20 = a.effect[a.effect.length - 1];
  return (
    <dl className="gp-plansum">
      <div>
        <dt>{t('zone.summary.plan')}</dt>
        <dd><strong>{plants.toLocaleString('ru-RU')}</strong> {t('zone.summary.plants', { p: a.survivalAvg.y3 })}</dd>
      </div>
      <div>
        <dt>{t('zone.summary.cost')}</dt>
        <dd><strong>{money(a.cost.total)}</strong> {t('zone.summary.costNote')}</dd>
      </div>
      {e20 && (
        <div>
          <dt>{t('zone.summary.future')}</dt>
          <dd><strong>{e20.canopyM2.toLocaleString('ru-RU')} м²</strong> {t('zone.summary.futureNote', { c: e20.coolingC })}</dd>
        </div>
      )}
    </dl>
  );
}
