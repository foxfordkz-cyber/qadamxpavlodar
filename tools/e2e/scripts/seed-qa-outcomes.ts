import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { Store } from '../../../apps/server/src/db.ts';
import { loadConfig } from '../../../apps/server/src/config.ts';
import { insertDoc } from '../../../apps/server/src/v2/core.ts';

const allowed = fileURLToPath(new URL('../test-results/', import.meta.url));
const target = process.env.STORAGE_ROOT ? resolve(process.env.STORAGE_ROOT) : '';
const rel = target ? relative(allowed, target) : '..';
if (!rel || rel.startsWith('..') || isAbsolute(rel) || !rel.startsWith('isolated-api-')) throw new Error('QA fixtures require a private isolated-api directory under tools/e2e/test-results');
const reference = JSON.parse(readFileSync(new URL('../reference/outcomes-cases.json', import.meta.url), 'utf8'));
const store = new Store(loadConfig().dbPath);
try {
  // ONLY canonical demo plant records. Cohorts and observations are created through
  // the real HTTP endpoints by the tests; no analytics results are injected.
  store.transaction(() => {
    for (let i = 1; i <= 4; i++) insertDoc(store, 'plant', {
      id: `qa-parity-p${i}`, name: 'QA synthetic parity reference tree', kind: 'tree',
      siteId: 'site-osm-1569993037', speciesId: 'sp-pinus-sylvestris', species: 'Pinus sylvestris',
      plantedAt: '2023-10-30T12:00:00+05:00', condition: 'unknown',
      evidenceIds: ['outcomes-demo-evidence'], isDemo: true, version: 1,
    });
    for (const c of reference.inspectionCases) for (let i = 1; i <= 4; i++) insertDoc(store, 'plant', {
      id: `qa-api-${c.id}-p${i}`, name: 'QA synthetic P4 reference tree', kind: 'tree',
      siteId: 'site-osm-1569993037', speciesId: 'sp-pinus-sylvestris', species: 'Pinus sylvestris',
      plantedAt: `${reference.cohortReference.plantedOn}T12:00:00+05:00`,
      condition: 'unknown', evidenceIds: ['outcomes-demo-evidence'], isDemo: true, version: 1,
    });
  });
  console.log('QA P4 synthetic registry fixtures added to the private database.');
} finally { store.close(); }
