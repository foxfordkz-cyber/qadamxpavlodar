import type { CandidateSite, Species } from './types';
import type { DecisionData, SocialProof } from '../analytics/decisionLab';
import { ratesMap, type RateEntry } from '../analytics/rates';
import { siteContext, contextEvidence } from './mock/context';

/** Existing offline OSM geometry/tag adapter, shared by API and mock. No name inference. */
export function decisionLabData(sites: CandidateSite[], catalog: Species[], rateEntries: RateEntry[], source: 'mock' | 'api', ratesVersion: number, capturedAt: string): DecisionData {
  const kinds: Record<string, SocialProof['kind']> = {
    'школа': 'school', 'детский сад': 'kindergarten', 'поликлиника': 'social',
    'больница': 'social', 'колледж': 'social', 'вуз': 'social',
  };
  const social = Object.fromEntries(sites.filter(s => s.centroid).map(site => {
    const context = siteContext(site, 400);
    const proofs = context.buildings.filter(b => b.purpose !== null && kinds[b.purpose]).map(b => ({
      id: b.id, kind: kinds[b.purpose!], name: b.name, distanceM: b.distanceM,
      source: contextEvidence.sourceUrl ?? 'https://www.openstreetmap.org/copyright',
    }));
    return [site.id, proofs];
  }));
  return { sites, catalog, rates: ratesMap(rateEntries), rateEntries, social,
    provenance: { source, capturedAt, dataClass: source === 'mock' ? 'demo' : 'estimate',
      isDemo: source === 'mock', evidenceIds: [contextEvidence.id], siteVersion: null, ratesVersion } };
}
