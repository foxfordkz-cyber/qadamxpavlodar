import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import sharp from 'sharp';
import { postgresFixture } from './workflow-helpers.js';
import { privateTestStorage } from './private-test-storage.js';
import { workflowScenario } from './scenario.js';
import { checkNames } from '../../src/v2/data.js';
import { today,day,shared } from '../../src/outcomes/shared.js';
import { migrations,migrate } from '../../src/cloud/migrations.js';
import { Store } from '../../src/db.js';
import { createApp } from '../../src/app.js';

const tables=['users','profiles','crews','memberships','documents','planning_documents','zone_contexts','analysis_snapshots','designs','design_revisions','tasks','assignments','reports','report_drafts','upload_intents','uploads','planting_receipts','workflow_history','idempotency','outcome_snapshots','outcome_cohorts','outcome_members','outcome_inspections','outcome_sources'];
test('Stage D/F: real planning → planting → private photo → acceptance → cohort → accepted inspection → viewer; atomicity and restart',{timeout:420000},async t=>{
 const storage=await privateTestStorage();t.after(()=>storage.stop());
 const f=await postgresFixture(t,storage.env),s=await workflowScenario(f,'outcome');let site:any,forecast:any,calculation:any,planting:any,photo:any,cohort:any,inspection:any,inspectReport:any;
 const planted:any[]=[];const inputPhoto=await sharp({create:{width:8,height:8,channels:3,background:'#15803d'}}).png().toBuffer();
 const cohortBody=()=>({id:'cloud-outcome-cohort',siteId:site.id,plantIds:planted.map(p=>p.id),plantedOn:null,snapshotId:forecast.id,evidenceIds:[s.source.id],expectedVersion:0});
 const inspectionBody=()=>({id:'cloud-outcome-inspection',observedOn:day(inspectReport.report.createdAt),expectedVersion:cohort.version,evidenceIds:[s.source.id],observations:[{plantId:planted[0].id,state:'alive',reportId:inspectReport.report.id,evidenceIds:[]},{plantId:planted[1].id,state:'unknown',reportId:null,evidenceIds:[]}]});
 const review=(r:any)=>({expectedVersion:r.task.version,expectedReportVersion:r.report.version,decision:'accepted',comment:'Synthetic DEMO acceptance; not a field observation'});
 async function step(name:string,work:()=>Promise<void>){let failed=false;await t.test(name,async()=>{try{await work();}catch(e){failed=true;throw e;}});if(failed)throw Error('Dependent Outcomes acceptance stopped after '+name);}
 async function readPhoto(){const a=f.sessions.get('viewer')??await f.login('viewer'),res=await fetch(f.base+'/uploads/'+photo.id,{headers:{Cookie:a.cookie}});assert.equal(res.status,200);return createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex');}
 await step('login, current zone/recommendation/estimate and immutable tree-only forecast before planting',async()=>{
  const extension=await f.request('/outcomes/openapi.json','GET','viewer');assert.equal(extension.status,200);assert.equal(extension.body.openapi,'3.1.0');assert(extension.body.paths['/cohorts/{id}/inspections']);
  site=await f.ok('/sites/site-osm-1568405606');
  site=await f.ok('/sites/'+site.id,'PATCH','coordinator',{expectedVersion:site.version,checks:Object.fromEntries(checkNames.map(name=>[name,{status:'cleared',comment:'Synthetic DEMO clearance, not a real survey'}]))});
  const ref=await f.ok('/rates'),species=await f.ok('/species'),options={variant:'econom',careYears:3,excluded:species.filter((v:any)=>v.form!=='tree').map((v:any)=>v.id)};
  const analysis=await f.ok('/zones/'+site.id+'/analysis','POST','coordinator',{options});assert(analysis.scheme.length>0);
  calculation=await f.ok('/zones/'+site.id+'/snapshots','POST','coordinator',{options},201,'outcome-calculation');
  forecast=await f.ok('/outcomes/snapshots','POST','coordinator',{id:'cloud-outcome-forecast',siteId:site.id,expectedVersion:site.version,expectedRatesVersion:ref.version,variant:'econom'},201,'outcome-forecast');
  assert.deepEqual(forecast.snapshot.analysis.scheme,analysis.scheme);assert.deepEqual(forecast.snapshot.rates,ref.rates);
  assert(forecast.snapshot.provenance.isDemo);assert.equal(forecast.snapshot.provenance.dataClass,'estimate');
  assert.deepEqual(await f.ok('/outcomes/snapshots','POST','coordinator',{id:forecast.id,siteId:site.id,expectedVersion:site.version,expectedRatesVersion:ref.version,variant:'econom'},201,'outcome-forecast'),forecast);
  assert.equal((await f.request('/outcomes/snapshots','POST','coordinator',{id:'stale-forecast',siteId:site.id,expectedVersion:site.version,expectedRatesVersion:999,variant:'econom'})).status,409);
 });
 await step('same forecast composition → admin-approved design → assignment → photo report → exactly-once planting acceptance',async()=>{
  const items=forecast.snapshot.analysis.scheme.map((row:any,i:number)=>({id:'outcome-item-'+i,catalogItemId:row.speciesId,quantity:row.quantity,geometry:{type:'MultiPoint',coordinates:Array.from({length:row.quantity},(_,n)=>[site.centroid.lng+(i+n)*0.000001,site.centroid.lat])},quantityMethod:'Synthetic DEMO positions from exact forecast composition',evidenceIds:[s.source.id]}));
  assert(items.reduce((n:number,v:any)=>n+v.quantity,0)>=3);assert(items.reduce((n:number,v:any)=>n+v.quantity,0)<=100);
  const design=await f.ok('/designs','POST','coordinator',{siteId:site.id,name:'Synthetic DEMO Outcomes project',objective:'Persistence acceptance only',contextVersion:1,plantingItems:items,evidenceIds:[s.source.id]},201);
  await f.ok('/designs/'+design.id+'/submit','POST','coordinator',{expectedVersion:1});
  await f.ok('/designs/'+design.id+'/review','POST','admin',{expectedVersion:2,decision:'approved',comment:'Synthetic DEMO approval'});
  const released=await f.ok('/designs/'+design.id+'/create-tasks','POST','coordinator',{expectedVersion:3,revision:1,estimatedMinutes:30,minWorkers:1},201);
  assert.equal(released.length,1);const task=await s.startTask(1,released[0]);
  const a=f.sessions.get(s.workerLogin)!,form=new FormData();form.set('taskId',task.id);form.set('file',new Blob([new Uint8Array(inputPhoto)],{type:'image/png'}),'synthetic-demo.png');
  const up=await fetch(f.base+'/uploads',{method:'POST',headers:{Cookie:a.cookie,'X-CSRF-Token':a.csrf,'Idempotency-Key':'outcomes-photo'},body:form}),uploaded=await up.json() as any;f.validate('/uploads','POST',up.status,uploaded);assert.equal(up.status,201);photo=uploaded.data;
  const sent=await f.ok('/tasks/'+task.id+'/reports','POST',s.workerLogin,{expectedVersion:task.version,note:'Synthetic DEMO planting, not field evidence',photoIds:[photo.id],actualWorkerIds:[s.worker.id],actualPlantingItems:items.map((v:any)=>({plantingItemId:v.id,catalogItemId:v.catalogItemId,quantity:v.quantity,geometry:v.geometry}))},201);
  planting=await f.ok('/reports/'+sent.report.id+'/review','POST','coordinator',review(sent),200,'outcomes-accept-planting');planted.push(...planting.plants);
  assert.equal(planted.length,items.reduce((n:number,v:any)=>n+v.quantity,0));assert(planted.every(p=>p.isDemo));
  assert.deepEqual(await f.ok('/reports/'+sent.report.id+'/review','POST','coordinator',review(sent),200,'outcomes-accept-planting'),planting);
  const receipt=(await f.db.pool.query('SELECT * FROM gp_cloud.planting_receipts WHERE report_id=$1',[planting.report.id])).rows;assert.equal(receipt.length,planted.length);
  assert.equal((await f.ok('/reports/'+planting.report.id,'GET','viewer')).reviewStatus,'accepted');assert.equal(await readPhoto(),photo.sha256);
 });
 await step('cohort references existing registry trees, exact immutable snapshot; missing inspection means unknown',async()=>{
  const before=(await f.db.pool.query("SELECT count(*)::int n FROM gp_cloud.documents WHERE kind='plant'")).rows[0].n,body=cohortBody();
  for(const role of ['viewer',s.workerLogin,s.foremanLogin])assert.equal((await f.request('/outcomes/cohorts','POST',role,body)).status,403);
  assert.equal((await f.request('/outcomes/cohorts','POST','coordinator',body,'no-csrf',false)).status,403);
  assert.equal((await f.request('/outcomes/cohorts','POST','coordinator',{...body,plantIds:['missing']})).status,404);
  const writes=await Promise.all([1,2,3].map(()=>f.request('/outcomes/cohorts','POST','coordinator',body,'outcome-cohort')));
  assert(writes.every(r=>r.status===201));assert.equal(writes.filter(r=>r.replayed==='false').length,1);cohort=writes[0]!.body.data;
  assert.equal(cohort.plantedOn,null);assert.deepEqual(cohort.forecast,forecast.snapshot);assert(cohort.provenance.isDemo);
  assert.equal((await f.request('/outcomes/cohorts','POST','coordinator',{...body,id:'changed'},'outcome-cohort')).status,409);
  assert.equal((await f.request('/outcomes/cohorts','POST','coordinator',{...body,id:'same-trees'})).body.error.code,'PLANT_ALREADY_IN_COHORT');
  assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM gp_cloud.documents WHERE kind='plant'")).rows[0].n,before);
  const summary=await f.ok('/outcomes/cohorts/'+cohort.id+'/summary','GET','viewer');assert.equal(summary.summary.unknown,planted.length);assert.equal(summary.summary.wholeCohortSurvivalPct,null);assert.equal(summary.summary.inspectionId,null);
  for(const role of [s.workerLogin,s.foremanLogin])assert.equal((await f.request('/outcomes/cohorts/'+cohort.id,'GET',role)).status,200);
  assert.equal((await f.request('/outcomes/cohorts/'+cohort.id,'GET',s.otherLogin)).status,404);
  assert.equal((await f.request('/outcomes/sites/'+site.id,'GET',s.workerLogin)).status,403);
 });
 await step('actual accepted inspect report is required; planting report and prose never imply alive/dead',async()=>{
  const task=await s.startTask(1,await f.ok('/tasks','POST','coordinator',{objectType:'plant',objectId:planted[0].id,action:'inspect',description:'Synthetic DEMO inspection, not real fieldwork',estimatedMinutes:30,evidenceIds:[s.source.id]},201));
  inspectReport=await f.ok('/tasks/'+task.id+'/reports','POST',s.workerLogin,{expectedVersion:task.version,note:'Synthetic DEMO prose does not establish structured survival',actualWorkerIds:[s.worker.id]},201);
  const path='/outcomes/cohorts/'+cohort.id+'/inspections',body=inspectionBody();
  assert.equal((await f.request(path,'POST','coordinator',body)).body.error.code,'UNACCEPTED_REPORT');
  inspectReport=await f.ok('/reports/'+inspectReport.report.id+'/review','POST','coordinator',review(inspectReport));
  for(const [delta,code] of [
   [{observations:[{...body.observations[0],reportId:planting.report.id}]},'REPORT_TARGET_MISMATCH'],
   [{observations:[{...body.observations[0],reportId:'missing'}]},'INVALID_REPORT'],
   [{observations:[{...body.observations[0],reportId:null}]},'UNCONFIRMED_OBSERVATION'],
   [{observations:[{...body.observations[0],reportId:null,evidenceIds:[s.source.id]}]},'UNCONFIRMED_EVIDENCE'],
   [{observations:[{...body.observations[0],plantId:s.plant.id}]},'FOREIGN_PLANT'],
   [{observedOn:'2020-01-01'},'REPORT_DATE_MISMATCH']
  ] as const)assert.equal((await f.request(path,'POST','coordinator',{...body,...delta})).body.error.code,code);
 });
 await step('late rollback preserves cohort version, source links, history and idempotency; same-key retry succeeds',async()=>{
  const path='/outcomes/cohorts/'+cohort.id+'/inspections',body=inspectionBody(),before=await f.snapshot(tables);
  await f.db.pool.query("CREATE FUNCTION gp_cloud.test_abort_outcome() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='outcome_inspection' THEN RAISE EXCEPTION 'synthetic late failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER test_abort_outcome BEFORE INSERT ON gp_cloud.workflow_history FOR EACH ROW EXECUTE FUNCTION gp_cloud.test_abort_outcome()");
  try{assert.equal((await f.request(path,'POST','coordinator',body,'outcome-inspection')).status,503);assert.deepEqual(await f.snapshot(tables),before);}finally{await f.db.pool.query('DROP TRIGGER test_abort_outcome ON gp_cloud.workflow_history; DROP FUNCTION gp_cloud.test_abort_outcome()');}
  const writes=await Promise.all([1,2,3].map(()=>f.request(path,'POST','coordinator',body,'outcome-inspection')));assert(writes.every(r=>r.status===201));inspection=writes[0]!.body.data;
  assert.equal(writes.filter(r=>r.replayed==='false').length,1);assert.deepEqual(writes[1]!.body,writes[0]!.body);
  assert.equal((await f.request(path,'POST','coordinator',{...body,id:'changed'},'outcome-inspection')).status,409);
  assert.equal((await f.request(path,'POST','coordinator',{...body,id:'stale'})).body.error.code,'VERSION_CONFLICT');
  assert.equal((await f.request(path,'POST','coordinator',{...body,id:'same-date',expectedVersion:2})).body.error.code,'DUPLICATE_INSPECTION');
  for(const role of ['viewer',s.workerLogin,s.foremanLogin])assert.equal((await f.request(path,'POST',role,body)).status,403);
  const result=await f.ok(path.replace('/inspections','/summary')+'?inspectionId='+inspection.id,'GET','viewer');
  assert.equal(result.summary.alive,1);assert.equal(result.summary.dead,0);assert.equal(result.summary.unknown,planted.length-1);assert.equal(result.summary.wholeCohortSurvivalPct,null);
  assert.deepEqual(result.summary,shared.summarizeOutcomeInspection({...cohort,version:2},inspection,today()));
  assert.equal((await f.ok('/outcomes/cohorts/'+cohort.id,'GET','viewer')).version,2);
  assert.equal((await f.ok(path,'GET','viewer')).length,1);
  const linked=(await f.db.pool.query('SELECT report_id FROM gp_cloud.outcome_sources WHERE inspection_id=$1 AND plant_id=$2',[inspection.id,planted[0].id])).rows[0];assert.equal(linked.report_id,inspectReport.report.id);
 });
 await step('lost inspection response and optimistic concurrent append keep dated history and unknown states',async()=>{
  const path='/outcomes/cohorts/'+cohort.id+'/inspections',prior=(n:number)=>new Date(Date.parse(today())-n*86400000).toISOString().slice(0,10);
  const body={id:'unknown-prior-inspection',observedOn:prior(1),expectedVersion:2,evidenceIds:[],observations:[{plantId:planted[2].id,state:'unknown',reportId:null,evidenceIds:[]}]};
  const a=f.sessions.get('coordinator')!,res=await fetch(f.base+path,{method:'POST',headers:{Cookie:a.cookie,'X-CSRF-Token':a.csrf,'Content-Type':'application/json','Idempotency-Key':'lost-outcome-response'},body:JSON.stringify(body)});
  assert.equal(res.status,201);await res.body?.cancel();
  const replay=await f.request(path,'POST','coordinator',body,'lost-outcome-response');assert.equal(replay.status,201);assert.equal(replay.replayed,'true');
  const race=await Promise.all([1,2].map(i=>f.request(path,'POST','coordinator',{...body,id:'version-race-'+i,observedOn:prior(2),expectedVersion:3},'outcome-race-'+i)));
  assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
  const rows=await f.ok(path,'GET','viewer');assert.equal(rows.length,3);assert.deepEqual(rows.find((r:any)=>r.data.id===inspection.id).data,inspection);
  const result=await f.ok('/outcomes/cohorts/'+cohort.id+'/summary?inspectionId='+body.id,'GET','viewer');assert.equal(result.summary.unknown,planted.length);assert.equal(result.summary.wholeCohortSurvivalPct,null);
  assert.equal((await f.ok('/outcomes/cohorts/'+cohort.id,'GET','viewer')).version,4);
 });
 await step('current frontend API-mode adapters use real HTTP; unsupported UI routes stay explicit 503',async()=>{
  const load=(path:string)=>import(new URL('../../../web/src/'+path,import.meta.url).href);
  const {createApi}=await load('shared/api/api.ts'),{createV2CompatTransport}=await load('shared/api/v2compat.ts'),{createOutcomesClient}=await load('shared/api/outcomesClient.ts'),{ApiError}=await load('shared/api/transport.ts');
  const http={kind:'api',async request(method:string,path:string,o:any={}){
   const url=new URL(path,'http://test.local');for(const [k,v] of Object.entries(o.query??{}))if(v!==undefined&&v!==null)url.searchParams.set(k,String(v));
   const r=await f.request(url.pathname+url.search,method,'viewer',o.body,o.idempotencyKey);
   if(r.status>=400)throw new ApiError(r.status,r.body.error.code,r.body.error.message,r.body.error.requestId,r.body.error.details);
   return r.body;
  }};
  const api=createApi(createV2CompatTransport(http)),read=await createOutcomesClient(http).list(site.id);
  assert.equal(read.cohorts[0].id,cohort.id);assert.equal(read.inspections.length,3);
  assert((await api.sites()).data.some((v:any)=>v.id===site.id));assert((await api.brigades()).some((v:any)=>v.id===s.crew.id));
  assert((await api.workers()).some((v:any)=>v.id===s.worker.id));assert((await api.tasks()).data.some((v:any)=>v.id===planting.task.id));
  assert((await api.reports()).data.some((v:any)=>v.id===planting.report.id));assert((await api.projects()).data.some((v:any)=>v.id===planting.task.approvedDesignId));
  assert((await api.plants()).data.some((v:any)=>v.id===planted[0].id));assert(Array.isArray((await api.dashboard()).data));
  assert.equal((await api.upload(photo.id)).url,'/api/v1/uploads/'+photo.id);
  const plan=await api.dayPlan(today());assert.equal(plan.plan,null);
  await assert.rejects(api.approveDayPlan(today(),null),(e:any)=>e.status===503&&e.code==='integration_unavailable');
  const pending:[string,string][]=[['POST','/zones'],['GET','/geocode?q=Pavlodar'],['POST','/imports/preview'],['POST','/imports/test/commit'],['POST','/zones/'+site.id+'/care-schedule'],['POST','/assistant'],['GET','/assistant/history'],['POST','/sites/rank-preview'],['POST','/sites/'+site.id+'/plant-selection'],['POST','/observations/interpret']];
  const a=f.sessions.get('coordinator')!,result:{method:string;path:string;status:number;code:string}[]=[];
  for(const [method,path] of pending){
   const response=await fetch(f.base+path,{method,headers:{Cookie:a.cookie,'X-CSRF-Token':a.csrf,'Idempotency-Key':'backlog-'+result.length,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:'{}'}:{})});
   const body=await response.json() as any;assert.equal(response.status,503);assert.equal(body.error.code,'CLOUD_ENDPOINT_UNSUPPORTED');result.push({method,path,status:response.status,code:body.error.code});
  }
  writeFileSync(join(f.dir,'remaining-routes.json'),JSON.stringify(result,null,2));
 });

 await step('real SQLite HTTP parity on identical persisted Outcomes and canonical workflow data',async()=>{
  const sqlite=new Store(join(f.dir,'outcomes-parity.sqlite'));
  const pairs=[['users','v2_users'],['sessions','v2_sessions'],['documents','v2_documents'],['profiles','v2_profiles'],['crews','v2_crews'],['memberships','v2_memberships'],['designs','v2_designs'],['design_revisions','v2_design_revisions'],['tasks','v2_tasks'],['assignments','v2_assignments'],['reports','v2_reports'],['planting_receipts','v2_planting_receipts'],['outcome_snapshots','outcome_snapshots'],['outcome_cohorts','outcome_cohorts'],['outcome_members','outcome_members'],['outcome_inspections','outcome_inspections'],['outcome_sources','outcome_sources']];
  for(const [pg,table] of pairs){const cols=sqlite.all('PRAGMA table_info('+table+')').map(r=>String(r.name));for(const row of (await f.db.pool.query('SELECT * FROM gp_cloud.'+pg)).rows)sqlite.run('INSERT INTO '+table+'('+cols.join(',')+') VALUES ('+cols.map(()=>'?').join(',')+')',...cols.map(k=>row[k]!==null&&typeof row[k]==='object'?JSON.stringify(row[k]):row[k]));}
  const server=createApp(sqlite,{uploadsPath:join(f.dir,'unused-parity-uploads')}).listen(0,'127.0.0.1');await once(server,'listening');
  try{for(const role of ['viewer',s.workerLogin,s.foremanLogin,s.otherLogin]){
   const session=f.sessions.get(role)??await f.login(role);
   for(const path of ['/outcomes/cohorts','/outcomes/cohorts/'+cohort.id,'/outcomes/cohorts/'+cohort.id+'/inspections','/outcomes/cohorts/'+cohort.id+'/summary','/outcomes/cohorts/'+cohort.id+'/summary?inspectionId='+inspection.id,'/outcomes/sites/'+site.id]){
    const pg=await f.request(path,'GET',role),res=await fetch('http://127.0.0.1:'+(server.address() as {port:number}).port+'/api/v1'+path,{headers:{Cookie:session.cookie}}),body=await res.json() as any;assert.equal(res.status,pg.status,role+' '+path);
    if(res.status===200)assert.deepEqual(body,pg.body);else assert.equal(body.error.code,pg.body.error.code);
   }
  }}finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));sqlite.close();}
 });
 await step('native constraints keep immutable history and forecasts; current rates cannot rewrite old inputs',async()=>{
  for(const query of ["UPDATE gp_cloud.outcome_snapshots SET data='{}'","DELETE FROM gp_cloud.outcome_snapshots","UPDATE gp_cloud.outcome_inspections SET data='{}'","DELETE FROM gp_cloud.outcome_inspections","UPDATE gp_cloud.outcome_cohorts SET snapshot_id=NULL"]){await assert.rejects(f.db.pool.query(query),{code:'23514'});}
  await assert.rejects(f.db.pool.query("INSERT INTO gp_cloud.outcome_members(cohort_id,plant_id) VALUES ($1,'missing-plant')",[cohort.id]),{code:'23503'});
  await assert.rejects(f.db.pool.query("INSERT INTO gp_cloud.outcome_sources(inspection_id,plant_id,report_id) VALUES ($1,$2,'missing-report')",[inspection.id,planted[2].id]),{code:'23503'});
  const rates=await f.ok('/rates'),rate=rates.rates.find((r:any)=>r.key==='soil.prep');await f.ok('/rates','PATCH','admin',{expectedVersion:rates.version,key:rate.key,value:rate.value+1,source:'Synthetic DEMO change',dataClass:'estimate'});
  const read=await f.ok('/outcomes/sites/'+site.id,'GET','viewer');assert.deepEqual(read.forecasts.find((v:any)=>v.id===forecast.id).snapshot,forecast.snapshot);
  assert.deepEqual(read.cohorts[0].forecast,forecast.snapshot);assert.equal(read.inspections.length,3);assert.equal(read.registry.length,planted.length);
  assert(read.registry.every((v:any)=>v.isDemo));assert.equal((await f.ok('/analysis-snapshots/'+calculation.id)).provenance.inputHash,calculation.provenance.inputHash);
 });
 await step('published v4 with existing tasks/reports/photos upgrades atomically to v5; checksums and all prior rows unchanged',async()=>{
  const upgrade=await f.isolatedDatabase('qa_outcomes_upgrade');
  try{
   await upgrade.pool.query('CREATE SCHEMA gp_cloud; CREATE TABLE gp_cloud.schema_migrations(version integer PRIMARY KEY,checksum text NOT NULL)');
   for(const [i,sql] of migrations.slice(0,4).entries()){await upgrade.pool.query(sql);await upgrade.pool.query('INSERT INTO gp_cloud.schema_migrations VALUES ($1,$2)',[i+1,createHash('sha256').update(sql).digest('hex')]);}
   const copy=['users','documents','planning_documents','zone_contexts','analysis_snapshots','profiles','crews','memberships','designs','design_revisions','tasks','assignments','reports','report_drafts','upload_intents','uploads','planting_receipts','workflow_history','idempotency'];
   async function hashes(){const values:Record<string,string>={};for(const table of copy)values[table]=createHash('sha256').update(JSON.stringify((await upgrade.pool.query('SELECT * FROM gp_cloud.'+table)).rows.map(r=>JSON.stringify(r)).sort())).digest('hex');return values;}
   for(const table of copy){
    const cols=(await upgrade.pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='gp_cloud' AND table_name=$1 AND is_generated='NEVER' ORDER BY ordinal_position",[table])).rows.map(r=>r.column_name);
    for(const row of (await f.db.pool.query('SELECT * FROM gp_cloud.'+table)).rows)await upgrade.pool.query('INSERT INTO gp_cloud.'+table+'('+cols.join(',')+') VALUES ('+cols.map((_:any,i:number)=>'$'+(i+1)).join(',')+')',cols.map((k:string)=>row[k]));
   }
   const before=await hashes();
   await upgrade.pool.query('CREATE TABLE gp_cloud.outcome_cohorts(sentinel integer); INSERT INTO gp_cloud.outcome_cohorts VALUES (7)');
   await assert.rejects(migrate(upgrade),{code:'42P07'});assert.equal((await upgrade.pool.query("SELECT to_regclass('gp_cloud.outcome_snapshots') name")).rows[0].name,null);assert.equal((await upgrade.pool.query('SELECT count(*)::int n FROM gp_cloud.schema_migrations')).rows[0].n,4);
   assert.deepEqual(await hashes(),before);assert.equal((await upgrade.pool.query('SELECT sentinel FROM gp_cloud.outcome_cohorts')).rows[0].sentinel,7);
   await upgrade.pool.query('DROP TABLE gp_cloud.outcome_cohorts'); // Only this explicitly test-created collision, in the new QA database.
   await migrate(upgrade);await migrate(upgrade);assert.deepEqual(await hashes(),before);
   assert.deepEqual((await upgrade.pool.query('SELECT checksum FROM gp_cloud.schema_migrations ORDER BY version')).rows.map(r=>r.checksum),migrations.map(sql=>createHash('sha256').update(sql).digest('hex')));
  }finally{await upgrade.close();}
 });
 await step('backend/native PostgreSQL/private test storage restart and repeat seed preserve full linked workflow and passwords',async()=>{
  const before=await f.snapshot(tables),saved=await f.ok('/outcomes/sites/'+site.id,'GET','viewer'),report=await f.ok('/reports/'+planting.report.id,'GET','viewer'),history=await f.ok('/tasks/'+planting.task.id+'/history','GET','viewer');
  await f.stop();await storage.stop();await storage.start();await f.restart();await f.reseed();await f.reseed();
  assert.deepEqual(await f.snapshot(tables),before);assert.deepEqual(await f.ok('/outcomes/sites/'+site.id,'GET','viewer'),saved);
  assert.deepEqual(await f.ok('/reports/'+planting.report.id,'GET','viewer'),report);assert.deepEqual(await f.ok('/tasks/'+planting.task.id+'/history','GET','viewer'),history);assert.equal(await readPhoto(),photo.sha256);
  for(const role of ['admin','coordinator','viewer',s.workerLogin,s.foremanLogin])await f.login(role);
  writeFileSync(join(f.dir,'stage-d-persistence.json'),JSON.stringify({before,after:await f.snapshot(tables),cohortId:cohort.id,inspectionId:inspection.id,reportId:inspectReport.report.id,plantingReportId:planting.report.id,photoSha256:photo.sha256,isDemo:true},null,2));
 });
});
