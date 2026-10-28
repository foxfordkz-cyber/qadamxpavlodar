import { useMemo, useRef } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import type { PlanOptions } from '../../../shared/analytics/plan';
import { VARIANT_LABEL } from '../../../shared/analytics/plan';
import { SALINITY_LABEL } from '../../../shared/analytics/zone';
import { StateView } from '../../../shared/ui/components';
import { fmtDateTime } from '../../../shared/format';
import { hrefFor, useRoute } from '../../../shared/router';
import { download } from '../sites/filters';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₸`;

/** Отчёт по зоне (ТЗ 3.9, 9): печать в PDF через браузер и выгрузка в Excel (.xls из таблиц отчёта). */
export function ReportPage() {
  const { api } = useData();
  const route = useRoute();
  const siteId = route.params.get('site') ?? '';
  const options = useMemo<Partial<PlanOptions>>(() => {
    try { return JSON.parse(decodeURIComponent(escape(atob(route.params.get('o') ?? '')))); } catch { return {}; }
  }, [route.params]);
  const site = useResource(() => api.site(siteId), [siteId]);
  const a = useResource(() => api.zoneAnalysis(siteId, options), [siteId, JSON.stringify(options)]);
  const catalog = useResource(() => api.species(), []);
  const byId = useMemo(() => new Map((catalog.data ?? []).map((s) => [s.id, s])), [catalog.data]);
  const body = useRef<HTMLDivElement>(null);
  const toExcel = () => {
    const html = `<html><head><meta charset="utf-8"></head><body>${body.current?.innerHTML ?? ''}</body></html>`;
    download(`report-${siteId}.xls`, html, 'application/vnd.ms-excel;charset=utf-8');
  };
  const r = a.data;
  const s = site.data;
  return (
    <div className="gp-page gp-report-page">
      <div className="gp-btn-row gp-noprint">
        <a className="gp-btn" href={hrefFor('/map', { site: siteId })}>← К зоне</a>
        <button className="gp-btn gp-btn--primary" onClick={() => print()}>Печать / сохранить PDF</button>
        <button className="gp-btn" onClick={toExcel}>⤓ Excel (.xls)</button>
      </div>
      <StateView loading={a.loading || site.loading || catalog.loading} error={a.error ?? site.error} hasData={!!r && !!s && !!catalog.data}>
        {r && s && (
          <div ref={body} className="gp-report-doc">
            <h1>Отчёт по зоне озеленения: {s.name}</h1>
            <p>Сформирован {fmtDateTime(new Date().toISOString())}. Зона {s.id}, вариант «{VARIANT_LABEL[r.options.variant]}», уход {r.options.careYears} г. Все значения оценочные и носят рекомендательный характер; решение принимает специалист акимата.</p>
            <h2>1. Характеристики зоны</h2>
            <table><tbody>
              <tr><td>Площадь</td><td>{r.facts.areaM2} м²</td></tr>
              <tr><td>Назначение</td><td>{r.facts.purposeLabel}</td></tr>
              <tr><td>Почва (синтетический слой)</td><td>{r.facts.soil.type}, pH {r.facts.soil.ph}, засоление {SALINITY_LABEL[r.facts.soil.salinity]}</td></tr>
              <tr><td>Доля зелени в 200 м</td><td>{r.facts.greenShare === null ? 'нет данных' : `${Math.round(r.facts.greenShare * 100)}%`}</td></tr>
              <tr><td>Окружение</td><td>{r.facts.nearRoadM !== null ? `магистраль ≈${r.facts.nearRoadM} м; ` : ''}{r.facts.social.join(', ') || 'соцобъектов в 400 м нет'}</td></tr>
            </tbody></table>
            <h2>2. Подбор растений и схема посадки</h2>
            <table><thead><tr><th>Ярус</th><th>Вид</th><th>Латинское название</th><th>Количество</th><th>Пригодность</th></tr></thead><tbody>
              {r.scheme.map((row) => <tr key={row.speciesId}><td>{row.tier === 'tree' ? 'Деревья' : row.tier === 'shrub' ? 'Кустарники' : 'Цветы'}</td><td>{byId.get(row.speciesId)?.nameRu}</td><td>{byId.get(row.speciesId)?.latin}</td><td>{row.quantity}</td><td>{r.ranked.find((x) => x.speciesId === row.speciesId)?.score ?? '—'}</td></tr>)}
            </tbody></table>
            <h2>3. Смета</h2>
            <table><thead><tr><th>Статья</th><th>Сумма, ₸</th><th>Расчёт</th></tr></thead><tbody>
              {r.cost.items.map((i) => <tr key={i.key}><td>{i.label}</td><td>{Math.round(i.amount)}</td><td>{i.formula}</td></tr>)}
              <tr><td><strong>Итого</strong></td><td><strong>{Math.round(r.cost.total)}</strong></td><td>{r.cost.perM2 ? `${money(r.cost.perM2)} за м²` : ''}</td></tr>
            </tbody></table>
            <p>Расценки — демонстрационный справочник; заменить сметными нормами.</p>
            <h2>4. Прогноз приживаемости</h2>
            <table><thead><tr><th>Вид</th><th>1 год, %</th><th>2 года, %</th><th>3 года, %</th><th>Диапазон 1-го года</th><th>Факторы риска</th></tr></thead><tbody>
              {r.survival.map((x) => <tr key={x.speciesId}><td>{byId.get(x.speciesId)?.nameRu}</td><td>{x.y1}</td><td>{x.y2 || '—'}</td><td>{x.y3 || '—'}</td><td>{x.low}–{x.high}</td><td>{x.risks.map((k) => `${k.label} ${k.pp} п.п.`).join('; ') || 'нет'}</td></tr>)}
            </tbody></table>
            <p>Средняя по зоне: {r.survivalAvg.y1}% / {r.survivalAvg.y2}% / {r.survivalAvg.y3}%. Метод — экспертные правила, не калиброваны на данных Павлодара.{r.measures.length ? ` Меры: ${r.measures.map((m) => `${m.label} (${m.effect})`).join('; ')}.` : ''}</p>
            <h2>5. План ухода</h2>
            <table><thead><tr><th>Месяц</th><th>Операция</th><th>Подробности</th></tr></thead><tbody>
              {r.care.map((c, i) => <tr key={i}><td>{MONTHS[c.month - 1]}</td><td>{c.operation}</td><td>{c.detail}</td></tr>)}
            </tbody></table>
            {r.careWarnings.map((w) => <p key={w}>⚠ {w}</p>)}
            <h2>6. Экологический эффект (оценка)</h2>
            <table><thead><tr><th>Показатель</th><th>5 лет</th><th>10 лет</th><th>20 лет</th></tr></thead><tbody>
              <tr><td>CO₂, т/год</td>{r.effect.map((e) => <td key={e.years}>{e.co2t.toFixed(2)}</td>)}</tr>
              <tr><td>O₂, т/год</td>{r.effect.map((e) => <td key={e.years}>{e.o2t.toFixed(2)}</td>)}</tr>
              <tr><td>Задержание дождя, м³/год</td>{r.effect.map((e) => <td key={e.years}>{Math.round(e.rainM3)}</td>)}</tr>
              <tr><td>Охлаждение, °C</td>{r.effect.map((e) => <td key={e.years}>{e.coolingC}</td>)}</tr>
              <tr><td>Площадь кроны, м²</td>{r.effect.map((e) => <td key={e.years}>{e.canopyM2}</td>)}</tr>
              <tr><td>Пыль, кг/год</td>{r.effect.map((e) => <td key={e.years}>{e.dustKg === null ? 'нет коэффициента' : Math.round(e.dustKg)}</td>)}</tr>
            </tbody></table>
            <p>Стоимость тонны CO₂ за 20 лет: {r.costPerTonCo2 ? money(r.costPerTonCo2) : '—'}.</p>
            <h2>7. Допущения и недостающие данные</h2>
            <ul>{[...r.missing, ...r.assumptions].map((x) => <li key={x}>{x}</li>)}</ul>
            <p>Источники коэффициентов — в разделе «Справочники». Данные зоны — OpenStreetMap (ODbL).</p>
          </div>
        )}
      </StateView>
    </div>
  );
}
