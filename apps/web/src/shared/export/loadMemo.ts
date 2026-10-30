import type { Api } from '../api/api';
import type { PlanOptions } from '../analytics/plan';
import { memoEvidenceIds, type MemoInput } from './memoData';

export class MemoRatesChanged extends Error {}
export async function loadMemo(api: Pick<Api, 'rates' | 'site' | 'zoneAnalysis' | 'species' | 'evidence'>, selected: string[], options: Partial<PlanOptions>, source: 'mock' | 'api'): Promise<MemoInput> {
  if (!selected.length) throw new Error('No zones selected');
  const before = await api.rates();
  const [zones, species] = await Promise.all([
    Promise.all([...new Set(selected)].map(async id => {
      const [site, analysis] = await Promise.all([api.site(id), api.zoneAnalysis(id, options)]);
      return { site, analysis };
    })), api.species(),
  ]);
  const ids = memoEvidenceIds(zones, species);
  const [evidence, after] = await Promise.all([ids.length ? api.evidence(ids) : Promise.resolve([]), api.rates()]);
  if (before.version !== after.version) throw new MemoRatesChanged('Rates changed during export');
  return { zones, species, evidence, rates: before.rates, source, generatedAt: new Date().toISOString() };
}
