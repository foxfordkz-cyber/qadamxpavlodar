import type { ZoneAnalysis } from '../../../shared/analytics/plan';
import { t } from '../../../shared/i18n';

export function SurvivalMethod({ model }: { model: ZoneAnalysis['survivalModel'] }) {
  return <><p className="gp-small gp-muted">{t('survival.method', {
    auc: model.rocAuc.toLocaleString('ru-RU', { maximumFractionDigits: 3 }),
    brier: model.brier.toLocaleString('ru-RU', { maximumFractionDigits: 3 }), n: model.validationN,
  })}</p><p className="gp-small gp-muted">{t('survival.range')}</p></>;
}
