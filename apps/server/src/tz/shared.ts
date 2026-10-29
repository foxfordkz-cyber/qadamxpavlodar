// Расчёты ТЗ, справочники и правила — те же модули, что в вебе (apps/web/src/shared), без копии кода:
// цифры тестового источника и сервера не расходятся. Модули загружает tsx (сервер всегда запускается через него).
// Их типы проверяет typecheck веба; здесь — узкие сигнатуры, сервер передаёт результаты как JSON.
export type Json = Record<string, any>;

const root = new URL('../../../web/src/shared/', import.meta.url);
const load = (path: string): Promise<Json> => import(new URL(path, root).href);
const [plan, city, rates, zone, assistant, species, fixtures, context, drawn, rules, imports, compat, views, pavlodar, geocode] = await Promise.all([
  load('analytics/plan.ts'), load('analytics/city.ts'), load('analytics/rates.ts'), load('analytics/zone.ts'), load('analytics/assistant.ts'),
  load('api/mock/species.ts'), load('api/mock/fixtures.ts'), load('api/mock/context.ts'), load('api/mock/drawnZone.ts'),
  load('api/mock/rules.ts'), load('api/mock/imports.ts'), load('api/v2compat.ts'), load('api/tzViews.ts'), load('api/pavlodar.ts'), load('api/geocode.ts'),
]);

export const web = {
  analyzeZone: plan.analyzeZone as (site: Json, catalog: Json[], rates: Json, options?: Json) => Json,
  VARIANT_LABEL: plan.VARIANT_LABEL as Record<string, string>,
  detectProblems: city.detectProblems as (sites: Json[]) => { problems: Json[]; notDetectable: string[] },
  priorities: city.priorities as (sites: Json[], catalog: Json[], rates: Json, weights: Json) => Json[],
  roadmap: city.roadmap as (items: Json[], budget: number) => Json,
  DEFAULT_PRIORITY_WEIGHTS: city.DEFAULT_PRIORITY_WEIGHTS as Record<string, number>,
  ratesMap: rates.ratesMap as (entries: Json[]) => Json,
  DEFAULT_RATES: rates.DEFAULT_RATES as Json[],
  soilFor: zone.soilFor as (lat: number, lng: number) => Json,
  soilForCell: zone.soilForCell as (cellId: string) => Json,
  SOIL_CELL_DEG: zone.SOIL_CELL_DEG as { lat: number; lng: number },
  SALINITY_LABEL: zone.SALINITY_LABEL as Record<string, string>,
  answer: assistant.answer as (message: string, ctx: { siteId: string | null }, sites: Json[], catalog: Json[], rates: Json) => Json,
  species: species.species as Json[],
  seed: fixtures.seed as () => Json,
  osmMeta: fixtures.osmMeta as Json,
  siteContext: context.siteContext as (site: Json, radiusM: number) => Json,
  validateDrawnPolygon: drawn.validateDrawnPolygon as (geometry: unknown) => { ring: [number, number][]; errors: { field: string; message: string }[] },
  buildDrawnZone: drawn.buildDrawnZone as (id: string, name: string, ring: [number, number][], maxBuildings: number) => Json,
  rankSites: rules.rankSites as (sites: Json[], weights: Json) => Json,
  selectPlants: rules.selectPlants as (site: Json, catalog: Json[]) => Json,
  CHECKS: rules.CHECKS as string[],
  previewImport: imports.previewImport as (format: string | undefined, features: Json[] | undefined, note: string) => Json,
  // Слой соответствий V2 ↔ веб: та же функция, что разворачивает участок для экранов в режиме api.
  siteFromV2: compat.siteFromV2 as (doc: Json) => Json,
  taskFromV2: compat.taskFromV2 as (doc: Json) => Json,
  projectFromDesign: compat.projectFromDesign as (doc: Json, revisions?: Json[]) => Json,
  soilsLayer: views.soilsLayer as () => { data: Json; meta: Json },
  greeneryLayer: views.greeneryLayer as () => { data: Json; meta: Json },
  variantSummaries: views.variantSummaries as (opts: Json, analyze: (o: Json) => Json) => Json[],
  // Проверенные данные о Павлодаре (fixtures/pavlodar): факты для ассистента и «Справочников».
  pavlodarFacts: pavlodar.pavlodarFacts as Json[],
  pavlodarSources: pavlodar.pavlodarSources as Json[],
  referenceFacts: pavlodar.referenceFacts as () => { data: Json; meta: Json },
  searchAddress: geocode.searchAddress as (q: string, zones: Json[], limit?: number) => Json[],
  GEOCODE_META: geocode.GEOCODE_META as Json,
  dashboardMetrics: views.dashboardMetrics as (input: { sites: Json[]; tasks: Json[]; reports: Json[]; projects: Json[]; osmBase?: string | null }) => Json[],
};
