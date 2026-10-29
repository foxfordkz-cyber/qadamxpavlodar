// @ts-nocheck
// Team OSM snapshot; attribution preserved.
// Окружение участка (B19) для тестового источника: та же форма, что должен отдавать
// сервер участника 3 (GET /sites/:id/context?radius=). Данные — OSM, без догадок о назначении.
import { readFileSync } from 'node:fs';
const surroundings=JSON.parse(readFileSync(new URL('../../../fixtures/surroundings.json',import.meta.url),'utf8'));
import type { CandidateSite, EvidenceRef, SiteContext, SiteContextBuilding } from './types.js';
import { distPointLine, distShapes, makeProjection, type LngLat, type XY } from './geo.js';

interface RawB { id: string; ring: LngLat[]; tags: Record<string, string> }
interface RawR { id: string; kind: string; name: string | null; line: LngLat[] }
interface RawP { id: string; lng: number; lat: number; tags: Record<string, string> }
const S = surroundings as unknown as { buildings: RawB[]; roads: RawR[]; entrances: RawP[]; crossings: RawP[]; meta: { fetchedAt: string; osmBase?: string } };

export const contextEvidence: EvidenceRef = {
  id: 'ev-osm-surroundings',
  sourceType: 'municipal',
  sourceLabel: 'OpenStreetMap: контуры зданий, улицы, тротуары, входы, переходы',
  sourceUrl: 'https://www.openstreetmap.org/copyright',
  observedAt: S.meta.osmBase,
  dataClass: 'real',
  note: `Загружено ${S.meta.fetchedAt}. Адрес, название и назначение — только если они внесены в OSM. Входы нанесены выборочно.`,
};

// Назначение берём только из явных тегов OSM.
const PURPOSE: Record<string, string> = {
  school: 'школа', kindergarten: 'детский сад', clinic: 'поликлиника', hospital: 'больница', college: 'колледж', university: 'вуз',
  apartments: 'жилой дом (тег OSM)', residential: 'жилое здание (тег OSM)', house: 'частный дом (тег OSM)', commercial: 'коммерческое (тег OSM)',
  retail: 'торговое (тег OSM)', office: 'офисное (тег OSM)', garage: 'гараж (тег OSM)', garages: 'гаражи (тег OSM)', kiosk: 'киоск (тег OSM)',
  church: 'храм (тег OSM)', mosque: 'мечеть (тег OSM)', industrial: 'производственное (тег OSM)', public: 'общественное (тег OSM)',
};
function purposeOf(t: Record<string, string>): string | null {
  if (t.amenity) return PURPOSE[t.amenity] ?? `amenity=${t.amenity}`;
  if (t.shop) return `магазин (shop=${t.shop})`;
  if (t.office) return `офис (office=${t.office})`;
  if (t.building && t.building !== 'yes') return PURPOSE[t.building] ?? `building=${t.building}`;
  return null; // building=yes — назначение неизвестно
}

export function siteContext(site: CandidateSite, radiusM: number): SiteContext {
  const c = site.centroid!;
  const proj = makeProjection(c);
  const ring: XY[] = site.geometry.type === 'Polygon' ? site.geometry.coordinates[0].map(proj.toXY) : [proj.toXY(site.geometry.coordinates)];
  const quick = (pts: LngLat[]) => pts.some(([lng, lat]) => Math.abs(lat - c.lat) < 0.006 && Math.abs(lng - c.lng) < 0.009);
  const round = (d: number) => Math.round(d * 10) / 10;

  const buildings: SiteContextBuilding[] = [];
  for (const b of S.buildings) {
    if (!quick(b.ring)) continue;
    const d = distShapes(ring, b.ring.map(proj.toXY));
    if (d > radiusM) continue;
    const t = b.tags;
    const street = t['addr:street'];
    const num = t['addr:housenumber'];
    buildings.push({
      id: b.id,
      name: t['name:ru'] ?? t.name ?? null,
      address: street && num ? `${street}, ${num}` : num ? `дом ${num}` : null,
      purpose: purposeOf(t),
      levels: t['building:levels'] ? Number(t['building:levels']) || null : null,
      distanceM: round(d),
      geometry: { type: 'Polygon', coordinates: [b.ring] },
    });
  }
  const roads = S.roads
    .filter((r) => quick(r.line))
    .map((r) => ({ r, d: distShapes(ring, r.line.map(proj.toXY), true, false) }))
    .filter((x) => x.d <= radiusM)
    .map(({ r, d }) => ({ id: r.id, kind: r.kind, name: r.name, distanceM: round(d), geometry: { type: 'LineString' as const, coordinates: r.line } }));
  const points = (list: RawP[], kind: 'entrance' | 'crossing') =>
    list
      .map((p) => ({ p, d: distPointLine(proj.toXY([p.lng, p.lat]), ring) }))
      .filter((x) => x.d <= radiusM)
      .map(({ p, d }) => ({
        id: p.id,
        kind,
        label: kind === 'entrance' ? [p.tags.ref && `подъезд ${p.tags.ref}`, p.tags['addr:flats'] && `кв. ${p.tags['addr:flats']}`, p.tags.entrance !== 'yes' && p.tags.entrance].filter(Boolean).join(', ') || null : p.tags.crossing ?? null,
        distanceM: round(d),
        lat: p.lat,
        lng: p.lng,
      }));

  return {
    siteId: site.id,
    radiusM,
    distanceMethod: 'Кратчайшее расстояние между контуром участка и контуром объекта по данным OSM, на плоскости. Это не обмер на месте.',
    buildings: buildings.sort((a, b) => a.distanceM - b.distanceM),
    roads: roads.sort((a, b) => a.distanceM - b.distanceM),
    entrances: points(S.entrances, 'entrance').sort((a, b) => a.distanceM - b.distanceM),
    crossings: points(S.crossings, 'crossing').sort((a, b) => a.distanceM - b.distanceM),
    evidenceIds: [contextEvidence.id],
    fetchedAt: S.meta.fetchedAt,
    osmBase: S.meta.osmBase ?? null,
  };
}
