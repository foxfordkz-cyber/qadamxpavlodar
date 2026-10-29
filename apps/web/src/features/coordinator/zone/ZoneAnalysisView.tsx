import { useMemo, useState } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import type { CandidateSite, Species } from '../../../shared/api/types';
import type { PlanOptions, Variant, ZoneAnalysis } from '../../../shared/analytics/plan';
import { VARIANT_LABEL } from '../../../shared/analytics/plan';
import { PURPOSE_LABEL, SALINITY_LABEL, type Purpose } from '../../../shared/analytics/zone';
import { Badge, Bar, Button, ErrorNote, StateView } from '../../../shared/ui/components';
import { hrefFor } from '../../../shared/router';
import { SpeciesPhoto } from '../species/SpeciesCardGrid';
import { SurvivalMethod } from './SurvivalMethod';
import { CareDrafts } from './CareDrafts';
import { TimeMachinePanel } from './TimeMachinePanel';
import { t } from '../../../shared/i18n';
import { fmtPp } from '../../../shared/format';

export type ZoneTab = 'plants' | 'cost' | 'survival' | 'care' | 'effect';
export const ZONE_TABS: [ZoneTab, string][] = [['plants', 'Растения'], ['cost', 'Смета'], ['survival', 'Приживаемость'], ['care', 'Уход'], ['effect', 'Эффект']];

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₸`;
const pct = (n: number) => `${n}%`;

/** Панель анализа зоны (ТЗ 3.3–3.8). Все вкладки — из одного расчёта и пересчитываются вместе. */
export function ZoneAnalysisView({ site, tab, options, setOptions }: { site: CandidateSite; tab: ZoneTab; options: Partial<PlanOptions>; setOptions: (o: Partial<PlanOptions>) => void }) {
  const { api } = useData();
  const key = JSON.stringify(options);
  const res = useResource(() => api.zoneAnalysis(site.id, options), [site.id, key]);
  const catalog = useResource(() => api.species(), []);
  const byId = useMemo(() => new Map((catalog.data ?? []).map((s) => [s.id, s])), [catalog.data]);
  const a = res.data;
  const set = (patch: Partial<PlanOptions>) => setOptions({ ...options, ...patch });
  return (
    <div className="gp-zone" aria-busy={res.loading}>
      <StateView loading={res.loading || catalog.loading} error={res.error ?? catalog.error} hasData={!!a && !!catalog.data} onRetry={res.reload}>
        {a && (
          <>
            <Facts a={a} onPurpose={(p) => set({ purpose: p })} />
            {res.loading && <p className="gp-small gp-muted" role="status">Пересчёт…</p>}
            {tab === 'plants' && <PlantsTab a={a} byId={byId} options={options} set={set} />}
            {tab === 'cost' && <CostTab a={a} site={site} options={options} set={set} />}
            {tab === 'survival' && <SurvivalTab a={a} byId={byId} options={options} set={set} />}
            {tab === 'care' && <CareTab a={a} />}
            {tab === 'effect' && <EffectTab a={a} site={site} byId={byId} />}
            <details className="gp-zone__notes">
              <summary>Допущения и недостающие данные ({a.missing.length})</summary>
              <ul className="gp-small">{[...a.missing, ...a.assumptions].map((x) => <li key={x}>{x}</li>)}</ul>
            </details>
            <div className="gp-btn-row">
              <a className="gp-btn" href={hrefFor('/report', { site: site.id, o: btoa(unescape(encodeURIComponent(key))) })}>⤓ Отчёт по зоне (PDF / Excel)</a>
              <a className="gp-btn gp-btn--ghost" href={hrefFor('/rates')}>Справочник расценок и коэффициентов</a>
            </div>
          </>
        )}
      </StateView>
    </div>
  );
}

function Facts({ a, onPurpose }: { a: ZoneAnalysis; onPurpose: (p: Purpose) => void }) {
  const f = a.facts;
  return (
    <dl className="gp-zone__facts">
      <div><dt>Площадь</dt><dd>{f.areaM2 ? `${f.areaM2.toLocaleString('ru-RU')} м²` : 'неизвестна'}</dd></div>
      <div><dt>Почва</dt><dd>{f.soil.type}, pH {f.soil.ph}, засоление {SALINITY_LABEL[f.soil.salinity]} <Badge tone="demo" icon="◇">синтетика</Badge></dd></div>
      <div><dt>Зелень в 200 м</dt><dd>{f.greenShare === null ? 'нет данных' : `${Math.round(f.greenShare * 100)}%`}</dd></div>
      <div><dt>Освещённость</dt><dd>{f.light} <span className="gp-muted gp-small">(по застройке)</span></dd></div>
      <div><dt>Окружение</dt><dd>{f.nearRoadM !== null ? `магистраль ≈${f.nearRoadM} м` : 'магистрали рядом нет'}{f.social.length ? `; ${f.social.slice(0, 2).join(', ')}` : ''}</dd></div>
      <div>
        <dt><label htmlFor="purpose">Назначение</label></dt>
        <dd><select id="purpose" className="gp-input gp-input--inline" value={f.purpose} onChange={(e) => onPurpose(e.target.value as Purpose)}>{Object.entries(PURPOSE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></dd>
      </div>
    </dl>
  );
}

function PlantsTab({ a, byId, options, set }: { a: ZoneAnalysis; byId: Map<string, Species>; options: Partial<PlanOptions>; set: (p: Partial<PlanOptions>) => void }) {
  const [showAll, setShowAll] = useState(false);
  const ok = a.ranked.filter((r) => !r.excludedBy && !(options.excluded ?? []).includes(r.speciesId));
  const hard = a.ranked.filter((r) => r.excludedBy);
  const list = showAll ? ok : ok.slice(0, 10);
  const locked = options.locked ?? [];
  const excluded = options.excluded ?? [];
  const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  return (
    <section aria-labelledby="z-plants">
      <h3 id="z-plants" className="gp-subhead">Подбор: топ-{list.length} по пригодности 0–100</h3>
      <p className="gp-small gp-muted">Сначала жёсткие ограничения (инвазивность, сети, площадь, безопасность для детей), затем оценка: климат 35%, почва 25%, городская нагрузка 15%, назначение 15%, местный опыт 10%.</p>
      <ol className="gp-rank">
        {list.map((r) => {
          const sp = byId.get(r.speciesId);
          if (!sp) return null;
          return (
            <li key={r.speciesId} className="gp-rank__row">
              <SpeciesPhoto s={sp} small />
              <div className="gp-rank__main">
                <div className="gp-rank__title"><strong>{sp.nameRu}</strong> <span className="gp-rank__score" aria-label={`Пригодность ${r.score}`}>{r.score}</span>{locked.includes(r.speciesId) && <Badge tone="info" icon="📌">закреплён</Badge>}</div>
                <Bar value={r.score} label="Пригодность" />
                <div className="gp-small">{r.reasons.join(', ') || '—'}{r.penalties.length ? <span className="gp-caution"> · {r.penalties.join('; ')}</span> : null}</div>
                <details className="gp-small"><summary>Вклад факторов</summary>Климат {r.factors.climate} · почва {r.factors.soil} · нагрузка {r.factors.urban} · назначение {r.factors.purpose} · местный опыт {r.factors.local}</details>
              </div>
              <div className="gp-rank__actions">
                <button className="gp-btn gp-btn--ghost" aria-pressed={locked.includes(r.speciesId)} onClick={() => set({ locked: toggle(locked, r.speciesId) })}>{locked.includes(r.speciesId) ? 'Открепить' : 'Закрепить'}</button>
                <button className="gp-btn gp-btn--ghost" onClick={() => set({ excluded: toggle(excluded, r.speciesId), locked: locked.filter((x) => x !== r.speciesId) })}>Исключить</button>
              </div>
            </li>
          );
        })}
      </ol>
      {ok.length > 10 && <Button variant="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? 'Показать топ-10' : `Показать все ${ok.length}`}</Button>}
      {excluded.length > 0 && (
        <p className="gp-small">Исключены вами: {excluded.map((id) => <button key={id} className="gp-chip gp-chip--btn" onClick={() => set({ excluded: excluded.filter((x) => x !== id) })}>{byId.get(id)?.nameRu} ✕</button>)}</p>
      )}
      <details className="gp-small"><summary>Не допущены правилами ({hard.length})</summary><ul>{hard.map((r) => <li key={r.speciesId}>{byId.get(r.speciesId)?.nameRu}: {r.excludedBy}</li>)}</ul></details>

      <h3 className="gp-subhead">Схема посадки · {a.scheme.reduce((x, r) => x + r.quantity, 0)} растений</h3>
      <p className="gp-small gp-muted">{a.tiersNote} Вариант «{VARIANT_LABEL[a.options.variant]}».</p>
      <label className="gp-kv gp-small">Макс. доля одного вида
        <select className="gp-input gp-input--inline" value={a.options.maxSpeciesShare} onChange={(e) => set({ maxSpeciesShare: Number(e.target.value) })}>
          {[0.2, 0.25, 0.3, 0.4, 0.5].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
        </select>
      </label>
      <table className="gp-table gp-small">
        <thead><tr><th>Ярус</th><th>Вид</th><th>Кол-во</th><th>Заменить на</th></tr></thead>
        <tbody>
          {a.scheme.map((row) => {
            const sp = byId.get(row.speciesId);
            const from = row.replacedFrom ?? row.speciesId;
            const alts = a.ranked.filter((r) => !r.excludedBy && byId.get(r.speciesId)?.form === sp?.form && r.speciesId !== row.speciesId).slice(0, 8);
            return (
              <tr key={row.speciesId + row.tier}>
                <td>{row.tier === 'tree' ? 'Деревья' : row.tier === 'shrub' ? 'Кустарники' : 'Цветы'}</td>
                <td>{sp?.nameRu}{row.replacedFrom && <span className="gp-muted"> (вместо {byId.get(row.replacedFrom)?.nameRu})</span>}</td>
                <td>{row.quantity}</td>
                <td>
                  <select className="gp-input gp-input--inline" aria-label={`Заменить ${sp?.nameRu}`} value="" onChange={(e) => { const rep = { ...(options.replacements ?? {}) }; if (e.target.value === '__reset') delete rep[from]; else rep[from] = e.target.value; set({ replacements: rep }); }}>
                    <option value="">—</option>
                    {row.replacedFrom && <option value="__reset">Вернуть исходный</option>}
                    {alts.map((r) => <option key={r.speciesId} value={r.speciesId}>{byId.get(r.speciesId)?.nameRu} ({r.score})</option>)}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function CostTab({ a, site, options, set }: { a: ZoneAnalysis; site: CandidateSite; options: Partial<PlanOptions>; set: (p: Partial<PlanOptions>) => void }) {
  const { api } = useData();
  const [compare, setCompare] = useState(false);
  const variants = useResource(() => (compare ? api.zoneVariants(site.id, options) : Promise.resolve(null)), [compare, JSON.stringify(options), site.id]);
  return (
    <section aria-labelledby="z-cost">
      <div className="gp-btn-row gp-zone__controls">
        <div className="gp-segment" role="radiogroup" aria-label="Вариант">
          {(['econom', 'optimal', 'max'] as Variant[]).map((v) => <label key={v}><input type="radio" name="variant" checked={a.options.variant === v} onChange={() => set({ variant: v })} />{VARIANT_LABEL[v]}</label>)}
        </div>
        <label className="gp-kv gp-small">Уход
          <select className="gp-input gp-input--inline" value={a.options.careYears} onChange={(e) => set({ careYears: Number(e.target.value) as 1 | 2 | 3 })}>{[1, 2, 3].map((y) => <option key={y} value={y}>{y} г.</option>)}</select>
        </label>
      </div>
      <h3 id="z-cost" className="gp-subhead">Смета: {money(a.cost.total)}{a.cost.perM2 ? <span className="gp-muted gp-small"> · {money(a.cost.perM2)}/м²</span> : null}</h3>
      <table className="gp-table gp-small">
        <thead><tr><th>Статья</th><th>Сумма</th><th>Доля</th><th>Как посчитано</th></tr></thead>
        <tbody>{a.cost.items.map((i) => (
          <tr key={i.key}><td>{i.label} {i.dataClass === 'demo' && <Badge tone="demo">демо</Badge>}</td><td className="gp-num">{money(i.amount)}</td><td><Bar value={a.cost.total ? Math.round((i.amount / a.cost.total) * 100) : 0} label={i.label} /></td><td className="gp-muted">{i.formula}</td></tr>
        ))}</tbody>
      </table>
      <p className="gp-small gp-muted">Расценки — демо-справочник; администратор меняет их в «Справочниках», смета пересчитается.</p>
      <Button onClick={() => setCompare(!compare)}>{compare ? 'Скрыть сравнение' : 'Сравнить варианты: эконом / оптимальный / максимальный'}</Button>
      {compare && (
        <StateView loading={variants.loading} error={variants.error} hasData={!!variants.data} onRetry={variants.reload}>
          <div className="gp-table-wrap">
            <table className="gp-table gp-small gp-compare">
              <thead><tr><th /> {(variants.data ?? []).map((v) => <th key={v.variant}>{v.label}</th>)}</tr></thead>
              <tbody>
                <tr><td>Растений</td>{variants.data?.map((v) => <td key={v.variant}>{v.plants}</td>)}</tr>
                <tr><td>Уход</td>{variants.data?.map((v) => <td key={v.variant}>{v.careYears} г.</td>)}</tr>
                <tr><td>Стоимость</td>{variants.data?.map((v) => <td key={v.variant}><strong>{money(v.cost)}</strong></td>)}</tr>
                <tr><td>Приживаемость 1/3 г.</td>{variants.data?.map((v) => <td key={v.variant}>{v.survival.y1}% / {v.survival.y3}%</td>)}</tr>
                <tr><td>CO₂ через 20 лет</td>{variants.data?.map((v) => <td key={v.variant}>{v.co2t20.toFixed(2)} т/год</td>)}</tr>
                <tr><td>Охлаждение</td>{variants.data?.map((v) => <td key={v.variant}>{v.coolingC} °C</td>)}</tr>
                <tr><td>₸ за т CO₂ (20 лет)</td>{variants.data?.map((v) => <td key={v.variant}>{v.costPerTonCo2 ? money(v.costPerTonCo2) : '—'}</td>)}</tr>
              </tbody>
            </table>
          </div>
        </StateView>
      )}
    </section>
  );
}

function SurvivalTab({ a, byId, options, set }: { a: ZoneAnalysis; byId: Map<string, Species>; options: Partial<PlanOptions>; set: (p: Partial<PlanOptions>) => void }) {
  const [compare, setCompare] = useState(false);
  return (
    <section aria-labelledby="z-surv">
      <h3 id="z-surv" className="gp-subhead">Прогноз приживаемости</h3>
      <div className="gp-bigstats">
        {(['y1', 'y2', 'y3'] as const).map((k, i) => <div key={k}><span className="gp-bigstats__v">{pct(a.survivalAvg[k])}</span><span className="gp-small">через {i + 1} {i ? 'года' : 'год'}</span></div>)}
      </div>
      <SurvivalMethod model={a.survivalModel} />
      <Button aria-pressed={compare} onClick={() => setCompare(!compare)}>{t(compare ? 'survival.hideRules' : 'survival.compare')}</Button>
      <div className="gp-btn-row gp-zone__controls">
        <label className="gp-kv gp-small">Полив
          <select className="gp-input gp-input--inline" value={a.options.watering} onChange={(e) => set({ watering: e.target.value as PlanOptions['watering'] })}>
            <option value="regular">Регулярный</option><option value="rare">Редкий</option><option value="none">Без полива</option>
          </select>
        </label>
        <label className="gp-check"><input type="checkbox" checked={a.options.improveSoil} onChange={(e) => set({ improveSoil: e.target.checked })} />Улучшить почву</label>
      </div>
      <table className="gp-table gp-small">
        <thead><tr><th>Вид</th><th>1 год</th>{compare && <th>{t('survival.rulesColumn')}</th>}<th>2 года</th><th>3 года</th><th>Главные риски</th></tr></thead>
        <tbody>{a.survival.map((r) => (
          <tr key={r.speciesId}>
            <td>{byId.get(r.speciesId)?.nameRu}</td>
            <td><strong>{r.y1}%</strong> <span className="gp-muted">({r.low}–{r.high}%)</span></td>
            {compare && <td>{a.survivalRules.find(x => x.speciesId === r.speciesId)?.y1 ?? '—'}%</td>}
            <td>{r.y2 ? `${r.y2}%` : 'однолетник'}</td>
            <td>{r.y3 ? `${r.y3}%` : '—'}</td>
            <td>{r.risks.length ? r.risks.map((x) => <div key={x.label}>{x.label}: <span className="gp-caution">{fmtPp(x.pp)}</span></div>) : <span className="gp-muted">нет</span>}{r.warnings?.map(w => <p className="gp-caution" key={w}>{w}</p>)}</td>
          </tr>
        ))}</tbody>
      </table>
      {a.measures.length > 0 && (
        <>
          <h4 className="gp-subhead">Как повысить приживаемость</h4>
          <ul className="gp-measures">
            {a.measures.map((m) => (
              <li key={m.label}>
                <span><strong>{m.label}</strong> — {m.effect}</span>
                <Button onClick={() => ('replace' in m.apply ? set({ replacements: { ...(options.replacements ?? {}), [m.apply.replace[0]]: m.apply.replace[1] } }) : set(m.apply as Partial<PlanOptions>))}>Применить</Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function CareTab({ a }: { a: ZoneAnalysis }) {
  const byMonth = new Map<number, ZoneAnalysis['care']>();
  for (const c of a.care) byMonth.set(c.month, [...(byMonth.get(c.month) ?? []), c]);
  return (
    <section aria-labelledby="z-care">
      <h3 id="z-care" className="gp-subhead">План ухода по месяцам</h3>
      {a.careWarnings.map((w) => <div key={w} className="gp-alert gp-alert--warn gp-small">{w}</div>)}
      <div className="gp-carecal">
        {MONTHS.map((m, i) => (
          <div key={m} className={`gp-carecal__m ${byMonth.has(i + 1) ? '' : 'is-empty'}`}>
            <strong>{m}</strong>
            {(byMonth.get(i + 1) ?? []).map((c) => <div key={c.operation + c.detail} className="gp-carecal__op"><span>{c.operation}</span><span className="gp-muted">{c.detail}</span></div>)}
          </div>
        ))}
      </div>
      <p className="gp-small gp-muted">Объёмы полива и допустимое число выездов — в «Справочниках». Календарь входит в отчёт по зоне.</p>
      <CareDrafts key={a.siteId} siteId={a.siteId} />
    </section>
  );
}

function EffectTab({ a, site, byId }: { a: ZoneAnalysis; site: CandidateSite; byId: Map<string, Species> }) {
  const e20 = a.effect[2];
  return (
    <section aria-labelledby="z-eff">
      <h3 id="z-eff" className="gp-subhead">Экологический эффект (оценка)</h3>
      <div className="gp-beforeafter">
        <div><span className="gp-muted gp-small">Сейчас</span><strong>{a.before.canopyM2} м² кроны</strong><span className="gp-small">зелень в 200 м: {a.before.greenShare === null ? 'нет данных' : `${Math.round(a.before.greenShare * 100)}%`}</span></div>
        <span aria-hidden="true">→</span>
        <div><span className="gp-muted gp-small">Через 20 лет</span><strong>{e20.canopyM2.toLocaleString('ru-RU')} м² кроны</strong><span className="gp-small">CO₂ {e20.co2t.toFixed(2)} т/год · −{e20.coolingC} °C</span></div>
      </div>
      <table className="gp-table gp-small">
        <thead><tr><th>Показатель</th><th>5 лет</th><th>10 лет</th><th>20 лет</th></tr></thead>
        <tbody>
          <tr><td>Поглощение CO₂, т/год</td>{a.effect.map((e) => <td key={e.years}>{e.co2t.toFixed(2)}</td>)}</tr>
          <tr><td>Выработка O₂, т/год</td>{a.effect.map((e) => <td key={e.years}>{e.o2t.toFixed(2)}</td>)}</tr>
          <tr><td>Задержание дождя, м³/год</td>{a.effect.map((e) => <td key={e.years}>{Math.round(e.rainM3).toLocaleString('ru-RU')}</td>)}</tr>
          <tr><td>Охлаждение воздуха в зоне, °C</td>{a.effect.map((e) => <td key={e.years}>{e.coolingC}</td>)}</tr>
          <tr><td>Площадь кроны, м²</td>{a.effect.map((e) => <td key={e.years}>{e.canopyM2.toLocaleString('ru-RU')}</td>)}</tr>
          <tr><td>Улавливание пыли, кг/год</td>{a.effect.map((e) => <td key={e.years}>{e.dustKg === null ? <Badge tone="warn" icon="?">нет коэффициента</Badge> : Math.round(e.dustKg)}</td>)}</tr>
          <tr><td>Зелень на жителя</td><td colSpan={3}><Badge tone="warn" icon="?">нет данных о населении</Badge></td></tr>
        </tbody>
      </table>
      <p><strong>Стоимость тонны CO₂ за 20 лет:</strong> {a.costPerTonCo2 ? money(a.costPerTonCo2) : '—'} <span className="gp-muted gp-small">(смета ÷ накопленное поглощение за 20 лет)</span></p>
      <p className="gp-small gp-muted">Коэффициенты и их источники — в «Справочниках». Значения оценочные, учитывают рост кроны и приживаемость за 3 года.</p>
      <TimeMachinePanel a={a} site={site} byId={byId} />
      <ErrorNote error={null} />
    </section>
  );
}
