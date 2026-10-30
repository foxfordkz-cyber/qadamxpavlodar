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

/** No speculative production routes or silent API → mock fallback. Inject Bekzat's adapter when agreed. */
export function createOutcomesClient(transport: Transport, backend?: OutcomesClient): OutcomesClient {
  if (transport.kind === 'api') return backend ?? {
    available: false,
    async list() { throw new ApiError(503, 'outcomes_not_connected', 'outcomes_not_connected'); },
    async saveForecast() { throw new ApiError(503, 'outcomes_not_connected', 'outcomes_not_connected'); },
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
