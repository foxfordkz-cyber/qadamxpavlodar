import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.env.DEMO_PASSWORD = randomBytes(24).toString('hex');
const { Store } = await import('../src/db.ts');
const { seed } = await import('../src/seed.ts');
const { seedV2 } = await import('../src/v2/seed.ts');
const { seedTz } = await import('../src/tz/seed.ts');
const { seedMunicipal, syncMunicipalZones } = await import('../src/municipal/data.ts');
const { createApp } = await import('../src/app.ts');
const { seedOutcomes } = await import('../src/outcomes/seed.ts');
const dir = mkdtempSync(join(tmpdir(), 'gp-outcomes-api-'));
const store = new Store(join(dir, 'test.sqlite'));
let server, vite;
try {
  seed(store); await seedV2(store); seedTz(store); await seedMunicipal(store); store.transaction(()=>syncMunicipalZones(store)); seedOutcomes(store);
  const app = createApp(store, { uploadsPath: join(dir, 'uploads'), frontendOrigins: ['http://127.0.0.1:5183'] });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const apiPort = server.address().port;
  vite = spawn(process.execPath, [fileURLToPath(new URL('../../web/node_modules/vite/bin/vite.js', import.meta.url)), '--host','127.0.0.1','--port','5183','--strictPort'], { cwd: fileURLToPath(new URL('../../web', import.meta.url)), windowsHide: true, env: {...process.env,VITE_API_PROXY:`http://127.0.0.1:${apiPort}`}, stdio:['ignore','pipe','pipe'] });
  let ready = false;
  for (let i=0; i<100; i++) { try { if ((await fetch('http://127.0.0.1:5183')).ok) {ready=true;break;} } catch {} await new Promise(r=>setTimeout(r,200)); }
  if(!ready) throw Error('Isolated Vite did not start');
  process.env.OUTCOMES_UI_BASE='http://127.0.0.1:5183';
  const {runOutcomeWorkflow}=await import('../../web/scripts/check-outcomes-workflow.mjs');
  await runOutcomeWorkflow('api',process.env.DEMO_PASSWORD);
} finally {
  if(vite) { vite.kill(); await once(vite,'exit').catch(()=>{}); }
  if(server) { server.closeAllConnections(); await new Promise(r=>server.close(r)); }
  store.close();
  if(resolve(dir).startsWith(resolve(tmpdir())+sep) && dir.includes('gp-outcomes-api-')) rmSync(dir,{recursive:true,force:true});
}
