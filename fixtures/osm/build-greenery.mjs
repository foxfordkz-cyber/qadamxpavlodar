// Слой существующих насаждений из OSM (ТЗ 3.1.3) до получения карты насаждений организатора.
// Запуск: node fixtures/osm/build-greenery.mjs → fixtures/osm/greenery.json (GeoJSON, [lng, lat]).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const green = JSON.parse(await readFile(join(here, 'raw-green.json'), 'utf8'));
const ctx = JSON.parse(await readFile(join(here, 'raw-context.json'), 'utf8'));
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const kind = (t) => (t.leisure === 'park' ? 'парк' : t.leisure === 'garden' ? 'сад, сквер' : t.landuse === 'forest' || t.natural === 'wood' ? 'лес, роща' : t.natural === 'tree_row' ? 'рядовая посадка' : 'зелень');
const features = [];
for (const e of green.elements) {
  if (e.type !== 'way' || !e.geometry) continue;
  const line = e.geometry.map((g) => [r6(g.lon), r6(g.lat)]);
  const isClosed = line.length > 3 && line[0][0] === line.at(-1)[0] && line[0][1] === line.at(-1)[1];
  const t = e.tags ?? {};
  features.push({ type: 'Feature', properties: { id: `way/${e.id}`, kind: kind(t), name: t['name:ru'] ?? t.name ?? null }, geometry: isClosed ? { type: 'Polygon', coordinates: [line] } : { type: 'LineString', coordinates: line } });
}
for (const e of ctx.elements) {
  if (e.type === 'node' && e.tags?.natural === 'tree') features.push({ type: 'Feature', properties: { id: `node/${e.id}`, kind: 'дерево', name: e.tags.species ?? null }, geometry: { type: 'Point', coordinates: [r6(e.lon), r6(e.lat)] } });
}
await writeFile(join(here, 'greenery.json'), JSON.stringify({ type: 'FeatureCollection', meta: { source: 'OpenStreetMap', license: 'ODbL 1.0', osmBase: green.osm3s?.timestamp_osm_base }, features }));
console.log(`Насаждений OSM: ${features.length}`);
