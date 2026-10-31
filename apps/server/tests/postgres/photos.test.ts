import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { writeFileSync,existsSync } from 'node:fs';
import sharp from 'sharp';
import { postgresFixture } from './workflow-helpers.js';
import { privateTestStorage } from './private-test-storage.js';
import { fixedTestProxy } from './fixed-test-proxy.js';
import { workflowScenario } from './scenario.js';
import { SupabasePrivateStorage } from '../../src/cloud/private-storage.js';
import { CloudPhotos } from '../../src/cloud/photo-service.js';
import { PostgresWorkflowRepository } from '../../src/cloud/workflow-repository.js';
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
test('Stage C: private multipart → actual HTTP storage → PostgreSQL → report → acceptance → viewer, failures and three-service restart',{timeout:420000},async t=>{
 const storage=await privateTestStorage();t.after(()=>storage.stop());
 const f=await postgresFixture(t,{...storage.env,FRONTEND_ORIGINS:'https://green-pavlodar-mock.pages.dev'}),s=await workflowScenario(f);let task:any,photo:any,accepted:any,bytes:Buffer;
 const input=await sharp({create:{width:12,height:12,channels:3,background:'#15803d'}}).withMetadata().png().toBuffer();let serial=0;
 const tables=['users','documents','tasks','assignments','reports','uploads','upload_intents','workflow_history','idempotency'];
 async function step(name:string,work:()=>Promise<void>){let failed=false;await t.test(name,async()=>{try{await work();}catch(e){failed=true;throw e;}});if(failed)throw Error('Dependent photo acceptance stopped after '+name);}
 async function upload(taskId:string,role=s.workerLogin,key='photo-'+(++serial),file=input,extraField=false,base=f.base){
  const a=f.sessions.get(role)??await f.login(role),form=new FormData();form.set('taskId',taskId);form.set('file',new Blob([new Uint8Array(file)],{type:'image/png'}),'../../unsafe-name.png');if(extraField)form.set('other','unexpected');
  const res=await fetch(base+'/uploads',{method:'POST',headers:{Origin:'https://green-pavlodar-mock.pages.dev',Cookie:a.cookie,'X-CSRF-Token':a.csrf,'Idempotency-Key':key},body:form});
  const body=await res.json() as any;f.validate('/uploads','POST',res.status,body);return {status:res.status,body,replayed:res.headers.get('Idempotency-Replayed')};
 }
 async function download(id:string,role='viewer',base=f.base){
  const a=f.sessions.get(role)??await f.login(role);const res=await fetch(base+'/uploads/'+id,{headers:{Origin:'https://green-pavlodar-mock.pages.dev',Cookie:a.cookie}});
  return {status:res.status,headers:res.headers,bytes:Buffer.from(await res.arrayBuffer())};
 }
 await step('image normalization, private object name, public DTO and real authenticated download',async()=>{
  task=await s.startTask();const up=await upload(task.id,s.workerLogin,'main-photo');assert.equal(up.status,201,up.body.error?.code);photo=up.body.data;
  assert.equal(photo.taskId,task.id);assert.equal(photo.ownerId,s.worker.id);assert.equal(photo.reportId,null);assert.equal(photo.mediaType,'image/webp');assert.equal(photo.contentUrl,'/api/v1/uploads/'+photo.id);
  assert(!JSON.stringify(photo).includes('storage_name'));const row=(await f.db.pool.query('SELECT * FROM gp_cloud.uploads WHERE id=$1',[photo.id])).rows[0];assert.match(row.storage_name,/^demo\/[a-f0-9-]{36}\.webp$/);
  const read=await download(photo.id);assert.equal(read.status,200);bytes=read.bytes;assert.equal(digest(bytes),photo.sha256);assert.equal(bytes.length,photo.byteSize);assert.match(read.headers.get('content-type')!,/image\/webp/);
  const metadata=await sharp(bytes).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.exif,undefined);assert.equal(metadata.icc,undefined);
  const direct=await fetch(storage.origin+'/storage/v1/object/public/gp-private-test/'+row.storage_name);assert.equal(direct.status,403);await direct.arrayBuffer();
  assert.equal((await download(photo.id,s.otherLogin)).status,404);
  assert.equal((await fetch(f.base+'/uploads/'+photo.id)).status,401);
 });
 await step('viewer/coordinator denial, invalid/malformed/oversize images and multipart limits do not create objects',async()=>{
  const before=storage.objectNames();
  assert.equal((await upload(task.id,'viewer')).status,403);assert.equal((await upload(task.id,'coordinator')).status,403);assert.equal((await upload(task.id,s.otherLogin)).status,404);
  assert.equal((await upload(task.id,s.workerLogin,'svg',Buffer.from('<svg/>'))).status,415);
  assert.equal((await upload(task.id,s.workerLogin,'large',Buffer.alloc(5*1024*1024+1))).status,413);
  const wide=await sharp({create:{width:4097,height:1,channels:3,background:'#15803d'}}).png().toBuffer();assert.equal((await upload(task.id,s.workerLogin,'wide',wide)).status,413);
  assert.equal((await upload(task.id,s.workerLogin,'extra-field',input,true)).status,400);
  assert.deepEqual(storage.objectNames(),before);
 });
 await step('concurrent and lost-response replay create exactly one object/metadata/receipt',async()=>{
  const before=storage.counts.puts;const repeats=await Promise.all([1,2,3].map(()=>upload(task.id,s.workerLogin,'concurrent-photo')));
  assert(repeats.every(r=>r.status===201));assert.equal(new Set(repeats.map(r=>r.body.data.id)).size,1);assert.equal(storage.counts.puts,before+1);
  const other=await sharp({create:{width:2,height:2,channels:3,background:'#000000'}}).png().toBuffer();assert.equal((await upload(task.id,s.workerLogin,'concurrent-photo',other)).status,409);
  const a=f.sessions.get(s.workerLogin)!,form=new FormData();form.set('taskId',task.id);form.set('file',new Blob([new Uint8Array(input)],{type:'image/png'}),'demo.png');
  const lost=await fetch(f.base+'/uploads',{method:'POST',headers:{Cookie:a.cookie,'X-CSRF-Token':a.csrf,'Idempotency-Key':'photo-lost-response'},body:form});assert.equal(lost.status,201);await lost.body?.cancel();
  const replay=await upload(task.id,s.workerLogin,'photo-lost-response');assert.equal(replay.replayed,'true');
  assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM gp_cloud.idempotency WHERE key='photo-lost-response'")).rows[0].n,1);
 });
 await step('remote success + late PostgreSQL failure retains durable intent; same-key retry reconciles without overwrite',async()=>{
  await f.db.pool.query("ALTER TABLE gp_cloud.uploads ADD CONSTRAINT test_upload_fail CHECK(task_id<>'"+task.id+"') NOT VALID");
  const objects=storage.counts.puts;
  try{assert.equal((await upload(task.id,s.workerLogin,'db-failed-photo')).status,503);}finally{await f.db.pool.query('ALTER TABLE gp_cloud.uploads DROP CONSTRAINT test_upload_fail');}
  assert.equal(storage.counts.puts,objects+1);const intent=(await f.db.pool.query("SELECT * FROM gp_cloud.upload_intents WHERE key='db-failed-photo'")).rows[0];assert.equal(intent.state,'pending');
  assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM gp_cloud.uploads WHERE id=$1',[intent.id])).rows[0].n,0);
  assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM gp_cloud.idempotency WHERE key='db-failed-photo'")).rows[0].n,0);
  assert.equal((await upload(task.id,s.workerLogin,'db-failed-photo')).status,201);assert.equal(storage.counts.puts,objects+1);
  storage.losePutResponse();assert.equal((await upload(task.id,s.workerLogin,'storage-lost-response')).status,503);
  const stored=storage.counts.puts;assert.equal((await upload(task.id,s.workerLogin,'storage-lost-response')).status,201);assert.equal(storage.counts.puts,stored);
 });
 await step('provider failure/public bucket/corruption never return success; no disk fallback',async()=>{
  storage.setOffline(true);try{assert.equal((await upload(task.id,s.workerLogin,'outage')).status,503);assert.equal((await download(photo.id)).status,503);assert.equal((await fetch(f.base+'/ready')).status,503);}finally{storage.setOffline(false);}
  storage.setPublic(true);try{assert.equal((await upload(task.id,s.workerLogin,'public')).status,503);assert.equal((await download(photo.id)).status,503);}finally{storage.setPublic(false);}
  const corrupt=await upload(task.id,s.workerLogin,'corrupt');assert.equal(corrupt.status,201);storage.corrupt('demo/'+corrupt.body.data.id+'.webp');assert.equal((await download(corrupt.body.data.id)).status,503);
  assert(!existsSync(join(f.dir,'uploads')),'Cloud may not create a local uploads fallback');
 });
 await step('only aged pending unreferenced intents can be cleaned; committed report photos survive',async()=>{
  storage.losePutResponse();assert.equal((await upload(task.id,s.workerLogin,'orphan-cleanup')).status,503);
  await f.db.pool.query("UPDATE gp_cloud.upload_intents SET updated_at='2000-01-01T00:00:00.000Z' WHERE key='orphan-cleanup'");
  const intent=(await f.db.pool.query("SELECT * FROM gp_cloud.upload_intents WHERE key='orphan-cleanup'")).rows[0];
  const service=new CloudPhotos(new PostgresWorkflowRepository(f.db),new SupabasePrivateStorage(storage.config));const cutoff=new Date(Date.now()-86400000).toISOString();
  const dry=await f.cli('dist/cloud/photo-reconcile-cli.js');assert.equal(dry.code,0);assert.deepEqual(JSON.parse(dry.output),{candidates:1,cleaned:0,dryRun:true});assert(storage.objectNames().includes(intent.storage_name));
  storage.setDeleteFailure(true);try{await assert.rejects(service.reconcile(cutoff,true),{code:'PHOTO_UNAVAILABLE'});}finally{storage.setDeleteFailure(false);}
  assert.equal((await f.db.pool.query('SELECT state FROM gp_cloud.upload_intents WHERE id=$1',[intent.id])).rows[0].state,'pending');
  const applied=await f.cli('dist/cloud/photo-reconcile-cli.js',['--apply']);assert.equal(applied.code,0);assert.deepEqual(JSON.parse(applied.output),{candidates:1,cleaned:1,dryRun:false});assert(!storage.objectNames().includes(intent.storage_name));assert(storage.objectNames().includes('demo/'+photo.id+'.webp'));
  assert.equal((await upload(task.id,s.workerLogin,'orphan-cleanup')).status,201);assert(storage.objectNames().includes(intent.storage_name));
 });
 await step('upload binds once to report, review and viewer; draft ownership remains for another assigned worker',async()=>{
  const body={expectedVersion:task.version,note:'Synthetic DEMO private photo report',actualWorkerIds:[s.worker.id],photoIds:[photo.id]};
  const submitted=await f.ok(`/tasks/${task.id}/reports`,'POST',s.workerLogin,body,201,'photo-report');assert.deepEqual(await f.ok(`/tasks/${task.id}/reports`,'POST',s.workerLogin,body,201,'photo-report'),submitted);
  accepted=await f.ok(`/reports/${submitted.report.id}/review`,'POST','coordinator',{expectedVersion:submitted.task.version,expectedReportVersion:1,decision:'accepted',comment:'Synthetic DEMO verification'});
  assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM gp_cloud.reports WHERE task_id=$1',[task.id])).rows[0].n,1);
  assert.equal((await f.db.pool.query('SELECT report_id FROM gp_cloud.uploads WHERE id=$1',[photo.id])).rows[0].report_id,accepted.report.id);
  assert.deepEqual((await f.ok(`/reports/${accepted.report.id}`,'GET','viewer')).photoIds,[photo.id]);assert((await download(photo.id)).bytes.equals(bytes));
  assert.equal((await upload(task.id,s.workerLogin,'main-photo')).replayed,'true');assert.equal((await upload(task.id,s.workerLogin,'after-accept')).status,409);
  const group=await s.startTask(2),groupPhoto=await upload(group.id,s.workerLogin,'group-photo');assert.equal(groupPhoto.status,201);
  assert.equal((await download(groupPhoto.body.data.id,s.otherLogin)).status,404);
  const contribution=await f.ok(`/tasks/${group.id}/report-draft/contributions`,'POST',s.workerLogin,{expectedVersion:group.version,expectedDraftVersion:0,note:'Synthetic photo contribution',photoIds:[groupPhoto.body.data.id]});
  const report=await f.ok(`/tasks/${group.id}/reports`,'POST',s.foremanLogin,{expectedVersion:group.version,expectedDraftVersion:contribution.version,note:'Synthetic group photo report',actualWorkerIds:[s.worker.id,s.other.id],photoIds:[groupPhoto.body.data.id]},201);
  assert.equal(report.report.photoIds[0],groupPhoto.body.data.id);assert.equal((await download(groupPhoto.body.data.id,s.otherLogin)).status,200);
 });
 await step('fixed same-origin proxy preserves multipart, binary, CSRF and idempotency end to end',async()=>{
  const proxy=await fixedTestProxy(f.base);
  try{
   const task=await s.startTask();const uploaded=await upload(task.id,s.workerLogin,'proxy-photo',input,false,proxy.base);assert.equal(uploaded.status,201);
   const replay=await upload(task.id,s.workerLogin,'proxy-photo',input,false,proxy.base);assert.equal(replay.replayed,'true');assert.equal(replay.body.data.id,uploaded.body.data.id);
   const a=f.sessions.get(s.workerLogin)!,body={expectedVersion:task.version,note:'Synthetic proxy report',actualWorkerIds:[s.worker.id],photoIds:[uploaded.body.data.id]};
   const response=await fetch(proxy.base+`/tasks/${task.id}/reports`,{method:'POST',headers:{Origin:'https://green-pavlodar-mock.pages.dev',Cookie:a.cookie,'X-CSRF-Token':a.csrf,'Idempotency-Key':'proxy-report','Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,201);const submission=(await response.json() as any).data;
   await f.ok(`/reports/${submission.report.id}/review`,'POST','coordinator',{expectedVersion:submission.task.version,expectedReportVersion:1,decision:'accepted',comment:'Synthetic proxy acceptance'});
   const image=await download(uploaded.body.data.id,'viewer',proxy.base);assert.equal(image.status,200);assert.equal(digest(image.bytes),uploaded.body.data.sha256);assert.match(image.headers.get('cache-control')!,/no-store/);
  }finally{await proxy.stop();}
 });
 await step('session revocation blocks a previously successful photo replay',async()=>{
  const before=await f.ok('/users','GET','admin'),user=before.find((u:any)=>u.id===s.worker.id);
  const disabled=await f.ok('/users/'+s.worker.id,'PATCH','admin',{expectedVersion:user.version,active:false});
  assert.equal((await upload(task.id,s.workerLogin,'main-photo')).status,401);
  await f.ok('/users/'+s.worker.id,'PATCH','admin',{expectedVersion:disabled.version,active:true});f.sessions.delete(s.workerLogin);await f.login(s.workerLogin);
  assert.equal((await upload(task.id,s.workerLogin,'main-photo')).replayed,'true');
 });
 await step('restart backend + native PostgreSQL + persistent integration storage, then repeat seed',async()=>{
  const before=await f.snapshot(tables);await f.stop();await storage.stop();await storage.start();await f.restart();
  assert.deepEqual(await f.snapshot(tables),before);assert((await download(photo.id)).bytes.equals(bytes));
  assert.equal((await f.ok(`/reports/${accepted.report.id}`,'GET','viewer')).reviewStatus,'accepted');
  await f.reseed();assert.deepEqual(await f.snapshot(tables),before);await f.login(s.workerLogin);await f.login('viewer');
  writeFileSync(join(f.dir,'stage-c-persistence.json'),JSON.stringify({kind:'isolated local integration storage, not real Supabase',storageDirectory:storage.dir,photoId:photo.id,photoSha256:digest(bytes),reportId:accepted.report.id,before,after:await f.snapshot(tables)},null,2));
 });
});
