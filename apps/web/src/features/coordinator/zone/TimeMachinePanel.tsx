import { t } from '../../../shared/i18n';
import { useEffect, useMemo } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import type { CandidateSite, Species } from '../../../shared/api/types';
import type { ZoneAnalysis } from '../../../shared/analytics/plan';
import { buildGrowthScene, GROWTH_YEARS, timeMachine, useTimeMachine, YEAR_LABEL } from './timeMachine';

const STREET = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)(_link)?$/;

/** Вкладка «Эффект»: посадка по схеме растёт на основной карте через 5, 10, 20 лет; цифры — из того же расчёта. */
export function TimeMachinePanel({ a, site, byId }: { a: ZoneAnalysis; site: CandidateSite; byId: Map<string, Species> }) {
  const { api } = useData();
  const tm = useTimeMachine();
  // Улицы рядом с зоной: ряды и бордюр цветов выстраиваются вдоль ближайшей. Тротуары и проезды
  // к домам вплотную к газону не в счёт — иначе бордюр уходит к подъездам, а не к улице.
  const ctx = useResource(() => api.siteContext(site.id, 50), [site.id]);
  const roads = useMemo(() => {
    const all = ctx.data?.roads ?? [];
    const streets = all.filter((r) => STREET.test(r.kind));
    return (streets.length ? streets : all).map((r) => r.geometry.coordinates);
  }, [ctx.data]);
  const scene = useMemo(() => (ctx.loading ? null : buildGrowthScene(site, a, byId, roads)), [site, a, byId, roads, ctx.loading]);
  const active = tm.scene?.siteId === site.id;
  // Пересчёт зоны (вариант, замена вида, полив) сразу меняет посадку на карте.
  useEffect(() => {
    if (active && scene && tm.scene !== scene) timeMachine.show(scene, tm.year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);
  // Ушли со вкладки или закрыли карточку — карта возвращается к обычному виду.
  useEffect(() => () => timeMachine.hide(), []);
  if (ctx.loading) return <p className="gp-small gp-muted" role="status">{t('timeMachine.loading')}</p>;
  if (!scene) return <p className="gp-small gp-muted">{t('timeMachine.noContour')}</p>;
  const year = active ? tm.year : null;
  const e = year ? a.effect.find((x) => x.years === year) : null;
  const area = a.facts.areaM2;
  return (
    <section className="gp-tm" aria-labelledby="z-tm">
      <h3 id="z-tm" className="gp-subhead">{t('timeMachine.title')}</h3>
      <p className="gp-small">{t('timeMachine.lead')}</p>
      <div className="gp-segment" role="radiogroup" aria-label={t('timeMachine.yearLabel')}>
        {GROWTH_YEARS.map((y) => <label key={y}><input type="radio" name="tm-year" checked={year === y} onChange={() => timeMachine.show(scene, y)} />{t(YEAR_LABEL[y])}</label>)}
      </div>
      {active && (
        <div className="gp-tm__stats" aria-live="polite">
          {e ? (
            <>
              <div><strong>{e.canopyM2.toLocaleString('ru-RU')} м²</strong><span>{t('timeMachine.canopy')}{area ? t('timeMachine.zoneShare', { n: Math.min(100, Math.round((e.canopyM2 / area) * 100)) }) : ''}</span></div>
              <div><strong>{e.co2t.toFixed(2)} {t('timeMachine.tonnesYear')}</strong><span>{t('timeMachine.co2')}</span></div>
              <div><strong>−{e.coolingC} °C</strong><span>{t('timeMachine.cooling')}</span></div>
            </>
          ) : (
            <p className="gp-small">{t('timeMachine.initial')}</p>
          )}
        </div>
      )}
      {active && <button className="gp-btn gp-btn--ghost" onClick={() => timeMachine.hide()}>{t('timeMachine.hideMap')}</button>}
      <p className="gp-small gp-muted">
        {t('timeMachine.method')}{scene.shown < scene.total ? t('timeMachine.shown', { shown: scene.shown, total: scene.total }) : ''}
      </p>
    </section>
  );
}
