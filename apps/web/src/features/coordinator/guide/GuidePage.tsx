import { t } from '../../../shared/i18n';
import { tr } from '../../../shared/i18n';
import { useMemo, useState, type ReactElement } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import { Badge, StateView } from '../../../shared/ui/components';
import { hrefFor } from '../../../shared/router';
import { CHECKLIST, CONDITIONS, DISTANCES, NOW_PLANTING, SOLUTIONS, SOURCES, type Use } from './content';
import { PageHeader } from '../PageHeader';
import { SpeciesThumb } from '../species/SpeciesCardGrid';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function Src({ id }: { id: keyof typeof SOURCES }) {
  const s = SOURCES[id];
  return <a className="gp-src" href={s.url} target="_blank" rel="noreferrer" title={s.label}>[{s.label.split(':')[0]}, {s.date}]</a>;
}

export function GuidePage() {
  const { api } = useData();
  const catalog = useResource(() => api.species(), []);
  const [use, setUse] = useState<Use>('alley');
  const list = catalog.data ?? [];
  const byId = useMemo(() => new Map(list.map((s) => [s.id, s])), [list]);
  const forUse = list.filter((s) => s.uses?.includes(use) && !s.invasiveRisk);
  const sol = SOLUTIONS.find((s) => s.id === use)!;

  return (
    <div className="gp-page gp-guide">
      <PageHeader eyebrow={tr("Для проектировщиков")} title={tr("Гайд по озеленению Павлодара")} lead={tr("Как выбрать растения и разместить их так, чтобы посадка прижилась, была полезна городу и красива во все сезоны. Факты о Павлодаре — со ссылками; ориентиры команды подписаны как ориентиры.")} />

      <section className="gp-guide__sec" aria-labelledby="g-cond">
        <h2 id="g-cond" className="gp-guide__h">{tr("01 · Условия города")}</h2>
        <div className="gp-guide__cards">
          {CONDITIONS.map((c) => (
            <div key={tr(c.title)} className="gp-card gp-guide__card">
              <span className="gp-guide__icon" aria-hidden="true">{c.icon}</span>
              <h3>{tr(c.title)}</h3>
              <p>{tr(c.text)} {'src' in c && c.src ? <Src id={c.src} /> : <span className="gp-muted gp-small">{tr("(общее описание)")}</span>}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="gp-guide__sec" aria-labelledby="g-now">
        <h2 id="g-now" className="gp-guide__h">{tr("02 · Что сажают в Павлодаре сейчас")}</h2>
        <ul className="gp-guide__facts">{NOW_PLANTING.facts.map((f) => <li key={tr(f.text)}>{tr(f.text)} <Src id={f.src as keyof typeof SOURCES} /></li>)}</ul>
        <StateView loading={catalog.loading} error={catalog.error} hasData={!!catalog.data} onRetry={catalog.reload}>
          <div className="gp-thumbs">{NOW_PLANTING.speciesIds.map((id) => byId.get(id)).filter(Boolean).map((s) => <SpeciesThumb key={s!.id} s={s!} />)}</div>
        </StateView>
      </section>

      <section className="gp-guide__sec" aria-labelledby="g-sol">
        <h2 id="g-sol" className="gp-guide__h">{tr("03 · Типовые решения для советского города")}</h2>
        <div className="gp-segment gp-guide__tabs" role="radiogroup" aria-label={tr("Тип посадки")}>
          {SOLUTIONS.map((s) => <label key={s.id}><input type="radio" name="g-use" checked={use === s.id} onChange={() => setUse(s.id)} />{tr(s.title)}</label>)}
        </div>
        <div className="gp-guide__solution gp-card">
          <Diagram kind={sol.diagram} />
          <div>
            <h3>{tr(sol.title)}</h3>
            <p>{tr(sol.where)}</p>
            <ul>{sol.how.map((h) => <li key={tr(h)}>{tr(h)}</li>)}</ul>
            <p className="gp-small"><strong>{tr("Шаг посадки:")}</strong> {tr(sol.spacing)} <span className="gp-muted">{tr("(ориентир команды)")}</span></p>
            <a className="gp-btn gp-btn--primary" href={hrefFor('/map')}>{tr("Выбрать участок и начать проект")}</a>
          </div>
        </div>
        <h3 className="gp-subhead">{tr("Подходящие растения ·")}{" "}{forUse.length}</h3>
        <div className="gp-thumbs">{forUse.map((s) => <SpeciesThumb key={s.id} s={s} />)}</div>
      </section>

      <section className="gp-guide__sec" aria-labelledby="g-dist">
        <h2 id="g-dist" className="gp-guide__h">{tr("04 · Расстояния при посадке")}</h2>
        <p className="gp-small">{tr("Редактор проверяет расстояние до стен зданий автоматически. Значения ниже взяты из таблицы норм РФ")}{" "}<Src id="kostroma" />{tr(". В Казахстане сверьте их с действующими СП РК и городскими правилами благоустройства — это обязательный шаг перед согласованием.")}</p>
        <div className="gp-table-wrap">
          <table className="gp-table">
            <thead><tr><th>{tr("От чего")}</th><th>{tr("До оси дерева")}</th><th>{tr("До оси куста")}</th><th>{tr("Статус")}</th></tr></thead>
            <tbody>{DISTANCES.map((d) => (
              <tr key={tr(d.from)}><td>{tr(d.from)}</td><td>{tr(d.tree)}</td><td>{tr(d.shrub)}</td><td>{d.verified ? <Badge tone="info" icon="≈">{tr("ориентир по источнику")}</Badge> : <Badge tone="warn" icon="?">{tr("сверить с СП РК")}</Badge>}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="gp-guide__sec" aria-labelledby="g-season">
        <h2 id="g-season" className="gp-guide__h">{tr("05 · Красота по сезонам")}</h2>
        <p className="gp-small">{tr("Сочетайте виды так, чтобы участок был декоративен с мая по октябрь, а зимой держали вид хвойные и красные побеги дёрена. Месяцы цветения — ориентировочные.")}</p>
        <div className="gp-table-wrap">
          <table className="gp-table gp-calendar">
            <thead><tr><th>{tr("Вид")}</th>{MONTHS.map((m, i) => <th key={i}>{tr(m)}</th>)}<th>{tr("Чем красив")}</th></tr></thead>
            <tbody>
              {list.filter((s) => s.floweringMonths?.length || s.evergreen).slice(0, 40).map((s) => (
                <tr key={s.id}>
                  <td><a href={hrefFor('/species', { q: s.nameRu })}>{s.nameRu}</a></td>
                  {MONTHS.map((_, i) => <td key={i} className={s.floweringMonths?.includes(i + 1) ? 'is-bloom' : s.evergreen ? 'is-green' : ''} aria-label={s.floweringMonths?.includes(i + 1) ? tr("цветёт") : undefined} />)}
                  <td className="gp-small">{(s.beauty ?? []).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="gp-small gp-muted"><span className="gp-calendar__sw is-bloom" />{" "}{tr("цветение ·")}{" "}<span className="gp-calendar__sw is-green" />{" "}{tr("вечнозелёный")}</p>
      </section>

      <section className="gp-guide__sec" aria-labelledby="g-check">
        <h2 id="g-check" className="gp-guide__h">{tr("06 · Чек-лист перед отправкой на согласование")}</h2>
        <ol className="gp-checklist">{CHECKLIST.map((c) => <li key={tr(c)}>{tr(c)}</li>)}</ol>
      </section>
    </div>
  );
}

/** Простые схемы приёмов посадки (вид сверху). */
function Diagram({ kind }: { kind: string }) {
  const tree = (x: number, y: number, r = 9, c = '#6a9e3a') => <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill={tr(c)} stroke="#3f6e2a" strokeWidth="1.5" />;
  const bush = (x: number, y: number) => <circle key={`b${x}-${y}`} cx={x} cy={y} r={4.5} fill="#8cbd4c" stroke="#5e9134" />;
  const road = <rect x="0" y="62" width="220" height="26" fill="#d8d4c8" />;
  const walk = <rect x="0" y="40" width="220" height="10" fill="#e9dcc0" />;
  const parts: Record<string, ReactElement> = {
    alley: <>{road}{walk}{[20, 60, 100, 140, 180].map((x) => tree(x, 26))}{[20, 60, 100, 140, 180].map((x) => tree(x, 108))}<rect x="0" y="96" width="220" height="2" fill="#e9dcc0" /></>,
    yard: <><rect x="10" y="8" width="70" height="40" fill="#cfc9bb" /><rect x="140" y="80" width="70" height="40" fill="#cfc9bb" /><rect x="90" y="40" width="40" height="30" fill="#f2e3c2" stroke="#c9a86a" />{tree(40, 85)}{tree(175, 40)}{[22, 30, 52, 60].map((x) => bush(x, 105))}{[160, 168, 186].map((x) => bush(x, 18))}</>,
    square: <><circle cx="110" cy="64" r="40" fill="#e9dcc0" />{tree(40, 30, 10, '#3f7a44')}{tree(180, 30, 10, '#3f7a44')}{tree(40, 100, 9, '#e58bb4')}{tree(180, 100, 9, '#e58bb4')}<circle cx="110" cy="64" r="14" fill="#c0688a" /></>,
    hedge: <>{walk}{Array.from({ length: 22 }, (_, i) => bush(5 + i * 10, 62))}{Array.from({ length: 21 }, (_, i) => bush(10 + i * 10, 70))}<rect x="0" y="82" width="220" height="40" fill="#d8d4c8" /></>,
    roadside: <>{road}{[25, 75, 125, 175].map((x) => tree(x, 30, 8, '#8fa86a'))}{Array.from({ length: 22 }, (_, i) => bush(5 + i * 10, 52))}</>,
    flowerbed: <><rect x="30" y="20" width="160" height="90" fill="#e9dcc0" /><ellipse cx="110" cy="65" rx="55" ry="30" fill="#6f8f3a" /><ellipse cx="110" cy="65" rx="42" ry="20" fill="#e69a1f" /><ellipse cx="110" cy="65" rx="22" ry="10" fill="#d9262b" /></>,
    greenbelt: <>{Array.from({ length: 4 }, (_, r) => Array.from({ length: 7 }, (_, i) => (r % 2 ? bush(15 + i * 30, 15 + r * 30) : tree(15 + i * 30, 15 + r * 30, 10, i % 2 ? '#3f7a44' : '#6a9e3a'))))}</>,
  };
  return <svg className="gp-guide__diagram" viewBox="0 0 220 130" role="img" aria-label={t('dynamic.001', { p0: String(kind) })}><rect width="220" height="130" fill="#eef2df" />{parts[kind]}</svg>;
}
