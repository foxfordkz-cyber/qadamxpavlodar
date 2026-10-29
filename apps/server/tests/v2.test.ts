import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { fixture } from './helpers.js';
import { seedV2,DEMO_PASSWORD } from '../src/v2/seed.js';
import sharp from 'sharp';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { AppOptions } from '../src/app.js';
export async function v2Fixture(t:TestContext,options:AppOptions={}) {
  const f=await fixture(t,options); await seedV2(f.store);
  const specResponse=await fetch(f.base+'/api/v1/openapi.json');const spec=await specResponse.json();assert.equal(specResponse.status,200,JSON.stringify(spec));
  const ajv=new Ajv2020({strict:false,validateFormats:false});const validators=new Map<string,ReturnType<typeof ajv.compile>>();
  function validate(path:string,method:string,status:number,body:unknown){
    const definition=Object.entries(spec.paths).find(([pattern])=>new RegExp('^'+pattern.replace(/\{id\}/g,'[^/]+')+'$').test(path.split('?')[0]!));assert(definition,`Undocumented ${path}`);
    const operation=(definition[1] as any)[method.toLowerCase()];assert(operation,`Undocumented ${method} ${path}`);const schema=operation.responses[status]?.content?.['application/json']?.schema;assert(schema,`Undocumented status ${status}`);
    const key=`${definition[0]}:${method}:${status}`;if(!validators.has(key))validators.set(key,ajv.compile({...schema,components:spec.components}));const validator=validators.get(key)!;assert(validator(body),`${key}: ${JSON.stringify(validator.errors)}`);
  }
  const sessions=new Map<string,{cookie:string;csrf:string}>();let n=0;
  async function login(user:string){
    const r=await fetch(f.base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:user,password:DEMO_PASSWORD})});const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));validate('/auth/login','POST',r.status,b);
    const session={cookie:r.headers.get('set-cookie')!.split(';')[0]!,csrf:b.data.csrfToken};sessions.set(user,session);return{...session,headers:r.headers,body:b};
  }
  async function call(path:string,method='GET',user='coordinator',body?:unknown,key?:string){
    const session=sessions.get(user)??await login(user);
    const r=await fetch(f.base+'/api/v1'+path,{method,headers:{Cookie:session.cookie,'X-CSRF-Token':session.csrf,...(body!==undefined?{'Content-Type':'application/json'}:{}),'Idempotency-Key':key??`v2-test-${++n}`},body:body===undefined?undefined:JSON.stringify(body)});
    const json=await r.json();validate(path,method,r.status,json);return{status:r.status,body:json,headers:r.headers};
  }
  return{...f,login,call,sessions,spec};
}
test('V2 server sessions: password verification, no role-header trust, CSRF, logout, revoked roles and hashed credentials',async t=>{
  const f=await v2Fixture(t);
  const anon=await fetch(f.base+'/api/v1/auth/me',{headers:{'X-Demo-User':'demo-coordinator-1'}});assert.equal(anon.status,401);
  const bad=await fetch(f.base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:'admin',password:'incorrect'})});assert.equal(bad.status,401);
  const a=await f.login('admin');assert.match(a.headers.get('set-cookie')!,/HttpOnly/);assert.match(a.headers.get('set-cookie')!,/SameSite=Strict/i);
  assert.equal((await f.call('/auth/me','GET','admin')).body.data.user.role,'admin');
  const noCsrf=await fetch(f.base+'/api/v1/crews',{method:'POST',headers:{Cookie:a.cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(noCsrf.status,403);
  const worker=await f.login('worker1');assert.equal((await f.call('/users','GET','worker1')).status,403);
  assert.equal((await f.call('/users/demo-worker-1','PATCH','admin',{expectedVersion:1,active:false})).status,200);
  assert.equal((await fetch(f.base+'/api/v1/auth/me',{headers:{Cookie:worker.cookie}})).status,401);
  assert.equal((await f.call('/users/demo-admin-1','PATCH','admin',{expectedVersion:1,role:'worker'})).status,403);
  const users=await f.call('/users','GET','admin');assert(!JSON.stringify(users.body).includes('password'));assert(!JSON.stringify(users.body).includes('scrypt'));
  assert(f.store.all('SELECT password_hash FROM v2_users').every(r=>String(r.password_hash).startsWith('scrypt32768$')&&!String(r.password_hash).includes(DEMO_PASSWORD)));
  assert(!f.store.all('SELECT token_hash FROM v2_sessions').some(r=>a.cookie.includes(String(r.token_hash))));
  assert.equal((await f.call('/auth/logout','POST','admin',{})).status,200);
  assert.equal((await fetch(f.base+'/api/v1/auth/me',{headers:{Cookie:a.cookie}})).status,401);
});
test('V2 admin crews: scoped staff, one active crew, version conflicts, audited membership and seed preservation',async t=>{
  const f=await v2Fixture(t);
  assert.deepEqual((await f.call('/crews','GET','foreman1')).body.data.map((c:any)=>c.id),['demo-crew-1']);
  const workers=(await f.call('/workers','GET','foreman1')).body.data.map((u:any)=>u.id);assert(workers.includes('demo-worker-1'));assert(!workers.includes('demo-worker-3'));
  assert.equal((await f.call('/crews/demo-crew-2/members','POST','foreman1',{expectedVersion:1,userId:'demo-worker-1',active:true})).status,403);
  assert.equal((await f.call('/crews/demo-crew-2/members','POST','admin',{expectedVersion:1,userId:'demo-worker-1',active:true})).status,409);
  assert.equal((await f.call('/crews/demo-crew-1/members','POST','admin',{expectedVersion:1,userId:'demo-worker-1',active:false})).status,200);
  assert.equal((await f.call('/crews/demo-crew-1','PATCH','admin',{expectedVersion:1,name:'stale'})).status,409);
  assert.equal((await f.call('/crews/demo-crew-2/members','POST','admin',{expectedVersion:1,userId:'demo-worker-1',active:true})).status,200);
  await seedV2(f.store);assert.equal(f.store.get('SELECT crew_id FROM v2_memberships WHERE user_id=? AND active=1','demo-worker-1')?.crew_id,'demo-crew-2');
  assert.equal(f.store.get("SELECT count(*) n FROM v2_history WHERE entity_type='crew'")?.n,2);
});
const plantingItems=[{id:'item-1',catalogItemId:'demo-catalog-1',geometry:{type:'MultiPoint',coordinates:[[76.951,52.281],[76.9511,52.2811]]},quantity:2,quantityMethod:'DEMO specialist-specified positions',carePolicyId:'demo-care-policy',evidenceIds:['demo-v2-evidence']}];
const designBody={siteId:'demo-site-1',name:'DEMO V2 intersection',objective:'Synthetic planting flow',contextVersion:1,plantingItems,evidenceIds:['demo-v2-evidence']};
async function approvedDesign(f:Awaited<ReturnType<typeof v2Fixture>>){
  const created=await f.call('/designs','POST','coordinator',designBody);assert.equal(created.status,201,JSON.stringify(created.body));const d=created.body.data;
  assert.equal((await f.call(`/designs/${d.id}/submit`,'POST','coordinator',{expectedVersion:1})).status,200);
  const result=await f.call(`/designs/${d.id}/review`,'POST','admin',{expectedVersion:2,decision:'approved',comment:'DEMO checks and quantities reviewed'});assert.equal(result.status,200,JSON.stringify(result.body));return result.body.data;
}
async function careTask(f:Awaited<ReturnType<typeof v2Fixture>>,extra:Record<string,unknown>={}){
  const r=await f.call('/tasks','POST','coordinator',{objectType:'plant',objectId:'demo-plant-1',action:'inspect',description:'DEMO inspect',estimatedMinutes:30,minWorkers:1,requiredSkills:['inspect'],evidenceIds:['demo-v2-evidence'],...extra});assert.equal(r.status,201,JSON.stringify(r.body));return r.body.data;
}
const assignment={crewId:'demo-crew-1',scheduledStart:'2026-10-28T04:00:00+00:00',scheduledEnd:'2026-10-28T04:30:00+00:00',resourceIds:[]};
test('V2 design approval: human checks, admin-only review, immutable revisions and release once',async t=>{
  const f=await v2Fixture(t);
  const unknown=await f.call('/designs','POST','coordinator',{...designBody,siteId:'demo-site-2'});assert.equal(unknown.status,201);
  const id=unknown.body.data.id;assert.equal((await f.call(`/designs/${id}/submit`,'POST','coordinator',{expectedVersion:1})).status,200);
  assert.equal((await f.call(`/designs/${id}/review`,'POST','admin',{expectedVersion:2,decision:'approved',comment:'Cannot clear unknown checks by approval'})).status,409);
  assert.equal((await f.call(`/designs/${id}/review`,'POST','coordinator',{expectedVersion:2,decision:'approved',comment:'wrong role'})).status,403);
  assert.equal((await f.call(`/designs/${id}/create-tasks`,'POST','coordinator',{expectedVersion:2,revision:1,estimatedMinutes:30,minWorkers:2})).status,409);
  const d=await approvedDesign(f);
  const issued=await f.call(`/designs/${d.id}/create-tasks`,'POST','coordinator',{expectedVersion:3,revision:1,estimatedMinutes:30,minWorkers:2},'release');assert.equal(issued.status,201);
  const replay=await f.call(`/designs/${d.id}/create-tasks`,'POST','coordinator',{expectedVersion:3,revision:1,estimatedMinutes:30,minWorkers:2},'release');assert.deepEqual(replay.body,issued.body);
  assert.equal((await f.call(`/designs/${d.id}/create-tasks`,'POST','coordinator',{expectedVersion:3,revision:1,estimatedMinutes:30,minWorkers:2})).status,409);
  const edited=await f.call(`/designs/${d.id}`,'PATCH','coordinator',{expectedVersion:3,name:'DEMO revised'});assert.equal(edited.body.data.revision,2);assert.equal(edited.body.data.status,'draft');
  const detail=await f.call(`/designs/${d.id}`);assert.equal(detail.body.data.revisions[0].status,'approved');assert.equal(detail.body.data.revisions[0].name,designBody.name);
  assert.equal((await f.call(`/tasks/${issued.body.data[0].id}`)).body.data.approvedDesignVersion,1);
  assert.equal(f.store.get("SELECT count(*) n FROM v2_documents WHERE kind='plant'")?.n,30);
});
test('V2 assignment: worker/crew isolation, membership, minWorkers, skills, intervals and resource conflicts',async t=>{
  const f=await v2Fixture(t);const t1=await careTask(f,{minWorkers:2});
  const assigned=await f.call(`/tasks/${t1.id}/assign`,'POST','coordinator',{expectedVersion:1,...assignment});assert.equal(assigned.status,200);
  assert.deepEqual((await f.call('/tasks','GET','worker1')).body.data,[]);
  assert.equal((await f.call(`/tasks/${t1.id}/assign-workers`,'POST','foreman2',{expectedVersion:2,workerIds:['demo-worker-3','demo-worker-4']})).status,404);
  assert.equal((await f.call(`/tasks/${t1.id}/assign-workers`,'POST','foreman1',{expectedVersion:2,workerIds:['demo-worker-1']})).status,409);
  assert.equal((await f.call(`/tasks/${t1.id}/assign-workers`,'POST','foreman1',{expectedVersion:2,workerIds:['demo-worker-1','demo-worker-3']})).status,409);
  assert.equal((await f.call(`/tasks/${t1.id}/assign-workers`,'POST','foreman1',{expectedVersion:2,workerIds:['demo-worker-1','demo-worker-2']})).status,200);
  assert.equal((await f.call('/tasks?crewId=demo-crew-1','GET','worker3')).body.data.length,0);
  assert.equal((await f.call(`/tasks/${t1.id}`,'GET','worker3')).status,404);
  const t2=await careTask(f);assert.equal((await f.call(`/tasks/${t2.id}/assign`,'POST','coordinator',{expectedVersion:1,...assignment})).status,200);
  assert.equal((await f.call(`/tasks/${t2.id}/assign-workers`,'POST','foreman1',{expectedVersion:2,workerIds:['demo-worker-1']})).body.error.code,'WORKER_OVERLAP');
  assert.equal((await f.call(`/tasks/${t1.id}/start`,'POST','worker1',{expectedVersion:3})).status,200);
  assert.equal((await f.call(`/tasks/${t1.id}/assign`,'POST','coordinator',{expectedVersion:4,...assignment})).status,409);
  const water1=await careTask(f,{action:'water',requiredWaterLiters:60});
  assert.equal((await f.call(`/tasks/${water1.id}/assign`,'POST','coordinator',{expectedVersion:1,...assignment,resourceIds:['demo-water']})).status,200);
  const water2=await careTask(f,{action:'water',requiredWaterLiters:60});
  assert.equal((await f.call(`/tasks/${water2.id}/assign`,'POST','coordinator',{expectedVersion:1,...assignment,crewId:'demo-crew-2',resourceIds:['demo-water']})).body.error.code,'WATER_CAPACITY');
  const vehicle1=await careTask(f);assert.equal((await f.call(`/tasks/${vehicle1.id}/assign`,'POST','coordinator',{expectedVersion:1,...assignment,resourceIds:['demo-vehicle']})).status,200);
  const vehicle2=await careTask(f);assert.equal((await f.call(`/tasks/${vehicle2.id}/assign`,'POST','coordinator',{expectedVersion:1,...assignment,crewId:'demo-crew-2',resourceIds:['demo-vehicle']})).body.error.code,'RESOURCE_OVERLAP');
});
async function plantingTask(f:Awaited<ReturnType<typeof v2Fixture>>){
  const d=await approvedDesign(f);const issued=await f.call(`/designs/${d.id}/create-tasks`,'POST','coordinator',{expectedVersion:3,revision:1,estimatedMinutes:30,minWorkers:2});assert.equal(issued.status,201);
  const id=issued.body.data[0].id;
  assert.equal((await f.call(`/tasks/${id}/assign`,'POST','coordinator',{expectedVersion:1,...assignment})).status,200);
  assert.equal((await f.call(`/tasks/${id}/assign-workers`,'POST','foreman1',{expectedVersion:2,workerIds:['demo-worker-1','demo-worker-2']})).status,200);
  assert.equal((await f.call(`/tasks/${id}/start`,'POST','worker1',{expectedVersion:3})).status,200);return id;
}
const actualItems=[{plantingItemId:'item-1',catalogItemId:'demo-catalog-1',quantity:2,geometry:plantingItems[0]!.geometry}];
async function uploadV2(f:Awaited<ReturnType<typeof v2Fixture>>,taskId:string,user='worker1',key='upload-photo',bytes?:Buffer){
  const session=f.sessions.get(user)??await f.login(user);const file=bytes??await sharp({create:{width:12,height:12,channels:3,background:'#1b8f51'}}).png().toBuffer();
  const form=new FormData();form.set('taskId',taskId);form.set('file',new Blob([new Uint8Array(file)],{type:'image/png'}),'../../outside.png');
  const r=await fetch(f.base+'/api/v1/uploads',{method:'POST',headers:{Cookie:session.cookie,'X-CSRF-Token':session.csrf,'Idempotency-Key':key},body:form});return{status:r.status,body:await r.json()};
}
test('V2 group planting: private materials, partial return, full atomic acceptance, care drafts, no duplicates and competing review',async t=>{
  const f=await v2Fixture(t),id=await plantingTask(f);
  assert.equal((await uploadV2(f,id,'worker3')).status,404);
  assert.equal((await uploadV2(f,id,'worker1','bad',Buffer.from('<svg/>'))).status,415);
  assert.equal((await uploadV2(f,id,'worker1','huge',Buffer.alloc(5*1024*1024+1))).status,413);
  const photo=await uploadV2(f,id);assert.equal(photo.status,201);const photoId=photo.body.data.id;
  assert.equal((await f.call(`/tasks/${id}/report-draft/contributions`,'POST','worker1',{expectedVersion:4,expectedDraftVersion:0,note:'DEMO one planted position',photoIds:[photoId]})).status,200);
  const partial={expectedVersion:4,expectedDraftVersion:1,note:'DEMO partial planting',photoIds:[photoId],actualWorkerIds:['demo-worker-1','demo-worker-2'],actualPlantingItems:[{...actualItems[0],quantity:1,geometry:{type:'Point',coordinates:[76.951,52.281]}}]};
  assert.equal((await f.call(`/tasks/${id}/reports`,'POST','worker1',partial)).status,403);
  const submitted=await f.call(`/tasks/${id}/reports`,'POST','foreman1',partial,'partial-report');assert.equal(submitted.status,201,JSON.stringify(submitted.body));const r1=submitted.body.data.report.id;
  assert.deepEqual((await f.call(`/tasks/${id}/reports`,'POST','foreman1',partial,'partial-report')).body,submitted.body);
  assert.equal((await f.call(`/tasks/${id}/reports`,'POST','foreman1',{...partial,note:'different'},'partial-report')).status,409);
  assert.equal((await f.call(`/reports/${r1}`,'GET','worker3')).status,404);
  const foreign=f.sessions.get('worker3')!;assert.equal((await fetch(f.base+`/api/v1/uploads/${photoId}`,{headers:{Cookie:foreign.cookie}})).status,404);
  const own=f.sessions.get('worker1')!;assert.equal((await fetch(f.base+`/api/v1/uploads/${photoId}`,{headers:{Cookie:own.cookie}})).status,200);
  assert.equal((await f.call(`/reports/${r1}/review`,'POST','coordinator',{expectedVersion:5,expectedReportVersion:1,decision:'accepted',comment:'incomplete cannot be accepted',acceptGeometryDeviation:true})).body.error.code,'INCOMPLETE_PLANTING');
  assert.equal(f.store.get("SELECT count(*) n FROM v2_documents WHERE kind='plant'")?.n,30);
  assert.equal((await f.call(`/reports/${r1}/review`,'POST','coordinator',{expectedVersion:5,expectedReportVersion:1,decision:'changes_requested',comment:'Finish the remaining position'})).status,200);
  assert.equal((await f.call(`/tasks/${id}/start`,'POST','worker1',{expectedVersion:6})).status,200);
  const complete={expectedVersion:7,expectedDraftVersion:2,note:'Both positions complete',photoIds:[],actualWorkerIds:['demo-worker-1','demo-worker-2'],actualPlantingItems:actualItems};
  const second=await f.call(`/tasks/${id}/reports`,'POST','foreman1',complete);assert.equal(second.status,201,JSON.stringify(second.body));const r2=second.body.data.report.id;
  const review={expectedVersion:8,expectedReportVersion:1,decision:'accepted',comment:'Full actual quantities and positions checked'};
  f.store.db.exec("CREATE TRIGGER v2_injected_failure BEFORE INSERT ON v2_care_events BEGIN SELECT RAISE(ABORT,'injected rollback'); END;");
  assert.equal((await f.call(`/reports/${r2}/review`,'POST','coordinator',review,'atomic-review')).status,500);
  assert.equal(f.store.get("SELECT count(*) n FROM v2_documents WHERE kind='plant'")?.n,30);assert.equal(f.store.get('SELECT count(*) n FROM v2_planting_receipts')?.n,0);
  assert.equal((await f.call(`/tasks/${id}`)).body.data.status,'submitted');
  f.store.db.exec('DROP TRIGGER v2_injected_failure');
  const concurrent=await Promise.all([f.call(`/reports/${r2}/review`,'POST','coordinator',review,'atomic-review'),f.call(`/reports/${r2}/review`,'POST','coordinator',review,'competing-review')]);
  assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,409]);const accepted=concurrent.find(x=>x.status===200)!;
  assert.equal(accepted.body.data.plants.length,2);assert.equal(accepted.body.data.careTasks.length,2);assert.equal(accepted.body.data.task.status,'verified');
  assert(accepted.body.data.plants.every((p:any)=>p.condition==='unknown'));
  const successKey=concurrent[0]!.status===200?'atomic-review':'competing-review';assert.deepEqual((await f.call(`/reports/${r2}/review`,'POST','coordinator',review,successKey)).body,accepted.body);
  assert.equal(f.store.get("SELECT count(*) n FROM v2_documents WHERE kind='plant'")?.n,32);assert.equal(f.store.get('SELECT count(*) n FROM v2_planting_receipts')?.n,2);
  assert.equal((await f.call(`/tasks/${id}/start`,'POST','worker1',{expectedVersion:9})).status,409);
  assert.equal(f.store.get('SELECT count(*) n FROM plants')?.n,30);
});
test('V2 permission replay, interval/skill rechecks, issue is not completion, and no self-review after role change',async t=>{
  const f=await v2Fixture(t);const x=await careTask(f,{requiredSkills:['specialist']});
  await f.call(`/tasks/${x.id}/assign`,'POST','coordinator',{expectedVersion:1,...assignment});
  assert.equal((await f.call(`/tasks/${x.id}/assign-workers`,'POST','foreman1',{expectedVersion:2,workerIds:['demo-worker-1']})).body.error.code,'MISSING_SKILLS');
  const solo=await careTask(f);await f.call(`/tasks/${solo.id}/assign`,'POST','coordinator',{expectedVersion:1,...assignment});
  const body={expectedVersion:2,workerIds:['demo-worker-1']};assert.equal((await f.call(`/tasks/${solo.id}/assign-workers`,'POST','foreman1',body,'original-assignment')).status,200);
  await f.call('/crews/demo-crew-1','PATCH','admin',{expectedVersion:1,foremanId:'demo-foreman-2'});
  assert.equal((await f.call(`/tasks/${solo.id}/assign-workers`,'POST','foreman1',body,'original-assignment')).status,404);
  assert.equal((await f.call(`/tasks/${solo.id}/start`,'POST','worker1',{expectedVersion:3})).status,200);
  const issue=await f.call(`/tasks/${solo.id}/issues`,'POST','worker1',{expectedVersion:4,text:'Access blocked; task is not complete'});assert.equal(issue.status,201);assert.equal((await f.call(`/tasks/${solo.id}`)).body.data.status,'in_progress');
  const submitted=await f.call(`/tasks/${solo.id}/reports`,'POST','worker1',{expectedVersion:5,note:'Inspection performed',actualWorkerIds:['demo-worker-1']});assert.equal(submitted.status,201);const rid=submitted.body.data.report.id;
  await f.call('/crews/demo-crew-1/members','POST','admin',{expectedVersion:2,userId:'demo-worker-1',active:false});
  assert.equal((await f.call('/users/demo-worker-1','PATCH','admin',{expectedVersion:1,role:'coordinator'})).status,200);await f.login('worker1');
  assert.equal((await f.call(`/reports/${rid}/review`,'POST','worker1',{expectedVersion:6,expectedReportVersion:1,decision:'accepted',comment:'self approval'})).body.error.code,'SELF_REVIEW');
  const before=(await f.call('/plants/demo-plant-1')).body.data.condition;
  assert.equal((await f.call(`/reports/${rid}/review`,'POST','coordinator',{expectedVersion:6,expectedReportVersion:1,decision:'accepted',comment:'Independent inspection review'})).status,200);
  assert.equal((await f.call('/plants/demo-plant-1')).body.data.condition,before);
  assert.equal((await f.call('/plants/demo-plant-1/care-history')).body.data[0].action,'inspect');
});
test('V2 published OpenAPI equals router; schematic becomes stale; unavailable AI cannot affect manual tasks',async t=>{
  const f=await v2Fixture(t);
  const router=(f.app as any).router.stack.find((layer:any)=>layer.handle?.stack?.some((x:any)=>x.route?.path==='/auth/login')).handle;
  const actual=router.stack.filter((x:any)=>x.route&&!['/openapi.json','/docs','/docs/init.js','/admin','/admin.js'].includes(x.route.path)).flatMap((x:any)=>Object.keys(x.route.methods).map(m=>`${m} ${x.route.path.replace(/:id/g,'{id}')}`));
  const documented=Object.entries(f.spec.paths).flatMap(([path,methods])=>Object.keys(methods as object).map(m=>`${m} ${path}`));assert.deepEqual(actual.sort(),documented.sort());
  const request={constraints:{shiftDate:'2026-10-28',crewIds:['demo-crew-1']}};
  assert.equal((await f.call('/plans/preview','POST','coordinator',request)).status,503);
  const t1=await careTask(f);assert.equal((await f.call('/observations/interpret','POST','coordinator',{taskId:t1.id,text:'Inspect the object'})).status,503);
  assert.equal((await f.call(`/tasks/${t1.id}`)).body.data.status,'draft');
  const d=await approvedDesign(f);const v=await f.call(`/designs/${d.id}/visualizations`,'POST','coordinator',{expectedVersion:3,designRevision:1,method:'schematic',seasonLabel:'DEMO autumn',growthStageLabel:'Concept mature size unknown'});assert.equal(v.status,201);
  assert.equal((await f.call(`/visualizations/${v.body.data.id}`)).body.data.stale,false);
  await f.call(`/designs/${d.id}`,'PATCH','coordinator',{expectedVersion:3,name:'New version'});
  assert.equal((await f.call(`/visualizations/${v.body.data.id}`)).body.data.stale,true);
  assert.equal((await f.call(`/visualizations/${v.body.data.id}/review`,'POST','coordinator',{expectedVersion:1,consistencyStatus:'accepted',comment:'Cannot approve stale'})).status,409);
});
test('V2 plan boundary: exact snapshot, all-or-nothing assignment, proposed workers not authorized, stale input conflict',async t=>{
  let selected:string[]=[];let conflict=true;
  const f=await v2Fixture(t,{v2Adapters:{buildPlanPreview:(snapshot:any)=>({proposedAssignments:selected.map((id,i)=>({taskId:id,crewId:'demo-crew-1',expectedTaskVersion:snapshot.tasks.find((t:any)=>t.id===id).version,scheduledStart:'2026-10-28T06:00:00Z',scheduledEnd:'2026-10-28T06:30:00Z',resourceIds:conflict?['demo-vehicle']:[],proposedWorkerIds:['demo-worker-1']})),unassignedTasks:[],warnings:['Test adapter only'],metrics:[],method:'rules'})}});
  selected=[(await careTask(f)).id,(await careTask(f)).id];
  const body={constraints:{shiftDate:'2026-10-28',crewIds:['demo-crew-1']}};
  const preview=await f.call('/plans/preview','POST','coordinator',body);assert.equal(preview.status,201,JSON.stringify(preview.body));const id=preview.body.data.id;
  assert.equal((await f.call('/tasks','GET','worker1')).body.data.length,0);
  assert.equal((await f.call(`/plans/${id}/approve`,'POST','coordinator',{expectedVersion:1})).body.error.code,'RESOURCE_OVERLAP');
  assert(selected.every(id=>f.store.get('SELECT status FROM v2_tasks WHERE id=?',id)?.status==='draft'));
  assert.equal((await f.call(`/plans/${id}`)).body.data.status,'draft');
  conflict=false;const next=await f.call('/plans/preview','POST','coordinator',body);
  const accepted=await f.call(`/plans/${next.body.data.id}/approve`,'POST','coordinator',{expectedVersion:1});assert.equal(accepted.status,200,JSON.stringify(accepted.body));assert(accepted.body.data.assignments.every((t:any)=>t.assignedWorkerIds.length===0));
  assert.equal((await f.call('/tasks','GET','worker1')).body.data.length,0);
  selected=[(await careTask(f)).id];const stale=await f.call('/plans/preview','POST','coordinator',body);
  await f.call('/users/demo-worker-1','PATCH','admin',{expectedVersion:1,active:false});
  assert.equal((await f.call(`/plans/${stale.body.data.id}/approve`,'POST','coordinator',{expectedVersion:1})).body.error.code,'SNAPSHOT_STALE');
  const snapshot=await f.call('/integration/snapshot');assert(!JSON.stringify(snapshot.body).includes('password'));assert(!JSON.stringify(snapshot.body).includes('csrf'));
});
