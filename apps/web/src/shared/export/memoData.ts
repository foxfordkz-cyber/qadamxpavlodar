import type { CandidateSite, EvidenceRef, Species } from '../api/types';
import type { ZoneAnalysis } from '../analytics/plan';
import type { RateEntry } from '../analytics/rates';

export interface MemoZone { site: CandidateSite; analysis: ZoneAnalysis }
export interface MemoInput {
  zones: MemoZone[];
  species: Species[];
  evidence: EvidenceRef[];
  rates: RateEntry[];
  generatedAt: string;
  source: 'mock' | 'api';
}
export function memoEvidenceIds(zones: MemoZone[], species: Species[]): string[] {
  const used = new Set(zones.flatMap(z => z.analysis.scheme.map(s => s.speciesId)));
  return [...new Set([
    ...zones.flatMap(z => z.site.evidenceIds ?? []),
    ...species.filter(s => used.has(s.id)).flatMap(s => [...s.evidenceIds, s.priceEvidenceId, s.pavlodarEvidenceId].filter((id): id is string => !!id)),
  ])];
}
