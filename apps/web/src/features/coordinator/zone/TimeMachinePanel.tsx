import { useEffect, useMemo } from 'react';
import type { CandidateSite, Species } from '../../../shared/api/types';
import type { ZoneAnalysis } from '../../../shared/analytics/plan';
import { buildGrowthScene, GROWTH_YEARS, timeMachine, useTimeMachine, YEAR_LABEL } from './timeMachine';

/** Вкладка «Эффект»: посадка по схеме растёт на основной карте через 5, 10, 20 лет; цифры — из того же расчёта. */
export function TimeMachinePanel({ a, site, byId }: { a: ZoneAnalysis; site: CandidateSite; byId: Map<string, Species> }) {
  const tm = useTimeMachine();
  const scene = useMemo(() => buildGrowthScene(site, a, byId), [site, a, byId]);
  const active = tm.scene?.siteId === site.id;
  // Пересчёт зоны (вариант, замена вида, полив) сразу меняет посадку на карте.
  useEffect(() => {
    if (active && scene && tm.scene !== scene) timeMachine.show(scene, tm.year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);
  // Ушли со вкладки или закрыли карточку — карта возвращается к обычному виду.
  useEffect(() => () => timeMachine.hide(), []);
  if (!scene) return <p className="gp-small gp-muted">Машина времени доступна для зон с контуром.</p>;
  const year = active ? tm.year : null;
  const e = year ? a.effect.find((x) => x.years === year) : null;
  const area = a.facts.areaM2;
  return (
    <section className="gp-tm" aria-labelledby="z-tm">
      <h3 id="z-tm" className="gp-subhead">Машина времени</h3>
      <p className="gp-small">Посадка по этой схеме вырастает на карте: так зона будет выглядеть через годы.</p>
      <div className="gp-segment" role="radiogroup" aria-label="Год после посадки">
        {GROWTH_YEARS.map((y) => <label key={y}><input type="radio" name="tm-year" checked={year === y} onChange={() => timeMachine.show(scene, y)} />{YEAR_LABEL[y]}</label>)}
      </div>
      {active && (
        <div className="gp-tm__stats" aria-live="polite">
          {e ? (
            <>
              <div><strong>{e.canopyM2.toLocaleString('ru-RU')} м²</strong><span>крона{area ? ` · ${Math.min(100, Math.round((e.canopyM2 / area) * 100))}% зоны` : ''}</span></div>
              <div><strong>{e.co2t.toFixed(2)} т/год</strong><span>поглощение CO₂</span></div>
              <div><strong>−{e.coolingC} °C</strong><span>охлаждение в зоне</span></div>
            </>
          ) : (
            <p className="gp-small">Саженцы: эффект начнётся после приживания.</p>
          )}
        </div>
      )}
      {active && <button className="gp-btn gp-btn--ghost" onClick={() => timeMachine.hide()}>Скрыть с карты</button>}
      <p className="gp-small gp-muted">
        Схематичные 3D-модели: высота и крона — из справочника видов, рост — те же доли, что в расчёте эффекта; к 5, 10 и 20 годам выпавшие растения убраны по прогнозу приживаемости.
        Места растений условные — точную раскладку делает проект озеленения.{scene.shown < scene.total ? ` На карте ${scene.shown} из ${scene.total} растений.` : ''}
      </p>
    </section>
  );
}
