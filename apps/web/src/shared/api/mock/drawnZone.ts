// Нарисованная пользователем зона (SRV-02, контракт POST /zones). Окружение и факторы
// считаются по тем же правилам, что у зон из OSM (fixtures/osm/build-sites.mjs), но по данным,
// доступным в тестовом источнике: контуры зданий, улицы, насаждения OSM.
import surroundings from '../../../../../../fixtures/osm/surroundings.json';
import greenery from '../../../../../../fixtures/osm/greenery.json';
import type { CandidateSite, GeoJsonPolygon, MissingData } from '../types';
import { centroidXY, distPointLine, distShapes, makeProjection, pointInRing, ringAreaXY, type LngLat, type XY } from '../../geo';
import { soilFor } from '../../analytics/zone';

/** Демонстрационный район: тот же прямоугольник, что у загрузки OSM (fixtures/osm/fetch-osm.mjs). */
export const DISTRICT = { south: 52.268, west: 76.926, north: 52.3, east: 76.974 };
export const MIN_AREA_M2 = 50;

interface RawB { id: string; ring: LngLat[]; tags: Record<string, string> }
interface RawR { id: string; kind: string; name: string | null; line: LngLat[] }
const SB = surroundings as unknown as { buildings: RawB[]; roads: RawR[]; meta: { fetchedAt: string; osmBase?: string } };
const GF = greenery as unknown as { features: { properties: { kind: string }; geometry: { type: string; coordinates: unknown } }[] };

const SOCIAL: Record<string, string> = { school: 'школа', kindergarten: 'детсад', clinic: 'поликлиника', hospital: 'больница', college: 'колледж', university: 'вуз' };

export interface ZoneValidationError { field: string; message: string }

function segmentsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o = (p: XY, q: XY, r: XY) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Проверки из SRV-02: Polygon, замкнут, без самопересечений, внутри района, площадь > 50 м². */
export function validateDrawnPolygon(geometry: unknown): { ring: LngLat[]; errors: ZoneValidationError[] } {
  const errors: ZoneValidationError[] = [];
  const g = geometry as Partial<GeoJsonPolygon> | null;
  if (!g || g.type !== 'Polygon' || !Array.isArray(g.coordinates) || !Array.isArray(g.coordinates[0])) {
    return { ring: [], errors: [{ field: 'geometry', message: 'Нужен GeoJSON Polygon: {type: "Polygon", coordinates: [[[lng, lat], …]]}.' }] };
  }
  const ring = g.coordinates[0] as LngLat[];
  if (ring.some((p) => !Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
    return { ring, errors: [{ field: 'geometry', message: 'Координаты должны быть числами [lng, lat].' }] };
  }
  if (ring.length < 4) errors.push({ field: 'geometry', message: 'В контуре меньше трёх вершин.' });
  const [f, l] = [ring[0], ring.at(-1)!];
  if (f[0] !== l[0] || f[1] !== l[1]) errors.push({ field: 'geometry', message: 'Контур не замкнут: первая и последняя точки должны совпадать.' });
  if (ring.some(([lng, lat]) => Math.abs(lng) > 180 || Math.abs(lat) > 90)) errors.push({ field: 'geometry', message: 'Координаты вне градусов — нужен WGS 84 (EPSG:4326), порядок [lng, lat].' });
  else if (ring.some(([lng, lat]) => lat < DISTRICT.south || lat > DISTRICT.north || lng < DISTRICT.west || lng > DISTRICT.east)) {
    const swapped = ring.every(([lng, lat]) => lng >= DISTRICT.south && lng <= DISTRICT.north && lat >= DISTRICT.west && lat <= DISTRICT.east);
    errors.push({ field: 'geometry', message: swapped ? 'Похоже, перепутаны lat и lng: в GeoJSON порядок [lng, lat].' : 'Зона выходит за пределы демонстрационного района (центр Павлодара).' });
  }
  if (errors.length) return { ring, errors };
  const proj = makeProjection({ lat: ring[0][1], lng: ring[0][0] });
  const xy = ring.map(proj.toXY);
  const n = xy.length - 1;
  outer: for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // соседние через замыкание
      if (segmentsCross(xy[i], xy[i + 1], xy[j], xy[j + 1])) {
        errors.push({ field: 'geometry', message: `Контур самопересекается (стороны ${i + 1} и ${j + 1}).` });
        break outer;
      }
    }
  const area = ringAreaXY(xy);
  if (area <= MIN_AREA_M2) errors.push({ field: 'geometry', message: `Площадь ${area.toFixed(1)} м² — нужно больше ${MIN_AREA_M2} м².` });
  return { ring, errors };
}

/** Строит CandidateSite для нарисованной зоны. Неизвестное — null и missingData, не ноль. */
export function buildDrawnZone(id: string, name: string, ring: LngLat[], maxBuildings: number): CandidateSite {
  const proj0 = makeProjection({ lat: ring[0][1], lng: ring[0][0] });
  const c0 = centroidXY(ring.map(proj0.toXY));
  const [clng, clat] = proj0.toLngLat(c0);
  const c = { lat: +clat.toFixed(6), lng: +clng.toFixed(6) };
  const proj = makeProjection(c);
  const zone = ring.map(proj.toXY);
  const area = Math.round(ringAreaXY(zone));
  const near = (pts: LngLat[]) => pts.some(([lng, lat]) => Math.abs(lat - c.lat) < 0.006 && Math.abs(lng - c.lng) < 0.009);
  const centerDist = (pts: LngLat[]) => Math.hypot(...proj.toXY(pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]) as LngLat));

  // Здания и соцобъекты (по тегам OSM у контуров зданий).
  let bld200 = 0;
  const social: string[] = [];
  for (const b of SB.buildings) {
    if (!near(b.ring)) continue;
    const d = centerDist(b.ring);
    if (d <= 200) bld200++;
    const kind = SOCIAL[b.tags.amenity ?? ''];
    if (kind && d <= 400) social.push(`${kind}${b.tags['name:ru'] ?? b.tags.name ? ` «${b.tags['name:ru'] ?? b.tags.name}»` : ''}`);
  }
  // Дороги: ближайший проезд и ближайшая магистраль.
  let dRoad = Infinity;
  let dMajor = Infinity;
  let street: string | null = null;
  let dStreet = Infinity;
  for (const r of SB.roads) {
    if (!near(r.line)) continue;
    const d = distShapes(zone, r.line.map(proj.toXY), true, false);
    if (!/foot|path|pedestrian|cycle/.test(r.kind)) dRoad = Math.min(dRoad, d);
    if (/^(primary|secondary|tertiary)$/.test(r.kind)) dMajor = Math.min(dMajor, d);
    if (r.name && d < dStreet) { dStreet = d; street = r.name; }
  }
  // Насаждения OSM: расстояние до зелени, деревья рядом, доля зелени в 200 м.
  const greenRings: XY[][] = [];
  let dGreen = Infinity;
  let trees150 = 0;
  for (const ft of GF.features) {
    if (ft.geometry.type === 'Point') {
      const p = proj.toXY(ft.geometry.coordinates as LngLat);
      const d = Math.hypot(p[0], p[1]);
      if (d <= 150) trees150++;
      dGreen = Math.min(dGreen, distPointLine(p, zone));
    } else if (ft.geometry.type === 'Polygon') {
      const r = (ft.geometry.coordinates as LngLat[][])[0].map(proj.toXY);
      greenRings.push(r);
      dGreen = Math.min(dGreen, distShapes(zone, r));
    }
  }
  let inGreen = 0;
  let total = 0;
  for (let dx = -200; dx <= 200; dx += 10)
    for (let dy = -200; dy <= 200; dy += 10) {
      if (dx * dx + dy * dy > 40000) continue;
      total++;
      if (greenRings.some((g) => pointInRing([dx, dy], g))) inGreen++;
    }
  const greenShare = total ? Math.round((inGreen / total) * 1000) / 1000 : null;
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  const fin = (v: number) => (Number.isFinite(v) ? Math.round(v) : null);
  const greeneryGap = clamp((Math.min(Number.isFinite(dGreen) ? dGreen : 400, 400) / 400) * 70 + Math.max(0, 30 - trees150 * 3));
  const publicUse = clamp(Math.min(social.length, 4) * 15 + (bld200 / Math.max(1, maxBuildings)) * 25);
  const maintenance = Number.isFinite(dRoad) ? clamp((1 - Math.min(dRoad, 150) / 150) * 70 + (area >= 300 ? 30 : 15)) : null;
  const hints: string[] = [];
  if (Number.isFinite(dMajor) && dMajor < 40) hints.push(`Магистральная улица примерно в ${Math.round(dMajor)} м — вероятны соль, пыль и газ; нужны устойчивые виды.`);
  const soil = soilFor(c.lat, c.lng);
  const missingData: MissingData[] = [
    { field: 'factors.waterAvailability', reason: 'Нет открытых данных о воде для полива.' },
    { field: 'context.busStops300m', reason: 'Остановки в тестовом источнике не загружены — фактор значимости посчитан без них.' },
    { field: 'soil', reason: `Почва по синтетическому слою (${soil.type}, засоление: ${soil.salinity}) — нужен анализ или карта почв организатора.` },
    { field: 'checks', reason: 'Разрешение, сети, доступ и пригодность не проверены.' },
  ];
  if (maintenance === null) missingData.push({ field: 'factors.maintenanceFeasibility', reason: 'Рядом нет проездов в данных OSM.' });
  return {
    id,
    name: name || `Нарисованная зона${street ? `, ${street}` : ''}`,
    osmId: null,
    geometry: { type: 'Polygon', coordinates: [ring] },
    geometryAccuracy: 'Контур нарисован пользователем на карте; точность зависит от масштаба при рисовании.',
    areaM2: area,
    centroid: c,
    factors: {
      greeneryGap: { value: greeneryGap, evidenceIds: ['ev-osm-green', 'ev-team-formula'], method: `До ближайшей зелени OSM ≈${fin(dGreen) ?? '—'} м, деревьев OSM в 150 м: ${trees150}. Формула как у зон OSM.` },
      publicUsePriority: { value: publicUse, evidenceIds: ['ev-osm-context', 'ev-team-formula'], method: `Соцобъекты в 400 м: ${social.length}${social.length ? ` (${social.slice(0, 4).join(', ')})` : ''}; зданий в 200 м: ${bld200}. Остановки не учтены — нет данных.` },
      waterAvailability: { value: null, evidenceIds: [], method: 'Открытых данных о поливочном водопроводе, гидрантах и подвозе воды нет.' },
      maintenanceFeasibility: { value: maintenance, evidenceIds: maintenance === null ? [] : ['ev-osm-context', 'ev-team-formula'], method: maintenance === null ? 'Нет данных о проездах рядом.' : `До ближайшего проезда ≈${Math.round(dRoad)} м (по контурам улиц OSM), площадь ${area} м².` },
    },
    checks: {
      landPermission: { state: 'unknown', checkedBy: null, checkedAt: null, comment: null },
      utilities: { state: 'unknown', checkedBy: null, checkedAt: null, comment: null },
      access: { state: 'unknown', checkedBy: null, checkedAt: null, comment: null },
      siteSuitability: { state: 'unknown', checkedBy: null, checkedAt: null, comment: null },
    },
    context: {
      distanceToGreenM: fin(dGreen),
      osmTrees150m: trees150,
      socialWithin400m: social.slice(0, 8),
      busStops300m: null,
      nearestMajorRoadM: fin(dMajor),
      hints,
      buildings200m: bld200,
      greenShare200m: greenShare,
    },
    evidenceIds: ['ev-osm-surroundings', 'ev-osm-green', 'ev-team-formula'],
    missingData,
    isDemo: false,
    version: 1,
  };
}
