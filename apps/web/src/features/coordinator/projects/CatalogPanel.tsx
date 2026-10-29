import { tr } from '../../../shared/i18n';
import { useMemo, useState } from 'react';
import type { Species } from '../../../shared/api/types';
import { Badge, DataClassTag, EvidenceList, Modal } from '../../../shared/ui/components';
import { t, type Key } from '../../../shared/i18n';
import { SpeciesPhoto } from '../species/SpeciesCardGrid';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

interface Filters {
  q: string;
  form: 'all' | Species['form'];
  drought: boolean;
  salt: boolean;
  month: number;
  easyCare: boolean;
  native: boolean;
  hideInvasive: boolean;
}

export function CatalogPanel({ catalog, active, onPick, disabled }: { catalog: Species[]; active: Species | null; onPick: (s: Species) => void; disabled?: boolean }) {
  const [f, setF] = useState<Filters>({ q: '', form: 'all', drought: false, salt: false, month: 0, easyCare: false, native: false, hideInvasive: true });
  const [card, setCard] = useState<Species | null>(null);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((p) => ({ ...p, [k]: v }));
  const list = useMemo(
    () =>
      catalog.filter((s) =>
        (f.form === 'all' || s.form === f.form) &&
        (!f.q || `${s.nameRu} ${s.latin}`.toLowerCase().includes(f.q.toLowerCase())) &&
        (!f.drought || s.droughtTolerance === 'high') &&
        (!f.salt || s.saltTolerance !== 'low') &&
        (!f.month || s.floweringMonths?.includes(f.month)) &&
        (!f.easyCare || s.careLevel === 'low') &&
        (!f.native || s.native) &&
        (!f.hideInvasive || !s.invasiveRisk),
      ),
    [catalog, f],
  );
  return (
    <div className="gp-catalog">
      <h2 className="gp-eyebrow">{t('ed.catalog')}</h2>
      <label className="gp-sr" htmlFor="cat-q">{t('ed.cat.search')}</label>
      <input id="cat-q" className="gp-input" type="search" placeholder={t('ed.cat.search')} value={f.q} onChange={(e) => set('q', e.target.value)} />
      <div className="gp-segment gp-catalog__forms" role="radiogroup" aria-label={t('ed.cat.form')}>
        {(['all', 'tree', 'shrub', 'flower'] as const).map((x) => (
          <label key={x}><input type="radio" name="cat-form" checked={f.form === x} onChange={() => set('form', x)} />{x === 'all' ? t('filters.all') : t(`species.form.${x}` as Key)}</label>
        ))}
      </div>
      <div className="gp-catalog__checks">
        <label className="gp-check"><input type="checkbox" checked={f.drought} onChange={(e) => set('drought', e.target.checked)} />{t('ed.cat.drought')}</label>
        <label className="gp-check"><input type="checkbox" checked={f.salt} onChange={(e) => set('salt', e.target.checked)} />{t('ed.cat.salt')}</label>
        <label className="gp-check"><input type="checkbox" checked={f.easyCare} onChange={(e) => set('easyCare', e.target.checked)} />{t('ed.cat.easy')}</label>
        <label className="gp-check"><input type="checkbox" checked={f.native} onChange={(e) => set('native', e.target.checked)} />{t('species.native')}</label>
        <label className="gp-check"><input type="checkbox" checked={f.hideInvasive} onChange={(e) => set('hideInvasive', e.target.checked)} />{t('ed.cat.hideInvasive')}</label>
        <label className="gp-kv gp-small">{t('ed.cat.month')}
          <select className="gp-input" value={f.month} onChange={(e) => set('month', Number(e.target.value))}>
            <option value={0}>{t('filters.all')}</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{tr(m)}</option>)}
          </select>
        </label>
      </div>
      <p className="gp-small gp-muted" aria-live="polite">{t('ed.cat.found', { n: list.length })}</p>
      <ul className="gp-catalog__list">
        {list.map((s) => (
          <li key={s.id} className={s.id === active?.id ? 'is-active' : ''}>
            <button className="gp-catalog__pick" onClick={() => onPick(s)} disabled={disabled} aria-pressed={s.id === active?.id}>
              <SpeciesPhoto s={s} small />
              <span className="gp-catalog__name">{s.nameRu}{s.pavlodarEvidenceId ? <span className="gp-catalog__pvl" title={tr("Сажают в Павлодаре")}> ✓</span> : null}</span>
              <span className="gp-small gp-muted">{t(`species.form.${s.form}` as Key)}{s.floweringMonths?.length ? ` · ${s.floweringMonths.map((m) => tr(MONTHS[m - 1])).join('–')}` : ''}{s.pricePerUnitKzt == null ? ` · ${t('ed.cat.noPrice')}` : ''}</span>
            </button>
            <button className="gp-icon-btn" onClick={() => setCard(s)} aria-label={t('ed.cat.details', { name: s.nameRu })}>ⓘ</button>
          </li>
        ))}
      </ul>
      <Modal open={!!card} title={card?.nameRu ?? ''} onClose={() => setCard(null)}>
        {card && <SpeciesCard s={card} />}
      </Modal>
    </div>
  );
}

export function SpeciesCard({ s }: { s: Species }) {
  const unknown = (v: unknown) => (v == null ? <Badge tone="warn" icon="?">{t('common.unknown')}</Badge> : null);
  return (
    <div className="gp-spmodal">
      <SpeciesPhoto s={s} />
      <p><i>{s.latin}</i> · {t(`species.form.${s.form}` as Key)} <DataClassTag value={s.dataClass} /></p>
      {!!s.benefits?.length && <p><strong>{tr("Польза для города:")}</strong> {s.benefits.join(' · ')}</p>}
      {!!s.beauty?.length && <p><strong>{tr("Красота:")}</strong> {s.beauty.join(' · ')}</p>}
      {s.spacingM != null && <p className="gp-small"><strong>{tr("Шаг посадки в ряду:")}</strong> {s.spacingM}{" "}{tr("м")}{" "}<span className="gp-muted">{tr("(ориентир команды)")}</span></p>}
      <dl className="gp-dl">
        <dt>{t('species.frost')}</dt><dd>{t(`species.level.${s.frostHardiness}` as Key)}</dd>
        <dt>{t('species.drought')}</dt><dd>{t(`species.level.${s.droughtTolerance}` as Key)}</dd>
        <dt>{t('species.salt')}</dt><dd>{t(`species.level.${s.saltTolerance}` as Key)}</dd>
        <dt>{t('ed.cat.care')}</dt><dd>{s.careLevel ? t(`species.level.${s.careLevel}` as Key) : unknown(null)}</dd>
        <dt>{t('ed.cat.flowering')}</dt><dd>{s.floweringMonths?.length ? s.floweringMonths.map((m) => tr(MONTHS[m - 1])).join(', ') : unknown(null)}</dd>
        <dt>{t('species.height')}</dt><dd>{s.matureHeightM ? `${s.matureHeightM[0]}–${s.matureHeightM[1]}` : unknown(null)}</dd>
        <dt>{t('ed.cat.crown')}</dt><dd>{s.crownDiameterM != null ? t('dynamic.002', { p0: String(s.crownDiameterM) }) : unknown(null)}</dd>
        <dt>{t('ed.cat.price')}</dt><dd>{s.pricePerUnitKzt != null ? `${s.pricePerUnitKzt.toLocaleString('ru-RU')} ₸ (${t('data.demo')})` : unknown(null)}</dd>
      </dl>
      <div className="gp-btn-row">
        {s.native && <Badge tone="ok" icon="✓">{t('species.native')}</Badge>}
        {s.invasiveRisk && <Badge tone="bad" icon="!">{t('species.invasive')}</Badge>}
        {s.allergenic && <Badge tone="warn" icon="!">{t('species.allergen')}</Badge>}
      </div>
      {s.notes.length > 0 && <ul>{s.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <h3 className="gp-subhead">{t('data.sources')}</h3>
      <EvidenceList ids={[...s.evidenceIds, ...(s.priceEvidenceId ? [s.priceEvidenceId] : [])]} />
      {s.photo && <p className="gp-small gp-muted">{tr("Фото:")}{" "}<a href={s.photo.page} target="_blank" rel="noreferrer">{s.photo.author}, {s.photo.license}, Wikimedia Commons</a>{" "}{tr("— иллюстрация вида, не снимок участка.")}</p>}
    </div>
  );
}
