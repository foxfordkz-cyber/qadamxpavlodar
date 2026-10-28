import type { CandidateSite } from '../../../shared/api/types';

// Демонстрационный район (fixtures/osm/fetch-osm.mjs), с запасом. Используется для
// проверки, что lat/lng не перепутаны: Павлодар ≈ 52.3° с.ш., 76.9° в.д.
export const AREA = { south: 52.26, west: 76.91, north: 52.31, east: 76.99 };
export const CENTER: [number, number] = [76.95, 52.284]; // [lng, lat] для MapLibre

export function inArea(lat: number, lng: number) {
  return lat >= AREA.south && lat <= AREA.north && lng >= AREA.west && lng <= AREA.east;
}

/** Проверка геометрии: GeoJSON строго [lng, lat]. Возвращает описание проблемы или null. */
export function validateSiteGeometry(s: CandidateSite): string | null {
  const pts = s.geometry.type === 'Polygon' ? s.geometry.coordinates.flat() : [s.geometry.coordinates];
  for (const [lng, lat] of pts) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'нечисловые координаты';
    if (!inArea(lat, lng)) return inArea(lng, lat) ? 'похоже, перепутаны lat и lng' : 'точка вне демонстрационного района';
  }
  return null;
}

export function siteCenter(s: CandidateSite): { lat: number; lng: number } {
  if (s.centroid) return s.centroid;
  if (s.geometry.type === 'Point') return { lng: s.geometry.coordinates[0], lat: s.geometry.coordinates[1] };
  const ring = s.geometry.coordinates[0];
  const n = ring.length - 1 || 1;
  return { lng: ring.slice(0, n).reduce((a, p) => a + p[0], 0) / n, lat: ring.slice(0, n).reduce((a, p) => a + p[1], 0) / n };
}

export function siteBounds(s: CandidateSite): [[number, number], [number, number]] {
  const pts = s.geometry.type === 'Polygon' ? s.geometry.coordinates[0] : [s.geometry.coordinates];
  const lngs = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x = rad(b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2));
  const y = rad(b.lat - a.lat);
  return Math.sqrt(x * x + y * y) * 6371008.8;
}
