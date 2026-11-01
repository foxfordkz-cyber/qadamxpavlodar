import { useId, useState } from 'react';
import type { ZoneAnalysis } from '../../../shared/analytics/plan';
import { t } from '../../../shared/i18n';
import './SurvivalMethod.css';

export function SurvivalMethod({ model }: { model: ZoneAnalysis['survivalModel'] }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  return (
    <section className="gp-survival-method" aria-label={t('survival.explanationTitle')}>
      <p className="gp-survival-method__label">{t('survival.syntheticLabel')}</p>
      <p className="gp-survival-method__summary">{t('survival.summaryLimits')}</p>
      <button type="button" className="gp-btn gp-btn--ghost gp-survival-method__toggle gp-noprint"
        aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(!expanded)}>
        {t(expanded ? 'survival.hideMethodDetails' : 'survival.methodDetails')}
      </button>
      <div id={detailsId} className="gp-survival-method__details" hidden={!expanded}>
        <dl className="gp-survival-method__facts">
          <div><dt>{t('survival.datasetSize')}</dt><dd>{model.n.toLocaleString('ru-RU')}</dd></div>
          <div><dt>{t('survival.validationSize')}</dt><dd>{model.validationN.toLocaleString('ru-RU')}</dd></div>
        </dl>
        <p className="gp-small gp-muted">{t('survival.method', {
          auc: model.rocAuc.toLocaleString('ru-RU', { maximumFractionDigits: 3 }),
          brier: model.brier.toLocaleString('ru-RU', { maximumFractionDigits: 3 }), n: model.validationN,
        })}</p>
        <p className="gp-small gp-muted">{t('survival.range')}</p>
      </div>
    </section>
  );
}
