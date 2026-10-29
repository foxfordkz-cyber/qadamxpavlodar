// Данные ТЗ на сервере: зоны хранятся как документы V2 'site' (те же, что видит кабинет работника),
// справочники видов и расценок — в tz_species и tz_rates (миграция 4).
import { Store } from '../db.js';
import { fail, hash, listDocs, maybeDoc, type Doc } from '../v2/core.js';
import { web, type Json } from './shared.js';

export const speciesList = (s: Store): Json[] => s.all('SELECT data FROM tz_species ORDER BY id').map(r => JSON.parse(String(r.data)));
export const ratesList = (s: Store): Json[] => s.all('SELECT data FROM tz_rates ORDER BY position').map(r => JSON.parse(String(r.data)));
/** Версия справочника расценок: 1 после seed, +1 за каждую правку (tz_rate_history). */
export const ratesVersion = (s: Store) => Number(s.get('SELECT COALESCE(MAX(version),1) AS v FROM tz_rate_history')?.v ?? 1);

export function reference(s: Store) {
  const species = speciesList(s), rates = ratesList(s);
  if (!species.length || !rates.length) fail('TZ_REFERENCE_MISSING', 'Справочники ТЗ не загружены: выполните npm run seed:tz', 503);
  return { species, rates, map: web.ratesMap(rates), version: ratesVersion(s) };
}

/** Зону можно рассчитать, если у неё есть контур и центр (синтетические точечные участки V2 — нельзя). */
export const analyzable = (doc: Doc) => doc.geometry?.type === 'Polygon' && !!doc.centroid;
export const candidates = (s: Store) => listDocs(s, 'site').filter(analyzable).map(web.siteFromV2);
export function candidate(s: Store, id: string) {
  const doc = maybeDoc(s, 'site', id);
  if (!doc) fail('NOT_FOUND', 'Zone not found', 404);
  if (!analyzable(doc!)) fail('ZONE_NOT_ANALYZABLE', 'Zone has no polygon geometry for TZ calculations', 422);
  return web.siteFromV2(doc!);
}

// Кэш расчётов: ключ «зона и её версия, параметры, версия расценок». Новая версия зоны или расценок — новый ключ.
const LIMIT = 1000;
const cache = new Map<string, Json>();
function remember<T extends Json | Json[]>(key: string, run: () => T): T {
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit as T; }
  const value = run();
  cache.set(key, value);
  if (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
  return value;
}
export function analyze(site: Json, ref: ReturnType<typeof reference>, options: Json = {}) {
  return remember(`zone:${site.id}:${site.version}:${hash(options)}:${ref.version}`, () => web.analyzeZone(site, ref.species, ref.map, options));
}
/** priorities() внутри считает analyzeZone по всем зонам; кэшируем результат по составу зон, весам и версии расценок. */
export function priorities(sites: Json[], ref: ReturnType<typeof reference>, weights: Json) {
  const stamp = hash(sites.map(z => [z.id, z.version]));
  return remember(`priorities:${stamp}:${hash(weights)}:${ref.version}`, () => web.priorities(sites, ref.species, ref.map, weights)) as Json[];
}
export const cacheSize = () => cache.size;
