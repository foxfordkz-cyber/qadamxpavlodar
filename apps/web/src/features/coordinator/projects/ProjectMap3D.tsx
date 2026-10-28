import { useEffect, useMemo, useRef, useState } from 'react';
import { AttributionControl, Map as MlMap, NavigationControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CandidateSite, GeoJsonPoint, ProjectItem, Species } from '../../../shared/api/types';
import { makeProjection } from '../../../shared/geo';
import { bedParts, plantParts, type Stage } from './trees3d';
import { createPlantingLayer } from './scene3d';
import { siteBounds } from '../map/geo';
import { t, type Key } from '../../../shared/i18n';

setWorkerUrl(workerUrl);
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * «После»: схематичная 3D-визуализация проекта на карте OSM. Кроны — многоугольники
 * с высотой по справочнику. Это не фото и не AI-эскиз, подписано явно.
 */
export function ProjectMap3D({ site, items, species, versionLabel }: { site: CandidateSite; items: ProjectItem[]; species: Map<string, Species>; versionLabel: string }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const [stage, setStage] = useState<Stage>('five');
  const [failed, setFailed] = useState<string | null>(null);
  // three.js-модели; при отказе WebGL-контекста — запасной вариант из объёмов карты.
  const [engine, setEngine] = useState<'three' | 'extrusion'>('three');
  const plantingRef = useRef<ReturnType<typeof createPlantingLayer> | null>(null);
  const sceneInput = () => ({ origin: site.centroid!, siteRing: site.geometry.type === 'Polygon' ? site.geometry.coordinates[0] : null, items: itemsRef.current, species, stage: stageRef.current });
  const stageRef = useRef(stage);
  stageRef.current = stage;

  // Макеты растений: ярусы fill-extrusion по форме вида (trees3d.ts).
  const data = useMemo(() => {
    const proj = makeProjection(site.centroid!);
    return {
      type: 'FeatureCollection' as const,
      features: items.flatMap((it) => {
        const sp = species.get(it.speciesId);
        if (it.kind === 'bed') return bedParts((it.geometry as { coordinates: [number, number][][] }).coordinates[0], sp, stage);
        return plantParts(proj, proj.toXY((it.geometry as GeoJsonPoint).coordinates), sp, stage);
      }),
    };
  }, [items, species, site, stage]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    if (!box.current) return;
    let m: MlMap;
    try {
      m = new MlMap({ container: box.current, style: STYLE_URL, bounds: focusBounds(site, itemsRef.current), fitBoundsOptions: { padding: 40, maxZoom: 19.5 }, pitch: 62, bearing: -25, maxPitch: 75, attributionControl: false });
    } catch (e) {
      setFailed((e as Error).message);
      return;
    }
    map.current = m;
    m.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    m.addControl(new AttributionControl({ compact: false }), 'bottom-right');
    m.on('error', (e) => !ready.current && setFailed(e.error?.message ?? 'ошибка загрузки'));
    m.on('load', () => {
      ready.current = true;
      m.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.35, position: [1.2, 210, 40] });
      m.addSource('site', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: site.geometry } });
      m.addLayer({ id: 'site-line', type: 'line', source: 'site', paint: { 'line-color': '#4a5a2a', 'line-width': 2, 'line-dasharray': [2, 1] } });
      try {
        const pl = createPlantingLayer(sceneInput());
        m.addLayer(pl.layer);
        plantingRef.current = pl;
        return;
      } catch {
        setEngine('extrusion');
      }
      m.addSource('planned', { type: 'geojson', data: dataRef.current });
      m.addLayer({ id: 'planned-3d', type: 'fill-extrusion', source: 'planned', paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true } });
    });
    return () => {
      ready.current = false;
      plantingRef.current = null;
      m.remove();
      map.current = null;
    };
  }, [site]);

  useEffect(() => {
    if (plantingRef.current) {
      plantingRef.current.update(sceneInput());
      return;
    }
    const src = map.current?.getSource('planned') as GeoJSONSource | undefined;
    if (ready.current && src) src.setData(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="gp-after">
      <div className="gp-after__bar">
        <div className="gp-segment" role="radiogroup" aria-label={t('ed.after.stage')}>
          {(['planting', 'five', 'mature'] as Stage[]).map((s) => (
            <label key={s}><input type="radio" name="stage" checked={stage === s} onChange={() => setStage(s)} />{t(`ed.after.${s}` as Key)}</label>
          ))}
        </div>
        <span className="gp-small">{versionLabel} · {t('ed.after.season')} · {engine === 'three' ? t('ed.after.engine3d') : t('ed.after.engineSimple')}</span>
      </div>
      <p className="gp-alert gp-alert--info gp-small"><span aria-hidden="true">ⓘ </span>{t('ed.after.caption')}</p>
      {failed ? (
        <div className="gp-alert gp-alert--warn" role="alert">{t('map.failed')} ({failed})</div>
      ) : (
        <div ref={box} className="gp-after__map" aria-label={t('ed.view.after')} />
      )}
      {items.length === 0 && <p className="gp-muted gp-small">{t('ed.after.empty')}</p>}
    </div>
  );
}

/** Камера на посадки (с запасом 12 м), а не на весь участок: на длинных газонах макеты иначе теряются. */
function focusBounds(site: CandidateSite, items: ProjectItem[]): [[number, number], [number, number]] {
  if (!items.length) return siteBounds(site);
  const proj = makeProjection(site.centroid!);
  const pts = items.flatMap((i) => (i.geometry.type === 'Point' ? [i.geometry.coordinates] : i.geometry.coordinates[0])).map(proj.toXY);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const pad = 12;
  const sw = proj.toLngLat([Math.min(...xs) - pad, Math.min(...ys) - pad]);
  const ne = proj.toLngLat([Math.max(...xs) + pad, Math.max(...ys) + pad]);
  return [sw, ne];
}
