// Сид ТЗ (SRV-04): 114 зон OSM из fixtures/osm/sites.json с теми же демо-отметками, что в тестовом источнике,
// источники (evidence), 50 видов (они же позиции каталога V2 — id совпадают), 27 расценок.
// Повторный запуск ничего не перезаписывает: ON CONFLICT DO NOTHING.
import { Store } from '../db.js';
import { now, type Doc } from '../v2/core.js';
import { web, type Json } from './shared.js';

const KIND: Record<string, string> = { tree: 'tree', shrub: 'shrub', flower: 'flowerbed' };
export const OSM_IMPORT = 'osm-import';

/** Веб-участок (CandidateSite) → документ V2 'site'. Пятая проверка V2 (видимость на перекрёстке) для газонов OSM не нужна. */
export function siteToV2(site: Json, at: string): Doc {
  const checks: Json = {};
  for (const k of web.CHECKS) {
    const c = site.checks?.[k] ?? { state: 'unknown' };
    checks[k] = { status: c.state, comment: c.comment ?? null, reviewedBy: c.checkedBy ? 'demo-coordinator-1' : null, reviewedByName: c.checkedBy ?? null, reviewedAt: c.checkedAt ?? null };
  }
  checks.trafficVisibility = { status: 'not_applicable', comment: 'Не перекрёсток: газон или зона из контура, проверка видимости для водителей не требуется.', reviewedBy: OSM_IMPORT, reviewedByName: 'Импорт зоны (автоматически)', reviewedAt: at };
  return { ...site, id: String(site.id), checks, isIntersection: false, contextId: `context-${site.id}`, currentDesignId: null, version: site.version ?? 1 };
}

/** Окружение зоны в формате V2 'context' (здания в 100 м из OSM) — его читают проекты и кабинет работника. */
export function contextToV2(site: Json, fetchedAt: string): Doc {
  const ctx = web.siteContext(site, 100);
  return {
    id: `context-${site.id}`, siteId: site.id, radiusM: 100,
    features: ctx.buildings.map((b: Json) => ({ id: b.id, featureType: 'building', geometry: b.geometry, name: b.name, address: b.address, mappedUse: b.purpose, heightM: null, distanceM: b.distanceM, distanceMethod: ctx.distanceMethod, evidenceIds: ctx.evidenceIds })),
    sourceEvidenceIds: ctx.evidenceIds, fetchedAt, missingData: ['Подземные сети в OSM не отмечены: нужна схема сетей.'], isDemo: false, version: 1,
  };
}

export function insertZone(s: Store, site: Json, at: string) {
  const add = (kind: string, d: Doc) => s.run('INSERT INTO v2_documents VALUES (?,?,?,?) ON CONFLICT(kind,id) DO NOTHING', kind, d.id, JSON.stringify(d), d.version);
  add('context', contextToV2(site, at));
  const doc = siteToV2(site, at);
  add('site', doc);
  return doc;
}

export function catalogFromSpecies(sp: Json) {
  return { id: sp.id, displayName: sp.nameRu, botanicalName: sp.latin, kind: KIND[sp.form] ?? 'shrub', colors: [], bloomPeriod: sp.floweringMonths?.length ? `месяцы ${sp.floweringMonths.join(', ')}` : null,
        lightRequirement: null, soilRequirement: null, moistureRequirement: null, climateSuitabilityNotes: sp.notes?.join(' ') || null, matureHeightM: sp.matureHeightM?.[1] ?? null,
        // Цена остаётся в справочнике видов (pricePerUnitKzt + priceEvidenceId): у демо-цен нет даты, а V2 требует её для известной цены.
        spreadM: sp.crownDiameterM ?? null, spacingM: sp.spacingM ?? null, carePolicyId: null, unitCost: null, currency: null,
        priceDate: null, stockQuantity: null, evidenceIds: sp.evidenceIds, reviewedBy: null, isDemo: true, version: 1 };
}

export function seedTz(s: Store) {
  const db = web.seed();
  const at = now();
  const counts = { zones: 0, evidence: 0, species: 0, rates: 0 };
  s.transaction(() => {
    // db.evidence тестового источника уже включает проверенные источники о Павлодаре (fixtures/pavlodar/sources.json).
    for (const e of db.evidence as Json[]) {
      const doc = { id: e.id, sourceType: e.sourceType, sourceLabel: e.sourceLabel, sourceUrl: e.sourceUrl ?? null, observedAt: e.observedAt ?? null, validUntil: e.validUntil ?? null, dataClass: e.dataClass, note: e.note ?? null, ...(e.publishedAt !== undefined ? { publishedAt: e.publishedAt } : {}), version: 1 };
      counts.evidence += Number(s.run("INSERT INTO v2_documents VALUES ('evidence',?,?,1) ON CONFLICT(kind,id) DO NOTHING", doc.id, JSON.stringify(doc)).changes);
    }
    for (const site of db.sites as Json[]) {
      const before = s.get("SELECT id FROM v2_documents WHERE kind='site' AND id=?", site.id);
      insertZone(s, site, web.osmMeta.generatedAt ?? at);
      if (!before) counts.zones++;
    }
    for (const sp of web.species) {
      counts.species += Number(s.run('INSERT INTO tz_species VALUES (?,?,1) ON CONFLICT(id) DO NOTHING', sp.id, JSON.stringify(sp)).changes);
      // Тот же вид — позиция каталога V2 (проекты и кабинет работника ссылаются на catalogItemId = id вида).
      const item = catalogFromSpecies(sp);
      s.run("INSERT INTO v2_documents VALUES ('catalog',?,?,1) ON CONFLICT(kind,id) DO NOTHING", item.id, JSON.stringify(item));
    }
    (db.rates as Json[]).forEach((r, i) => { counts.rates += Number(s.run('INSERT INTO tz_rates VALUES (?,?,?) ON CONFLICT(key) DO NOTHING', r.key, i, JSON.stringify(r)).changes); });
  });
  return { mode: 'DEMO', inserted: counts, totalZones: Number(s.get("SELECT count(*) AS n FROM v2_documents WHERE kind='site'")?.n ?? 0) };
}
