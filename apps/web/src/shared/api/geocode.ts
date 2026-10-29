// Поиск по адресу на карте (ТЗ 3.1.4) без внешнего геокодера: по снимку OpenStreetMap района прототипа
// (fixtures/osm/surroundings.json — дома с улицей и номером, улицы, названные здания) и по названиям зон.
// Общий для тестового источника и сервера apps/server; названия улиц ищутся и по-русски, и по-казахски.
import surroundings from '../../../../../fixtures/osm/surroundings.json';

export type GeoHit = { kind: 'address' | 'street' | 'place' | 'zone'; label: string; lng: number; lat: number; bbox?: [number, number, number, number]; zoneId?: string };
type Ring = [number, number][];

const KK: Record<string, string> = { ә: 'а', ғ: 'г', қ: 'к', ң: 'н', ө: 'о', ұ: 'у', ү: 'у', һ: 'х', і: 'и', ё: 'е' };
// Служебные слова адреса не участвуют в сравнении: «улица Торайгырова» = «Торайғыров көшесі» = «торайгырова».
const NOISE = /^(ул|улица|пр|проспект|пр-т|пер|переулок|бульвар|б-р|мкр|микрорайон|кошеси|кош|дангылы|даналы|кв|д|дом|г|город|павлодар)$/;
const norm = (x: string) => x.toLowerCase().replace(/[әғқңөұүһіё]/g, (c) => KK[c]!).replace(/[«»"'.,()]/g, ' ');
const words = (x: string) => norm(x).split(/[\s/–-]+/).filter((w) => w && !NOISE.test(w));
/** Основа слова — первые 5 букв: «торайгырова» и «торайгыров», «лермонтова» и «лермонтов» совпадают. */
const stem = (w: string) => w.slice(0, 5);

const center = (ring: Ring): [number, number] => {
  const n = ring.length - (ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? 1 : 0);
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) { x += ring[i]![0]; y += ring[i]![1]; }
  return [+(x / n).toFixed(6), +(y / n).toFixed(6)];
};
const bbox = (pts: Ring): [number, number, number, number] => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];

type Entry = GeoHit & { keys: string[]; house?: string };
let index: Entry[] | null = null;
function build(): Entry[] {
  const out: Entry[] = [];
  const streets = new Map<string, { label: string; pts: Ring }>();
  const addStreet = (name: string, pts: Ring) => {
    const key = words(name).map(stem).join(' ');
    if (!key) return;
    const s = streets.get(key) ?? { label: name, pts: [] };
    // Русское название улицы показываем охотнее казахского.
    if (/улица|проспект|переулок/.test(name) && !/улица|проспект|переулок/.test(s.label)) s.label = name;
    s.pts.push(...pts);
    streets.set(key, s);
  };
  const src = surroundings as unknown as { buildings: { ring: Ring; tags?: Record<string, string> }[]; roads: { name?: string | null; line: Ring }[] };
  for (const b of src.buildings) {
    const t = b.tags ?? {};
    const street = t['addr:street'], house = t['addr:housenumber'];
    const [lng, lat] = center(b.ring);
    if (street && house) {
      out.push({ kind: 'address', label: `${street}, ${house}`, lng, lat, keys: words(street).map(stem), house: norm(house).replace(/\s/g, '') });
      addStreet(street, [[lng, lat]]);
    }
    const name = t['name:ru'] ?? t.name;
    if (name) out.push({ kind: 'place', label: street && house ? `${name} — ${street}, ${house}` : name, lng, lat, keys: words(name).map(stem) });
  }
  for (const r of src.roads) if (r.name) addStreet(r.name, r.line);
  for (const s of streets.values()) {
    const [w, so, e, n] = bbox(s.pts);
    out.push({ kind: 'street', label: s.label, lng: +((w + e) / 2).toFixed(6), lat: +((so + n) / 2).toFixed(6), bbox: [w, so, e, n], keys: words(s.label).map(stem) });
  }
  return out;
}

const ORDER: Record<GeoHit['kind'], number> = { address: 0, zone: 1, street: 2, place: 3 };

/** Поиск: «Торайгырова 1/5», «Лермонтова», «собор», название зоны. zones — зоны карты (id, имя, центр). */
export function searchAddress(query: string, zones: { id: string; name: string; centroid?: { lat: number; lng: number } | null }[] = [], limit = 8): GeoHit[] {
  index ??= build();
  // Номер дома — токен с цифрой целиком («1/5», «93к3»); остальное — слова названия.
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  const house = tokens.find((w) => /^\d/.test(w));
  const keys = tokens.filter((w) => w !== house).flatMap((w) => words(w)).filter((w) => !/\d/.test(w)).map(stem);
  if (!keys.length) return [];
  // Короткие слова названий («к», «а») не совпадают с запросом — иначе «Кривенко» находит «К. Абусеитова».
  const match = (e: { keys: string[] }) => keys.every((k) => e.keys.some((x) => x.startsWith(k) || (x.length >= 4 && k.startsWith(x))));
  const hits: (GeoHit & { rank: number })[] = [];
  for (const e of index) {
    if (!keys.length || !match(e)) continue;
    if (e.kind === 'address') {
      if (!house) continue;
      if (e.house === house) hits.push({ ...e, rank: 0 });
      else if (e.house!.startsWith(house)) hits.push({ ...e, rank: 1 });
    } else if (!house || e.kind === 'street') hits.push({ ...e, rank: house && e.kind === 'street' ? 4 : 2 + ORDER[e.kind] });
  }
  for (const z of zones) {
    if (!z.centroid || !keys.length) continue;
    if (match({ keys: words(z.name).map(stem) })) hits.push({ kind: 'zone', label: z.name, lng: z.centroid.lng, lat: z.centroid.lat, zoneId: z.id, rank: house ? 5 : 2 });
  }
  const seen = new Set<string>();
  return hits.sort((a, b) => a.rank - b.rank || ORDER[a.kind] - ORDER[b.kind] || a.label.localeCompare(b.label, 'ru'))
    .filter((h) => !seen.has(h.label) && !!seen.add(h.label)).slice(0, limit)
    .map(({ kind, label, lng, lat, bbox: b, zoneId }) => ({ kind, label, lng, lat, ...(b ? { bbox: b } : {}), ...(zoneId ? { zoneId } : {}) }));
}

export const GEOCODE_META = { source: 'OpenStreetMap (ODbL), снимок района прототипа', coverage: 'Центр Павлодара в границах карты прототипа; адресов вне района нет.' };
