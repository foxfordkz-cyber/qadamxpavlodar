import { t } from '../../../shared/i18n';
import { tr } from '../../../shared/i18n';
import { useMemo, useState } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import { PRIORITY_LABEL } from '../../../shared/analytics/city';
import { Bar, Button, StateView } from '../../../shared/ui/components';
import { hrefFor, navigate } from '../../../shared/router';
import { PageHeader } from '../PageHeader';
import { download } from '../sites/filters';
import { FACTORS, usePriorityWeights, WeightSliders } from './PriorityWeights';

const money = (n: number) => (n >= 1e6 ? t('dynamic.014', { p0: String((n / 1e6).toFixed(2)) }) : `${Math.round(n).toLocaleString('ru-RU')} ₸`);

/** ТЗ 3.7: индекс приоритета 0–100, ползунки весов (пересчёт сразу), объяснение и дорожная карта под бюджет. */
export function PrioritiesPage() {
  const { api } = useData();
  const { weights, setWeights, debounced, reset } = usePriorityWeights(250);
  const [budget, setBudget] = useState('50');
  const budgetTg = Number(budget.replace(',', '.')) * 1e6;
  const res = useResource(() => api.priorities(debounced, Number.isFinite(budgetTg) && budgetTg > 0 ? budgetTg : null), [JSON.stringify(debounced), budget]);
  const sites = useResource(() => api.sites(), []);
  const name = useMemo(() => new Map((sites.data?.data ?? []).map((s) => [s.id, s.name])), [sites.data]);
  const items = res.data?.items ?? [];
  const chosen = new Set((res.data?.roadmap?.chosen ?? []).map((c) => c.siteId));
  // Номера на карте — место в рейтинге или в очереди дорожной карты.
  const showOnMap = (ids: string[], title: string) => navigate('/map', { hl: ids.slice(0, 30).join(','), hlt: title });
  const csv = () => download('priorities.csv', '﻿' + ['Место;Зона;ID;Индекс;' + FACTORS.map((f) => tr(PRIORITY_LABEL[f])).join(';') + ';Смета, ₸;CO₂ через 20 лет, т/год;В дорожной карте', ...items.map((it, i) => [i + 1, name.get(it.siteId), it.siteId, it.index, ...FACTORS.map((f) => it.factors[f]), Math.round(it.cost), it.co2t20.toFixed(2), chosen.has(it.siteId) ? tr("да") : tr("нет")].join(';'))].join('\n'));

  return (
    <div className="gp-page">
      <PageHeader eyebrow={tr("Очерёдность озеленения")} title={tr("Приоритеты")} lead={tr("Индекс приоритета 0–100 по факторам ТЗ. Меняйте веса — рейтинг пересчитывается сразу. Задайте бюджет — система предложит, какие зоны озеленить в первую очередь.")} actions={<><button className="gp-btn gp-btn--secondary" disabled={!items.length} onClick={() => showOnMap(items.slice(0, 10).map((it) => it.siteId), 'Первые 10 по приоритету')}>🗺 Топ-10 на карте</button><button className="gp-btn" onClick={csv}>⤓ Excel (CSV)</button></>} />
      <div className="gp-ranking">
        <section className="gp-card gp-ranking__weights" aria-labelledby="w-h">
          <h2 id="w-h">{tr("Веса факторов")}</h2>
          <WeightSliders weights={weights} onChange={setWeights} idPrefix="pw" />
          <p className="gp-small gp-muted">{tr("Веса нормируются на сумму. Плотность населения заменена плотностью застройки (нет данных о населении), тепловая нагрузка — оценка по дорогам и застройке.")}</p>
          <p className="gp-small gp-muted">{tr("Эти же веса окрашивают слой «Приоритет» на карте.")}</p>
          <Button variant="ghost" onClick={reset}>{tr("Веса по умолчанию")}</Button>
          <h2 className="gp-subhead">{tr("Бюджет")}</h2>
          <label className="gp-kv">
            <input className="gp-input gp-input--short" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} aria-label={tr("Бюджет, млн тенге")} />{" "}{tr("млн ₸")}{" "}</label>
          {res.data?.roadmap && (
            <div className="gp-roadmap-sum">
              <p><strong>{res.data.roadmap.chosen.length}</strong>{" "}{tr("зон за")}{" "}<strong>{money(res.data.roadmap.spent)}</strong>{tr(", остаток")}{" "}{money(res.data.roadmap.left)}.</p>
              <p className="gp-small">{tr("CO₂ через 20 лет: ≈")}{res.data.roadmap.co2t20.toFixed(1)}{" "}{tr("т/год (оценка).")}</p>
              <p className="gp-small gp-muted">{res.data.roadmap.method}{" "}{tr("Сметы — вариант «оптимальный», демо-расценки.")}</p>
              {res.data.roadmap.chosen.length > 0 && <Button variant="primary" onClick={() => showOnMap(res.data!.roadmap!.chosen.map((c) => c.siteId), `Дорожная карта · ${budget} млн ₸`)}>🗺 Показать очередь на карте</Button>}
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
                    {chosen.has(it.siteId) && <span className="gp-badge gp-badge--ok">{tr("✓ в дорожной карте")}</span>}
                    <span className="gp-rank-item__score"><strong>{it.index}</strong> / 100</span>
                  </div>
                  <Bar value={it.index} label={tr("Индекс приоритета")} />
                  <p className="gp-small">{tr("Главное:")}{" "}{it.explanation.join(' · ')}{" "}{tr("· смета")}{" "}{money(it.cost)}</p>
                  <details className="gp-small">
                    <summary>{tr("Все факторы")}</summary>
                    <table className="gp-table"><tbody>{FACTORS.map((f) => <tr key={f}><td>{tr(PRIORITY_LABEL[f])}</td><td style={{ width: '40%' }}><Bar value={it.factors[f]} label={tr(PRIORITY_LABEL[f])} /></td><td>{it.factors[f]}</td><td>× {weights[f].toFixed(2)}</td></tr>)}</tbody></table>
                  </details>
                </li>
              ))}
            </ol>
            {items.length > 40 && <p className="gp-small gp-muted">{tr("Показаны первые 40 из")}{" "}{items.length}{tr("; полный список — в выгрузке.")}</p>}
          </StateView>
        </section>
      </div>
    </div>
  );
}
