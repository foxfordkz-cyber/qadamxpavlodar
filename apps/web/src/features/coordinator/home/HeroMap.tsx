import { useEffect, useRef, useState } from 'react';
import { AttributionControl, Map as MlMap, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CandidateSite } from '../../../shared/api/types';
import { growthFrame, type GrowthScene } from '../zone/timeMachine';

setWorkerUrl(workerUrl);
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const PANEL_MIN_WIDTH = 761;

const zones = (sites: CandidateSite[], focusId: string | null) => ({
  type: 'FeatureCollection' as const,
  features: sites.map((s) => ({ type: 'Feature' as const, properties: { focus: s.id === focusId ? 1 : 0 }, geometry: s.geometry })),
});

/**
 * Первый экран: настоящая 3D-карта центра Павлодара (здания OSM). Выбранный участок выделен,
 * на нём стоит посадка из расчёта через 20 лет. Карта не интерактивна.
 * При ошибке вызывает onFail — показывается запасная иллюстрация.
 */
export function HeroMap({ sites, focus, scene, onFail }: { sites: CandidateSite[]; focus: CandidateSite | null; scene: GrowthScene | null; onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const mapRef = useRef<MlMap | null>(null);
  const planted = useRef(false);

  useEffect(() => {
    if (!box.current) return;
    let map: MlMap;
    try {
      map = new MlMap({ container: box.current, style: STYLE_URL, center: [76.9560, 52.2885], zoom: 14.7, pitch: 60, bearing: -30, interactive: false, attributionControl: false });
    } catch {
      onFail();
      return;
    }
    mapRef.current = map;
    planted.current = false;
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    let loaded = false;
    const timer = setTimeout(() => !loaded && onFail(), 12000);
    map.on('error', () => !loaded && onFail());
    map.on('load', () => {
      loaded = true;
      clearTimeout(timer);
      // Здания светлые, без подписей и цветных дорог: город читается как макет, а участок сразу виден.
      if (map.getLayer('building-3d')) map.setPaintProperty('building-3d', 'fill-extrusion-color', '#eef0e8');
      for (const l of map.getStyle().layers) {
        if (l.type === 'symbol') map.setLayoutProperty(l.id, 'visibility', 'none');
        else if (l.type === 'line' && /road|highway|street|bridge|tunnel/.test(l.id)) map.setPaintProperty(l.id, 'line-color', '#ffffff');
      }
      map.addSource('hero-sites', { type: 'geojson', data: zones([], null) });
      map.addLayer({ id: 'hero-sites', type: 'fill', source: 'hero-sites', paint: { 'fill-color': ['case', ['==', ['get', 'focus'], 1], '#2f9e5f', '#a9d6b6'] as never, 'fill-opacity': ['case', ['==', ['get', 'focus'], 1], 0.85, 0.5] as never } });
      map.addLayer({ id: 'hero-sites-line', type: 'line', source: 'hero-sites', paint: { 'line-color': '#14603c', 'line-width': ['case', ['==', ['get', 'focus'], 1], 3, 0.8] as never } });
      setReady(true);
    });
    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
    };
  }, [onFail]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('hero-sites') as { setData?: (d: unknown) => void } | undefined)?.setData?.(zones(sites, focus?.id ?? null));
    if (focus?.geometry.type !== 'Polygon') return;
    const ring = focus.geometry.coordinates[0];
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    // Слева карту закрывает панель сценария: участок показываем в свободной части.
    const wide = matchMedia(`(min-width: ${PANEL_MIN_WIDTH}px)`).matches;
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: wide ? { left: 520, right: 80, top: 70, bottom: 70 } : 30, maxZoom: 17.2, pitch: 60, bearing: -30, duration: 0 });
  }, [ready, sites, focus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !scene || planted.current) return;
    planted.current = true;
    const g = growthFrame(scene, 20);
    void import('../projects/scene3d').then(({ createPlantingLayer }) => {
      if (mapRef.current !== map) return;
      try {
        map.addLayer(createPlantingLayer({ origin: g.origin, siteRing: g.ring, items: g.items, species: g.species, stage: g.k }).layer);
      } catch {
        /* без WebGL-контекста для three.js участок остаётся выделенным контуром */
      }
    }).catch(() => { /* модель не загрузилась: контур участка виден и без неё */ });
  }, [ready, scene]);

  return <div ref={box} className={`gp-hero__map ${ready ? 'is-ready' : ''}`} aria-hidden="true" />;
}
