import { resolve, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { Store } from '../../../apps/server/src/db.ts';
import { loadConfig } from '../../../apps/server/src/config.ts';
import { getUser, parseRow } from '../../../apps/server/src/v2/core.ts';
import { hashPassword } from '../../../apps/server/src/v2/auth.ts';
import { createUser, workers } from '../../../apps/server/src/v2/people.ts';
import { insertTask, assign, assignWorkers, start, taskCreate } from '../../../apps/server/src/v2/tasks.ts';
import { submit } from '../../../apps/server/src/v2/reports.ts';

const allowed = fileURLToPath(new URL('../test-results/', import.meta.url));
const target = process.env.STORAGE_ROOT ? resolve(process.env.STORAGE_ROOT) : '';
const rel = target ? relative(allowed, target) : '..';
if (process.env.E2E_ISOLATED !== '1' || !rel || rel.startsWith('..') || isAbsolute(rel) || !rel.startsWith('isolated-api-')) {
  throw new Error('QA permission fixtures require a private isolated-api directory under tools/e2e/test-results');
}
const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 12) throw new Error('Isolated demo password must be supplied in the process environment');
const passwordHash = await hashPassword(password);
const store = new Store(loadConfig().dbPath);
try {
  const admin = getUser(store, 'demo-admin-1'), coordinator = getUser(store, 'demo-coordinator-1');
  const foreman = getUser(store, 'demo-foreman-1'), worker = getUser(store, 'demo-worker-1');
  const fixture = store.transaction(() => {
    // Independent viewer accounts keep active failing cases from exhausting the
    // product's genuine per-account login limit after Playwright restarts workers.
    const viewerLogins = Array.from({ length: 24 }, (_, index) => `qa-final-viewer-${index + 1}`);
    for (const [index, login] of viewerLogins.entries()) {
      createUser(store, admin, { login, displayName: `QA DEMO Просмотр ${index + 1}`, role: 'viewer', password }, passwordHash);
    }
    const tasks: Record<string, any> = {};
    for (const [index, name] of ['viewer-read', 'worker-1280', 'worker-375'].entries()) {
      let task = insertTask(store, coordinator, taskCreate.parse({ objectType: 'candidate_site', objectId: 'site-osm-1569993037',
        action: 'inspect', description: `QA DEMO isolated ${name}`, priority: 'medium', estimatedMinutes: 15,
        minWorkers: 1, requiredSkills: ['inspect'], evidenceIds: ['demo-v2-evidence'] }));
      task = assign(store, coordinator, task.id, { expectedVersion: task.version, crewId: 'demo-crew-1', resourceIds: [],
        scheduledStart: `2026-10-28T0${3 + index}:00:00.000Z`, scheduledEnd: `2026-10-28T0${3 + index}:15:00.000Z` });
      task = assignWorkers(store, foreman, task.id, { expectedVersion: task.version, workerIds: ['demo-worker-1'] });
      tasks[name] = start(store, worker, task.id, task.version);
    }
    const sent = submit(store, worker, tasks['viewer-read'].id, { expectedVersion: tasks['viewer-read'].version,
      note: 'QA DEMO existing report for read-only acceptance', photoIds: [], actualWorkerIds: ['demo-worker-1'],
      actualPlantingItems: [], location: null, confirmedObservation: null }, 'qa-permissions-seed-report');
    tasks['viewer-read'] = sent.task;
    return { isDemo: true, source: 'QA isolated synthetic permissions fixtures', viewerLogins, tasks, report: sent.report,
      crews: store.all('SELECT data FROM v2_crews ORDER BY id').map(row => parseRow(row)).map(c => ({ id: c.id, name: c.name })),
      workers: workers(store, coordinator).map(w => ({ id: w.id, displayName: w.displayName })) };
  });
  writeFileSync(join(target, 'qa-permissions.json'), JSON.stringify(fixture, null, 2));
  console.log('QA synthetic viewer/task/report fixtures created in the private database; no credentials written to the fixture manifest.');
} finally { store.close(); }
