import { tr } from '../../../shared/i18n';
import { useMemo, useState } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import type { RateEntry } from '../../../shared/analytics/rates';
import { Badge, Button, ErrorNote, StateView, useGuarded } from '../../../shared/ui/components';
import { PageHeader } from '../PageHeader';
import { useMe } from '../me';
import { t } from '../../../shared/i18n';
import { TOPIC_LABEL, type FactTopic, type PavlodarFact, type PavlodarSource } from '../../../shared/api/pavlodar';

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
      <PageHeader eyebrow={tr("Справочники")} title={tr("Расценки и коэффициенты")} lead={tr("Все числа, из которых считаются смета, приживаемость и экоэффект. У каждого значения указан источник; без источника значение нельзя сохранить.")} />
      {!admin && <div className="gp-alert gp-alert--info gp-small">{tr("Менять значения может администратор. Ваша роль — только просмотр справочника.")}</div>}
      <StateView loading={res.loading} error={res.error} hasData={!!res.data} onRetry={res.reload}>
        {groups.map(([g, list]) => (
          <section key={g} className="gp-guide__sec">
            <h2 className="gp-guide__h">{tr(GROUP[g])}</h2>
            {g === 'survival' && <p className="gp-alert gp-alert--info gp-small">{t('survival.ratesNote')}</p>}
            <div className="gp-table-wrap gp-card">
              <table className="gp-table gp-small">
                <thead><tr><th>{tr("Показатель")}</th><th>{tr("Значение")}</th><th>{tr("Ед.")}</th><th>{tr("Источник")}</th></tr></thead>
                <tbody>{list.map((r) => <RateRow key={r.key} r={r} admin={admin} version={res.data!.version} onSaved={() => { res.reload(); bump(); }} />)}</tbody>
              </table>
            </div>
          </section>
        ))}
      </StateView>
      <PavlodarFacts />
    </div>
  );
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Проверенные открытые данные о Павлодаре (fixtures/pavlodar): что известно, откуда, и чего пока нет. */
function PavlodarFacts() {
  const { api } = useData();
  const res = useResource(() => api.referenceFacts(), []);
  const data = res.data?.data;
  const byId = useMemo(() => new Map((data?.sources ?? []).map((x) => [x.id, x] as const)), [data]);
  const topics = useMemo(() => {
    const m = new Map<FactTopic, PavlodarFact[]>();
    for (const f of data?.facts ?? []) m.set(f.topic as FactTopic, [...(m.get(f.topic as FactTopic) ?? []), f as PavlodarFact]);
    return [...m];
  }, [data]);
  return (
    <section className="gp-guide__sec" aria-labelledby="pvl-h">
      <h2 id="pvl-h" className="gp-guide__h">{tr("Проверенные данные о Павлодаре")}</h2>
      <p className="gp-small gp-muted">{tr("Открытые источники, собраны")}{" "}{String(res.data?.meta?.researchedAt ?? '29.10.2026')}{tr(": климат, нормы СП РК, правила озеленения области, воздух, зелёный фонд, цены госзакупок. «Нет данных» значит «не найдено в проверенных источниках», а не ноль. Ассистент ссылается на эти факты.")}</p>
      <StateView loading={res.loading} error={res.error} hasData={!!data} onRetry={res.reload}>
        {data && (
          <>
            <h3 className="gp-subhead">{tr("Климатические нормы 1991–2020, станция Павлодар")}</h3>
            <div className="gp-table-wrap gp-card">
              <table className="gp-table gp-small">
                <thead><tr><th>{tr("Месяц")}</th>{MONTHS.map((m) => <th key={m}>{tr(m)}</th>)}</tr></thead>
                <tbody>
                  <tr><td>{tr("Температура, °C")}</td>{data.climate.months.map((m) => <td key={m.month}>{m.tMeanC?.toLocaleString('ru-RU') ?? '—'}</td>)}</tr>
                  <tr><td>{tr("Осадки, мм")}</td>{data.climate.months.map((m) => <td key={m.month}>{m.precipitationMm?.toLocaleString('ru-RU') ?? '—'}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <SourceLinks ids={data.climate.evidenceIds.slice(0, 2)} byId={byId} />
            <div className="gp-facts">
              {topics.map(([topic, list]) => (
                <div key={topic} className="gp-card gp-facts__topic">
                  <h3 className="gp-subhead">{tr(TOPIC_LABEL[topic])}</h3>
                  <ul className="gp-list">
                    {list.map((f) => (
                      <li key={f.id} className="gp-facts__item">
                        <strong>{f.title}</strong> {f.gap ? <Badge tone="demo">{tr("нет данных")}</Badge> : f.dataClass === 'estimate' ? <Badge tone="neutral">{tr("оценка")}</Badge> : null}
                        <p className="gp-small">{f.text}</p>
                        <SourceLinks ids={f.evidenceIds} byId={byId} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </StateView>
    </section>
  );
}

function SourceLinks({ ids, byId }: { ids: string[]; byId: Map<string, PavlodarSource> }) {
  if (!ids.length) return null;
  return (
    <p className="gp-small gp-muted">{tr("Источник:")}{" "}{ids.map((id, i) => { const src = byId.get(id); return <span key={id}>{i > 0 && '; '}{src?.sourceUrl ? <a href={src.sourceUrl} target="_blank" rel="noreferrer noopener">{src.sourceLabel}</a> : src?.sourceLabel ?? id}</span>; })}</p>
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
        {edit ? <input className="gp-input gp-input--short" value={value} onChange={(e) => setValue(e.target.value)} aria-label={t('dynamic.015', { p0: String(r.label) })} /> : <strong>{r.value === null ? '—' : r.value.toLocaleString('ru-RU')}</strong>}
        {' '}<Badge tone={DC[r.dataClass][0]}>{tr(DC[r.dataClass][1])}</Badge>
      </td>
      <td>{r.unit}</td>
      <td>
        {edit ? (
          <>
            <input className="gp-input" placeholder={tr("Источник: документ, прайс, дата")} value={source} onChange={(e) => setSource(e.target.value)} aria-label={tr("Источник значения")} />
            <div className="gp-btn-row"><Button variant="primary" busy={busy} onClick={save}>{tr("Сохранить")}</Button><Button onClick={() => setEdit(false)}>{tr("Отмена")}</Button></div>
            <ErrorNote error={error} notSaved />
          </>
        ) : (
          <>
            {r.source} {r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noreferrer">{tr("ссылка")}</a>}
            {admin && <div><button className="gp-linkbtn" onClick={() => setEdit(true)}>{tr("Изменить")}</button></div>}
          </>
        )}
      </td>
    </tr>
  );
}
