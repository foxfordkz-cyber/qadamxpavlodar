import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../PageHeader';
import { useData, useResource } from '../../../shared/api/DataProvider';
import type { FactorKey, RankWeights, SiteRanking, SiteRankItem } from '../../../shared/api/types';
import { Bar, Button, EligBadge, ErrorNote, Limitations, MethodLine, StateView, useGuarded } from '../../../shared/ui/components';
import { t, type Key } from '../../../shared/i18n';
import { fmtArea } from '../../../shared/format';
import { hrefFor } from '../../../shared/router';

// Демонстрационная политика из контракта (раздел 6), не научно утверждённая формула.
const DEMO_WEIGHTS: RankWeights = { greeneryGap: 0.35, publicUsePriority: 0.3, waterAvailability: 0.2, maintenanceFeasibility: 0.15 };
const FACTORS: FactorKey[] = ['greeneryGap', 'publicUsePriority', 'waterAvailability', 'maintenanceFeasibility'];

export function RankingPage() {
  const { api, revision } = useData();
  const sites = useResource(() => api.sites(), []);
  const [weights, setWeights] = useState<RankWeights>(DEMO_WEIGHTS);
  const [ranking, setRanking] = useState<SiteRanking | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [limit, setLimit] = useState(15);
  const { run, busy } = useGuarded();
  const sum = +FACTORS.reduce((a, f) => a + weights[f], 0).toFixed(2);
  const sumOk = Math.abs(sum - 1) <= 0.01;

  const recalc = (w = weights) =>
    run(async () => {
      setError(null);
      try {
        setRanking(await api.rankPreview(w));
      } catch (e) {
        setError(e);
      }
    });
  useEffect(() => {
    recalc(DEMO_WEIGHTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  const siteById = useMemo(() => new Map((sites.data?.data ?? []).map((s) => [s.id, s])), [sites.data]);
  // Сначала проверки, затем приоритет: участки с ограничением отдельно.
  const groups = useMemo(() => {
    const m = new Map<string, SiteRankItem[]>();
    for (const it of ranking?.items ?? []) {
      if (it.eligibility === 'blocked') continue;
      const k = it.missingFactors.join(',');
      m.set(k, [...(m.get(k) ?? []), it]);
    }
    return [...m.entries()].sort((a, b) => a[0].length - b[0].length);
  }, [ranking]);
  const blocked = (ranking?.items ?? []).filter((x) => x.eligibility === 'blocked');

  const normalize = () => {
    const s = FACTORS.reduce((a, f) => a + weights[f], 0) || 1;
    const n = Object.fromEntries(FACTORS.map((f) => [f, +(weights[f] / s).toFixed(2)])) as unknown as RankWeights;
    const diff = +(1 - FACTORS.reduce((a, f) => a + n[f], 0)).toFixed(2);
    n.greeneryGap = +(n.greeneryGap + diff).toFixed(2);
    setWeights(n);
  };

  return (
    <div className="gp-page">
      <PageHeader eyebrow={t('rank.eyebrow')} title={t('rank.title')} lead={t('rank.lead')} />
      <div className="gp-ranking">
        <section className="gp-card gp-ranking__weights" aria-labelledby="weights-h">
          <h2 id="weights-h">{t('rank.weights')}</h2>
          <p className="gp-small gp-muted">{t('rank.weightsNote')}</p>
          {FACTORS.map((f) => (
            <div key={f} className="gp-weight">
              <label htmlFor={`w-${f}`}>{t(`factor.${f}` as Key)} <strong>{weights[f].toFixed(2)}</strong></label>
              <input id={`w-${f}`} type="range" min={0} max={1} step={0.05} value={weights[f]} onChange={(e) => setWeights((w) => ({ ...w, [f]: +e.target.value }))} />
            </div>
          ))}
          <p className={sumOk ? 'gp-small' : 'gp-small gp-caution'} aria-live="polite">{sumOk ? t('rank.sum', { sum: sum.toFixed(2) }) : <><span aria-hidden="true">✕ </span>{t('rank.sumBad')} ({sum.toFixed(2)})</>}</p>
          <div className="gp-btn-row">
            <Button variant="primary" onClick={() => recalc()} busy={busy} disabled={!sumOk}>{t('rank.recalc')}</Button>
            {!sumOk && <Button onClick={normalize}>{t('rank.normalize')}</Button>}
            <Button variant="ghost" onClick={() => { setWeights(DEMO_WEIGHTS); recalc(DEMO_WEIGHTS); }}>{t('rank.reset')}</Button>
          </div>
          {ranking && <MethodLine method={ranking.method} />}
          {ranking && <p className="gp-small gp-muted">Сценарий: {ranking.scenarioId}</p>}
        </section>

        <section className="gp-ranking__results" aria-live="polite">
          <ErrorNote error={error} />
          <StateView loading={busy && !ranking} error={!ranking ? error : null} hasData={!!ranking} onRetry={() => recalc()}>
            {ranking && (
              <>
                <Limitations items={ranking.limitations} />
                {groups.map(([missing, items]) => (
                  <div key={missing} className="gp-rank-group">
                    <h2>{missing ? t('rank.group.partial', { factors: missing.split(',').map((f) => t(`factor.${f}` as Key)).join(', ') }) : t('rank.group.complete')} · {items.length}</h2>
                    <p className="gp-small gp-muted">{t('rank.groupNote')}</p>
                    <ol className="gp-rank-list">
                      {items.slice(0, limit).map((it, i) => {
                        const s = siteById.get(it.siteId);
                        return (
                          <li key={it.siteId} className="gp-card gp-rank-item">
                            <div className="gp-rank-item__head">
                              <span className="gp-rank-item__pos">{i + 1}</span>
                              <a href={hrefFor('/map', { site: it.siteId })}><strong>{s?.name ?? it.siteId}</strong></a>
                              <EligBadge value={it.eligibility} />
                              <span className="gp-rank-item__score">
                                {it.score !== null ? <><strong>{it.score}</strong> {t('rank.score').toLowerCase()}</> : <><strong>{it.partialScore ?? '—'}</strong> {t('rank.partial', { n: 4 - it.missingFactors.length })}</>}
                              </span>
                            </div>
                            <div className="gp-small gp-muted">{fmtArea(s?.areaM2)} · {it.siteId}</div>
                            <details>
                              <summary>{t('rank.contrib')}</summary>
                              <table className="gp-table gp-small">
                                <thead><tr><th>Фактор</th><th>Значение</th><th>Вес</th><th>Вклад</th></tr></thead>
                                <tbody>
                                  {it.contributions.map((c) => (
                                    <tr key={c.factor}>
                                      <td>{t(`factor.${c.factor}` as Key)}<div className="gp-muted">{s?.factors[c.factor].method}</div></td>
                                      <td><Bar value={c.value} label={t(`factor.${c.factor}` as Key)} /> {c.value ?? t('factor.noData')}</td>
                                      <td>{c.weight.toFixed(2)}</td>
                                      <td>{c.contribution ?? '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <p className="gp-small">{it.explanation}</p>
                            </details>
                          </li>
                        );
                      })}
                    </ol>
                    {items.length > limit && <Button variant="ghost" onClick={() => setLimit(1000)}>{t('rank.all')} ({items.length})</Button>}
                  </div>
                ))}
                {blocked.length > 0 && (
                  <div className="gp-rank-group">
                    <h2><span aria-hidden="true">✕ </span>{t('rank.excludedBlocked')} · {blocked.length}</h2>
                    <ul>{blocked.map((b) => <li key={b.siteId}><a href={hrefFor('/map', { site: b.siteId })}>{siteById.get(b.siteId)?.name ?? b.siteId}</a> — {b.explanation}</li>)}</ul>
                  </div>
                )}
              </>
            )}
          </StateView>
        </section>
      </div>
    </div>
  );
}
