import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AttributionControl, Map as MlMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CandidateSite, Plant, SiteContext, SiteRankItem } from '../../../shared/api/types';
import { useData } from '../../../shared/api/DataProvider';
import { t } from '../../../shared/i18n';
import { CENTER, siteBounds, siteCenter } from './geo';
import { SchemeView } from './SchemeView';
import { mapBroken } from './mapFlags';
import { mapView } from './mapView';
import type { GrowthFrame } from '../zone/timeMachine';
import type { SceneInput } from '../projects/scene3d';

// Векторная подложка OpenFreeMap (OSM). Без ключа; атрибуция обязательна — её задаёт сам стиль
// («OpenFreeMap © OpenMapTiles Data from OpenStreetMap»), контрол показывает её всегда развёрнутой.
// Массовое скачивание тайлов для офлайн-показа не делаем — резерв это SchemeView.
// По умолчанию светлая приглушённая подложка: на ней слои ТЗ (почвы, проблемы, приоритет) не сливаются с дорогами.
const STYLES = { light: 'https://tiles.openfreemap.org/styles/positron', color: 'https://tiles.openfreemap.org/styles/liberty' } as const;
type Basemap = keyof typeof STYLES;
const BASEMAP_KEY = 'gp-basemap';
function readBasemap(): Basemap {
  try {
    const v = localStorage.getItem(BASEMAP_KEY);
    if (v === 'light' || v === 'color') return v;
  } catch {
    /* без хранилища — светлая */
  }
  return 'light';
}

/** У светлой подложки нет объёмных зданий — добавляем их из того же источника OpenMapTiles, под подписями. */
function add3dBuildings(map: MlMap) {
  const layers = map.getStyle().layers;
  if (layers.some((l) => l.type === 'fill-extrusion') || !map.getSource('openmaptiles')) return;
  map.addLayer({
    id: 'building-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14, filter: ['!', ['has', 'hide_3d']] as never,
    paint: { 'fill-extrusion-base': ['get', 'render_min_height'] as never, 'fill-extrusion-height': ['get', 'render_height'] as never, 'fill-extrusion-color': '#d7dbe0', 'fill-extrusion-opacity': 0.8 },
  }, layers.find((l) => l.type === 'symbol')?.id);
}

/** На телефоне карточка зоны — шторка снизу: зона должна оказаться над ней, а не под ней. */
function fitPadding(m: MlMap, p: number) {
  const sheet = document.querySelector('.gp-sites--card .gp-sites__card');
  if (!sheet || !matchMedia('(max-width: 760px)').matches) return p;
  const box = m.getContainer().getBoundingClientRect();
  const hidden = box.bottom - sheet.getBoundingClientRect().top;
  return hidden > 0 && hidden < box.height - 80 ? { top: p / 2, left: p / 3, right: p / 3, bottom: hidden + p / 3 } : p;
}

/** Цвет подсветки «зоны из ответа»: не совпадает с цветами статусов, проблем и приоритета. */
const HL_COLOR = '#6b3fa0';

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
  /** ТЗ 3.1.3: слои почв и существующей зелени (GeoJSON, [lng, lat]). */
  soils?: { type: 'FeatureCollection'; features: unknown[] } | null;
  greenery?: { type: 'FeatureCollection'; features: unknown[] } | null;
  /** Окраска зон по проблемам или приоритету: id → цвет. */
  zoneTint?: Record<string, string> | null;
  /** ТЗ 3.1.4: рисование зоны — углы контура [lng, lat]; null — рисование выключено. */
  drawPoints?: [number, number][] | null;
  onDrawPoint?: (p: [number, number]) => void;
  /** Найденное место (поиск по адресу): метка и перелёт; seq меняется при каждом выборе. */
  target?: { lng: number; lat: number; bbox?: [number, number, number, number]; label: string; seq: number } | null;
  /** Поиск и кнопка рисования — в панели инструментов карты. */
  toolbarExtra?: ReactNode;
  /** Зоны из ответа ассистента или дорожной карты: номер очереди и обводка; seq меняется — карта показывает их все. */
  highlight?: { ids: string[]; seq: number } | null;
  /** Машина времени: посадка выбранной зоны в 3D (three.js) на указанный год. */
  growth?: GrowthFrame | null;
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
/** Рисуемый контур: заливка с трёх углов, линия, углы (первый — крупнее, по нему видно начало). */
function drawGeoJson(pts: [number, number][] | null | undefined) {
  if (!pts?.length) return EMPTY;
  const ring = pts.length >= 3 ? [...pts, pts[0]!] : pts;
  return {
    type: 'FeatureCollection' as const,
    features: [
      ...(pts.length >= 3 ? [{ type: 'Feature' as const, properties: { t: 'poly' }, geometry: { type: 'Polygon' as const, coordinates: [ring] } }] : []),
      ...(pts.length >= 2 ? [{ type: 'Feature' as const, properties: { t: 'line' }, geometry: { type: 'LineString' as const, coordinates: ring } }] : []),
      ...pts.map((p, i) => ({ type: 'Feature' as const, properties: { t: 'vertex', first: i === 0 ? 1 : 0 }, geometry: { type: 'Point' as const, coordinates: p } })),
    ],
  };
}
const pinGeoJson = (target: Props['target']) => (target ? pointsGeoJson([{ lng: target.lng, lat: target.lat, label: target.label }]) : EMPTY);
const pointsGeoJson = (pts: { lng: number; lat: number; label: string }[]) => ({
  type: 'FeatureCollection' as const,
  features: pts.map((p) => ({ type: 'Feature' as const, properties: { label: p.label }, geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] } })),
});

function toGeoJson(sites: CandidateSite[], eligibility: Props['eligibility'], selectedId: string | null, tint?: Record<string, string> | null, highlight?: Props['highlight']) {
  const rank = new Map((highlight?.ids ?? []).map((id, i) => [id, i + 1]));
  return {
    type: 'FeatureCollection' as const,
    features: sites.flatMap((s) => {
      const props = { id: s.id, elig: eligibility(s), selected: s.id === selectedId ? 1 : 0, name: s.name, ...(tint?.[s.id] ? { tint: tint[s.id] } : {}), ...(rank.has(s.id) ? { rank: rank.get(s.id) } : {}) };
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

export function SiteMap({ sites, eligibility, selectedId, onSelect, focusSeq, context, plants = [], planned = [], soils = null, greenery = null, zoneTint = null, drawPoints = null, onDrawPoint, target = null, toolbarExtra, highlight = null, growth = null }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const { reportService } = useData();
  const [failed, setFailed] = useState<string | null>(null);
  const [view, setView] = useState<'map' | 'scheme'>('map');
  const [pitched, setPitched] = useState(true);
  const [basemap, setBasemapState] = useState<Basemap>(readBasemap);
  const setBasemap = (b: Basemap) => {
    setBasemapState(b);
    try {
      localStorage.setItem(BASEMAP_KEY, b);
    } catch {
      /* не сохраняется — не страшно */
    }
  };
  // Камера переживает смену подложки (карта пересоздаётся со своим стилем).
  const camera = useRef({ center: CENTER, zoom: 14.2, pitch: 50, bearing: -15 });
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onDrawRef = useRef(onDrawPoint);
  onDrawRef.current = onDrawPoint;
  const dataRef = useRef({ sites, eligibility, selectedId, context, plants, planned, soils, greenery, zoneTint, drawPoints, target, highlight });
  dataRef.current = { sites, eligibility, selectedId, context, plants, planned, soils, greenery, zoneTint, drawPoints, target, highlight };

  useEffect(() => {
    if (!box.current || view !== 'map') return;
    let map: MlMap;
    try {
      map = new MlMap({
        container: box.current,
        style: mapBroken.value ? 'https://invalid.localhost/style.json' : STYLES[basemap],
        ...camera.current,
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
    map.on('moveend', () => {
      const c = map.getCenter();
      mapView.center = { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) };
      camera.current = { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    });
    map.on('load', () => {
      ready.current = true;
      clearTimeout(timeout);
      reportService('map', 'ok');
      add3dBuildings(map);
      map.addImage('hatch-blocked', hatchImage('#b3261e'));
      const { sites, eligibility, selectedId } = dataRef.current;
      const empty = { type: 'FeatureCollection' as const, features: [] };
      // Подложки ТЗ: почвы (синтетика) и существующая зелень — ниже зон.
      map.addSource('soils', { type: 'geojson', data: (dataRef.current.soils ?? empty) as never });
      map.addLayer({ id: 'soils-fill', type: 'fill', source: 'soils', paint: { 'fill-color': ['match', ['get', 'salinity'], 'high', '#b8734a', 'medium', '#d6a463', 'low', '#e6d29a', '#cfdcae'] as never, 'fill-opacity': 0.42 } });
      map.addLayer({ id: 'soils-line', type: 'line', source: 'soils', paint: { 'line-color': '#9a8460', 'line-width': 0.6, 'line-dasharray': [2, 2] } });
      map.addSource('greenery', { type: 'geojson', data: (dataRef.current.greenery ?? empty) as never });
      map.addLayer({ id: 'greenery-fill', type: 'fill', source: 'greenery', filter: ['==', ['geometry-type'], 'Polygon'] as never, paint: { 'fill-color': '#3f8a3a', 'fill-opacity': 0.45 } });
      map.addLayer({ id: 'greenery-line', type: 'line', source: 'greenery', filter: ['==', ['geometry-type'], 'LineString'] as never, paint: { 'line-color': '#2f6e2a', 'line-width': 3 } });
      map.addLayer({ id: 'greenery-tree', type: 'circle', source: 'greenery', filter: ['==', ['geometry-type'], 'Point'] as never, paint: { 'circle-radius': 4, 'circle-color': '#2f6e2a', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
      map.addSource('sites', { type: 'geojson', data: toGeoJson(sites, eligibility, selectedId, dataRef.current.zoneTint, dataRef.current.highlight) });
      const color = ['match', ['get', 'elig'], 'blocked', '#b3261e', 'planting_candidate', '#2f7a3e', '#d89a1c'] as never;
      const isPoly = ['!=', ['get', 'centroid'], 1] as never;
      map.addLayer({ id: 'sites-fill', type: 'fill', source: 'sites', filter: isPoly, paint: { 'fill-color': color, 'fill-opacity': ['case', ['==', ['get', 'selected'], 1], 0.45, 0.28] } });
      map.addLayer({ id: 'sites-tint', type: 'fill', source: 'sites', filter: ['all', isPoly, ['has', 'tint']] as never, paint: { 'fill-color': ['get', 'tint'] as never, 'fill-opacity': 0.75 } });
      map.addLayer({ id: 'sites-hatch', type: 'fill', source: 'sites', filter: ['all', isPoly, ['==', ['get', 'elig'], 'blocked']] as never, paint: { 'fill-pattern': 'hatch-blocked' } });
      // Стиль линии кодирует состояние независимо от цвета: пунктир — нужна проверка, сплошная — завершены.
      map.addLayer({ id: 'sites-line-dash', type: 'line', source: 'sites', filter: ['all', isPoly, ['==', ['get', 'elig'], 'survey_needed']] as never, paint: { 'line-color': '#8a5a00', 'line-width': 2, 'line-dasharray': [2, 1.5] } });
      map.addLayer({ id: 'sites-line-solid', type: 'line', source: 'sites', filter: ['all', isPoly, ['!=', ['get', 'elig'], 'survey_needed']] as never, paint: { 'line-color': color, 'line-width': 2.5 } });
      map.addLayer({ id: 'sites-selected', type: 'line', source: 'sites', filter: ['all', isPoly, ['==', ['get', 'selected'], 1]] as never, paint: { 'line-color': '#1f5d99', 'line-width': 4 } });
      map.addLayer({ id: 'sites-hl-line', type: 'line', source: 'sites', filter: ['all', isPoly, ['has', 'rank']] as never, paint: { 'line-color': HL_COLOR, 'line-width': 3.5 } });
      // Точки-центры видны на мелком масштабе, где полигоны слишком малы.
      // Окраска слоя «Приоритет» или «Проблемы» видна и на точках, иначе на мелком масштабе её не разглядеть.
      map.addLayer({ id: 'sites-dot', type: 'circle', source: 'sites', filter: ['==', ['get', 'centroid'], 1] as never, maxzoom: 15.5, paint: { 'circle-radius': ['case', ['==', ['get', 'selected'], 1], 8, ['has', 'tint'], 6, 5] as never, 'circle-color': ['case', ['has', 'tint'], ['get', 'tint'], color] as never, 'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], '#1f5d99', '#ffffff'], 'circle-stroke-width': 2, 'circle-opacity': 0.9 } });
      // Подпись только у выбранного участка — без десятков наложенных надписей.
      map.addLayer({ id: 'sites-label', type: 'symbol', source: 'sites', filter: ['all', ['==', ['get', 'centroid'], 1], ['==', ['get', 'selected'], 1]] as never, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-max-width': 14 }, paint: { 'text-color': '#0f2f4f', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
      // Номер очереди на центре зоны — виден на любом масштабе, поверх подписей.
      const isRanked = ['all', ['==', ['get', 'centroid'], 1], ['has', 'rank']] as never;
      map.addLayer({ id: 'sites-hl-badge', type: 'circle', source: 'sites', filter: isRanked, paint: { 'circle-radius': 11, 'circle-color': HL_COLOR, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'sites-hl-num', type: 'symbol', source: 'sites', filter: isRanked, layout: { 'text-field': ['to-string', ['get', 'rank']] as never, 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#ffffff' } });
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
      // Найденное по адресу место и рисуемый контур — поверх всех слоёв.
      map.addSource('pin', { type: 'geojson', data: pinGeoJson(d.target) });
      map.addLayer({ id: 'pin-halo', type: 'circle', source: 'pin', paint: { 'circle-radius': 14, 'circle-color': '#1f5d99', 'circle-opacity': 0.18 } });
      map.addLayer({ id: 'pin-dot', type: 'circle', source: 'pin', paint: { 'circle-radius': 6, 'circle-color': '#1f5d99', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'pin-label', type: 'symbol', source: 'pin', layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-max-width': 16 }, paint: { 'text-color': '#0f2f4f', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
      map.addSource('draw', { type: 'geojson', data: drawGeoJson(d.drawPoints) });
      map.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw', filter: ['==', ['get', 't'], 'poly'] as never, paint: { 'fill-color': '#1f5d99', 'fill-opacity': 0.18 } });
      map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', filter: ['==', ['get', 't'], 'line'] as never, paint: { 'line-color': '#1f5d99', 'line-width': 3, 'line-dasharray': [2, 1] } });
      map.addLayer({ id: 'draw-vertex', type: 'circle', source: 'draw', filter: ['==', ['get', 't'], 'vertex'] as never, paint: { 'circle-radius': ['case', ['==', ['get', 'first'], 1], 7, 5] as never, 'circle-color': '#fff', 'circle-stroke-color': '#1f5d99', 'circle-stroke-width': 2.5 } });
      // В режиме рисования клик ставит угол контура, а не открывает зону.
      map.on('click', (e) => { if (dataRef.current.drawPoints) onDrawRef.current?.([+e.lngLat.lng.toFixed(7), +e.lngLat.lat.toFixed(7)]); });
      for (const layer of ['sites-fill', 'sites-dot', 'sites-hl-badge']) {
        map.on('click', layer, (e: MapLayerMouseEvent) => {
          if (dataRef.current.drawPoints) return;
          const id = e.features?.[0]?.properties?.id;
          if (id) onSelectRef.current(String(id));
        });
        map.on('mouseenter', layer, () => { if (!dataRef.current.drawPoints) map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { if (!dataRef.current.drawPoints) map.getCanvas().style.cursor = ''; });
      }
      focusRef.current();
      highlightRef.current();
      planting.current = null;
      void syncGrowth.current();
    });
    return () => {
      clearTimeout(timeout);
      ready.current = false;
      planting.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [view, basemap, reportService]);

  // Машина времени: three.js-слой из редактора проектов (scene3d), грузится только когда нужен.
  // Первое включение — камера наклоняется к зоне; смена года пересобирает модели без пересоздания слоя.
  const growthRef = useRef(growth);
  growthRef.current = growth;
  const planting = useRef<{ update: (input: SceneInput) => void } | null>(null);
  const syncGrowth = useRef(async () => {});
  syncGrowth.current = async () => {
    const m = mapRef.current;
    const g = growthRef.current;
    if (!m || !ready.current) return;
    if (!g) {
      if (m.getLayer('planting-3d')) m.removeLayer('planting-3d');
      planting.current = null;
      return;
    }
    const input = { origin: g.origin, siteRing: g.ring, items: g.items, species: g.species, stage: g.k };
    if (planting.current && m.getLayer('planting-3d')) { planting.current.update(input); return; }
    const { createPlantingLayer } = await import('../projects/scene3d');
    const now = growthRef.current;
    if (mapRef.current !== m || !now || m.getLayer('planting-3d')) return;
    try {
      const pl = createPlantingLayer({ origin: now.origin, siteRing: now.ring, items: now.items, species: now.species, stage: now.k });
      m.addLayer(pl.layer);
      planting.current = pl;
    } catch {
      return; // без WebGL-контекста для three.js — цифры машины времени остаются в карточке
    }
    if (now.ring) {
      const xs = now.ring.map((p) => p[0]);
      const ys = now.ring.map((p) => p[1]);
      m.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: fitPadding(m, 70), maxZoom: 18.5, pitch: 60, duration: 1400 });
    }
  };
  useEffect(() => { void syncGrowth.current(); }, [growth]);

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
    if (ready.current && src) src.setData(toGeoJson(sites, eligibility, selectedId, zoneTint, highlight));
  }, [sites, eligibility, selectedId, zoneTint, highlight]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready.current || !m) return;
    const empty = { type: 'FeatureCollection' as const, features: [] };
    (m.getSource('soils') as GeoJSONSource | undefined)?.setData((soils ?? empty) as never);
    (m.getSource('greenery') as GeoJSONSource | undefined)?.setData((greenery ?? empty) as never);
  }, [soils, greenery]);

  // Рисование: контур, курсор-крестик; двойной клик не приближает карту, пока ставим углы.
  const drawing = drawPoints !== null;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready.current || !m) return;
    (m.getSource('draw') as GeoJSONSource | undefined)?.setData(drawGeoJson(drawPoints));
    m.getCanvas().style.cursor = drawing ? 'crosshair' : '';
    if (drawing) m.doubleClickZoom.disable(); else m.doubleClickZoom.enable();
  }, [drawPoints, drawing]);

  // Найденное по адресу место: метка и перелёт (улица — по её габаритам, дом и место — крупно).
  useEffect(() => {
    const m = mapRef.current;
    if (!ready.current || !m) return;
    (m.getSource('pin') as GeoJSONSource | undefined)?.setData(pinGeoJson(target));
    if (!target) return;
    if (target.bbox) m.fitBounds([[target.bbox[0], target.bbox[1]], [target.bbox[2], target.bbox[3]]], { padding: 60, maxZoom: 16.5, duration: 1200 });
    else m.flyTo({ center: [target.lng, target.lat], zoom: 17, duration: 1200 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.seq]);

  // Перелёт к выбранной зоне (из списка, по ссылке ассистента, со страниц «Проблемы» и «Приоритеты»).
  // Если карта или участки ещё грузятся — перелёт выполнится, когда они будут готовы, один раз на focusSeq.
  const focusDone = useRef(0);
  const focusRef = useRef(() => {});
  focusRef.current = () => {
    const map = mapRef.current;
    const s = sites.find((x) => x.id === selectedId);
    if (!map || !ready.current || !s || !focusSeq || focusDone.current === focusSeq) return;
    focusDone.current = focusSeq;
    map.fitBounds(siteBounds(s), { padding: fitPadding(map, 80), maxZoom: 17, pitch: pitched ? 50 : 0, duration: 1200 });
  };
  useEffect(() => focusRef.current(), [focusSeq, sites, selectedId]);

  // Подсвеченные зоны показываются все сразу, один раз на highlight.seq (как перелёт к выбранной зоне).
  const highlightDone = useRef(0);
  const highlightRef = useRef(() => {});
  highlightRef.current = () => {
    const map = mapRef.current;
    const list = sites.filter((s) => highlight?.ids.includes(s.id));
    if (!map || !ready.current || !highlight?.seq || !list.length || highlightDone.current === highlight.seq) return;
    highlightDone.current = highlight.seq;
    const b = list.map(siteBounds);
    const bounds: [[number, number], [number, number]] = [[Math.min(...b.map((x) => x[0][0])), Math.min(...b.map((x) => x[0][1]))], [Math.max(...b.map((x) => x[1][0])), Math.max(...b.map((x) => x[1][1]))]];
    map.fitBounds(bounds, { padding: 90, maxZoom: 16, pitch: pitched ? 45 : 0, duration: 1200 });
  };
  useEffect(() => highlightRef.current(), [highlight?.seq, sites]);

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
        {!showScheme && (
          <div className="gp-segment" role="radiogroup" aria-label={t('map.base.label')}>
            <label title={t('map.base.lightHint')}><input type="radio" name="basemap" checked={basemap === 'light'} onChange={() => setBasemap('light')} />{t('map.base.light')}</label>
            <label title={t('map.base.colorHint')}><input type="radio" name="basemap" checked={basemap === 'color'} onChange={() => setBasemap('color')} />{t('map.base.color')}</label>
          </div>
        )}
        {!showScheme && toolbarExtra}
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
