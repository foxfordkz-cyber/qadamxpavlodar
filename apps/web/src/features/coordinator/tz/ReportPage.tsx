import { tr } from '../../../shared/i18n';
import { useMemo, useRef, useState } from 'react';
import { MemoExport } from './MemoExport';
import { SurvivalMethod } from '../zone/SurvivalMethod';
import { t } from '../../../shared/i18n';
import { useData, useResource } from '../../../shared/api/DataProvider';
import type { PlanOptions } from '../../../shared/analytics/plan';
import { VARIANT_LABEL } from '../../../shared/analytics/plan';
import { SALINITY_LABEL } from '../../../shared/analytics/zone';
import { StateView } from '../../../shared/ui/components';
import { fmtDateTime, fmtPp } from '../../../shared/format';
import { hrefFor, useRoute } from '../../../shared/router';
import { download } from '../sites/filters';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₸`;

/** Отчёт по зоне (ТЗ 3.9, 9): печать в PDF через браузер и выгрузка в Excel (.xls из таблиц отчёта). */
export function ReportPage() {
  const { api, mode } = useData();
  const [exportError,setExportError]=useState('');
  const [exporting,setExporting]=useState(false);
  const [compare, setCompare] = useState(false);
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
  const serverExport=async(format:'pdf'|'xlsx')=>{
    setExporting(true);setExportError('');
    try{const me=await fetch('/api/v1/auth/me',{credentials:'include'});const session=await me.json();
      if(!me.ok)throw Error(session.error?.message??t('report.signInAgain'));
      const res=await fetch(`/api/v1/zones/${encodeURIComponent(siteId)}/export`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':session.data.csrfToken},body:JSON.stringify({options,format})});
      if(!res.ok){const e=await res.json();throw Error(e.error?.message??t('report.exportFailed'));}
      const url=URL.createObjectURL(await res.blob()),link=document.createElement('a');link.href=url;link.download=`zone-${siteId}.${format}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){setExportError((e as Error).message);}finally{setExporting(false);}
  };
  const toExcel = () => {
    const html = `<html><head><meta charset="utf-8"></head><body>${body.current?.innerHTML ?? ''}</body></html>`;
    download(`report-${siteId}.xls`, html, 'application/vnd.ms-excel;charset=utf-8');
  };
  const r = a.data;
  const s = site.data;
  return (
    <div className="gp-page gp-report-page">
      <div className="gp-btn-row gp-noprint">
        <a className="gp-btn" href={hrefFor('/map', { site: siteId })}>{tr("← К зоне")}</a>
        <button className="gp-btn gp-btn--primary" onClick={() => print()}>{tr("Печать / сохранить PDF")}</button>
        {mode==='api'?<><button className="gp-btn" disabled={exporting} onClick={()=>serverExport('pdf')}>{t('report.serverPdf')}</button><button className="gp-btn" disabled={exporting} onClick={()=>serverExport('xlsx')}>{t('report.excel', { format: 'xlsx' })}</button></>:<button className="gp-btn" onClick={toExcel}>{t('report.excel', { format: 'xls' })}</button>}
        {exportError&&<p role="alert">{exportError}</p>}
      </div>
      <MemoExport siteId={siteId} options={options} ready={!!r && !!s && !!catalog.data && !a.loading && !site.loading && !catalog.loading && !a.error && !site.error && !catalog.error} />
      <StateView loading={a.loading || site.loading || catalog.loading} error={a.error ?? site.error ?? catalog.error} hasData={!!r && !!s && !!catalog.data}>
        {r && s && (
          <div ref={body} className="gp-report-doc">
            <h1>{tr("Отчёт по зоне озеленения:")}{" "}{s.name}</h1>
            <p>{tr("Сформирован")}{" "}{fmtDateTime(new Date().toISOString())}{tr(". Зона")}{" "}{s.id}{tr(", вариант «")}{tr(VARIANT_LABEL[r.options.variant])}{tr("», уход")}{" "}{r.options.careYears}{" "}{tr("г. Все значения оценочные и носят рекомендательный характер; решение принимает специалист акимата.")}</p>
            <h2>{tr("1. Характеристики зоны")}</h2>
            <table><tbody>
              <tr><td>{tr("Площадь")}</td><td>{r.facts.areaM2}{" "}{tr("м²")}</td></tr>
              <tr><td>{tr("Назначение")}</td><td>{tr(r.facts.purposeLabel)}</td></tr>
              <tr><td>{tr("Почва (синтетический слой)")}</td><td>{tr(r.facts.soil.type)}, pH {r.facts.soil.ph}{tr(", засоление")}{" "}{tr(SALINITY_LABEL[r.facts.soil.salinity])}</td></tr>
              <tr><td>{tr("Доля зелени в 200 м")}</td><td>{r.facts.greenShare === null ? tr("нет данных") : `${Math.round(r.facts.greenShare * 100)}%`}</td></tr>
              <tr><td>{tr("Окружение")}</td><td>{r.facts.nearRoadM !== null ? t('dynamic.016', { p0: String(r.facts.nearRoadM) }) : ''}{r.facts.social.join(', ') || 'соцобъектов в 400 м нет'}</td></tr>
            </tbody></table>
            <h2>{tr("2. Подбор растений и схема посадки")}</h2>
            <table><thead><tr><th>{tr("Ярус")}</th><th>{tr("Вид")}</th><th>{tr("Латинское название")}</th><th>{tr("Количество")}</th><th>{tr("Пригодность")}</th></tr></thead><tbody>
              {r.scheme.map((row) => <tr key={row.speciesId}><td>{row.tier === 'tree' ? tr("Деревья") : row.tier === 'shrub' ? tr("Кустарники") : tr("Цветы")}</td><td>{byId.get(row.speciesId)?.nameRu}</td><td>{byId.get(row.speciesId)?.latin}</td><td>{row.quantity}</td><td>{r.ranked.find((x) => x.speciesId === row.speciesId)?.score ?? '—'}</td></tr>)}
            </tbody></table>
            <h2>{tr("3. Смета")}</h2>
            <table><thead><tr><th>{tr("Статья")}</th><th>{tr("Сумма, ₸")}</th><th>{tr("Расчёт")}</th></tr></thead><tbody>
              {r.cost.items.map((i) => <tr key={i.key}><td>{tr(i.label)}</td><td>{Math.round(i.amount)}</td><td>{i.formula}</td></tr>)}
              <tr><td><strong>{tr("Итого")}</strong></td><td><strong>{Math.round(r.cost.total)}</strong></td><td>{r.cost.perM2 ? t('dynamic.017', { p0: String(money(r.cost.perM2)) }) : ''}</td></tr>
            </tbody></table>
            <p>{tr("Расценки — демонстрационный справочник; заменить сметными нормами.")}</p>
            <h2>{tr("4. Прогноз приживаемости")}</h2>
            <SurvivalMethod model={r.survivalModel} />
            <button className="gp-btn gp-noprint" aria-pressed={compare} onClick={() => setCompare(!compare)}>{t(compare ? 'survival.hideRules' : 'survival.compare')}</button>
            <table><thead><tr><th>{tr("Вид")}</th><th>{tr("1 год, %")}</th>{compare && <th>{t('survival.rulesColumn')}</th>}<th>{tr("2 года, %")}</th><th>{tr("3 года, %")}</th><th>{tr("Диапазон 1-го года")}</th><th>{tr("Факторы риска")}</th></tr></thead><tbody>
              {r.survival.map((x) => <tr key={x.speciesId}><td>{byId.get(x.speciesId)?.nameRu}</td><td>{x.y1}</td>{compare && <td>{r.survivalRules.find(v => v.speciesId === x.speciesId)?.y1 ?? '—'}</td>}<td>{x.y2}</td><td>{x.y3}</td><td>{x.low}–{x.high}</td><td>{x.risks.map((k) => `${tr(k.label)} ${fmtPp(k.pp)}`).join('; ') || 'нет'}{x.warnings?.map(w => <p key={w}>{tr(w)}</p>)}</td></tr>)}
            </tbody></table>
            <p>{tr("Средняя по зоне:")}{" "}{r.survivalAvg.y1}% / {r.survivalAvg.y2}% / {r.survivalAvg.y3}%.{r.measures.length ? t('dynamic.018', { p0: String(r.measures.map((m) => `${m.label} (${m.effect})`).join('; ')) }) : ''}</p>
            <h2>{tr("5. План ухода")}</h2>
            <table><thead><tr><th>{tr("Месяц")}</th><th>{tr("Операция")}</th><th>{tr("Подробности")}</th></tr></thead><tbody>
              {r.care.map((c, i) => <tr key={i}><td>{tr(MONTHS[c.month - 1])}</td><td>{c.operation}</td><td>{c.detail}</td></tr>)}
            </tbody></table>
            {r.careWarnings.map((w) => <p key={w}>⚠ {tr(w)}</p>)}
            <h2>{tr("6. Экологический эффект (оценка)")}</h2>
            <table><thead><tr><th>{tr("Показатель")}</th><th>{tr("5 лет")}</th><th>{tr("10 лет")}</th><th>{tr("20 лет")}</th></tr></thead><tbody>
              <tr><td>{tr("CO₂, т/год")}</td>{r.effect.map((e) => <td key={e.years}>{e.co2t.toFixed(2)}</td>)}</tr>
              <tr><td>{tr("O₂, т/год")}</td>{r.effect.map((e) => <td key={e.years}>{e.o2t.toFixed(2)}</td>)}</tr>
              <tr><td>{tr("Задержание дождя, м³/год")}</td>{r.effect.map((e) => <td key={e.years}>{Math.round(e.rainM3)}</td>)}</tr>
              <tr><td>{tr("Охлаждение, °C")}</td>{r.effect.map((e) => <td key={e.years}>{e.coolingC}</td>)}</tr>
              <tr><td>{tr("Площадь кроны, м²")}</td>{r.effect.map((e) => <td key={e.years}>{e.canopyM2}</td>)}</tr>
              <tr><td>{tr("Пыль, кг/год")}</td>{r.effect.map((e) => <td key={e.years}>{e.dustKg === null ? tr("нет коэффициента") : Math.round(e.dustKg)}</td>)}</tr>
            </tbody></table>
            <p>{tr("Стоимость тонны CO₂ за 20 лет:")}{" "}{r.costPerTonCo2 ? money(r.costPerTonCo2) : '—'}.</p>
            <h2>{tr("7. Допущения и недостающие данные")}</h2>
            <ul>{[...r.missing, ...r.assumptions].map((x) => <li key={x}>{x}</li>)}</ul>
            <p>{tr("Источники коэффициентов — в разделе «Справочники». Данные зоны — OpenStreetMap (ODbL).")}</p>
          </div>
        )}
      </StateView>
    </div>
  );
}
