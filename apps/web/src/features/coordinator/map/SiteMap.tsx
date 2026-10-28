import { useEffect, useRef, useState } from 'react';
import { AttributionControl, Map as MlMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CandidateSite, Plant, SiteContext, SiteRankItem } from '../../../shared/api/types';
import { useData } from '../../../shared/api/DataProvider';
import { t } from '../../../shared/i18n';
import { CENTER, siteBounds, siteCenter } from './geo';
import { SchemeView } from './SchemeView';
import { mapBroken } from './mapFlags';

// Векторная подложка OpenFreeMap (OSM). Без ключа; атрибуция обязательна — её задаёт сам стиль
// («OpenFreeMap © OpenMapTiles Data from OpenStreetMap»), контрол показывает её всегда развёрнутой.
// Массовое скачивание тайлов для офлайн-показа не делаем — резерв это SchemeView.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

// MapLibre 6 ищет воркер рядом со своим файлом; после сборки Vite он лежит отдельно.
setWorkerUrl(workerUrl);

export type Elig = SiteRankItem['eligibility'];

interface Props {
  sites: CandidateSite[];
  eligibility: (s: CandidateSite) => Elig;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Меняется, когда нужно перелететь к выбранному участку (выбор из списка). */
  focusSeq: number;
  /** B19: окружение выбранного участка (здания, дороги, входы, переходы). */
  context?: SiteContext | null;
  /** B23: существующие растения (в том числе после принятой посадки). */
  plants?: Plant[];
  /** Планируемые позиции проектов, ещё не реализованных. Отдельный слой. */
  planned?: { lng: number; lat: number; label: string }[];
}

const EMPTY = { type: 'FeatureCollection' as const, features: [] as { type: 'Feature'; properties: Record<string, unknown>; geometry: unknown }[] };

function contextGeoJson(ctx: SiteContext | null | undefined) {
  if (!ctx) return EMPTY;
  return {
    type: 'FeatureCollection' as const,
    features: [
      ...ctx.buildings.map((b) => ({ type: 'Feature' as const, properties: { t: 'bld', label: b.address ?? '' }, geometry: b.geometry })),
      ...ctx.roads.map((r) => ({ type: 'Feature' as const, properties: { t: /foot|path|pedestrian|cycle/.test(r.kind) ? 'foot' : 'road' }, geometry: r.geometry })),
      ...ctx.entrances.map((p) => ({ type: 'Feature' as const, properties: { t: 'entrance' }, geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] } })),
      ...ctx.crossings.map((p) => ({ type: 'Feature' as const, properties: { t: 'crossing' }, geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] } })),
    ],
  };
}
const pointsGeoJson = (pts: { lng: number; lat: number; label: string }[]) => ({
  type: 'FeatureCollection' as const,
  features: pts.map((p) => ({ type: 'Feature' as const, properties: { label: p.label }, geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] } })),
});

function toGeoJson(sites: CandidateSite[], eligibility: Props['eligibility'], selectedId: string | null) {
  return {
    type: 'FeatureCollection' as const,
    features: sites.flatMap((s) => {
      const props = { id: s.id, elig: eligibility(s), selected: s.id === selectedId ? 1 : 0, name: s.name };
      const c = siteCenter(s);
      return [
        { type: 'Feature' as const, id: s.id, properties: props, geometry: s.geometry },
        { type: 'Feature' as const, properties: { ...props, centroid: 1 }, geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] } },
      ];
    }),
  };
}

function hatchImage(color: string) {
  const size = 12;
  const data = new Uint8Array(size * size * 4);
  const [r, g, b] = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const on = (x + y) % size < 2 || (x - y + size) % size < 2; // диагональный крест ✕
      const i = (y * size + x) * 4;
      data.set(on ? [r, g, b, 200] : [255, 255, 255, 0], i);
    }
  return { width: size, height: size, data };
}

export function SiteMap({ sites, eligibility, selectedId, onSelect, focusSeq, context, plants = [], planned = [] }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const { reportService } = useData();
  const [failed, setFailed] = useState<string | null>(null);
  const [view, setView] = useState<'map' | 'scheme'>('map');
  const [pitched, setPitched] = useState(true);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const dataRef = useRef({ sites, eligibility, selectedId, context, plants, planned });
  dataRef.current = { sites, eligibility, selectedId, context, plants, planned };

  useEffect(() => {
    if (!box.current || view !== 'map') return;
    let map: MlMap;
    try {
      map = new MlMap({
        container: box.current,
        style: mapBroken.value ? 'https://invalid.localhost/style.json' : STYLE_URL,
        center: CENTER,
        zoom: 14.2,
        pitch: 50,
        bearing: -15,
        maxPitch: 70,
        attributionControl: false,
      });
    } catch (e) {
      setFailed(`WebGL недоступен: ${(e as Error).message}`);
      reportService('map', 'down');
      return;
    }
    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.addControl(new AttributionControl({ compact: false }), 'bottom-right');

    const timeout = setTimeout(() => {
      if (!ready.current) {
        setFailed('Подложка не ответила за 12 секунд.');
        reportService('map', 'down');
      }
    }, 12000);
    map.on('error', (e) => {
      if (!ready.current) {
        setFailed(e.error?.message ?? 'ошибка загрузки стиля');
        reportService('map', 'down');
      }
    });
    map.on('load', () => {
      ready.current = true;
      clearTimeout(timeout);
      reportService('map', 'ok');
      map.addImage('hatch-blocked', hatchImage('#b3261e'));
      const { sites, eligibility, selectedId } = dataRef.current;
      map.addSource('sites', { type: 'geojson', data: toGeoJson(sites, eligibility, selectedId) });
      const color = ['match', ['get', 'elig'], 'blocked', '#b3261e', 'planting_candidate', '#2f7a3e', '#d89a1c'] as never;
      const isPoly = ['!=', ['get', 'centroid'], 1] as never;
      map.addLayer({ id: 'sites-fill', type: 'fill', source: 'sites', filter: isPoly, paint: { 'fill-color': color, 'fill-opacity': ['case', ['==', ['get', 'selected'], 1], 0.45, 0.28] } });
      map.addLayer({ id: 'sites-hatch', type: 'fill', source: 'sites', filter: ['all', isPoly, ['==', ['get', 'elig'], 'blocked']] as never, paint: { 'fill-pattern': 'hatch-blocked' } });
      // Стиль линии кодирует состояние независимо от цвета: пунктир — нужна проверка, сплошная — завершены.
      map.addLayer({ id: 'sites-line-dash', type: 'line', source: 'sites', filter: ['all', isPoly, ['==', ['get', 'elig'], 'survey_needed']] as never, paint: { 'line-color': '#8a5a00', 'line-width': 2, 'line-dasharray': [2, 1.5] } });
      map.addLayer({ id: 'sites-line-solid', type: 'line', source: 'sites', filter: ['all', isPoly, ['!=', ['get', 'elig'], 'survey_needed']] as never, paint: { 'line-color': color, 'line-width': 2.5 } });
      map.addLayer({ id: 'sites-selected', type: 'line', source: 'sites', filter: ['all', isPoly, ['==', ['get', 'selected'], 1]] as never, paint: { 'line-color': '#1f5d99', 'line-width': 4 } });
      // Точки-центры видны на мелком масштабе, где полигоны слишком малы.
      map.addLayer({ id: 'sites-dot', type: 'circle', source: 'sites', filter: ['==', ['get', 'centroid'], 1] as never, maxzoom: 15.5, paint: { 'circle-radius': ['case', ['==', ['get', 'selected'], 1], 8, 5], 'circle-color': color, 'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], '#1f5d99', '#ffffff'], 'circle-stroke-width': 2, 'circle-opacity': 0.9 } });
      // Подпись только у выбранного участка — без десятков наложенных надписей.
      map.addLayer({ id: 'sites-label', type: 'symbol', source: 'sites', filter: ['all', ['==', ['get', 'centroid'], 1], ['==', ['get', 'selected'], 1]] as never, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-max-width': 14 }, paint: { 'text-color': '#0f2f4f', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
      // Окружение выбранного участка: поверх 3D-зданий подсвечиваются контуры в выбранном радиусе.
      const d = dataRef.current;
      map.addSource('ctx', { type: 'geojson', data: contextGeoJson(d.context) });
      map.addLayer({ id: 'ctx-bld', type: 'line', source: 'ctx', filter: ['==', ['get', 't'], 'bld'] as never, paint: { 'line-color': '#2c5a7a', 'line-width': 2 } });
      map.addLayer({ id: 'ctx-foot', type: 'line', source: 'ctx', filter: ['==', ['get', 't'], 'foot'] as never, paint: { 'line-color': '#8a6d3b', 'line-width': 2.5, 'line-dasharray': [1, 1] } });
      map.addLayer({ id: 'ctx-road', type: 'line', source: 'ctx', filter: ['==', ['get', 't'], 'road'] as never, paint: { 'line-color': '#5c5c5c', 'line-width': 3, 'line-opacity': 0.6 } });
      map.addLayer({ id: 'ctx-entr', type: 'circle', source: 'ctx', filter: ['==', ['get', 't'], 'entrance'] as never, paint: { 'circle-radius': 5, 'circle-color': '#2c5a7a', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'ctx-cross', type: 'circle', source: 'ctx', filter: ['==', ['get', 't'], 'crossing'] as never, paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': '#222', 'circle-stroke-width': 2 } });
      // Существующие и планируемые растения — разные слои: сплошной кружок и полый.
      map.addSource('plants', { type: 'geojson', data: pointsGeoJson(d.plants.map((p) => ({ lng: p.lng, lat: p.lat, label: p.name }))) });
      map.addLayer({ id: 'plants-existing', type: 'circle', source: 'plants', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 3, 18, 7], 'circle-color': '#2f4f2a', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
      map.addSource('planned', { type: 'geojson', data: pointsGeoJson(d.planned) });
      map.addLayer({ id: 'plants-planned', type: 'circle', source: 'planned', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 3, 18, 7], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#7b8f1f', 'circle-stroke-width': 2 } });
      for (const layer of ['sites-fill', 'sites-dot']) {
        map.on('click', layer, (e: MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.id;
          if (id) onSelectRef.current(String(id));
        });
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }
    });
    return () => {
      clearTimeout(timeout);
      ready.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [view, reportService]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready.current || !m) return;
    (m.getSource('ctx') as GeoJSONSource | undefined)?.setData(contextGeoJson(context));
    (m.getSource('plants') as GeoJSONSource | undefined)?.setData(pointsGeoJson(plants.map((p) => ({ lng: p.lng, lat: p.lat, label: p.name }))));
    (m.getSource('planned') as GeoJSONSource | undefined)?.setData(pointsGeoJson(planned));
  }, [context, plants, planned]);

  // Обновление данных без пересоздания карты.
  useEffect(() => {
    const src = mapRef.current?.getSource('sites') as GeoJSONSource | undefined;
    if (ready.current && src) src.setData(toGeoJson(sites, eligibility, selectedId));
  }, [sites, eligibility, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    const s = sites.find((x) => x.id === selectedId);
    if (!map || !s || !focusSeq) return;
    map.fitBounds(siteBounds(s), { padding: 80, maxZoom: 17, pitch: pitched ? 50 : 0, duration: 800 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq]);

  const toggle3d = () => {
    const next = !pitched;
    setPitched(next);
    mapRef.current?.easeTo({ pitch: next ? 50 : 0, bearing: next ? -15 : 0, duration: 600 });
  };

  const showScheme = view === 'scheme' || !!failed;
  return (
    <div className="gp-map">
      <div className="gp-map__toolbar" role="toolbar" aria-label={t('map.title')}>
        <div className="gp-segment" role="radiogroup" aria-label="Вид">
          <label><input type="radio" name="mapview" checked={view === 'map' && !failed} disabled={!!failed} onChange={() => setView('map')} />{t('map.basemap')}</label>
          <label><input type="radio" name="mapview" checked={showScheme} onChange={() => setView('scheme')} />{t('map.scheme')}</label>
        </div>
        {!showScheme && (
          <button className="gp-btn gp-btn--secondary" onClick={toggle3d} aria-pressed={pitched} aria-label={t('map.toggle3d')}>
            {pitched ? t('map.3d') : t('map.2d')}
          </button>
        )}
      </div>
      {failed && (
        <div className="gp-alert gp-alert--warn gp-map__alert" role="status">
          <span aria-hidden="true">⚠ </span>{t('map.failed')} <span className="gp-small gp-muted">({failed})</span>
          {view === 'map' && <button className="gp-btn gp-btn--ghost" onClick={() => { setFailed(null); setView('scheme'); setTimeout(() => setView('map'), 0); }}>{t('state.retry')}</button>}
        </div>
      )}
      {showScheme ? (
        <SchemeView sites={sites} eligibility={eligibility} selectedId={selectedId} onSelect={onSelect} />
      ) : (
        <div ref={box} className="gp-map__canvas" aria-label={t('map.title')} />
      )}
    </div>
  );
}
