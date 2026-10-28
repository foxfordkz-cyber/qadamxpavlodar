import { useMemo, useState } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import type { Species } from '../../../shared/api/types';
import { Modal, StateView } from '../../../shared/ui/components';
import { t, type Key } from '../../../shared/i18n';
import { hrefFor, useRoute } from '../../../shared/router';
import { PageHeader } from '../PageHeader';
import { SpeciesCard } from '../projects/CatalogPanel';
import { SpeciesCardFull, USE_LABEL } from './SpeciesCardGrid';

type Use = NonNullable<Species['uses']>[number];

export function SpeciesPage() {
  const { api } = useData();
  const route = useRoute();
  const r = useResource(() => api.species(), []);
  const [q, setQ] = useState(route.params.get('q') ?? '');
  const [form, setForm] = useState<'all' | Species['form']>('all');
  const [use, setUse] = useState<'all' | Use>('all');
  const [pvl, setPvl] = useState(false);
  const [soviet, setSoviet] = useState(false);
  const [hardy, setHardy] = useState(false);
  const [card, setCard] = useState<Species | null>(null);
  const list = useMemo(
    () =>
      (r.data ?? []).filter((s) =>
        (form === 'all' || s.form === form) &&
        (use === 'all' || s.uses?.includes(use)) &&
        (!pvl || s.pavlodarEvidenceId) &&
        (!soviet || s.soviet) &&
        (!hardy || (s.droughtTolerance === 'high' && s.frostHardiness !== 'low')) &&
        `${s.nameRu} ${s.latin}`.toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [r.data, form, use, pvl, soviet, hardy, q],
  );
  const reset = () => { setQ(''); setForm('all'); setUse('all'); setPvl(false); setSoviet(false); setHardy(false); };

  return (
    <div className="gp-page">
      <PageHeader eyebrow="Каталог" title={t('species.title')} lead="Деревья, кустарники и цветы для Павлодара: польза для города, красота по сезонам и устойчивость. Отметка «Сажают в Павлодаре» — со ссылкой на источник." actions={<a className="gp-btn" href={hrefFor('/guide')}>Гайд проектировщика</a>} />
      <div className="gp-alert gp-alert--warn gp-small"><span aria-hidden="true">≈ </span>{t('species.note')}</div>
      <div className="gp-filterbar gp-card">
        <label className="gp-sr" htmlFor="sp-q">Поиск</label>
        <input id="sp-q" className="gp-input gp-input--search" type="search" placeholder="Поиск по названию" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="gp-segment" role="radiogroup" aria-label="Форма">
          {(['all', 'tree', 'shrub', 'flower'] as const).map((f) => (
            <label key={f}><input type="radio" name="spform" checked={form === f} onChange={() => setForm(f)} />{f === 'all' ? t('filters.all') : t(`species.form.${f}` as Key)}</label>
          ))}
        </div>
        <label className="gp-kv gp-small">Где
          <select className="gp-input" value={use} onChange={(e) => setUse(e.target.value as 'all' | Use)}>
            <option value="all">Везде</option>
            {Object.entries(USE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="gp-check"><input type="checkbox" checked={pvl} onChange={(e) => setPvl(e.target.checked)} />Сажают в Павлодаре</label>
        <label className="gp-check"><input type="checkbox" checked={soviet} onChange={(e) => setSoviet(e.target.checked)} />Советская классика</label>
        <label className="gp-check"><input type="checkbox" checked={hardy} onChange={(e) => setHardy(e.target.checked)} />Без полива</label>
        <span className="gp-small gp-muted" aria-live="polite">Найдено: {list.length}</span>
      </div>
      <StateView loading={r.loading} error={r.error} hasData={!!r.data} onRetry={r.reload} empty={!!r.data && !list.length} emptyText="Ничего не найдено. Ослабьте фильтры.">
        <div className="gp-spgrid">{list.map((s) => <SpeciesCardFull key={s.id} s={s} onOpen={() => setCard(s)} />)}</div>
      </StateView>
      {list.length === 0 && r.data && <button className="gp-btn" onClick={reset}>{t('filters.reset')}</button>}
      <Modal open={!!card} title={card?.nameRu ?? ''} onClose={() => setCard(null)} wide>
        {card && <SpeciesCard s={card} />}
      </Modal>
    </div>
  );
}
