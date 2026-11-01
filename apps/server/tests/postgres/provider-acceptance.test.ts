import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { postgresFixture } from './workflow-helpers.js';
import { privateTestStorage } from './private-test-storage.js';

test('operator HTTPS runner rehearsed over local real HTTP: full DEMO chain, restart/reseed, immutable manifest', {timeout:240000}, async t => {
  const storage=await privateTestStorage();t.after(()=>storage.stop());
  const f=await postgresFixture(t,storage.env);
  const {runAcceptance}=await import(new URL('../../scripts/cloud-https-acceptance.mjs',import.meta.url).href);
  const origin=new URL(f.base).origin, manifestPath=join(f.dir,'provider-acceptance.json');
  const options={manifestPath,origin,browserOrigin:origin,password:f.acceptancePassword,demoOptIn:'1',localTest:true};
  assert.equal((await runAcceptance({...options,mode:'create'})).result,'PASS');
  const raw=readFileSync(manifestPath,'utf8');
  assert(!raw.includes(f.acceptancePassword));assert(!raw.includes(storage.env.SUPABASE_SERVICE_ROLE_KEY));
  assert(!raw.includes('gp_v2_session='));assert(!raw.includes('csrfToken'));
  await assert.rejects(runAcceptance({...options,mode:'create'}), {code:'EEXIST'});
  const before=await f.snapshot(['users','tasks','reports','uploads','planting_receipts','outcome_snapshots','outcome_cohorts','outcome_inspections','outcome_sources','workflow_history']);
  await storage.stop();await f.stop();await storage.start();await f.restart();
  await f.reseed();
  assert.equal((await runAcceptance({...options,mode:'verify'})).result,'PASS');
  assert.deepEqual(await f.snapshot(['users','tasks','reports','uploads','planting_receipts','outcome_snapshots','outcome_cohorts','outcome_inspections','outcome_sources','workflow_history']),before);
  assert.equal(JSON.parse(readFileSync(manifestPath,'utf8')).checks.length,2);
  await assert.rejects(runAcceptance({...options,mode:'verify',localTest:false}));
  await assert.rejects(runAcceptance({...options,mode:'verify',demoOptIn:'0'}));
});
