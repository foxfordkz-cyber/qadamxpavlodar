// Run with esbuild as documented in docs/outcomes-contract.md. No files or APIs are changed.
import osm from '../../../fixtures/osm/sites.json';
import { species } from '../src/shared/api/mock/species';
import type { CandidateSite } from '../src/shared/api/types';
import { analyzeZone, type Variant } from '../src/shared/analytics/plan';
import { DEFAULT_RATES, ratesMap } from '../src/shared/analytics/rates';
import { calculateOutcomeVariant, compareOutcomeVariants } from '../src/shared/analytics/outcomes';

export function buildOutcomeExample() {
  const site = (osm.sites as unknown as CandidateSite[]).find(s => s.id === 'site-osm-1569993037');
  if (!site) throw new Error('The documented demo zone is absent');
  const provenance = { source: 'mock' as const, capturedAt: '2026-10-30T00:00:00+05:00', dataClass: 'demo' as const,
    isDemo: true, evidenceIds: [...site.evidenceIds, 'ev-demo-prices', 'ev-team-species-notes'],
    siteVersion: site.version, ratesVersion: null };
  const variants = (['econom', 'optimal', 'max'] as Variant[]).map(variant => {
    // The whole estimate is generated for a tree-only plan; no costs are stripped after analysis.
    const analysis = analyzeZone(site, species, ratesMap(DEFAULT_RATES), {
      variant, careYears: 3, excluded: species.filter(s => s.form !== 'tree').map(s => s.id),
    });
    return { analysis, outcome: calculateOutcomeVariant({ id: variant, site, analysis, catalog: species, rates: DEFAULT_RATES, provenance }) };
  });
  return { site: { id: site.id, name: site.name }, provenance, variants, comparison: compareOutcomeVariants(variants.map(v => v.outcome)) };
}

if (process.argv[1]?.endsWith('example-outcomes.mjs') || process.argv[1]?.endsWith('example-outcomes.ts')) {
  const example = buildOutcomeExample();
  console.log(JSON.stringify({ note: 'DEMO: team prices, synthetic soil, synthetic-trained y1 and expert y2/y3. Not municipal cost or field validation.',
    site: example.site, provenance: example.provenance,
    variants: example.variants.map(({ outcome: v }) => ({ id: v.id, treeCount: v.treeCount,
      expectedTreesY3: v.expectedTreesY3, cost: v.cost, costPerExpectedTreeKzt: v.costPerExpectedTreeKzt, issues: v.issues })),
    comparison: example.comparison }, null, 2));
}
