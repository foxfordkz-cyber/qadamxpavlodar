import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.js';
import {seedV2,DEMO_PASSWORD} from '../src/v2/seed.js';
import {seedTz} from '../src/tz/seed.js';
import {seedMunicipal} from '../src/municipal/data.js';
import {insertDoc} from '../src/v2/core.js';
import {Store} from '../src/db.js';
import {seedOutcomes} from '../src/outcomes/seed.js';
import {shared,today} from '../src/outcomes/shared.js';
import {createApp} from '../src/app.js';
import {once} from 'node:events';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
async function setup(t:TestContext){
 const f=await fixture(t);await seedV2(f.store);seedTz(f.store);await seedMunicipal(f.store);
 const siteId='site-osm-1569993037';
 for(let n=1;n<=6;n++)insertDoc(f.store,'plant',{id:`oc-tree-${n}`,speciesId:'sp-pinus-sylvestris',species:'Pinus sylvestris',kind:'tree',siteId:n===6?'foreign-zone':siteId,plantedAt:null,isDemo:true,version:1});
 insertDoc(f.store,'evidence',{id:'outcomes-demo-evidence',sourceType:'fixture',dataClass:'demo',isDemo:true,version:1});
 const sessions=new Map<string,{cookie:string;csrf:string}>();let key=0;
 async function call(path:string,method='GET',body?:any,user='coordinator',idem:string|null=`oc-${++key}`,csrf=true){
  if(!sessions.has(user)){const r=await fetch(f.base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:user,password:DEMO_PASSWORD})});assert.equal(r.status,200);const b=await r.json();sessions.set(user,{cookie:r.headers.get('set-cookie')!.split(';')[0]!,csrf:b.data.csrfToken});}
  const sess=sessions.get(user)!;const r=await fetch(f.base+'/api/v1/outcomes'+path,{method,headers:{Cookie:sess.cookie,...(csrf?{'X-CSRF-Token':sess.csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...(idem?{'Idempotency-Key':idem}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return{status:r.status,body:await r.json(),replay:r.headers.get('Idempotency-Replayed')};
 }
 const input={id:'cohort',siteId,plantIds:['oc-tree-1','oc-tree-2','oc-tree-3'],plantedOn:null,snapshotId:null,evidenceIds:[],expectedVersion:0};
 const inspect={id:'inspection',observedOn:today(),expectedVersion:1,evidenceIds:[],observations:[{plantId:'oc-tree-1',state:'alive',reportId:null,evidenceIds:['outcomes-demo-evidence']},{plantId:'oc-tree-2',state:'dead',reportId:null,evidenceIds:['outcomes-demo-evidence']}]};
 return{...f,call,input,inspect};
}
test('outcomes: HTTP cohort validation and missing date remains null',async t=>{
 const f=await setup(t);
 for(const [delta,status]of [[{plantIds:['missing']},404],[{plantIds:['oc-tree-1','oc-tree-1']},400],[{plantIds:['oc-tree-6']},400],[{plantedOn:'2020-01-01'},400]]as const){const r=await f.call('/cohorts','POST',{...f.input,...delta});assert.equal(r.status,status,JSON.stringify(r.body));assert.ok(r.body.error.code);assert.ok(r.body.error.requestId);}
 assert.equal(f.store.get('SELECT count(*) n FROM outcome_cohorts')?.n,0);
 const c=await f.call('/cohorts','POST',f.input);assert.equal(c.status,201,JSON.stringify(c.body));assert.equal(c.body.data.plantedOn,null);
 const result=await f.call('/cohorts/cohort/summary');assert.equal(result.body.data.summary.unknown,3);assert.equal(result.body.data.summary.wholeCohortSurvivalPct,null);
 assert.equal((await f.call('/cohorts','POST',{...f.input,id:'another'})).status,409);
});
test('outcomes: RBAC, CSRF, idempotent replay and duplicate submissions',async t=>{
 const f=await setup(t);
 for(const role of ['viewer','worker1','foreman1'])assert.equal((await f.call('/cohorts','POST',f.input,role)).status,403);
 assert.equal((await f.call('/cohorts','POST',f.input,'admin',null)).status,400);
 assert.equal((await f.call('/cohorts','POST',f.input,'admin','csrf',false)).status,403);
 const first=await f.call('/cohorts','POST',f.input,'admin','same');assert.equal(first.status,201);
 const replay=await f.call('/cohorts','POST',f.input,'admin','same');assert.deepEqual(replay.body,first.body);assert.equal(replay.replay,'true');
 assert.equal((await f.call('/cohorts','POST',{...f.input,id:'other'},'admin','same')).status,409);
 assert.equal((await f.call('/cohorts','POST',f.input)).status,409);
 assert.equal((await f.call('/cohorts/cohort','GET',undefined,'viewer')).status,200);
 for(const role of ['worker1','foreman1'])assert.equal((await f.call('/cohorts/cohort','GET',undefined,role)).status,404);
});
test('outcomes: accepted reports required, foreign observations rejected, atomic rollback and history',async t=>{
 const f=await setup(t);await f.call('/cohorts','POST',f.input);
 const path='/cohorts/cohort/inspections';
 for(const delta of [{expectedVersion:99},{observations:[{...f.inspect.observations[0],state:'missing'}]},{observations:[{...f.inspect.observations[0],plantId:'oc-tree-4'}]},{observations:[{...f.inspect.observations[0],reportId:'invalid'}]},{observations:[{...f.inspect.observations[0],evidenceIds:[]}]},{observations:[f.inspect.observations[0],f.inspect.observations[0]]}]){
  const r=await f.call(path,'POST',{...f.inspect,...delta});assert.ok([400,409].includes(r.status),JSON.stringify(r.body));
 }
 assert.equal(f.store.get('SELECT count(*) n FROM outcome_inspections')?.n,0);assert.equal(f.store.get('SELECT version FROM outcome_cohorts')?.version,1);
 const result=await f.call(path,'POST',f.inspect,'coordinator','inspect-key');assert.equal(result.status,201,JSON.stringify(result.body));
 assert.equal((await f.call(path,'POST',f.inspect,'coordinator','inspect-key')).replay,'true');
 assert.equal((await f.call(path,'POST',{...f.inspect,id:'duplicate',expectedVersion:2})).status,409);
 const c=(await f.call('/cohorts/cohort')).body.data;
 const summary=(await f.call('/cohorts/cohort/summary?inspectionId=inspection')).body.data;
 assert.deepEqual(summary.summary,shared.summarizeOutcomeInspection(c,result.body.data,today()));
 assert.equal(summary.summary.unknown,1);assert.equal(summary.summary.wholeCohortSurvivalPct,null);
 assert.equal((await f.call('/cohorts/cohort/inspections')).body.data.length,1);
 assert.throws(()=>f.store.run("UPDATE outcome_inspections SET observed_on='2020-01-01'"));
});
test('outcomes: pending versus accepted report status, date and target validation',async t=>{
 const f=await setup(t);await f.call('/cohorts','POST',f.input);
 const task={id:'oc-task',objectType:'plant',objectId:'oc-tree-1',action:'inspect',assignedWorkerIds:['demo-worker-1'],assignedCrewId:'demo-crew-1',version:1};
 f.store.run("INSERT INTO v2_tasks VALUES (?,'verified',?,NULL,NULL,1,?)",task.id,task.assignedCrewId,JSON.stringify(task));
 const report={id:'oc-report',taskId:task.id,reviewStatus:'pending',createdAt:new Date().toISOString(),reviewerId:null,reviewedAt:null,version:1};
 f.store.run("INSERT INTO v2_reports VALUES (?,?,1,?,'pending',1,?)",report.id,task.id,'demo-worker-1',JSON.stringify(report));
 const input={...f.inspect,observations:[{plantId:'oc-tree-1',state:'alive',reportId:report.id,evidenceIds:[]}]};
 assert.equal((await f.call('/cohorts/cohort/inspections','POST',input)).body.error.code,'UNACCEPTED_REPORT');
 f.store.run("UPDATE v2_reports SET status='accepted',data=? WHERE id=?",JSON.stringify({...report,reviewStatus:'accepted',reviewerId:'demo-coordinator-1',reviewedAt:new Date().toISOString()}),report.id);
 assert.equal((await f.call('/cohorts/cohort/inspections','POST',input)).status,201);
 assert.equal((await f.call('/cohorts/cohort','GET',undefined,'worker1')).status,404);
 f.store.run('UPDATE v2_tasks SET data=? WHERE id=?',JSON.stringify({...task,objectType:'candidate_site',objectId:f.input.siteId}),task.id);
 assert.equal((await f.call('/cohorts/cohort','GET',undefined,'worker1')).status,200);
 assert.equal((await f.call('/cohorts/cohort','GET',undefined,'foreman1')).status,200);
 assert.equal((await f.call('/cohorts/cohort','GET',undefined,'worker3')).status,404);
});
test('outcomes: immutable snapshot, real SQLite reopen, repeat seed and no registry duplication',async t=>{
 const f=await setup(t);const oldPlants=f.store.all("SELECT * FROM v2_documents WHERE kind='plant' ORDER BY id");
 const seeded=seedOutcomes(f.store);assert.equal(seeded.created,true);
 for(const p of oldPlants)assert.deepEqual(f.store.get("SELECT * FROM v2_documents WHERE kind='plant' AND id=?",p.id!),p);
 const members=f.store.all('SELECT plant_id FROM outcome_members');assert.equal(members.length,seeded.trees);
 for(const p of members)assert(f.store.get("SELECT id FROM v2_documents WHERE kind='plant' AND id=?",p.plant_id!),'Cohort must reference canonical registry IDs');
 const before=f.store.all('SELECT * FROM outcome_snapshots');const plants=f.store.get("SELECT count(*) n FROM v2_documents WHERE kind='plant'")?.n;
 assert.equal(seedOutcomes(f.store).created,false);assert.equal(f.store.get("SELECT count(*) n FROM v2_documents WHERE kind='plant'")?.n,plants);
 assert.throws(()=>f.store.run("UPDATE outcome_snapshots SET data='{}'"));
 assert.throws(()=>f.store.run("DELETE FROM outcome_snapshots"));
 assert.throws(()=>f.store.run("UPDATE outcome_cohorts SET data=json_set(data,'$.forecast',null)"));
 const reopened=new Store(f.store.path);try{assert.deepEqual(reopened.all('SELECT * FROM outcome_snapshots'),before);assert.equal(reopened.get('PRAGMA integrity_check')?.integrity_check,'ok');assert.deepEqual(reopened.all('PRAGMA foreign_key_check'),[]);}finally{reopened.close();}
 const c=(await f.call('/cohorts/outcomes-demo-cohort')).body.data;
 assert.equal(c.provenance.isDemo,true);assert.ok(c.forecast);assert.equal(c.forecast.provenance.isDemo,true);
 const result=(await f.call('/cohorts/outcomes-demo-cohort/summary?inspectionId=outcomes-demo-inspection')).body.data;assert.equal(result.summary.dead,1);assert.ok(result.summary.unknown>0);
});

test('outcomes: optional existing demo plant IDs preserve registry and reject real/foreign data',async t=>{
 const f=await setup(t),before=f.store.all("SELECT * FROM v2_documents WHERE kind='plant' ORDER BY id");
 const input={siteId:f.input.siteId,plantIds:f.input.plantIds};
 assert.throws(()=>seedOutcomes(f.store,{...input,plantIds:['oc-tree-1','oc-tree-2','oc-tree-6']}));
 f.store.run("UPDATE v2_documents SET data=json_set(data,'$.isDemo',json('false')) WHERE kind='plant' AND id='oc-tree-3'");
 assert.throws(()=>seedOutcomes(f.store,input));
 f.store.run("UPDATE v2_documents SET data=? WHERE kind='plant' AND id='oc-tree-3'",before.find(x=>x.id==='oc-tree-3')!.data!);
 assert.equal(seedOutcomes(f.store,input).trees,3);assert.equal(seedOutcomes(f.store,input).created,false);
 assert.deepEqual(f.store.all("SELECT * FROM v2_documents WHERE kind='plant' ORDER BY id"),before);
 const c=(await f.call('/cohorts/outcomes-demo-cohort')).body.data;assert.equal(c.forecast,null);assert.equal(c.plantedOn,null);
 const r=(await f.call('/cohorts/outcomes-demo-cohort/summary?inspectionId=outcomes-demo-inspection')).body.data;
 assert.equal(r.summary.alive,1);assert.equal(r.summary.dead,1);assert.equal(r.summary.unknown,1);
});

test('outcomes: transaction failure rolls back history, sources, version and idempotency',async t=>{
 const f=await setup(t);await f.call('/cohorts','POST',f.input);
 f.store.db.exec("CREATE TRIGGER oc_fail BEFORE INSERT ON outcome_sources BEGIN SELECT RAISE(ABORT,'injected'); END");
 const r=await f.call('/cohorts/cohort/inspections','POST',f.inspect,'coordinator','failure');assert.equal(r.status,500);
 assert.equal(f.store.get('SELECT count(*) n FROM outcome_inspections')?.n,0);
 assert.equal(f.store.get('SELECT version FROM outcome_cohorts')?.version,1);
 assert.equal(f.store.get("SELECT count(*) n FROM v2_idempotency WHERE key='failure'")?.n,0);
 f.store.db.exec('DROP TRIGGER oc_fail');assert.equal((await f.call('/cohorts/cohort/inspections','POST',f.inspect,'coordinator','failure')).status,201);
});
test('outcomes: snapshot HTTP uses current site version; body cannot inject historical forecast',async t=>{
 const f=await setup(t);const site=JSON.parse(String(f.store.get("SELECT data FROM v2_documents WHERE kind='site' AND id=?",f.input.siteId)?.data));
 const input={id:'http-forecast',siteId:f.input.siteId,expectedVersion:site.version,variant:'econom'};
 assert.equal((await f.call('/snapshots','POST',{...input,expectedVersion:999})).status,409);
 assert.equal((await f.call('/snapshots','POST',{...input,capturedAt:'2020-01-01'})).status,400);
 const r=await f.call('/snapshots','POST',input);assert.equal(r.status,201,JSON.stringify(r.body));
 assert.equal(r.body.data.snapshot.schemaVersion,1);assert.equal(r.body.data.snapshot.analysis.options.careYears,3);
 assert.equal((await f.call('/cohorts','POST',{...f.input,forecast:{schemaVersion:1}})).status,400);
});

test('outcomes: HTTP after closed database/server restart retains snapshot, inspection, session and seed',async()=>{
 const root=mkdtempSync(join(tmpdir(),'gp-outcomes-restart-')),path=join(root,'data.sqlite');
 let s=new Store(path);await seedV2(s);seedTz(s);await seedMunicipal(s);const demo=seedOutcomes(s);
 assert.ok(demo.trees && demo.trees>2);
 let server=createApp(s,{uploadsPath:join(root,'uploads')}).listen(0,'127.0.0.1');await once(server,'listening');
 const base=()=>`http://127.0.0.1:${(server.address() as any).port}`;
 try{
  const login=await fetch(base()+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:'coordinator',password:DEMO_PASSWORD})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
  const read=async()=>{const r=await fetch(base()+'/api/v1/outcomes/cohorts/outcomes-demo-cohort',{headers:{Cookie:cookie}});assert.equal(r.status,200);return r.json();};
  const before=await read();
  server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));s.close();
  s=new Store(path);assert.equal(seedOutcomes(s).created,false);
  // Later source changes must not rebuild the saved forecast.
  s.run("UPDATE tz_rates SET data=json_set(data,'$.value',123456) WHERE key='soil.prep'");
  server=createApp(s,{uploadsPath:join(root,'uploads')}).listen(0,'127.0.0.1');await once(server,'listening');
  assert.deepEqual(await read(),before);
  const r=await fetch(base()+'/api/v1/outcomes/cohorts/outcomes-demo-cohort/inspections',{headers:{Cookie:cookie}});assert.equal(r.status,200);assert.equal((await r.json()).data.length,1);
 }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));s.close();}
});
