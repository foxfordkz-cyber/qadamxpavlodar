import { useEffect, useId, useRef, useState } from 'react';
import { useData } from '../../../shared/api/DataProvider';
import { ApiError, newIdempotencyKey } from '../../../shared/api/transport';
import type { GeoHit } from '../../../shared/api/geocode';
import type { CandidateSite } from '../../../shared/api/types';
import { makeProjection, ringAreaXY } from '../../../shared/geo';
import { ErrorNote } from '../../../shared/ui/components';

const KIND: Record<GeoHit['kind'], string> = { address: 'дом', street: 'улица', place: 'место', zone: 'зона' };

/** ТЗ 3.1.4: поиск по адресу, улице, месту или зоне — по снимку OSM района (сервер или тестовый источник). */
export function MapSearch({ onPick }: { onPick: (hit: GeoHit) => void }) {
  const { api } = useData();
  const id = useId();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<GeoHit[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const picked = useRef<string | null>(null);
  useEffect(() => {
    const text = q.trim();
    // Выбранный адрес попадает в поле — повторно его не ищем.
    if (text.length < 2 || text === picked.current) { setHits(null); return; }
    let alive = true;
    const timer = setTimeout(() => {
      api.geocode(text).then((r) => { if (alive) { setHits(r.data); setActive(0); setError(null); } }, (e) => { if (alive) { setHits([]); setError(e); } });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [q, api]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setHits(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const pick = (h: GeoHit) => { picked.current = h.label; onPick(h); setQ(h.label); setHits(null); };
  return (
    <div className="gp-mapsearch" ref={box}>
      <label className="gp-sr" htmlFor={id}>Поиск по адресу</label>
      <input id={id} className="gp-input" type="search" placeholder="Адрес, улица, место или зона" value={q} autoComplete="off"
        role="combobox" aria-expanded={!!hits?.length} aria-controls={`${id}-list`} aria-activedescendant={hits?.length ? `${id}-${active}` : undefined}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (!hits?.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          if (e.key === 'Enter') { e.preventDefault(); pick(hits[active]!); }
          if (e.key === 'Escape') setHits(null);
        }} />
      {hits && (
        <ul id={`${id}-list`} className="gp-mapsearch__list gp-card" role="listbox" aria-label="Найденные места">
          {hits.map((h, i) => (
            <li key={`${h.kind}-${h.label}`} id={`${id}-${i}`} role="option" aria-selected={i === active}>
              <button type="button" onMouseEnter={() => setActive(i)} onClick={() => pick(h)}><span className="gp-badge">{KIND[h.kind]}</span> {h.label}</button>
            </li>
          ))}
          {!hits.length && <li className="gp-small gp-muted gp-mapsearch__empty">{error instanceof ApiError ? error.message : 'Ничего не найдено в районе карты. Попробуйте улицу без номера дома.'}</li>}
        </ul>
      )}
    </div>
  );
}

/** Площадь контура по углам [lng, lat], м² — та же проекция, что в проверке на сервере. */
export function drawnArea(pts: [number, number][]) {
  if (pts.length < 3) return 0;
  const c = { lng: pts.reduce((a, p) => a + p[0], 0) / pts.length, lat: pts.reduce((a, p) => a + p[1], 0) / pts.length };
  const proj = makeProjection(c);
  return Math.round(ringAreaXY([...pts, pts[0]!].map(proj.toXY)));
}

/** ТЗ 3.1.4: рисование зоны — углы кликами по карте, затем название и сохранение (POST /zones). */
export function DrawBar({ points, onUndo, onCancel, onSaved }: { points: [number, number][]; onUndo: () => void; onCancel: () => void; onSaved: (site: CandidateSite, note: string | null) => void }) {
  const { api, bump } = useData();
  const [step, setStep] = useState<'draw' | 'name'>('draw');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const key = useRef<{ hash: string; key: string } | null>(null);
  const area = drawnArea(points);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onCancel]);
  const save = async () => {
    const geometry = { type: 'Polygon' as const, coordinates: [[...points, points[0]!]] };
    const body = { name: name.trim() || undefined, geometry };
    const hash = JSON.stringify(body);
    // Повтор того же сохранения после сбоя сети — с тем же ключом: сервер не создаст вторую зону.
    if (key.current?.hash !== hash) key.current = { hash, key: newIdempotencyKey() };
    setBusy(true); setError(null);
    try {
      const r = await api.createZone(body, key.current.key);
      bump();
      onSaved(r.data, typeof r.meta?.note === 'string' ? r.meta.note : null);
    } catch (e) { setError(e); setStep('draw'); } finally { setBusy(false); }
  };
  return (
    <div className="gp-drawbar" role="group" aria-label="Рисование зоны">
      {step === 'draw' ? (
        <>
          <span className="gp-small" aria-live="polite">
            {points.length < 3 ? `Кликайте по карте — углы контура (${points.length} из минимум 3).` : `Углов: ${points.length} · ≈${area.toLocaleString('ru-RU')} м²`}
            {points.length >= 3 && area <= 50 && ' — меньше 50 м², сервер не примет'}
          </span>
          <button type="button" className="gp-btn" onClick={onUndo} disabled={!points.length}>Отменить точку</button>
          <button type="button" className="gp-btn gp-btn--primary" onClick={() => setStep('name')} disabled={points.length < 3}>Готово</button>
          <button type="button" className="gp-btn gp-btn--ghost" onClick={onCancel}>Отмена</button>
        </>
      ) : (
        <form className="gp-drawbar__form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="gp-sr" htmlFor="draw-name">Название зоны</label>
          <input id="draw-name" className="gp-input" maxLength={120} placeholder="Название (необязательно)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <button type="submit" className="gp-btn gp-btn--primary" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Сохраняю…' : 'Сохранить зону'}</button>
          <button type="button" className="gp-btn" onClick={() => setStep('draw')} disabled={busy}>Назад</button>
        </form>
      )}
      {error !== null && <ErrorNote error={error} notSaved />}
    </div>
  );
}
