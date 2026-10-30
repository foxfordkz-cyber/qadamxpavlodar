import type { OutcomeCohort, OutcomeInspection, OutcomeForecastComparison, OutcomeInspectionSummary, DeepReadonly } from './outcomes';
import { summarizeOutcomeInspection, compareOutcomeForecast } from '../analytics/outcomes';

type Cohort = DeepReadonly<OutcomeCohort>;
type Inspection = DeepReadonly<OutcomeInspection>;
export type CohortRecord = { data: Cohort; meta: { createdAt: string; createdBy: string } };
export type InspectionRecord = { data: Inspection; meta: { createdAt: string; reviewerId: string } };
type Summary = { data: { summary: OutcomeInspectionSummary; comparison: OutcomeForecastComparison; asOf: string } };
export interface OutcomesReader {
  list(): Promise<{ data: CohortRecord[] }>;
  get(id: string): Promise<CohortRecord>;
  history(id: string): Promise<{ data: InspectionRecord[] }>;
  summary(id: string, inspectionId?: string): Promise<Summary>;
}
/** Explicit API transport. HTTP/network failures propagate; there is no mock fallback. */
export function apiOutcomesReader(request: typeof fetch = fetch): OutcomesReader {
  async function get<T>(path: string): Promise<T> {
    const response = await request(`/api/v1/outcomes${path}`, { credentials: 'include' });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error?.message ?? 'Outcomes request failed'), {
      status: response.status, code: body.error?.code, requestId: body.error?.requestId,
    });
    return body as T;
  }
  const path = (id: string) => `/cohorts/${encodeURIComponent(id)}`;
  return { list: () => get('/cohorts'), get: id => get(path(id)), history: id => get(path(id) + '/inspections'),
    summary: (id, inspectionId) => get(path(id) + '/summary' + (inspectionId ? `?inspectionId=${encodeURIComponent(inspectionId)}` : '')) };
}
/** Offline read transport for explicit DEMO fixtures. No server or network is used. */
export function mockOutcomesReader(cohorts: CohortRecord[], inspections: InspectionRecord[], asOf: string): OutcomesReader {
  const cs = structuredClone(cohorts), ins = structuredClone(inspections);
  if (cs.some(c => !c.data.provenance.isDemo) || ins.some(i => !i.data.provenance.isDemo)) throw Error('Mock requires labelled demo records');
  const get = (id: string) => { const c = cs.find(c => c.data.id === id); if (!c) throw Error('Cohort not found'); return c; };
  return {
    async list() { return { data: structuredClone(cs) }; },
    async get(id) { return structuredClone(get(id)); },
    async history(id) { get(id); return { data: structuredClone(ins.filter(i => i.data.cohortId === id)) }; },
    async summary(id, inspectionId) {
      const c = get(id).data;
      const i = inspectionId ? ins.find(i => i.data.id === inspectionId && i.data.cohortId === id)?.data : null;
      if (inspectionId && !i) throw Error('Inspection not found');
      return { data: { summary: summarizeOutcomeInspection(c, i ?? null, asOf), comparison: compareOutcomeForecast(c, i ?? null, asOf), asOf } };
    },
  };
}
