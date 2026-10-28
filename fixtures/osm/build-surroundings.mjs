// Компактное окружение участков (B19) из raw-surroundings.json.
// Запуск: node fixtures/osm/build-surroundings.mjs → fixtures/osm/surroundings.json
// Сохраняем только теги, которые есть в OSM; назначение здания НЕ выводим из формы или вида.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(await readFile(join(here, 'raw-surroundings.json'), 'utf8'));
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const line = (el) => (el.geometry ?? []).map((g) => [r6(g.lon), r6(g.lat)]);
const pick = (t, keys) => Object.fromEntries(keys.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));

const BUILDING_KEYS = ['building', 'name', 'name:ru', 'addr:street', 'addr:housenumber', 'building:levels', 'height', 'amenity', 'shop', 'office'];
const out = { buildings: [], roads: [], entrances: [], crossings: [] };
for (const el of raw.elements) {
  const t = el.tags ?? {};
  if (el.type === 'way' && t.building) {
    const ring = line(el);
    if (ring.length > 3) out.buildings.push({ id: `way/${el.id}`, ring, tags: pick(t, BUILDING_KEYS) });
  } else if (el.type === 'way' && t.highway) {
    out.roads.push({ id: `way/${el.id}`, kind: t.highway, name: t['name:ru'] ?? t.name ?? null, line: line(el) });
  } else if (el.type === 'node' && t.entrance) {
    out.entrances.push({ id: `node/${el.id}`, lng: r6(el.lon), lat: r6(el.lat), tags: pick(t, ['entrance', 'ref', 'addr:flats', 'wheelchair']) });
  } else if (el.type === 'node' && t.highway === 'crossing') {
    out.crossings.push({ id: `node/${el.id}`, lng: r6(el.lon), lat: r6(el.lat), tags: pick(t, ['crossing', 'crossing:markings']) });
  }
}
out.meta = { fetchedAt: raw.fetchedAt, osmBase: raw.osm3s?.timestamp_osm_base, bbox: raw.bbox, license: 'ODbL 1.0 — © OpenStreetMap contributors' };
await writeFile(join(here, 'surroundings.json'), JSON.stringify(out));
console.log(`Здания: ${out.buildings.length}, дороги и тротуары: ${out.roads.length}, входы: ${out.entrances.length}, переходы: ${out.crossings.length}`);
