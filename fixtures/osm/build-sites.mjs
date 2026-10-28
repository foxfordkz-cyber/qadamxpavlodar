// Строит кандидатов в участки озеленения из сырых данных OSM (fetch-osm.mjs).
// Запуск: node fixtures/osm/build-sites.mjs
// Результат: fixtures/osm/sites.json — CandidateSite[] по контракту v1 + EvidenceRef[].
//
// ВАЖНО: OSM-газон или пустырь — это кандидат, а не «свободный участок».
// Разрешение, коммуникации, доступ и пригодность остаются unknown до проверки человеком.
// Формулы факторов — демонстрационная политика команды, не утверждённая методика.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const load = async (n) => JSON.parse(await readFile(join(here, `${n}.json`), 'utf8'));

const raw = await load('raw-candidates');
const green = await load('raw-green');
const ctx = await load('raw-context');

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
function distM(a, b) {
  const x = rad(b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2));
  const y = rad(b.lat - a.lat);
  return Math.sqrt(x * x + y * y) * R;
}
// Площадь кольца [lng,lat] в м², локальная равнопромежуточная проекция (участки малы).
function ringAreaM2(ring) {
  const lat0 = rad(ring[0][1]);
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = [rad(ring[i][0]) * Math.cos(lat0) * R, rad(ring[i][1]) * R];
    const [x2, y2] = [rad(ring[i + 1][0]) * Math.cos(lat0) * R, rad(ring[i + 1][1]) * R];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
function centroid(ring) {
  let lat = 0, lng = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) { lng += ring[i][0]; lat += ring[i][1]; }
  return { lat: lat / n, lng: lng / n };
}
function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p.lat) !== (yj > p.lat) && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const ringOf = (el) => (el.geometry ?? []).map((g) => [+g.lon.toFixed(6), +g.lat.toFixed(6)]);
const closed = (r) => r.length > 3 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1];
const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

// Зелёные зоны (парки, скверы, лес, рядовые посадки) — для дефицита озеленения.
const greenRings = green.elements.filter((e) => e.type === 'way').map(ringOf).filter((r) => r.length > 1);
const greenClosed = green.elements.filter((e) => e.type === 'way' && /park|garden|forest|wood/.test(`${e.tags?.leisure ?? ''}${e.tags?.landuse ?? ''}${e.tags?.natural ?? ''}`)).map(ringOf).filter(closed);
const greenPts = greenRings.flatMap((r) => r.map(([lng, lat]) => ({ lat, lng })));
const treePts = ctx.elements.filter((e) => e.type === 'node' && e.tags?.natural === 'tree').map((e) => ({ lat: e.lat, lng: e.lon }));
const centerOf = (e) => (e.type === 'node' ? { lat: e.lat, lng: e.lon } : e.center ? { lat: e.center.lat, lng: e.center.lon } : null);
const social = ctx.elements.filter((e) => /^(school|kindergarten|clinic|hospital|college|university)$/.test(e.tags?.amenity ?? ''))
  .map((e) => ({ p: centerOf(e), kind: e.tags.amenity, name: e.tags['name:ru'] ?? e.tags.name ?? null })).filter((s) => s.p);
const stops = ctx.elements.filter((e) => e.tags?.highway === 'bus_stop').map(centerOf);
const buildings = ctx.elements.filter((e) => e.tags?.building).map(centerOf).filter(Boolean);
const roads = ctx.elements.filter((e) => e.tags?.highway && e.type === 'way').map((e) => ({ p: centerOf(e), name: e.tags['name:ru'] ?? e.tags.name ?? null, kind: e.tags.highway })).filter((r) => r.p);
const majorRoads = roads.filter((r) => /^(primary|secondary|tertiary)$/.test(r.kind));
const lines = ctx.elements.filter((e) => e.tags?.power === 'line' || e.tags?.man_made === 'pipeline').map(centerOf).filter(Boolean);

const fetchedAt = ctx.fetchedAt;
const osmBase = ctx.osm3s?.timestamp_osm_base;
const evidence = [
  {
    id: 'ev-osm-landuse',
    sourceType: 'municipal',
    sourceLabel: 'OpenStreetMap: landuse=grass / natural=grassland (контуры участков)',
    sourceUrl: 'https://www.openstreetmap.org/copyright',
    observedAt: raw.osm3s?.timestamp_osm_base,
    dataClass: 'real',
    note: `Контур из OSM (ODbL). Загружено ${raw.fetchedAt}. OSM не является официальным земельным реестром: отметка «газон» не означает, что участок свободен.`,
  },
  {
    id: 'ev-osm-green',
    sourceType: 'municipal',
    sourceLabel: 'OpenStreetMap: парки, скверы, лес, деревья',
    sourceUrl: 'https://www.openstreetmap.org/copyright',
    observedAt: osmBase,
    dataClass: 'real',
    note: `Загружено ${green.fetchedAt}. Деревья в OSM нанесены неполно; отсутствие точки не доказывает отсутствие дерева.`,
  },
  {
    id: 'ev-osm-context',
    sourceType: 'municipal',
    sourceLabel: 'OpenStreetMap: школы, детсады, поликлиники, остановки, здания, улицы',
    sourceUrl: 'https://www.openstreetmap.org/copyright',
    observedAt: osmBase,
    dataClass: 'real',
    note: `Загружено ${fetchedAt}. Используются центры объектов, а не точные контуры.`,
  },
  {
    id: 'ev-team-formula',
    sourceType: 'manual',
    sourceLabel: 'Формулы факторов команды Green Pavlodar (демонстрационная политика)',
    dataClass: 'estimate',
    note: 'Пороговые расстояния и нормировки выбраны командой для демонстрации, научно не утверждены.',
  },
];

const candidates = [];
for (const el of raw.elements) {
  if (el.type !== 'way') continue;
  const ring = ringOf(el);
  if (!closed(ring)) continue;
  const area = ringAreaM2(ring);
  if (area < 150 || area > 25000) continue; // слишком мелкие полосы и крупные массивы не берём
  const c = centroid(ring);
  if (!pointInRing(c, ring)) continue; // сильно вогнутые контуры: центр вне участка
  // Газон внутри существующего парка — уже озеленённая территория, не кандидат.
  const insidePark = green.elements.some((g) => g.type === 'way' && /park|garden/.test(g.tags?.leisure ?? '') && closed(ringOf(g)) && pointInRing(c, ringOf(g)));
  if (insidePark) continue;
  candidates.push({ el, ring, area, c });
}

const near = (pts, c, r) => pts.filter((p) => distM(p, c) <= r).length;
const nearest = (pts, c) => pts.reduce((m, p) => Math.min(m, distM(p, c)), Infinity);

const raw_ = candidates.map(({ el, ring, area, c }) => {
  const dGreen = nearest(greenPts, c);
  const trees150 = near(treePts, c, 150);
  const social400 = social.filter((s) => distM(s.p, c) <= 400);
  const stops300 = near(stops, c, 300);
  const bld200 = near(buildings, c, 200);
  const dRoad = nearest(roads.map((r) => r.p), c);
  const dMajor = nearest(majorRoads.map((r) => r.p), c);
  const namedRoad = roads.filter((r) => r.name).sort((a, b) => distM(a.p, c) - distM(b.p, c))[0];
  const dLine = nearest(lines, c);
  // Доля зелени (парки, скверы, лес OSM) в круге 200 м: выборка точек сетки 10 м.
  let inGreen = 0, total = 0;
  const kLat = 1 / 111320, kLng = 1 / (111320 * Math.cos(rad(c.lat)));
  for (let dx = -200; dx <= 200; dx += 10)
    for (let dy = -200; dy <= 200; dy += 10) {
      if (dx * dx + dy * dy > 40000) continue;
      total++;
      const p = { lat: c.lat + dy * kLat, lng: c.lng + dx * kLng };
      if (greenClosed.some((g) => pointInRing(p, g))) inGreen++;
    }
  const greenShare = total ? inGreen / total : 0;
  return { el, ring, area, c, dGreen, trees150, social400, stops300, bld200, dRoad, dMajor, namedRoad, dLine, greenShare };
});
const maxBld = Math.max(1, ...raw_.map((r) => r.bld200));

const sites = raw_.map((r, i) => {
  const id = `site-osm-${r.el.id}`;
  const street = r.namedRoad?.name ?? null;
  const kindLabel = r.el.tags.landuse === 'grass' ? 'Газон' : 'Травяной участок';
  const name = `${kindLabel} ${street ? `у ${street}` : `№${i + 1}`}`;
  // Дефицит озеленения: чем дальше ближайшая зелёная зона и меньше деревьев рядом, тем выше.
  const greeneryGap = clamp((Math.min(r.dGreen, 400) / 400) * 70 + Math.max(0, 30 - r.trees150 * 3));
  // Общественная значимость: соцобъекты в 400 м, остановки в 300 м, плотность застройки в 200 м.
  const publicUse = clamp(Math.min(r.social400.length, 4) * 15 + Math.min(r.stops300, 3) * 5 + (r.bld200 / maxBld) * 25);
  // Удобство обслуживания: близость к проезду (центр ближайшей улицы, грубая оценка) и площадь.
  const maintenance = clamp((1 - Math.min(r.dRoad, 150) / 150) * 70 + (r.area >= 300 ? 30 : 15));
  const socialNames = r.social400.slice(0, 4).map((s) => `${{ school: 'школа', kindergarten: 'детсад', clinic: 'поликлиника', hospital: 'больница', college: 'колледж', university: 'вуз' }[s.kind]}${s.name ? ` «${s.name}»` : ''}`);
  const hints = [];
  if (r.dLine < 60) hints.push(`В OSM в ~${Math.round(r.dLine)} м отмечена ЛЭП или трубопровод — проверить охранную зону.`);
  if (r.dMajor < 40) hints.push(`Магистральная улица примерно в ${Math.round(r.dMajor)} м — вероятны соль, пыль и газ; нужны устойчивые виды.`);
  return {
    id,
    name,
    osmId: `way/${r.el.id}`,
    osmTags: r.el.tags,
    geometry: { type: 'Polygon', coordinates: [r.ring] },
    geometryAccuracy: 'Контур из OpenStreetMap; точность зависит от картографа и не проверялась на месте.',
    areaM2: Math.round(r.area),
    centroid: { lat: +r.c.lat.toFixed(6), lng: +r.c.lng.toFixed(6) },
    factors: {
      greeneryGap: { value: greeneryGap, evidenceIds: ['ev-osm-green', 'ev-team-formula'], method: `До ближайшей зелёной зоны OSM ≈${Math.round(r.dGreen)} м, деревьев OSM в 150 м: ${r.trees150}. Формула: min(d,400)/400×70 + max(0, 30 − 3×деревья).` },
      publicUsePriority: { value: publicUse, evidenceIds: ['ev-osm-context', 'ev-team-formula'], method: `Соцобъекты в 400 м: ${r.social400.length}${socialNames.length ? ` (${socialNames.join(', ')})` : ''}; остановок в 300 м: ${r.stops300}; зданий в 200 м: ${r.bld200}. Формула: 15×соцобъекты(≤4) + 5×остановки(≤3) + 25×доля застройки.` },
      waterAvailability: { value: null, evidenceIds: [], method: 'Открытых данных о поливочном водопроводе, гидрантах и подвозе воды нет.' },
      maintenanceFeasibility: { value: maintenance, evidenceIds: ['ev-osm-context', 'ev-team-formula'], method: `До центра ближайшей улицы/проезда ≈${Math.round(r.dRoad)} м (грубая оценка по центрам линий), площадь ${Math.round(r.area)} м².` },
    },
    checks: {
      landPermission: { state: 'unknown', checkedBy: null, checkedAt: null, comment: null },
      utilities: { state: 'unknown', checkedBy: null, checkedAt: null, comment: null },
      access: { state: 'unknown', checkedBy: null, checkedAt: null, comment: null },
      siteSuitability: { state: 'unknown', checkedBy: null, checkedAt: null, comment: null },
    },
    context: {
      distanceToGreenM: Math.round(r.dGreen),
      osmTrees150m: r.trees150,
      socialWithin400m: socialNames,
      busStops300m: r.stops300,
      buildings200m: r.bld200,
      greenShare200m: Math.round(r.greenShare * 1000) / 1000,
      nearestMajorRoadM: Number.isFinite(r.dMajor) ? Math.round(r.dMajor) : null,
      hints,
    },
    evidenceIds: ['ev-osm-landuse', 'ev-osm-green', 'ev-osm-context', 'ev-team-formula'],
    missingData: [
      { field: 'factors.waterAvailability', reason: 'Нет открытых данных о воде для полива.' },
      { field: 'soil', reason: 'Тип и засолённость почвы неизвестны: нужен осмотр или анализ.' },
      { field: 'checks', reason: 'Разрешение, сети, доступ и пригодность не проверены.' },
    ],
    isDemo: false,
    version: 1,
  };
});

sites.sort((a, b) => b.areaM2 - a.areaM2);
// Одинаковые названия (несколько газонов у одной улицы) различаем номером — для списков и ассистента.
const seenNames = new Map();
for (const s of sites) {
  const n = (seenNames.get(s.name) ?? 0) + 1;
  seenNames.set(s.name, n);
  if (n > 1) s.name = `${s.name} — ${n}`;
}
const out = {
  generatedAt: new Date().toISOString(),
  source: 'OpenStreetMap via Overpass API',
  license: 'ODbL 1.0 — © OpenStreetMap contributors',
  bbox: ctx.bbox,
  osmBase,
  evidence,
  sites,
};
await writeFile(join(here, 'sites.json'), JSON.stringify(out, null, 1));
console.log(`Кандидатов: ${sites.length} (из ${raw.elements.length} контуров). Площадь: ${sites.at(-1)?.areaM2}–${sites[0]?.areaM2} м².`);
