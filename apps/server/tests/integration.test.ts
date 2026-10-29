import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { fixture, coordinator, w1, w2 } from './helpers.js';
import { routes, openapiPath, buildOpenApi } from '../src/contracts.js';
import { PhotoStorage, MAX_PHOTO_BYTES } from '../src/photos.js';
import { localDayRange } from '../src/time.js';
import { Store } from '../src/db.js';
import { schema } from '../src/schema.js';
import { seed } from '../src/seed.js';
import { mockAdapter, type AiAdapter } from '../src/ai-boundary.js';
import { networkAudit } from '../scripts/local-network-guard.mjs';
import net from 'node:net';
import dns from 'node:dns';

const synthetic = (format: 'png' | 'jpeg' | 'webp' = 'png', color = '#24874b') =>
  sharp({create:{width:24,height:16,channels:3,background:color}}).withMetadata().toFormat(format).toBuffer();

test('OpenAPI inventory equals actual Express routes; legacy responses and local Swagger assets conform', async t => {
  const f = await fixture(t);
  const actual = f.app.router.stack.flatMap((layer: any) => layer.route ? Object.keys(layer.route.methods)
    .map(method => `${method} ${openapiPath(layer.route.path)}`) : []).sort();
  const spec = (await f.request('/openapi.json','GET',null)).body;
  const documented = Object.entries(spec.paths).flatMap(([path,methods]) => Object.keys(methods as object).map(m => `${m} ${path}`)).sort();
  assert.deepEqual(actual,documented);
  assert.equal(actual.length,Object.keys(routes).length);
  assert.equal(spec.openapi,'3.1.0');
  for (const path of ['/health','/plants','/plants/demo-plant-1','/candidate-sites','/workers','/tasks','/tasks/demo-task-1','/tasks/demo-task-1/history']) {
    assert.equal((await f.request(path)).status,200);
  }
  const created = await f.request('/tasks','POST',coordinator,{title:'DEMO contract sample',assignedToId:w1,plantId:'demo-plant-1'},'contract-create');
  assert.equal(created.status,201);
  const taskId = created.body.data.id;
  assert.equal((await f.request(`/tasks/${taskId}`,'PATCH',w1,{version:1,status:'in_progress'},'contract-start')).status,200);
  const report = await f.request('/reports','POST',w1,{taskId,version:2,notes:'DEMO contract report'},'contract-report');
  assert.equal(report.status,201);
  assert.equal((await f.request(`/reports/${report.body.data.id}`)).status,200);
  assert.equal((await f.request(`/reports/${report.body.data.id}`,'GET',w2)).status,404);
  const photo = await f.upload(report.body.data.id,await synthetic(),'legacy-photo',false);
  assert.equal(photo.status,201);
  const bytes = await fetch(f.base+photo.body.data.contentUrl,{headers:{'X-Demo-User':w1}});
  assert.equal(bytes.status,200); await bytes.arrayBuffer();
  const docs = await fetch(f.base+'/api-docs'); assert.equal(docs.status,200);
  const html = await docs.text(); assert(html.includes('swagger-ui-bundle.js')); assert(!/<(?:script|link)[^>]*(?:src|href)="https?:/i.test(html));
  for (const asset of ['swagger-ui.css','swagger-ui-bundle.js','init.js']) {
    const response = await fetch(`${f.base}/api-docs/assets/${asset}`); assert.equal(response.status,200);
    const text = await response.text(); if (asset==='init.js') assert(text.includes('validatorUrl:null'));
  }
});

test('experimental return/rework/verification preserves all transitions and isolates legacy tables', async t => {
  const f = await fixture(t);
  const before = JSON.stringify(f.store.all('SELECT * FROM tasks ORDER BY id'));
  const run = await f.submitted();
  assert.equal((await f.request(`/experimental/tasks/${run.taskId}`,'GET',w2)).status,404);
  assert.equal((await run.transition({action:'verify',version:4},w1,'worker-verify')).status,403);
  assert.equal((await run.transition({action:'return',version:4,comment:'  '},coordinator,'empty-return')).status,400);
  assert.equal((await run.transition({action:'return',version:4,comment:'DEMO add detail'},coordinator,'return')).status,200);
  assert.equal((await f.request(`/experimental/reports/${run.reportId}`)).body.data.status,'returned');
  assert.equal((await run.transition({action:'verify',version:5},coordinator,'invalid-verify')).status,409);
  assert.equal((await run.transition({action:'start',version:5},w2,'foreign-start')).status,404);
  assert.equal((await run.transition({action:'start',version:5},w1,'restart')).status,200);
  const revision2 = await f.request('/experimental/reports','POST',w1,{taskId:run.taskId,version:6,notes:'DEMO corrected'},'revision2');
  assert.equal(revision2.status,201); assert.equal(revision2.body.data.revision,2);
  assert.equal((await run.transition({action:'verify',version:7,comment:'DEMO accepted'},coordinator,'verify')).status,200);
  assert.equal((await f.request(`/experimental/reports/${revision2.body.data.id}`)).body.data.status,'verified');
  const detail = await f.request(`/experimental/tasks/${run.taskId}`);
  assert.deepEqual(detail.body.reports.map((r:any)=>r.id),[run.reportId,revision2.body.data.id]);
  assert.equal((await run.transition({action:'return',version:8,comment:'DEMO too late'},coordinator,'terminal')).status,409);
  const history = (await f.request(`/experimental/tasks/${run.taskId}/history`)).body.data;
  assert.deepEqual(history.map((r:any)=>r.action),['create','assign','start','submit','return','start','submit','verify']);
  assert.equal(history[4].comment,'DEMO add detail');
  assert.deepEqual(history.map((r:any)=>r.version),[1,2,3,4,5,6,7,8]);
  assert.equal((await f.request('/experimental/tasks','GET',w1)).body.data.length,1);
  assert.equal((await f.request('/experimental/tasks','GET',w2)).body.data.length,0);
  assert.equal(before,JSON.stringify(f.store.all('SELECT * FROM tasks ORDER BY id')));
  seed(f.store); assert.equal(f.store.get('SELECT count(*) AS n FROM experimental_task_history')?.n,8);
});

test('experimental version competition and idempotency prevent duplicate or conflicting review', async t => {
  const f = await fixture(t); const run = await f.submitted();
  const results = await Promise.all([
    run.transition({action:'verify',version:4},coordinator,'review-a'),
    run.transition({action:'return',version:4,comment:'DEMO return'},coordinator,'review-b')
  ]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const winner = results.findIndex(r=>r.status===200);
  const payload = winner===0 ? {action:'verify',version:4} : {action:'return',version:4,comment:'DEMO return'};
  const key = winner===0 ? 'review-a' : 'review-b';
  const replay = await run.transition(payload,coordinator,key);
  assert.equal(replay.status,200); assert.equal(replay.headers.get('Idempotency-Replayed'),'true');
  assert.equal((await run.transition({...payload,version:5},coordinator,key)).status,409);
  assert.equal(f.store.get('SELECT count(*) AS n FROM experimental_task_history')?.n,5);
});

test('photo decoding, private read access, traversal filenames and multipart replay', async t => {
  const f = await fixture(t); const run = await f.submitted();
  let version = 4; let first: any; let original: Buffer | undefined;
  for (const format of ['png','jpeg','webp'] as const) {
    const input = await synthetic(format);
    const result = await f.upload(run.reportId,input,`photo-${format}`,true,version);
    assert.equal(result.status,201); version++;
    assert.equal(result.body.task.version,version);
    if (!first) { first = result; original = input; }
    const response = await fetch(f.base+result.body.data.contentUrl,{headers:{'X-Demo-User':coordinator}});
    assert.equal(response.status,200); assert.equal(response.headers.get('Content-Type'),'image/webp');
    const buffer = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(buffer).metadata();
    assert.equal(metadata.format,'webp'); assert.equal(metadata.exif,undefined);
    assert.equal(metadata.width,24); assert(!JSON.stringify(result.body).includes('storageName'));
  }
  assert.equal(readdirSync(f.uploads).filter(n=>n.endsWith('.webp')).length,3);
  assert.deepEqual(readdirSync(join(f.uploads,'.tmp')),[]);
  const replay = await f.upload(run.reportId,original!,'photo-png',true,4);
  assert.equal(replay.status,201); assert.equal(replay.headers.get('Idempotency-Replayed'),'true');
  assert.deepEqual(replay.body,first.body);
  assert.equal((await f.upload(run.reportId,await synthetic('png','#ff0000'),'photo-png',true,4)).status,409);
  assert.equal((await f.upload(run.reportId,original!,'foreign-photo',true,version,w2)).status,404);
  assert.equal((await f.request(`/experimental/reports/${run.reportId}`,'GET',w2)).status,404);
  const foreign = await fetch(f.base+first.body.data.contentUrl,{headers:{'X-Demo-User':w2}});
  assert.equal(foreign.status,404); await foreign.arrayBuffer();
  const anonymous = await fetch(f.base+first.body.data.contentUrl);
  assert.equal(anonymous.status,401); await anonymous.arrayBuffer();
  assert.equal((await f.request('/uploads/'+first.body.data.id+'.webp')).status,404);
  assert.equal((await run.transition({action:'verify',version:4},coordinator,'stale-photo-review')).status,409);
  assert.equal((await run.transition({action:'verify',version},coordinator,'review')).status,200);
  assert.equal((await f.upload(run.reportId,original!,'late-photo',true,version+1)).status,409);
});

test('invalid, oversized, truncated and over-dimension photos are rejected without files or metadata', async t => {
  const f = await fixture(t); const run = await f.submitted();
  const badInputs = [Buffer.from('<svg><script>DEMO</script></svg>'),Buffer.from([137,80,78,71,13,10,26,10,0])];
  for (let i=0;i<badInputs.length;i++) assert.equal((await f.upload(run.reportId,badInputs[i]!,`bad-${i}`,true,4)).status,415);
  assert.equal((await f.upload(run.reportId,Buffer.alloc(MAX_PHOTO_BYTES+1),'too-big',true,4)).status,413);
  const wide = await sharp({create:{width:5000,height:1,channels:3,background:'#228844'}}).png().toBuffer();
  assert.equal((await f.upload(run.reportId,wide,'wide',true,4)).status,413);
  assert.equal(f.store.get('SELECT count(*) AS n FROM experimental_photos')?.n,0);
  assert.deepEqual(readdirSync(f.uploads),['.tmp']);
  assert.deepEqual(readdirSync(join(f.uploads,'.tmp')),[]);
});

test('photo/history failure rolls back metadata and removes staged files; cleanup preserves referenced and unrelated files', async t => {
  const f = await fixture(t); const run = await f.submitted(); const input = await synthetic();
  f.store.db.exec("CREATE TRIGGER fail_photo_history BEFORE INSERT ON experimental_task_history WHEN NEW.action='attach_photo' BEGIN SELECT RAISE(ABORT,'DEMO failure'); END");
  assert.equal((await f.upload(run.reportId,input,'failed-photo',true,4)).status,500);
  assert.equal(f.store.get('SELECT count(*) AS n FROM experimental_photos')?.n,0);
  assert.equal(f.store.get('SELECT version FROM experimental_tasks WHERE id=?',run.taskId)?.version,4);
  assert.deepEqual(readdirSync(f.uploads),['.tmp']); assert.deepEqual(readdirSync(join(f.uploads,'.tmp')),[]);
  f.store.db.exec('DROP TRIGGER fail_photo_history');
  const success = await f.upload(run.reportId,input,'failed-photo',true,4); assert.equal(success.status,201);
  const storedName = String(f.store.get('SELECT storage_name FROM experimental_photos WHERE id=?',success.body.data.id)!.storage_name);
  const orphan = `${randomUUID()}.webp`, temp = `${randomUUID()}.tmp`;
  writeFileSync(join(f.uploads,orphan),'DEMO orphan'); writeFileSync(join(f.uploads,'.tmp',temp),'DEMO temp');
  writeFileSync(join(f.uploads,'keep.txt'),'DEMO unrelated local file');
  const old = new Date(Date.now()-48*3600000);
  for (const path of [join(f.uploads,orphan),join(f.uploads,'.tmp',temp),join(f.uploads,storedName)]) utimesSync(path,old,old);
  new PhotoStorage(f.uploads).cleanupOrphans(f.store);
  assert.deepEqual(readdirSync(f.uploads).sort(),['.tmp','keep.txt',storedName].sort());
  assert.deepEqual(readdirSync(join(f.uploads,'.tmp')),[]);
  writeFileSync(join(f.uploads,storedName),'DEMO corrupt bytes');
  const corrupt = await fetch(f.base+success.body.data.contentUrl,{headers:{'X-Demo-User':coordinator}});
  assert.equal(corrupt.status,503); await corrupt.arrayBuffer();
});

test('local frontend preflight works and remote origins remain forbidden', async t => {
  const f = await fixture(t,{frontendOrigins:['http://localhost:5173']});
  const preflight = await fetch(f.base+'/experimental/tasks',{method:'OPTIONS',headers:{Origin:'http://localhost:5173','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-demo-user,idempotency-key'}});
  assert.equal(preflight.status,204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'http://localhost:5173');
  const sameOrigin = await fetch(f.base+'/experimental/tasks',{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json','X-Demo-User':coordinator,'Idempotency-Key':'swagger-create'},body:JSON.stringify({title:'DEMO Swagger',plantId:'demo-plant-1'})});
  assert.equal(sameOrigin.status,201); await sameOrigin.arrayBuffer();
  const evil = await fetch(f.base+'/health',{headers:{Origin:'https://remote.example'}});
  assert.equal(evil.status,403); assert.equal(evil.headers.get('Access-Control-Allow-Origin'),null); await evil.arrayBuffer();
});

test('CSV preview checks schema, coordinates and duplicates without importing or overwriting', async t => {
  const f = await fixture(t); const before = JSON.stringify(f.store.all('SELECT * FROM plants ORDER BY id'));
  const csv = ['id,name,species,latitude,longitude,condition',
    'csv-a,DEMO A,DEMO Tree,52.2,76.9,good',
    'csv-b,DEMO Bad,DEMO Tree,91,76.9,good',
    'csv-dup,DEMO D,DEMO Tree,52.3,76.8,unknown',
    'csv-dup,DEMO D,DEMO Tree,52.3,76.8,unknown',
    'demo-plant-1,DEMO Existing,DEMO Tree,52,76,good',
    'csv-name,DEMO Растение 1,DEMO Tree,52.4,76.7,good'].join('\n');
  const result = await f.request('/imports/plants/preview','POST',coordinator,{csv});
  assert.equal(result.status,200); assert.deepEqual(result.body.counts,{total:6,valid:2,invalid:4});
  assert.equal(result.body.imported,0); assert.equal(result.body.previewOnly,true); assert.equal(result.body.rows[5].warnings.length,1);
  assert.equal(before,JSON.stringify(f.store.all('SELECT * FROM plants ORDER BY id')));
  assert.equal((await f.request('/imports/plants/preview','POST',coordinator,{csv:'id,name\na,DEMO'})).status,400);
  assert.equal((await f.request('/imports/plants/preview','POST',w1,{csv})).status,403);
  assert.equal((await f.request('/plants?siteId=demo-site-1')).status,400);
});

test('map coordinates and UTC+5 day boundaries use correct order and exclusive next-day end', async t => {
  const f = await fixture(t);
  const filtered = await f.request('/plants?condition=needs_care'); assert.equal(filtered.body.data.length,10);
  const geo = await f.request('/plants/geojson?condition=needs_care&limit=1');
  const plant = filtered.body.data[0];
  assert.deepEqual(geo.body.features[0].geometry.coordinates,[plant.longitude,plant.latitude]);
  assert.deepEqual(localDayRange('2026-10-27'),{start:'2026-10-26T19:00:00.000Z',end:'2026-10-27T19:00:00.000Z'});
  const times = ['2026-10-26T18:59:59.999Z','2026-10-26T19:00:00.000Z','2026-10-27T18:59:59.999Z','2026-10-27T19:00:00.000Z'];
  times.forEach((time,i)=>f.store.run('UPDATE tasks SET created_at=? WHERE id=?',time,`demo-task-${i+1}`));
  const ids = (await f.request('/tasks?date=2026-10-27')).body.data.map((row:any)=>row.id);
  assert(!ids.includes('demo-task-1')); assert(ids.includes('demo-task-2')); assert(ids.includes('demo-task-3')); assert(!ids.includes('demo-task-4'));
  assert.equal((await f.request('/tasks?date=2026-02-30')).status,400);
  assert.throws(()=>localDayRange('2026-02-29'));
  assert.equal(localDayRange('2028-02-29').start,'2028-02-28T19:00:00.000Z');
});

test('AI mock produces validated drafts and only a coordinator confirmation can create an isolated draft task', async t => {
  const f = await fixture(t); const before = JSON.stringify(f.store.all('SELECT * FROM tasks ORDER BY id'));
  const snapshot = (await f.request('/experimental/ai/snapshot')).body.data;
  const proposal = await f.request('/experimental/ai/proposals','POST',coordinator,{snapshotVersion:snapshot.version},'ai-proposal');
  assert.equal(proposal.status,201); assert.equal(proposal.body.data.status,'draft');
  assert.equal(f.store.get('SELECT count(*) AS n FROM experimental_tasks')?.n,0);
  const second = await f.request('/experimental/ai/proposals','POST',coordinator,{snapshotVersion:snapshot.version},'ai-proposal2');
  assert.deepEqual(proposal.body.data.proposal,second.body.data.proposal);
  const confirmPath = `/experimental/ai/proposals/${proposal.body.data.id}/confirm`;
  assert.equal((await f.request(confirmPath,'POST',w1,{version:1,snapshotVersion:snapshot.version},'worker-confirm')).status,403);
  const confirmed = await f.request(confirmPath,'POST',coordinator,{version:1,snapshotVersion:snapshot.version},'ai-confirm');
  assert.equal(confirmed.status,200); assert.equal(confirmed.body.task.status,'draft'); assert.equal(confirmed.body.task.assignedToId,null);
  assert.equal(before,JSON.stringify(f.store.all('SELECT * FROM tasks ORDER BY id')));
  assert.deepEqual((await f.request('/experimental/ai/proposals','POST',coordinator,{snapshotVersion:snapshot.version},'ai-proposal')).body,proposal.body);
  assert.equal((await f.request(`/experimental/ai/proposals/${second.body.data.id}/confirm`,'POST',coordinator,{version:1,snapshotVersion:snapshot.version},'stale-confirm')).status,409);
});

test('AI adapter errors, timeouts and untrusted extra fields leave normal APIs and task tables intact', async t => {
  const adapters: AiAdapter[] = [async()=>{throw new Error('DEMO failure');},async()=>new Promise(()=>{}),
    async snapshot=>({...await mockAdapter(snapshot) as object,executeSql:'DELETE FROM tasks'}),
    async snapshot=>({label:'DEMO',snapshotVersion:snapshot.version,reason:'DEMO invalid target',suggestedTask:{title:'DEMO',plantId:'missing'}})];
  for (let i=0;i<adapters.length;i++) {
    const f = await fixture(t,{aiAdapter:adapters[i]});
    const snapshot = (await f.request('/experimental/ai/snapshot')).body.data;
    const result = await f.request('/experimental/ai/proposals','POST',coordinator,{snapshotVersion:snapshot.version},'ai-fail');
    assert.equal(result.status,i===3 ? 502 : 503);
    assert.equal((await f.request('/health')).status,200); assert.equal((await f.request('/tasks')).body.data.length,15);
    assert.equal(f.store.get('SELECT count(*) AS n FROM experimental_tasks')?.n,0);
    assert.equal(f.store.get('SELECT count(*) AS n FROM ai_proposals')?.n,0);
  }
});

test('v1 migration is additive and repeat-open/seed preserve legacy records', async t => {
  const f = await fixture(t); const path = join(f.dir,'migration-v1.sqlite');
  const old = new DatabaseSync(path);
  old.exec(schema+'PRAGMA user_version=1;');
  old.prepare('INSERT INTO plants VALUES (?,?,?,?,?,?,0)').run('custom-local','DEMO preserved user record','DEMO Species',52.3,76.9,'good');
  old.close();
  const migrated = new Store(path);
  assert.equal(migrated.get('PRAGMA user_version')?.user_version,5);
  seed(migrated); seed(migrated);
  assert.equal(migrated.get('SELECT name FROM plants WHERE id=?','custom-local')?.name,'DEMO preserved user record');
  assert.equal(migrated.get('SELECT count(*) AS n FROM plants')?.n,31);
  assert.deepEqual(migrated.all('PRAGMA foreign_key_check'),[]); migrated.close();
  const reopened = new Store(path); assert.equal(reopened.get('PRAGMA integrity_check')?.integrity_check,'ok'); reopened.close();
});

test('application scenarios make no external network attempts; preparation guard blocks TCP and DNS egress', async t => {
  // All preceding tests in this process used the guard; no adapter or doc asset tried to leave loopback.
  assert.deepEqual(networkAudit().blocked,[]);
  const f = await fixture(t); const run = await f.submitted();
  assert.equal((await f.upload(run.reportId,await synthetic(),'offline-photo',true,4)).status,201);
  const snapshot = (await f.request('/experimental/ai/snapshot')).body.data;
  assert.equal((await f.request('/experimental/ai/proposals','POST',coordinator,{snapshotVersion:snapshot.version},'offline-ai')).status,201);
  assert.equal((await f.request('/openapi.json','GET',null)).status,200);
  assert.deepEqual(networkAudit().blocked,[]);
  assert.throws(()=>net.createConnection({host:'198.51.100.1',port:443}),/LOCAL_NETWORK_ONLY/);
  await assert.rejects(dns.promises.resolve4('never-contact.example'),/LOCAL_NETWORK_ONLY/);
  assert.equal(networkAudit().blocked.length,2);
});
