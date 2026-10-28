// Загрузка открытых данных OpenStreetMap для демонстрационного района Павлодара.
// Запуск: node fixtures/osm/fetch-osm.mjs   (из корня репозитория, нужен Node 18+)
// Данные © участники OpenStreetMap, лицензия ODbL 1.0 — https://www.openstreetmap.org/copyright
// Запросы идут к публичному Overpass API; не запускать в цикле, соблюдать
// https://dev.overpass-api.de/overpass-doc/en/preface/commons.html

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// Центральная часть Павлодара (≈2,7 × 3,3 км). S, W, N, E.
const BBOX = '52.268,76.926,52.300,76.974';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const QUERIES = {
  'raw-candidates': `[out:json][timeout:90];
(
  way["landuse"~"^(grass|brownfield|greenfield|vacant|meadow|village_green)$"](${BBOX});
  way["natural"~"^(scrub|grassland|heath)$"](${BBOX});
);
out tags geom;`,
  'raw-green': `[out:json][timeout:90];
(
  way["leisure"~"^(park|garden)$"](${BBOX});
  way["landuse"="forest"](${BBOX});
  way["natural"~"^(wood|tree_row)$"](${BBOX});
);
out tags geom;`,
  'raw-context': `[out:json][timeout:120];
(
  nwr["amenity"~"^(school|kindergarten|clinic|hospital|college|university)$"](${BBOX});
  node["highway"="bus_stop"](${BBOX});
  node["natural"="tree"](${BBOX});
  way["building"](${BBOX});
  way["highway"~"^(primary|secondary|tertiary|residential|service|footway|pedestrian)$"](${BBOX});
  way["power"="line"](${BBOX});
  way["man_made"="pipeline"](${BBOX});
);
out tags center;`,
  // Окружение участков (B19): контуры зданий, улицы и тротуары, входы, переходы.
  'raw-surroundings': `[out:json][timeout:180];
(
  way["building"](${BBOX});
  way["highway"~"^(primary|secondary|tertiary|residential|service|living_street|unclassified|footway|pedestrian|path|cycleway)$"](${BBOX});
  node["entrance"](${BBOX});
  node["highway"="crossing"](${BBOX});
);
out tags geom;`,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(name, query) {
  for (let attempt = 0; attempt < ENDPOINTS.length * 2; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'GreenPavlodar-hackathon/0.1' },
        body: 'data=' + encodeURIComponent(query),
      });
      const text = await res.text();
      if (!res.ok || !text.startsWith('{')) throw new Error(`${res.status} ${text.slice(0, 80)}`);
      const json = JSON.parse(text);
      json.fetchedAt = new Date().toISOString();
      json.fetchedFrom = url;
      json.bbox = BBOX;
      await writeFile(join(here, `${name}.json`), JSON.stringify(json));
      console.log(`${name}: ${json.elements.length} элементов, OSM base ${json.osm3s?.timestamp_osm_base} (${url})`);
      return;
    } catch (e) {
      console.warn(`${name}: попытка ${attempt + 1} через ${url} не удалась — ${e.message}`);
      await sleep(5000 * (attempt + 1));
    }
  }
  throw new Error(`${name}: все попытки исчерпаны`);
}

const only = process.argv.slice(2);
for (const [name, q] of Object.entries(QUERIES)) {
  if (only.length && !only.includes(name)) continue;
  await run(name, q);
  await sleep(3000);
}
