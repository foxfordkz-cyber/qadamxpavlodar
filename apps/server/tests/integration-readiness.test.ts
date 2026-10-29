import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fixture } from './helpers.js';
import { seedV2, DEMO_PASSWORD } from '../src/v2/seed.js';
import { seedMunicipal } from '../src/municipal/data.js';

async function setup(t:TestContext){
  const f=await fixture(t);await seedV2(f.store);const sessions=new Map<string,{cookie:string;csrf:string}>();let seq=0;
  async function call(path:string,method='GET',user='coordinator',body?:unknown,headers:Record<string,string>={}){
    if(!sessions.has(user)){const r=await fetch(f.base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:user,password:DEMO_PASSWORD})});const b=await r.json();assert.equal(r.status,200);sessions.set(user,{cookie:r.headers.get('set-cookie')!.split(';')[0]!,csrf:b.data.csrfToken});}
    const ss=sessions.get(user)!,r=await fetch(f.base+'/api/v1'+path,{method,headers:{Cookie:ss.cookie,'X-CSRF-Token':ss.csrf,'Idempotency-Key':`readiness-${++seq}`,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    return{status:r.status,body:await r.json(),headers:r.headers};
  }
  const care=(dueAt:string|null)=>call('/tasks','POST','coordinator',{objectType:'plant',objectId:'demo-plant-1',action:'inspect',description:'DEMO integration readiness',estimatedMinutes:15,dueAt,evidenceIds:['demo-v2-evidence']});
  return{...f,call,care};
}

test('Readiness: object/date filters preserve worker scope and UTC+5 boundaries',async t=>{
  const f=await setup(t),dates=['2026-10-27T18:59:59.999Z','2026-10-27T19:00:00.000Z','2026-10-28T18:59:59.999Z','2026-10-28T19:00:00.000Z'];
  const ids:string[]=[];for(const date of dates){const created=await f.care(date);assert.equal(created.status,201);ids.push(created.body.data.id);}
  const filtered=await f.call('/tasks?date=2026-10-28&objectId=demo-plant-1');assert.equal(filtered.status,200);assert.deepEqual(filtered.body.data.map((x:any)=>x.id).sort(),[ids[1],ids[2]].sort());
  assert.equal((await f.call('/tasks?date=2026-02-30')).status,400);
  const assigned=await f.care('2026-10-29T05:00:00Z'),task=assigned.body.data;
  assert.equal((await f.call(`/tasks/${task.id}/assign`,'POST','coordinator',{expectedVersion:1,crewId:'demo-crew-1',scheduledStart:'2026-10-28T05:00:00Z',scheduledEnd:'2026-10-28T05:15:00Z'})).status,200);
  assert.equal((await f.call(`/tasks/${task.id}/assign-workers`,'POST','foreman1',{expectedVersion:2,workerIds:['demo-worker-1']})).status,200);
  assert.deepEqual((await f.call('/tasks?date=2026-10-28&objectId=demo-plant-1','GET','worker1')).body.data.map((x:any)=>x.id),[task.id]);
  assert.equal((await f.call('/tasks?date=2026-10-29','GET','worker1')).body.data.length,0,'scheduledStart takes precedence over dueAt');
  assert.equal((await f.call('/tasks?workerId=demo-worker-1','GET','worker3')).body.data.length,0);
  assert.equal((await f.call('/tasks?objectId=demo-plant-2','GET','worker1')).body.data.length,0);
});

test('Readiness: worker catalog contains only assigned approved planting revision, never a newer draft',async t=>{
  const f=await setup(t),item={id:'readiness-item',catalogItemId:'demo-catalog-1',geometry:{type:'Point',coordinates:[76.951,52.281]},quantity:1,quantityMethod:'Explicit DEMO position',evidenceIds:['demo-v2-evidence']};
  const created=await f.call('/designs','POST','coordinator',{siteId:'demo-site-1',name:'DEMO catalog scope',objective:'Assigned context only',contextVersion:1,plantingItems:[item],evidenceIds:['demo-v2-evidence']});assert.equal(created.status,201);const id=created.body.data.id;
  assert.equal((await f.call(`/designs/${id}/submit`,'POST','coordinator',{expectedVersion:1})).status,200);
  assert.equal((await f.call(`/designs/${id}/review`,'POST','admin',{expectedVersion:2,decision:'approved',comment:'DEMO reviewed'})).status,200);
  const issued=await f.call(`/designs/${id}/create-tasks`,'POST','coordinator',{expectedVersion:3,revision:1,estimatedMinutes:30,minWorkers:1});assert.equal(issued.status,201);const task=issued.body.data[0];
  assert.equal((await f.call(`/tasks/${task.id}/assign`,'POST','coordinator',{expectedVersion:1,crewId:'demo-crew-1',scheduledStart:'2026-10-28T05:00:00Z',scheduledEnd:'2026-10-28T05:30:00Z'})).status,200);
  assert.equal((await f.call(`/tasks/${task.id}/assign-workers`,'POST','foreman1',{expectedVersion:2,workerIds:['demo-worker-1']})).status,200);
  assert.deepEqual((await f.call('/plant-catalog','GET','worker1')).body.data.map((x:any)=>x.id),['demo-catalog-1']);
  assert.equal((await f.call('/plant-catalog','GET','worker3')).body.data.length,0);
  assert.equal((await f.call('/plant-catalog','POST','worker1',{displayName:'DEMO forbidden write',kind:'tree',evidenceIds:['demo-v2-evidence']})).status,403);
  assert.equal((await f.call(`/designs/${id}`,'PATCH','coordinator',{expectedVersion:3,plantingItems:[{...item,catalogItemId:'demo-catalog-2'}]})).status,200);
  assert.deepEqual((await f.call('/plant-catalog','GET','worker1')).body.data.map((x:any)=>x.id),['demo-catalog-1']);
  const workerDesign=(await f.call(`/designs/${id}`,'GET','worker1')).body.data;assert.equal(workerDesign.status,undefined);assert.deepEqual(workerDesign.revisions.map((x:any)=>x.revision),[1]);
  assert.equal((await f.call('/resources','GET','worker1')).status,403);
});

test('Readiness: planning snapshot retains effective roles; OpenAPI requires real adapter idempotency keys',async t=>{
  const f=await setup(t);await seedMunicipal(f.store);
  const users=(await f.call('/users','GET','admin')).body.data,snapshot=(await f.call('/integration/snapshot')).body.data;
  for(const role of ['viewer','specialist']){const user=users.find((x:any)=>x.role===role);assert.equal(snapshot.workers.find((x:any)=>x.id===user.id).role,role);}
  assert(!JSON.stringify(snapshot).includes('password_hash'));assert(!JSON.stringify(snapshot).includes('csrf'));
  const spec=await (await fetch(f.base+'/api/v1/openapi.json')).json();assert.equal(Object.values(spec.paths).reduce((n:number,p:any)=>n+Object.keys(p).length,0),100);
  for(const path of ['/plans/preview','/observations/interpret'])assert(spec.paths[path].post.parameters.some((p:any)=>p.name==='Idempotency-Key'&&p.required));
  for(const name of ['date','objectId','workerId','crewId'])assert(spec.paths['/tasks'].get.parameters.some((p:any)=>p.in==='query'&&p.name===name));
  const payload={constraints:{shiftDate:'2026-10-28',crewIds:['demo-crew-1']}};
  assert.equal((await f.call('/plans/preview','POST','coordinator',payload,{'Idempotency-Key':''})).body.error.code,'INVALID_IDEMPOTENCY_KEY');
  assert.equal((await f.call('/plans/preview','POST','coordinator',payload)).status,503);
});

test('Readiness: real HTTP confirms incompatible legacy DTOs and truthful error status',async t=>{
  const f=await setup(t);const task=(await f.care(null)).body.data;
  const probes:[string,string,unknown,number,string][]=[
    ['/projects','GET',undefined,404,'NOT_FOUND'],['/brigades','GET',undefined,404,'NOT_FOUND'],['/issues?objectId=demo-plant-1','GET',undefined,404,'NOT_FOUND'],
    ['/plans?date=2026-10-28','GET',undefined,404,'NOT_FOUND'],['/municipal/sites/demo-site-1','PATCH',{expectedVersion:1,checks:{access:{state:'cleared',comment:'Checked'}}},404,'NOT_FOUND'],
    ['/municipal/sites/rank-preview','POST',{weights:{}},404,'NOT_FOUND'],['/sites/demo-site-1/plant-selection','POST',{},404,'NOT_FOUND'],
    ['/tasks?assigneeId=demo-worker-1','GET',undefined,400,'VALIDATION_ERROR'],
    [`/tasks/${task.id}/assign`,'POST',{expectedVersion:1,brigadeId:'demo-crew-1',minCrew:1,scheduledStart:'2026-10-28T05:00:00Z'},400,'VALIDATION_ERROR'],
    ['/reports/absent/review','POST',{expectedTaskVersion:1,decision:'accepted',comment:'Legacy body'},400,'VALIDATION_ERROR'],
    ['/observations/interpret','POST',{taskId:task.id,objectId:task.objectId,text:'Test'},400,'VALIDATION_ERROR'],
    [`/tasks/${task.id}/assign-workers`,'POST',{expectedVersion:1,workerIds:['demo-worker-1'],responsibleUserId:'demo-worker-1'},400,'VALIDATION_ERROR'],
    [`/tasks/${task.id}/report-draft/contributions`,'POST',{expectedVersion:0,note:'Legacy contribution',actualWorkerIds:[],actualPlantingItems:[]},400,'VALIDATION_ERROR'],
    [`/tasks/${task.id}/reports`,'POST',{expectedVersion:1,note:'Legacy submit',actualWorkerIds:['demo-worker-1'],deviceTime:'2026-10-28T05:00:00Z',revisionOf:null},400,'VALIDATION_ERROR'],
    [`/tasks/${task.id}/issues`,'POST',{expectedVersion:1,reason:'access',note:'Legacy issue',photoIds:[]},400,'VALIDATION_ERROR']
  ];
  const results=[];for(const[path,method,body,status,code]of probes){const r=await f.call(path,method,'coordinator',body);assert.equal(r.status,status,path);assert.equal(r.body.error.code,code,path);assert(r.body.error.requestId);results.push({method,path,status,code});}
  assert.equal((await f.call('/tasks','POST','coordinator',{objectType:'plant',objectId:'demo-plant-1',action:'inspect',description:'CSRF test',estimatedMinutes:15,evidenceIds:['demo-v2-evidence']},{'X-CSRF-Token':''})).body.error.code,'CSRF_REQUIRED');
  mkdirSync('data/integration-readiness',{recursive:true});writeFileSync('data/integration-readiness/http-contract-probes.json',JSON.stringify({checkedAt:new Date().toISOString(),mode:'real HTTP; incompatible requests intentionally rejected',results},null,2));
});
