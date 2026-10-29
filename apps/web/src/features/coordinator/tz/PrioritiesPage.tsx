import { useEffect, useMemo, useState } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import { DEFAULT_PRIORITY_WEIGHTS, PRIORITY_LABEL, type PriorityFactor } from '../../../shared/analytics/city';
import { Bar, Button, StateView } from '../../../shared/ui/components';
import { hrefFor } from '../../../shared/router';
import { PageHeader } from '../PageHeader';
import { download } from '../sites/filters';

const FACTORS = Object.keys(PRIORITY_LABEL) as PriorityFactor[];
const money = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} млн ₸` : `${Math.round(n).toLocaleString('ru-RU')} ₸`);

/** ТЗ 3.7: индекс приоритета 0–100, ползунки весов (пересчёт сразу), объяснение и дорожная карта под бюджет. */
export function PrioritiesPage() {
  const { api } = useData();
  const [weights, setWeights] = useState(DEFAULT_PRIORITY_WEIGHTS);
  const [budget, setBudget] = useState('50');
  const [debounced, setDebounced] = useState(weights);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(weights), 250);
    return () => clearTimeout(id);
  }, [weights]);
  const budgetTg = Number(budget.replace(',', '.')) * 1e6;
  const res = useResource(() => api.priorities(debounced, Number.isFinite(budgetTg) && budgetTg > 0 ? budgetTg : null), [JSON.stringify(debounced), budget]);
  const sites = useResource(() => api.sites(), []);
  const name = useMemo(() => new Map((sites.data?.data ?? []).map((s) => [s.id, s.name])), [sites.data]);
  const items = res.data?.items ?? [];
  const chosen = new Set((res.data?.roadmap?.chosen ?? []).map((c) => c.siteId));
  const csv = () => download('priorities.csv', '﻿' + ['Место;Зона;ID;Индекс;' + FACTORS.map((f) => PRIORITY_LABEL[f]).join(';') + ';Смета, ₸;CO₂ через 20 лет, т/год;В дорожной карте', ...items.map((it, i) => [i + 1, name.get(it.siteId), it.siteId, it.index, ...FACTORS.map((f) => it.factors[f]), Math.round(it.cost), it.co2t20.toFixed(2), chosen.has(it.siteId) ? 'да' : 'нет'].join(';'))].join('\n'));

  return (
    <div className="gp-page">
      <PageHeader eyebrow="Очерёдность озеленения" title="Приоритеты" lead="Индекс приоритета 0–100 по факторам ТЗ. Меняйте веса — рейтинг пересчитывается сразу. Задайте бюджет — система предложит, какие зоны озеленить в первую очередь." actions={<button className="gp-btn" onClick={csv}>⤓ Excel (CSV)</button>} />
      <div className="gp-ranking">
        <section className="gp-card gp-ranking__weights" aria-labelledby="w-h">
          <h2 id="w-h">Веса факторов</h2>
          {FACTORS.map((f) => (
            <div key={f} className="gp-weight">
              <label htmlFor={`pw-${f}`}>{PRIORITY_LABEL[f]} <strong>{weights[f].toFixed(2)}</strong></label>
              <input id={`pw-${f}`} type="range" min={0} max={0.5} step={0.05} value={weights[f]} onChange={(e) => setWeights({ ...weights, [f]: Number(e.target.value) })} />
            </div>
          ))}
          <p className="gp-small gp-muted">Веса нормируются на сумму. Плотность населения заменена плотностью застройки (нет данных о населении), тепловая нагрузка — оценка по дорогам и застройке.</p>
          <Button variant="ghost" onClick={() => setWeights(DEFAULT_PRIORITY_WEIGHTS)}>Веса по умолчанию</Button>
          <h2 className="gp-subhead">Бюджет</h2>
          <label className="gp-kv">
            <input className="gp-input gp-input--short" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} aria-label="Бюджет, млн тенге" /> млн ₸
          </label>
          {res.data?.roadmap && (
            <div className="gp-roadmap-sum">
              <p><strong>{res.data.roadmap.chosen.length}</strong> зон за <strong>{money(res.data.roadmap.spent)}</strong>, остаток {money(res.data.roadmap.left)}.</p>
              <p className="gp-small">CO₂ через 20 лет: ≈{res.data.roadmap.co2t20.toFixed(1)} т/год (оценка).</p>
              <p className="gp-small gp-muted">{res.data.roadmap.method} Сметы — вариант «оптимальный», демо-расценки.</p>
            </div>
          )}
        </section>
        <section aria-live="polite">
          <StateView loading={res.loading && !res.data} error={res.error} hasData={!!res.data} onRetry={res.reload}>
            <ol className="gp-rank-list">
              {items.slice(0, 40).map((it, i) => (
                <li key={it.siteId} className={`gp-card gp-rank-item ${chosen.has(it.siteId) ? 'is-chosen' : ''}`}>
                  <div className="gp-rank-item__head">
                    <span className="gp-rank-item__pos">{i + 1}</span>
                    <a href={hrefFor('/map', { site: it.siteId })}><strong>{name.get(it.siteId) ?? it.siteId}</strong></a>
                    {chosen.has(it.siteId) && <span className="gp-badge gp-badge--ok">✓ в дорожной карте</span>}
                    <span className="gp-rank-item__score"><strong>{it.index}</strong> / 100</span>
                  </div>
                  <Bar value={it.index} label="Индекс приоритета" />
                  <p className="gp-small">Главное: {it.explanation.join(' · ')} · смета {money(it.cost)}</p>
                  <details className="gp-small">
                    <summary>Все факторы</summary>
                    <table className="gp-table"><tbody>{FACTORS.map((f) => <tr key={f}><td>{PRIORITY_LABEL[f]}</td><td style={{ width: '40%' }}><Bar value={it.factors[f]} label={PRIORITY_LABEL[f]} /></td><td>{it.factors[f]}</td><td>× {weights[f].toFixed(2)}</td></tr>)}</tbody></table>
                  </details>
                </li>
              ))}
            </ol>
            {items.length > 40 && <p className="gp-small gp-muted">Показаны первые 40 из {items.length}; полный список — в выгрузке.</p>}
          </StateView>
        </section>
      </div>
    </div>
  );
}
