import { useState } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import type { RateEntry } from '../../../shared/analytics/rates';
import { Badge, Button, ErrorNote, StateView, useGuarded } from '../../../shared/ui/components';
import { PageHeader } from '../PageHeader';
import { useMe } from '../me';

const GROUP: Record<RateEntry['group'], string> = { cost: 'Расценки сметы', effect: 'Коэффициенты экологического эффекта', care: 'Уход', survival: 'Приживаемость' };
const DC: Record<RateEntry['dataClass'], ['demo' | 'neutral' | 'info', string]> = { demo: ['demo', 'демо'], estimate: ['neutral', 'оценка'], real: ['info', 'введено'] };

/** ТЗ 3.4.2 и 5.3: справочник расценок и коэффициентов с источниками; меняет только администратор. */
export function RatesPage() {
  const { api, bump } = useData();
  const me = useMe();
  const res = useResource(() => api.rates(), []);
  const admin = me.role === 'admin';
  const groups = (Object.keys(GROUP) as RateEntry['group'][]).map((g) => [g, (res.data?.rates ?? []).filter((r) => r.group === g)] as const);
  return (
    <div className="gp-page">
      <PageHeader eyebrow="Справочники" title="Расценки и коэффициенты" lead="Все числа, из которых считаются смета, приживаемость и экоэффект. У каждого значения указан источник; без источника значение нельзя сохранить." />
      {!admin && <div className="gp-alert gp-alert--info gp-small">Менять значения может администратор. Ваша роль — только просмотр справочника.</div>}
      <StateView loading={res.loading} error={res.error} hasData={!!res.data} onRetry={res.reload}>
        {groups.map(([g, list]) => (
          <section key={g} className="gp-guide__sec">
            <h2 className="gp-guide__h">{GROUP[g]}</h2>
            <div className="gp-table-wrap gp-card">
              <table className="gp-table gp-small">
                <thead><tr><th>Показатель</th><th>Значение</th><th>Ед.</th><th>Источник</th></tr></thead>
                <tbody>{list.map((r) => <RateRow key={r.key} r={r} admin={admin} version={res.data!.version} onSaved={() => { res.reload(); bump(); }} />)}</tbody>
              </table>
            </div>
          </section>
        ))}
      </StateView>
    </div>
  );
}

function RateRow({ r, admin, version, onSaved }: { r: RateEntry; admin: boolean; version: number; onSaved: () => void }) {
  const { api } = useData();
  const [edit, setEdit] = useState(false);
  const [value, setValue] = useState(r.value === null ? '' : String(r.value));
  const [source, setSource] = useState('');
  const [error, setError] = useState<unknown>(null);
  const { run, busy } = useGuarded();
  const save = () => run(async () => {
    setError(null);
    try {
      await api.patchRate({ key: r.key, value: value.trim() === '' ? null : Number(value.replace(',', '.')), source, expectedVersion: version });
      setEdit(false);
      onSaved();
    } catch (e) { setError(e); }
  });
  return (
    <tr>
      <td>{r.label}</td>
      <td>
        {edit ? <input className="gp-input gp-input--short" value={value} onChange={(e) => setValue(e.target.value)} aria-label={`Значение: ${r.label}`} /> : <strong>{r.value === null ? '—' : r.value.toLocaleString('ru-RU')}</strong>}
        {' '}<Badge tone={DC[r.dataClass][0]}>{DC[r.dataClass][1]}</Badge>
      </td>
      <td>{r.unit}</td>
      <td>
        {edit ? (
          <>
            <input className="gp-input" placeholder="Источник: документ, прайс, дата" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Источник значения" />
            <div className="gp-btn-row"><Button variant="primary" busy={busy} onClick={save}>Сохранить</Button><Button onClick={() => setEdit(false)}>Отмена</Button></div>
            <ErrorNote error={error} notSaved />
          </>
        ) : (
          <>
            {r.source} {r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noreferrer">ссылка</a>}
            {admin && <div><button className="gp-linkbtn" onClick={() => setEdit(true)}>Изменить</button></div>}
          </>
        )}
      </td>
    </tr>
  );
}
