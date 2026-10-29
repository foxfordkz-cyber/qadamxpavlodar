import { useMemo, useState } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import { PROBLEM_LABEL, type ProblemType, type Severity } from '../../../shared/analytics/city';
import { Badge, Freshness, StateView } from '../../../shared/ui/components';
import { hrefFor } from '../../../shared/router';
import { PageHeader } from '../PageHeader';
import { download } from '../sites/filters';

const SEV: Record<Severity, ['bad' | 'warn' | 'neutral', string, string]> = { high: ['bad', '▲', 'Высокая'], medium: ['warn', '■', 'Средняя'], low: ['neutral', '●', 'Низкая'] };

/** ТЗ 3.2: проблемные зоны — таблица с фильтрами и сортировкой; слой — на карте («Слои → Проблемные зоны»). */
export function ProblemsPage() {
  const { api } = useData();
  const res = useResource(() => api.problems(), [], 60000);
  const sites = useResource(() => api.sites(), []);
  const [type, setType] = useState<'all' | ProblemType>('all');
  const [sev, setSev] = useState<'all' | Severity>('all');
  const [sort, setSort] = useState<'severity' | 'type' | 'zone'>('severity');
  const name = useMemo(() => new Map((sites.data?.data ?? []).map((s) => [s.id, s.name])), [sites.data]);
  const all = res.data?.data.problems ?? [];
  const order = { high: 0, medium: 1, low: 2 };
  const list = all
    .filter((p) => (type === 'all' || p.type === type) && (sev === 'all' || p.severity === sev))
    .sort((a, b) => (sort === 'severity' ? order[a.severity] - order[b.severity] : sort === 'type' ? a.type.localeCompare(b.type) : (name.get(a.siteId) ?? '').localeCompare(name.get(b.siteId) ?? '')));
  const csv = () => download('problem-zones.csv', '﻿' + ['Зона;ID;Проблема;Острота;Причина;Рекомендуемое действие;Примечание к данным', ...list.map((p) => [name.get(p.siteId), p.siteId, PROBLEM_LABEL[p.type], SEV[p.severity][2], p.cause, p.action, p.dataNote ?? ''].map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n'));
  return (
    <div className="gp-page">
      <PageHeader eyebrow="Анализ AI-карты" title="Проблемные зоны" lead="Участки с дефицитом зелени, неблагоприятной почвой, перегревом и без защитных полос. У каждой проблемы — острота, причина и рекомендуемое действие." actions={<><a className="gp-btn" href={hrefFor('/map')}>Показать на карте</a><button className="gp-btn" onClick={csv}>⤓ Excel (CSV)</button><Freshness updatedAt={res.updatedAt} error={res.error} loading={res.loading} onRefresh={res.reload} /></>} />
      <div className="gp-tiles gp-tiles--compact">
        {(Object.keys(PROBLEM_LABEL) as ProblemType[]).map((k) => (
          <button key={k} className={`gp-tile gp-tile--btn ${type === k ? 'is-active' : ''}`} onClick={() => setType(type === k ? 'all' : k)} aria-pressed={type === k}>
            <span className="gp-small">{PROBLEM_LABEL[k]}</span>
            <span className="gp-tile__value">{all.filter((p) => p.type === k).length}</span>
          </button>
        ))}
      </div>
      {res.data?.data.notDetectable.map((n) => <div key={n} className="gp-alert gp-alert--warn gp-small">{n}</div>)}
      <div className="gp-filterbar gp-card">
        <label className="gp-kv gp-small">Тип <select className="gp-input gp-input--inline" value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="all">Все</option>{Object.entries(PROBLEM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="gp-kv gp-small">Острота <select className="gp-input gp-input--inline" value={sev} onChange={(e) => setSev(e.target.value as typeof sev)}><option value="all">Любая</option><option value="high">Высокая</option><option value="medium">Средняя</option><option value="low">Низкая</option></select></label>
        <label className="gp-kv gp-small">Сортировка <select className="gp-input gp-input--inline" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="severity">по остроте</option><option value="type">по типу</option><option value="zone">по зоне</option></select></label>
        <span className="gp-small gp-muted" aria-live="polite">Найдено: {list.length} из {all.length}</span>
      </div>
      <StateView loading={res.loading} error={res.error} hasData={!!res.data} onRetry={res.reload} empty={!!res.data && !list.length} emptyText="Проблем по выбранным фильтрам нет." emptyAction={<button className="gp-btn" onClick={() => { setType('all'); setSev('all'); }}>Показать все</button>}>
        <div className="gp-table-wrap gp-card">
          <table className="gp-table">
            <thead><tr><th>Зона</th><th>Проблема</th><th>Острота</th><th>Причина</th><th>Что сделать</th></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id}>
                <td><a href={hrefFor('/map', { site: p.siteId })}>{name.get(p.siteId) ?? p.siteId}</a></td>
                <td>{PROBLEM_LABEL[p.type]}</td>
                <td><Badge tone={SEV[p.severity][0]} icon={SEV[p.severity][1]}>{SEV[p.severity][2]}</Badge></td>
                <td className="gp-small">{p.cause}{p.dataNote && <div className="gp-muted">{p.dataNote}</div>}</td>
                <td className="gp-small">{p.action}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </StateView>
    </div>
  );
}
