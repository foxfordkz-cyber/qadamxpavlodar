import { useEffect, useRef, useState } from 'react';
import { AttributionControl, Map as MlMap, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CandidateSite } from '../../../shared/api/types';

setWorkerUrl(workerUrl);
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * Фон первого экрана: настоящая 3D-карта центра Павлодара (здания OSM) с контурами
 * кандидатов. Не интерактивна; медленный облёт выключается при prefers-reduced-motion
 * и на скрытой вкладке. При ошибке вызывает onFail — показывается запасная иллюстрация.
 */
export function HeroMap({ sites, onFail }: { sites: CandidateSite[]; onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const sitesRef = useRef(sites);
  sitesRef.current = sites;
  const mapRef = useRef<MlMap | null>(null);

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
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    let loaded = false;
    const timer = setTimeout(() => !loaded && onFail(), 12000);
    map.on('error', () => !loaded && onFail());
    let raf = 0;
    map.on('load', () => {
      loaded = true;
      clearTimeout(timer);
      setReady(true);
      // Здания чуть теплее и светлее, чтобы фон не спорил с текстом.
      if (map.getLayer('building-3d')) map.setPaintProperty('building-3d', 'fill-extrusion-color', '#eef0e8');
      // Без подписей и цветных дорог город читается как макет, а зоны-кандидаты сразу видны.
      for (const l of map.getStyle().layers) {
        if (l.type === 'symbol') map.setLayoutProperty(l.id, 'visibility', 'none');
        else if (l.type === 'line' && /road|highway|street|bridge|tunnel/.test(l.id)) map.setPaintProperty(l.id, 'line-color', '#ffffff');
      }
      map.addSource('hero-sites', { type: 'geojson', data: { type: 'FeatureCollection', features: sitesRef.current.map((s) => ({ type: 'Feature', properties: {}, geometry: s.geometry })) } });
      map.addLayer({ id: 'hero-sites', type: 'fill', source: 'hero-sites', paint: { 'fill-color': '#2f9e5f', 'fill-opacity': 0.72 } });
      map.addLayer({ id: 'hero-sites-line', type: 'line', source: 'hero-sites', paint: { 'line-color': '#14603c', 'line-width': 1.5 } });
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      let last = performance.now();
      const spin = (now: number) => {
        if (document.visibilityState === 'visible') map.setBearing(map.getBearing() + ((now - last) / 1000) * 1.2);
        last = now;
        raf = requestAnimationFrame(spin);
      };
      raf = requestAnimationFrame(spin);
    });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
    };
  }, [onFail]);

  useEffect(() => {
    const src = mapRef.current?.getSource('hero-sites') as { setData?: (d: unknown) => void } | undefined;
    src?.setData?.({ type: 'FeatureCollection', features: sites.map((s) => ({ type: 'Feature', properties: {}, geometry: s.geometry })) });
  }, [sites]);

  return <div ref={box} className={`gp-hero__map ${ready ? 'is-ready' : ''}`} aria-hidden="true" />;
}
