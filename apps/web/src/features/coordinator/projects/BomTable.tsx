import { speciesName } from '../../../shared/i18n';
import { useEffect, useMemo, useRef } from 'react';
import type { ProjectItem, Species } from '../../../shared/api/types';
import { Badge, Button } from '../../../shared/ui/components';
import { t } from '../../../shared/i18n';
import { estimateCost } from '../../../shared/projectRules';

/** Ведомость: каждая строка — позиция на схеме; выбор синхронизирован в обе стороны. */
export function BomTable({ items, species, selectedId, onSelect, onQuantity, onDelete, onAccept, errors, editable }: {
  items: ProjectItem[];
  species: Map<string, Species>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onQuantity: (id: string, q: number) => void;
  onDelete: (id: string) => void;
  onAccept: (id: string) => void;
  errors: Record<string, string>;
  editable: boolean;
}) {
  const catalog = useMemo(() => [...species.values()], [species]);
  const cost = estimateCost(items, catalog);
  const rowRef = useRef<Record<string, HTMLTableRowElement | null>>({});
  useEffect(() => {
    if (selectedId) rowRef.current[selectedId]?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.speciesId, (m.get(i.speciesId) ?? 0) + i.quantity);
    return [...m];
  }, [items]);

  return (
    <div className="gp-bom">
      <h2 className="gp-eyebrow">{t('ed.bom')} · {items.length}</h2>
      {items.length === 0 ? <p className="gp-muted gp-small">{t('ed.bom.empty')}</p> : (
        <div className="gp-table-wrap">
          <table className="gp-table gp-small">
            <thead><tr><th>№</th><th>{t('ed.bom.species')}</th><th>{t('ed.bom.qty')}</th><th>{t('ed.bom.price')}</th><th /></tr></thead>
            <tbody>
              {items.map((it, i) => {
                const sp = species.get(it.speciesId);
                const price = sp?.pricePerUnitKzt;
                return (
                  <tr key={it.id} ref={(el) => { rowRef.current[it.id] = el; }} className={it.id === selectedId ? 'is-selected' : ''} onClick={() => onSelect(it.id)}>
                    <td>{i + 1}</td>
                    <td>
                      <button className="gp-linkbtn" onClick={(e) => { e.stopPropagation(); onSelect(it.id); }}>{speciesName(sp, it.speciesId)}</button>
                      <div className="gp-muted">{it.kind === 'bed' ? t('ed.kind.bed') : t('ed.kind.point')}</div>
                      {it.origin === 'suggested' && (
                        <div><Badge tone="info" icon="✦">{t('ed.bom.suggested')}</Badge>{editable && <Button variant="ghost" onClick={(e) => { e.stopPropagation(); onAccept(it.id); }}>{t('ed.bom.accept')}</Button>}</div>
                      )}
                      {it.conflicts.map((c) => <div key={c.type} className="gp-bom__conflict"><span aria-hidden="true">! </span>{c.message}<br /><em>{t('ed.bom.resolution')}: {c.resolution ?? '—'}</em></div>)}
                      {errors[it.id] && <div className="gp-field__error" role="alert">✕ {errors[it.id]}</div>}
                    </td>
                    <td>
                      {editable ? (
                        <input className="gp-input gp-bom__qty" inputMode="numeric" aria-label={t('ed.bom.qtyFor', { n: i + 1 })} value={it.quantity}
                          onClick={(e) => e.stopPropagation()} onChange={(e) => { const q = Math.max(0, Math.round(Number(e.target.value) || 0)); onQuantity(it.id, q); }} />
                      ) : it.quantity}
                      {it.quantity <= 0 && <div className="gp-field__error">{t('ed.bom.qtyZero')}</div>}
                    </td>
                    <td>{price != null ? `${(price * it.quantity).toLocaleString('ru-RU')} ₸` : <Badge tone="warn" icon="?">{t('ed.bom.noPrice')}</Badge>}</td>
                    <td>{editable && <button className="gp-icon-btn" aria-label={t('ed.bom.delete', { n: i + 1 })} onClick={(e) => { e.stopPropagation(); onDelete(it.id); }}>✕</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {totals.length > 0 && (
        <>
          <h3 className="gp-subhead gp-small">{t('ed.bom.totals')}</h3>
          <ul className="gp-small gp-bom__totals">{totals.map(([id, q]) => <li key={id}>{speciesName(species.get(id), id)}: <strong>{q}</strong></li>)}</ul>
        </>
      )}
      <div className={`gp-bom__cost ${cost.complete ? '' : 'is-partial'}`} aria-live="polite">
        {items.length === 0 ? null : cost.complete ? (
          <><strong>{cost.known.toLocaleString('ru-RU')} ₸</strong> <span className="gp-small gp-muted">{t('ed.bom.costDemo')}</span></>
        ) : cost.known > 0 ? (
          <><strong>{t('ed.bom.costPartial', { sum: cost.known.toLocaleString('ru-RU') })}</strong><div className="gp-small">{t('ed.bom.costMissing', { list: cost.missing.map((m) => `${speciesName(species.get(m.speciesId), m.speciesId)} (${m.quantity})`).join(', ') })}</div></>
        ) : (
          <><strong>{t('ed.bom.costUnknown')}</strong><div className="gp-small">{t('ed.bom.costMissing', { list: cost.missing.map((m) => speciesName(species.get(m.speciesId), m.speciesId)).join(', ') })}</div></>
        )}
      </div>
    </div>
  );
}
