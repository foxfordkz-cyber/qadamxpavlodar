import type { PlanOptions } from '../analytics/plan';
import type { DeepReadonly, OutcomeCohort, OutcomeForecastSnapshot, OutcomeInspection, RegisteredOutcomePlant } from './outcomes';
import { ApiError, type Transport } from './transport';

/** UI port, not an HTTP contract. Backend supplies its server calendar date and authoritative registry links. */
export interface SavedOutcomeForecast { id: string; snapshot: OutcomeForecastSnapshot }
export interface OutcomeSiteData {
  siteId: string;
  asOf: string;
  cohorts: DeepReadonly<OutcomeCohort>[];
  inspections: DeepReadonly<OutcomeInspection>[];
  forecasts: SavedOutcomeForecast[];
  registry: RegisteredOutcomePlant[];
}
export interface SaveOutcomeForecast {
  options: Partial<PlanOptions>;
  siteVersion: number;
  ratesVersion: number;
}
export interface OutcomesClient {
  available: boolean;
  list(siteId: string): Promise<OutcomeSiteData>;
  saveForecast(siteId: string, input: SaveOutcomeForecast, idempotencyKey: string): Promise<SavedOutcomeForecast>;
}

/** Published #23 routes plus its read model. API failures never select mock implicitly. */
export function createOutcomesClient(transport: Transport, backend?: OutcomesClient): OutcomesClient {
  if (transport.kind === 'api') return backend ?? {
    available: true,
    async list(siteId) {
      return (await transport.request<OutcomeSiteData>('GET', `/outcomes/sites/${encodeURIComponent(siteId)}`)).data;
    },
    async saveForecast(siteId, input, idempotencyKey) {
      const o = input.options;
      if (o.careYears !== 3 || o.watering !== 'regular' || o.improveSoil || o.locked?.length || Object.keys(o.replacements ?? {}).length || o.purpose || o.maxSpeciesShare !== 0.3)
        throw new ApiError(400, 'outcomes_unsupported_plan', 'outcomes_unsupported_plan');
      return (await transport.request<SavedOutcomeForecast>('POST', '/outcomes/snapshots', {
        idempotencyKey, body: { id: `outcome-${idempotencyKey}`, siteId, expectedVersion: input.siteVersion,
          expectedRatesVersion: input.ratesVersion, variant: o.variant },
      })).data;
    },
  };
  return {
    available: true,
    async list(siteId) {
      return (await transport.request<OutcomeSiteData>('GET', `/outcomes/${encodeURIComponent(siteId)}`)).data;
    },
    async saveForecast(siteId, input, idempotencyKey) {
      return (await transport.request<SavedOutcomeForecast>('POST', `/outcomes/${encodeURIComponent(siteId)}/forecasts`, { body: input, idempotencyKey })).data;
    },
  };
}
