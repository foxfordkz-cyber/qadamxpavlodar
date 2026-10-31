import { z } from 'zod';
import { fail } from '../v2/core.js';
import { web } from '../tz/shared.js';
import type { PostgresDatabase } from './database.js';

export const geocodeQuery = z.object({ q: z.string().trim().min(1).max(100) }).strict();
export const geoHit = z.object({
  kind: z.enum(['address', 'street', 'place', 'zone']), label: z.string(),
  lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(), zoneId: z.string().optional(),
}).strict();

/** Per-process budget, bounded by the global limit; no timers, query text or persistent identities.
 * A multi-replica deployment also needs ingress rate limiting. No external geocoder is called.
 */
export function geocodeBudget(clock = Date.now) {
  let until = 0, total = 0;
  const actors = new Map<string, number>();
  return (actorId: string): number => {
    const at = clock();
    if (at >= until) { until = at + 60_000; total = 0; actors.clear(); }
    const used = actors.get(actorId) ?? 0;
    if (used >= 60 || total >= 600) return Math.max(1, Math.ceil((until - at) / 1000));
    actors.set(actorId, used + 1); total++;
    return 0;
  };
}

export async function geocode(db: PostgresDatabase, query: string) {
  // Search text never enters SQL. Project only public search fields, in deterministic ID order.
  // Refuse an oversized index explicitly instead of silently omitting municipal zones.
  const zones = (await db.pool.query(`SELECT id, data->>'name' AS name, data->'centroid' AS centroid
    FROM gp_cloud.documents WHERE kind='site' ORDER BY id LIMIT 10001`)).rows;
  if (zones.length > 10_000) fail('GEOCODE_INDEX_LIMIT', 'Zone index exceeds this deployment limit', 503);
  return { data: web.searchAddress(query, zones, 8), meta: web.GEOCODE_META };
}
