// Данные ТЗ на сервере: зоны хранятся как документы V2 'site' (те же, что видит кабинет работника),
// справочники видов и расценок — в tz_species и tz_rates (миграция 4).
import { Store } from '../db.js';
import { fail, hash, listDocs, maybeDoc, type Doc } from '../v2/core.js';
import { web, type Json } from './shared.js';
import * as municipal from '../municipal/data.js';

export const speciesList = (s: Store): Json[] => municipal.catalog(s);
export const ratesList = (s: Store): Json[] => municipal.rates(s).rates;
/** Версия справочника расценок: 1 после seed, +1 за каждую правку (tz_rate_history). */
export const ratesVersion = (s: Store) => municipal.rates(s).version;

export function reference(s: Store) {
  const species = speciesList(s), rates = municipal.calculationRates(s).rates;
  if (!species.length || !rates.length) fail('TZ_REFERENCE_MISSING', 'Справочники ТЗ не загружены: выполните npm run seed:tz', 503);
  return { species, rates, map: web.ratesMap(rates), version: ratesVersion(s) };
}

/** Зону можно рассчитать, если у неё есть контур и центр (синтетические точечные участки V2 — нельзя). */
export const analyzable = (doc: Doc) => doc.geometry?.type === 'Polygon' && !!doc.centroid;
export const candidates = (s: Store) => municipal.calculationSites(s);
export function candidate(s: Store, id: string) {
  return municipal.withSoil(s,municipal.site(s,id)).zone;
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
  return remember(`zone:${hash({site,options,species:ref.species,rates:ref.rates,version:ref.version})}`, () => web.analyzeZone(site, ref.species, ref.map, options));
}
/** priorities() внутри считает analyzeZone по всем зонам; кэшируем результат по составу зон, весам и версии расценок. */
export function priorities(sites: Json[], ref: ReturnType<typeof reference>, weights: Json) {
  const stamp = hash({sites,species:ref.species,rates:ref.rates});
  return remember(`priorities:${stamp}:${hash(weights)}:${ref.version}`, () => web.priorities(sites, ref.species, ref.map, weights)) as Json[];
}
export const cacheSize = () => cache.size;
/** Include actual reference data and request parameters, so edits invalidate cached plans. */
export function decisionLab(sites: Json[], ref: ReturnType<typeof reference>, input: Json) {
  return remember(`decision-lab:${hash({ sites, species: ref.species, rates: ref.rates, version: ref.version, input })}`,
    () => web.decisionPlans({ ...web.decisionLabData(sites, ref.species, ref.rates, 'api', ref.version, new Date().toISOString()), ...input }));
}
