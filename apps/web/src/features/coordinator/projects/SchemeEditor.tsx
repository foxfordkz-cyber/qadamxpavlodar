import { tr } from '../../../shared/i18n';
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { CandidateSite, GeoJsonPoint, GeoJsonPolygon, Plant, ProjectItem, SiteContext, Species } from '../../../shared/api/types';
import { bboxXY, makeProjection, ringAreaXY, type XY } from '../../../shared/geo';
import { t } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/components';

export type Tool = 'select' | 'point' | 'bed';

interface Props {
  site: CandidateSite;
  context: SiteContext | null;
  items: ProjectItem[];
  species: Map<string, Species>;
  existingPlants: Plant[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  tool: Tool;
  activeSpecies: Species | null;
  onAdd?: (geometry: GeoJsonPoint | GeoJsonPolygon) => void;
  onMove?: (id: string, geometry: GeoJsonPoint) => void;
  onDelete?: (id: string) => void;
  readOnly?: boolean;
}

const FORM_COLOR: Record<Species['form'], string> = { tree: '#3f5a1f', shrub: '#6c8a2c', flower: '#b0577a' };

/** Схема сверху в локальных метрах (x вправо, y вверх; в SVG y отражён). */
export function SchemeEditor({ site, context, items, species, existingPlants, selectedId, onSelect, tool, activeSpecies, onAdd, onMove, onDelete, readOnly }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const proj = useMemo(() => makeProjection(site.centroid!), [site.centroid]);
  const siteRing = useMemo<XY[]>(() => (site.geometry.type === 'Polygon' ? site.geometry.coordinates[0].map(proj.toXY) : [proj.toXY(site.geometry.coordinates)]), [site, proj]);
  const box = useMemo(() => {
    const b = bboxXY(siteRing);
    const pad = Math.max(12, (b.maxX - b.minX) * 0.15);
    return { minX: b.minX - pad, maxX: b.maxX + pad, minY: b.minY - pad, maxY: b.maxY + pad };
  }, [siteRing]);
  const W = box.maxX - box.minX;
  const H = box.maxY - box.minY;
  const k = Math.max(W, H) / 100; // масштаб подписей и маркеров
  const [draft, setDraft] = useState<XY[]>([]);
  const [drag, setDrag] = useState<{ id: string; xy: XY } | null>(null);

  const sv = ([x, y]: XY) => `${x},${-y}`;
  const path = (ring: XY[]) => ring.map(sv).join(' ');
  const toXY = (e: { clientX: number; clientY: number }): XY | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, -p.y];
  };
  const inView = (pts: [number, number][]) => pts.map(proj.toXY).some(([x, y]) => x > box.minX - 40 && x < box.maxX + 40 && y > box.minY - 40 && y < box.maxY + 40);

  const onCanvasClick = (e: React.MouseEvent) => {
    if (readOnly || drag) return;
    const xy = toXY(e);
    if (!xy) return;
    if (tool === 'point' && activeSpecies) onAdd?.({ type: 'Point', coordinates: proj.toLngLat(xy) });
    else if (tool === 'bed' && activeSpecies) {
      if (draft.length >= 3 && Math.hypot(xy[0] - draft[0][0], xy[1] - draft[0][1]) < 1.5 * k) finishBed();
      else setDraft((d) => [...d, xy]);
    } else if (tool === 'select') onSelect(null);
  };
  const finishBed = () => {
    if (draft.length < 3) return;
    const ring = [...draft, draft[0]].map(proj.toLngLat);
    onAdd?.({ type: 'Polygon', coordinates: [ring] });
    setDraft([]);
  };

  const startDrag = (e: PointerEvent, it: ProjectItem) => {
    if (readOnly || tool !== 'select' || it.kind !== 'point') return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    onSelect(it.id);
    setDrag({ id: it.id, xy: proj.toXY((it.geometry as GeoJsonPoint).coordinates) });
  };
  const moveDrag = (e: PointerEvent) => {
    if (!drag) return;
    const xy = toXY(e);
    if (xy) setDrag({ ...drag, xy });
  };
  const endDrag = () => {
    if (!drag) return;
    onMove?.(drag.id, { type: 'Point', coordinates: proj.toLngLat(drag.xy) });
    setTimeout(() => setDrag(null), 0);
  };
  const onItemKey = (e: KeyboardEvent, it: ProjectItem) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(it.id); return; }
    if (readOnly) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onDelete?.(it.id); return; }
    const step = e.shiftKey ? 2 : 0.5;
    const d: Record<string, XY> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (d[e.key] && it.kind === 'point') {
      e.preventDefault();
      const [x, y] = proj.toXY((it.geometry as GeoJsonPoint).coordinates);
      onMove?.(it.id, { type: 'Point', coordinates: proj.toLngLat([x + d[e.key][0], y + d[e.key][1]]) });
    }
  };

  const grid = [];
  for (let x = Math.ceil(box.minX / 5) * 5; x < box.maxX; x += 5) grid.push(<line key={`gx${x}`} x1={x} x2={x} y1={-box.maxY} y2={-box.minY} className="gp-scheme__grid" />);
  for (let y = Math.ceil(box.minY / 5) * 5; y < box.maxY; y += 5) grid.push(<line key={`gy${y}`} y1={-y} y2={-y} x1={box.minX} x2={box.maxX} className="gp-scheme__grid" />);

  return (
    <div className={`gp-scheme-ed gp-scheme-ed--${tool}`}>
      {!readOnly && tool === 'bed' && (
        <div className="gp-scheme-ed__bar" role="status">
          {draft.length === 0 ? t('ed.bed.start') : t('ed.bed.points', { n: draft.length, area: draft.length >= 3 ? ringAreaXY([...draft, draft[0]]).toFixed(1) : '—' })}
          <Button onClick={finishBed} disabled={draft.length < 3}>{t('ed.bed.finish')}</Button>
          <Button variant="ghost" onClick={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length}>{t('ed.bed.undo')}</Button>
        </div>
      )}
      <svg ref={svgRef} viewBox={`${box.minX} ${-box.maxY} ${W} ${H}`} className="gp-scheme-ed__svg" onClick={onCanvasClick} onPointerMove={moveDrag} onPointerUp={endDrag}
        role="group" aria-label={t('ed.scheme.label', { name: site.name })}>
        <defs>
          <pattern id="gp-ez" width={1.5 * k} height={1.5 * k} patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2={1.5 * k} stroke="#a32f1f" strokeWidth={0.35 * k} /></pattern>
          <pattern id="gp-flowers" width={1.2 * k} height={1.2 * k} patternUnits="userSpaceOnUse"><circle cx={0.6 * k} cy={0.6 * k} r={0.25 * k} fill="#b0577a" /></pattern>
        </defs>
        <rect x={box.minX} y={-box.maxY} width={W} height={H} fill="#f3f4ec" />
        {grid}
        {context?.roads.filter((r) => inView(r.geometry.coordinates)).map((r) => (
          <polyline key={r.id} points={r.geometry.coordinates.map(proj.toXY).map(sv).join(' ')} className={`gp-scheme__road gp-scheme__road--${/foot|path|pedestrian|cycle/.test(r.kind) ? 'foot' : 'car'}`} />
        ))}
        {context?.buildings.filter((b) => inView(b.geometry.coordinates[0])).map((b) => {
          const ring = b.geometry.coordinates[0].map(proj.toXY);
          const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
          return (
            <g key={b.id}>
              <polygon points={path(ring)} className="gp-scheme__bld" />
              {b.address && <text x={c[0]} y={-c[1]} fontSize={1.6 * k} className="gp-scheme__label" textAnchor="middle">{b.address.split(', ').at(-1)}</text>}
            </g>
          );
        })}
        <polygon points={path(siteRing)} className="gp-scheme__site" />
        {(site.exclusionZones ?? []).map((z) => <polygon key={z.id} points={path(z.geometry.coordinates[0].map(proj.toXY))} fill="url(#gp-ez)" stroke="#a32f1f" strokeWidth={0.3 * k}><title>{z.label}</title></polygon>)}
        {context?.entrances.map((p) => { const [x, y] = proj.toXY([p.lng, p.lat]); return <path key={p.id} d={`M${x} ${-y - 1.2 * k} l${k} ${1.8 * k} h${-2 * k} Z`} className="gp-scheme__entrance" />; })}
        {context?.crossings.map((p) => { const [x, y] = proj.toXY([p.lng, p.lat]); return <rect key={p.id} x={x - k} y={-y - 0.5 * k} width={2 * k} height={k} className="gp-scheme__crossing" />; })}
        {existingPlants.map((pl) => { const [x, y] = proj.toXY([pl.lng, pl.lat]); return <circle key={pl.id} cx={x} cy={-y} r={0.9 * k} className="gp-scheme__existing"><title>{pl.name}</title></circle>; })}

        {items.map((it, i) => {
          const sp = species.get(it.speciesId);
          const color = sp ? FORM_COLOR[sp.form] : '#555';
          const sel = it.id === selectedId;
          const conflict = it.conflicts.length > 0;
          const cls = `gp-scheme__item ${sel ? 'is-selected' : ''} ${conflict ? 'is-conflict' : ''} ${it.origin === 'suggested' ? 'is-suggested' : ''}`;
          const label = `${i + 1}. ${sp?.nameRu ?? it.speciesId}, ${it.kind === 'bed' ? t('ed.kind.bed') : t('ed.kind.point')}${conflict ? `, ${t('ed.conflict')}` : ''}`;
          if (it.kind === 'bed') {
            const ring = (it.geometry as GeoJsonPolygon).coordinates[0].map(proj.toXY);
            return (
              <g key={it.id} className={cls} role="button" tabIndex={0} aria-label={label} aria-pressed={sel} onClick={(e) => { e.stopPropagation(); if (tool === 'select') onSelect(it.id); }} onKeyDown={(e) => onItemKey(e, it)}>
                <polygon points={path(ring)} fill="url(#gp-flowers)" stroke={color} strokeWidth={0.3 * k} />
              </g>
            );
          }
          const xy = drag?.id === it.id ? drag.xy : proj.toXY((it.geometry as GeoJsonPoint).coordinates);
          const r = Math.max(0.5, (sp?.crownDiameterM ?? 1) / 2);
          return (
            <g key={it.id} className={cls} role="button" tabIndex={0} aria-label={label} aria-pressed={sel} onPointerDown={(e) => startDrag(e, it)} onClick={(e) => { e.stopPropagation(); if (tool === 'select') onSelect(it.id); }} onKeyDown={(e) => onItemKey(e, it)}>
              <circle cx={xy[0]} cy={-xy[1]} r={r} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={0.2 * k} strokeDasharray={`${0.6 * k} ${0.4 * k}`} />
              <circle cx={xy[0]} cy={-xy[1]} r={0.45 * k} fill={color} />
              {conflict && <text x={xy[0] + r} y={-xy[1] - r} fontSize={2.2 * k} className="gp-scheme__warn">!</text>}
              <text x={xy[0]} y={-xy[1] + 2.2 * k} fontSize={1.5 * k} textAnchor="middle" className="gp-scheme__num">{i + 1}</text>
            </g>
          );
        })}
        {draft.length > 0 && (
          <g className="gp-scheme__draft">
            <polyline points={draft.map(sv).join(' ')} />
            {draft.map((p, i) => <circle key={i} cx={p[0]} cy={-p[1]} r={0.5 * k} />)}
          </g>
        )}
        <g className="gp-scheme__scalebar" transform={`translate(${box.minX + 2 * k} ${-box.minY - 2 * k})`}>
          <line x1={0} x2={10} y1={0} y2={0} />
          <text x={5} y={-k} fontSize={1.6 * k} textAnchor="middle">{tr("10 м")}</text>
        </g>
        <text x={box.maxX - 2 * k} y={-box.maxY + 3 * k} fontSize={2 * k} textAnchor="end" className="gp-scheme__north">{tr("С ↑")}</text>
      </svg>
    </div>
  );
}
