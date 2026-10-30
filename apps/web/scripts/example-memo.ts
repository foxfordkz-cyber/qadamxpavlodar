import { writeFileSync } from 'node:fs';
import osm from '../../../fixtures/osm/sites.json';
import { species } from '../src/shared/api/mock/species';
import type { CandidateSite } from '../src/shared/api/types';
import { analyzeZone } from '../src/shared/analytics/plan';
import { DEFAULT_RATES, ratesMap } from '../src/shared/analytics/rates';
import { buildMemoDocx } from '../src/shared/export/memo';
const site = osm.sites[0] as unknown as CandidateSite;
const input = { zones: [{ site, analysis: analyzeZone(site, species, ratesMap(DEFAULT_RATES)) }], species, evidence: [], rates: DEFAULT_RATES, source: 'mock' as const, generatedAt: new Date().toISOString() };
for (const language of ['ru', 'kk'] as const) {
  const bytes = buildMemoDocx(input, language);
  const path = `dist-scripts/example-memo-${language}.docx`;
  writeFileSync(path, bytes);
  console.log(`${path}: ${bytes.length} bytes`);
}
