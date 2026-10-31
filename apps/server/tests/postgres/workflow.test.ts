import { createHash } from 'node:crypto';
import { migrate,migration1,migrations } from '../../src/cloud/migrations.js';
import { migration2 } from '../../src/cloud/planning-migration.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer as httpServer } from 'node:http';
import { createCloudApp } from '../../src/cloud/app.js';
import { Store } from '../../src/db.js';
import { createApp } from '../../src/app.js';
import { postgresFixture } from './workflow-helpers.js';
import { checkNames } from '../../src/v2/data.js';
const tables=['users','profiles','crews','memberships','documents','designs','design_revisions','tasks','assignments','reports','report_drafts','issues','planting_receipts','care_events','workflow_history','idempotency','analysis_snapshots'];

test('Stage B: real PostgreSQL HTTP workflow, actor scopes, atomic planting, restart and repeat seed',{timeout:420000},async t=>{
 const f=await postgresFixture(t);let crew:any,worker:any,foreman:any,outsider:any,foreignForeman:any,source:any,site:any,plant:any,catalog:any,accepted:any,returned:any,planting:any,approved:any;
 const day=new Date();day.setUTCDate(day.getUTCDate()+1);day.setUTCHours(0,0,0,0);let slot=0;
 const profile={shiftStart:day.toISOString(),shiftEnd:new Date(+day+86400000-1).toISOString(),capacityMinutes:1000,skills:['inspect','plant','water'],unavailableIntervals:[]};
 const assignment=()=>({crewId:crew.id,scheduledStart:new Date(+day+(++slot)*3600000).toISOString(),scheduledEnd:new Date(+day+slot*3600000+1800000).toISOString(),resourceIds:[]});
 async function step(name:string,run:()=>Promise<void>){let failed=false;await t.test(name,async()=>{try{await run();}catch(e){failed=true;throw e;}});if(failed)throw Error('Dependent acceptance stopped after '+name);}
 async function draft(){return f.ok('/tasks','POST','coordinator',{objectType:'plant',objectId:plant.id,action:'inspect',description:'Synthetic DEMO inspection; not field evidence',estimatedMinutes:30,requiredSkills:['inspect'],evidenceIds:[source.id]},201);}
 async function start(task:any,workerIds=[worker.id]){
  task=await f.ok(`/tasks/${task.id}/assign`,'POST','coordinator',{expectedVersion:task.version,...assignment()});
  task=await f.ok(`/tasks/${task.id}/assign-workers`,'POST','foreman-b',{expectedVersion:task.version,workerIds});
  return f.ok(`/tasks/${task.id}/start`,'POST','worker-b',{expectedVersion:task.version});
 }
 async function submit(task:any,extra:Record<string,unknown>={}){return f.ok(`/tasks/${task.id}/reports`,'POST','worker-b',{expectedVersion:task.version,note:'Synthetic DEMO task completion, not a field observation',actualWorkerIds:[worker.id],...extra},201);}
 const review=(r:any,decision='accepted')=>({expectedVersion:r.task.version,expectedReportVersion:r.report.version,decision,comment:'Synthetic DEMO acceptance test'});
 await step('admin creates real profiles and crews; public DTOs never contain credentials',async()=>{
  foreman=await f.createUser('foreman-b','foreman',profile);worker=await f.createUser('worker-b','worker',profile);
  foreignForeman=await f.createUser('foreign-foreman','foreman',profile);outsider=await f.createUser('outside-worker','worker',profile);
  const viewer=await f.createUser('viewer-b','viewer');assert.equal(viewer.role,'viewer');assert.equal((await f.ok('/auth/me','GET','viewer-b')).user.role,'viewer');
  crew=await f.ok('/crews','POST','admin',{name:'DEMO workflow crew',foremanId:foreman.id},201);
  crew=await f.ok(`/crews/${crew.id}/members`,'POST','admin',{expectedVersion:crew.version,userId:worker.id,active:true});
  const foreign=await f.ok('/crews','POST','admin',{name:'DEMO unrelated crew',foremanId:foreignForeman.id},201);
  await f.ok(`/crews/${foreign.id}/members`,'POST','admin',{expectedVersion:foreign.version,userId:outsider.id,active:true});
  assert.equal((await f.request(`/crews/${foreign.id}/members`,'POST','admin',{expectedVersion:2,userId:worker.id,active:true})).body.error.code,'ALREADY_MEMBER');
  const staff=await f.ok('/workers','GET','viewer');assert(staff.some((u:any)=>u.id===worker.id));assert(!JSON.stringify(staff).match(/password|scrypt|csrf|token_hash/));
  assert(!(await f.ok('/workers','GET','foreman-b')).some((u:any)=>u.id===outsider.id));
  assert.deepEqual((await f.ok('/crews','GET','foreman-b')).map((c:any)=>c.id),[crew.id]);
  source=await f.ok('/evidence','POST','coordinator',{sourceType:'manual',sourceLabel:'Synthetic DEMO workflow fixture',dataClass:'demo',note:'Not a field observation'},201);
  plant=await f.ok('/plants','POST','coordinator',{name:'Synthetic DEMO tree',kind:'tree',lat:52.281,lng:76.951,evidenceIds:[source.id]},201);
  site=(await f.ok('/sites'))[0];catalog=(await f.ok('/plant-catalog'))[0];
  const resource=await f.ok('/resources','POST','admin',{type:'equipment',label:'DEMO crew equipment',ownerCrewId:crew.id,availableIntervals:[{start:profile.shiftStart,end:profile.shiftEnd}],evidenceIds:[source.id]},201);
  assert.equal(resource.ownerCrewId,crew.id);
 });
 await step('coordinator → foreman → worker → report → accepted; viewer reads existing records',async()=>{
  const task=await start(await draft());accepted=await submit(task);
  accepted=await f.ok(`/reports/${accepted.report.id}/review`,'POST','coordinator',review(accepted));
  assert.equal(accepted.task.status,'verified');assert.equal(accepted.report.reviewStatus,'accepted');
  for(const path of ['/tasks',`/tasks/${task.id}`,`/tasks/${task.id}/history`,'/reports',`/reports/${accepted.report.id}`,'/crews','/workers','/plants',`/plants/${plant.id}`])await f.ok(path,'GET','viewer');
  const row=(await f.db.pool.query('SELECT t.status task,r.status report FROM gp_cloud.tasks t JOIN gp_cloud.reports r ON r.task_id=t.id WHERE r.id=$1',[accepted.report.id])).rows[0];assert.deepEqual(row,{task:'verified',report:'accepted'});
  assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM gp_cloud.assignments WHERE task_id=$1',[task.id])).rows[0].n,1);
 });
 await step('return is changes_requested in the existing contract; no invented rejected state',async()=>{
  returned=await submit(await start(await draft()));const body=review(returned,'changes_requested');
  const reply=await f.ok(`/reports/${returned.report.id}/review`,'POST','coordinator',body,200,'return-once');
  assert.equal(reply.report.reviewStatus,'changes_requested');assert.equal(reply.task.status,'assigned');
  assert.deepEqual(await f.ok(`/reports/${returned.report.id}/review`,'POST','coordinator',body,200,'return-once'),reply);
  assert.equal((await f.request(`/reports/${returned.report.id}/review`,'POST','coordinator',{...body,decision:'rejected'})).status,400);
  returned=reply;
 });
 await step('viewer writes denied; worker/foreman foreign scope, CSRF and terminal states retained',async()=>{
  const d=await draft();const writes:[string,string,any][]=[['/tasks','POST',{objectType:'plant',objectId:plant.id,action:'inspect',description:'Denied',estimatedMinutes:30,evidenceIds:[source.id]}],
   [`/tasks/${d.id}/assign`,'POST',{expectedVersion:d.version,...assignment()}],
   [`/tasks/${d.id}/assign-workers`,'POST',{expectedVersion:d.version,workerIds:[worker.id]}],
   [`/tasks/${d.id}/start`,'POST',{expectedVersion:d.version}],
   [`/tasks/${d.id}/reports`,'POST',{expectedVersion:d.version,note:'Denied',actualWorkerIds:[worker.id]}],
   [`/reports/${accepted.report.id}/review`,'POST',review(accepted)],
   [`/reports/${returned.report.id}/review`,'POST',review(returned,'changes_requested')],
   [`/plants/${plant.id}`,'PATCH',{expectedVersion:plant.version,name:'Denied'}],
   ['/crews','POST',{name:'Denied',foremanId:foreman.id}]];
  const before=await f.snapshot(tables);
  for(const [path,method,body] of writes)assert.equal((await f.request(path,method,'viewer',body)).status,403,path);
  assert.deepEqual(await f.snapshot(tables),before);
  for(const role of ['outside-worker','foreign-foreman'])for(const path of [`/tasks/${accepted.task.id}`,`/reports/${accepted.report.id}`])assert.equal((await f.request(path,'GET',role)).status,404);
  assert.equal((await f.request(`/tasks/${d.id}/start`,'POST','worker-b',{expectedVersion:1})).status,404);
  assert.equal((await f.request('/crews','POST','admin',{name:'CSRF denied',foremanId:foreman.id},'csrf-missing',false)).status,403);
  assert.equal((await f.request(`/tasks/${accepted.task.id}/start`,'POST','worker-b',{expectedVersion:accepted.task.version})).status,409);
 });
 await step('group draft PUT, worker contribution and own-foreman submission retain optimistic versions',async()=>{
  let task=await f.ok('/tasks','POST','coordinator',{objectType:'plant',objectId:plant.id,action:'inspect',description:'Synthetic DEMO group task',estimatedMinutes:30,minWorkers:2,evidenceIds:[source.id]},201);
  task=await start(task,[worker.id,foreman.id]);
  const contribution={expectedVersion:task.version,expectedDraftVersion:0,note:'Synthetic DEMO contribution'};
  const draft=await f.ok(`/tasks/${task.id}/report-draft/contributions`,'POST','worker-b',contribution);assert.equal(draft.version,1);
  assert.equal((await f.request(`/tasks/${task.id}/report-draft/contributions`,'POST','worker-b',contribution)).status,409);
  const body={expectedVersion:task.version,expectedDraftVersion:1,note:'Synthetic DEMO group summary',actualWorkerIds:[worker.id,foreman.id]};
  assert.equal((await f.request(`/tasks/${task.id}/report-draft`,'PUT','worker-b',body)).status,403);
  assert.equal((await f.request(`/tasks/${task.id}/report-draft`,'PUT','foreign-foreman',body)).status,404);
  const summary=await f.ok(`/tasks/${task.id}/report-draft`,'PUT','foreman-b',body);assert.equal(summary.version,2);
  assert.equal((await f.request(`/tasks/${task.id}/reports`,'POST','worker-b',{...body,expectedDraftVersion:2})).status,403);
  const report=await f.ok(`/tasks/${task.id}/reports`,'POST','foreman-b',{...body,expectedDraftVersion:2},201);
  assert.equal(report.report.foremanCheckedBy,foreman.id);assert.equal(report.report.contributorIds[0],worker.id);
  await f.ok(`/reports/${report.report.id}/review`,'POST','coordinator',review(report));
 });
 await step('same key replay, changed body conflict, lost response and competing versions',async()=>{
  const body={objectType:'plant',objectId:plant.id,action:'inspect',description:'DEMO replay',estimatedMinutes:30,evidenceIds:[source.id]};
  const writes=await Promise.all(Array.from({length:4},()=>f.request('/tasks','POST','coordinator',body,'concurrent-create')));
  assert(writes.every(r=>r.status===201));assert.equal(new Set(writes.map(r=>r.body.data.id)).size,1);assert.equal(writes.filter(r=>r.replayed==='false').length,1);
  assert.equal((await f.request('/tasks','POST','coordinator',{...body,description:'Changed'},'concurrent-create')).status,409);
  const a=await f.login('coordinator');const lost=await fetch(f.base+'/tasks',{method:'POST',headers:{Cookie:a.cookie,'X-CSRF-Token':a.csrf,'Idempotency-Key':'lost-response','Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(lost.status,201);await lost.body?.cancel();
  const replay=await f.request('/tasks','POST','coordinator',body,'lost-response');assert.equal(replay.replayed,'true');
  const receipt=(await f.db.pool.query("SELECT response_json FROM gp_cloud.idempotency WHERE key='lost-response'")).rows;assert.equal(receipt.length,1);assert.equal(receipt[0].response_json.data.id,replay.body.data.id);
  const changes=await Promise.all([1,2].map(i=>f.request(`/tasks/${replay.body.data.id}/assign`,'POST','coordinator',{expectedVersion:1,...assignment()},'version-race-'+i)));assert.deepEqual(changes.map(r=>r.status).sort(),[200,409]);
 });
 await step('approved design, immutable revision, exactly-once task and planting acceptance with rollback',async()=>{
  site=await f.ok(`/sites/${site.id}`,'PATCH','coordinator',{expectedVersion:site.version,checks:Object.fromEntries(checkNames.map(name=>[name,{status:'cleared',comment:'Synthetic DEMO check; not a real survey'}]))});
  const items=[{id:'item-stage-b',catalogItemId:catalog.id,geometry:{type:'MultiPoint',coordinates:[[76.951,52.281],[76.9511,52.2811]]},quantity:2,quantityMethod:'Synthetic DEMO explicit positions',evidenceIds:[source.id]}];
  const design=await f.ok('/designs','POST','coordinator',{siteId:site.id,name:'Synthetic DEMO project',objective:'Persistence acceptance only',contextVersion:1,plantingItems:items,evidenceIds:[source.id]},201);
  await f.ok(`/designs/${design.id}/submit`,'POST','coordinator',{expectedVersion:1});
  assert.equal((await f.request(`/designs/${design.id}/review`,'POST','coordinator',{expectedVersion:2,decision:'approved',comment:'Wrong role'})).status,403);
  approved=await f.ok(`/designs/${design.id}/review`,'POST','admin',{expectedVersion:2,decision:'approved',comment:'Synthetic DEMO approval'});
  await assert.rejects(f.db.pool.query("UPDATE gp_cloud.design_revisions SET data=jsonb_set(data,'{name}',to_jsonb('tamper'::text)) WHERE design_id=$1",[design.id]),{code:'23514'});
  const released=await f.ok(`/designs/${design.id}/create-tasks`,'POST','coordinator',{expectedVersion:3,revision:1,estimatedMinutes:30,minWorkers:1},201,'design-release');
  assert.deepEqual(await f.ok(`/designs/${design.id}/create-tasks`,'POST','coordinator',{expectedVersion:3,revision:1,estimatedMinutes:30,minWorkers:1},201,'design-release'),released);
  assert.equal((await f.request(`/designs/${design.id}/create-tasks`,'POST','coordinator',{expectedVersion:3,revision:1,estimatedMinutes:30,minWorkers:1})).status,409);
  planting=await submit(await start(released[0]),{actualPlantingItems:[{plantingItemId:items[0]!.id,catalogItemId:catalog.id,quantity:2,geometry:items[0]!.geometry}]});
  const before=await f.snapshot(tables);
  await f.db.pool.query("CREATE FUNCTION gp_cloud.test_abort_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='accepted' THEN RAISE EXCEPTION 'synthetic rollback injection'; END IF; RETURN NEW; END; $$; CREATE TRIGGER test_abort_review BEFORE INSERT ON gp_cloud.workflow_history FOR EACH ROW EXECUTE FUNCTION gp_cloud.test_abort_review();");
  try{assert.equal((await f.request(`/reports/${planting.report.id}/review`,'POST','coordinator',review(planting),'accept-planting')).status,503);assert.deepEqual(await f.snapshot(tables),before);}finally{await f.db.pool.query('DROP TRIGGER test_abort_review ON gp_cloud.workflow_history; DROP FUNCTION gp_cloud.test_abort_review()');}
  const body=review(planting);planting=await f.ok(`/reports/${planting.report.id}/review`,'POST','coordinator',body,200,'accept-planting');assert.equal(planting.plants.length,2);
  assert.deepEqual(await f.ok(`/reports/${planting.report.id}/review`,'POST','coordinator',body,200,'accept-planting'),planting);
  assert.equal((await f.request(`/reports/${planting.report.id}/review`,'POST','coordinator',body)).status,409);
  assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM gp_cloud.planting_receipts WHERE report_id=$1',[planting.report.id])).rows[0].n,2);
  const edited=await f.ok(`/designs/${design.id}`,'PATCH','coordinator',{expectedVersion:3,name:'Next draft'});assert.equal(edited.revision,2);
  assert.equal((await f.ok(`/designs/${design.id}`,'GET','viewer')).revisions[0].name,approved.name);
  await assert.rejects(f.db.pool.query("INSERT INTO gp_cloud.assignments VALUES ('missing-task',$1)",[worker.id]),{code:'23503'});
 });
 await step('real SQLite HTTP read parity from identical persisted domain rows, including actor scope',async()=>{
  // A test-only copy into a new disposable SQLite verifies the unchanged local DTOs.
  // Production cloud runtime never creates or calls this database.
  const sqlite=new Store(join(f.dir,'workflow-parity.sqlite'));
  const pairs=[['users','v2_users'],['municipal_roles','municipal_roles'],['sessions','v2_sessions'],['documents','v2_documents'],['profiles','v2_profiles'],['crews','v2_crews'],['memberships','v2_memberships'],['designs','v2_designs'],['design_revisions','v2_design_revisions'],['tasks','v2_tasks'],['assignments','v2_assignments'],['reports','v2_reports'],['report_drafts','v2_report_drafts'],['workflow_history','v2_history']];
  for(const [pg,table] of pairs){
   const columns=sqlite.all(`PRAGMA table_info(${table})`).map(r=>String(r.name));
   for(const row of (await f.db.pool.query(`SELECT * FROM gp_cloud.${pg}`)).rows)sqlite.run(`INSERT INTO ${table}(${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,...columns.map(k=>row[k]!==null&&typeof row[k]==='object'?JSON.stringify(row[k]):row[k]));
  }
  const server=createApp(sqlite,{uploadsPath:join(f.dir,'unused-parity-uploads')}).listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/v1`;
  try{for(const role of ['viewer','worker-b','outside-worker','foreman-b']){
    const paths=['/tasks','/reports','/workers','/crews','/plants',`/tasks/${accepted.task.id}`,`/reports/${accepted.report.id}`];
    for(const path of paths){const pg=await f.request(path,'GET',role);const local=await fetch(base+path,{headers:{Cookie:f.sessions.get(role)!.cookie}});const body=await local.json() as any;
     assert.equal(local.status,pg.status,role+' '+path);if(pg.status===200)assert.deepEqual(body,pg.body);else assert.equal(body.error.code,pg.body.error.code);
    }
  }}finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));sqlite.close();}
 });
 await step('published v2 → v3 upgrade preserves linked zones, analysis, histories and users; checksums repeat',async()=>{
  const upgrade=await f.isolatedDatabase('qa_workflow_upgrade');
  try{
   await upgrade.pool.query('CREATE SCHEMA gp_cloud; CREATE TABLE gp_cloud.schema_migrations(version integer PRIMARY KEY,checksum text NOT NULL)');
   for(const [i,sql] of [migration1,migration2].entries()){await upgrade.pool.query(sql);await upgrade.pool.query('INSERT INTO gp_cloud.schema_migrations VALUES ($1,$2)',[i+1,createHash('sha256').update(sql).digest('hex')]);}
   const user=(await f.db.pool.query("SELECT * FROM gp_cloud.users WHERE login='coordinator'")).rows[0];
   await upgrade.pool.query('INSERT INTO gp_cloud.users VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[user.id,user.login,user.display_name,user.role,user.active,user.password_hash,user.version,user.created_at,user.updated_at]);
   await upgrade.pool.query("INSERT INTO gp_cloud.planning_documents VALUES ('site',$1,$2,$3,0)",[site.id,site,site.version]);
   await upgrade.pool.query("INSERT INTO gp_cloud.zone_contexts VALUES ('site',$1,50,$2,$3)",[site.id,site.version,{id:'upgrade-context',note:'DEMO persisted context'}]);
   await upgrade.pool.query("INSERT INTO gp_cloud.analysis_snapshots VALUES ('upgrade-snapshot','site',$1,$2,$3,$4,'2026-10-31')",[site.id,user.id,'a'.repeat(64),{inputSnapshot:{site},isDemo:true}]);
   await upgrade.pool.query("INSERT INTO gp_cloud.planning_history VALUES ('upgrade-history','site',$1,$2,'update',null,$3,'2026-10-31')",[site.id,user.id,site]);
   const before=(await upgrade.pool.query('SELECT * FROM gp_cloud.analysis_snapshots')).rows;
   await migrate(upgrade);await migrate(upgrade);
   assert.deepEqual((await upgrade.pool.query('SELECT * FROM gp_cloud.analysis_snapshots')).rows,before);
   assert.deepEqual((await upgrade.pool.query("SELECT data FROM gp_cloud.documents WHERE kind='site' AND id=$1",[site.id])).rows[0].data,site);
   assert.equal((await upgrade.pool.query("SELECT count(*)::int n FROM gp_cloud.planning_documents WHERE kind='site'")).rows[0].n,0);
   assert.equal((await upgrade.pool.query("SELECT count(*)::int n FROM gp_cloud.history WHERE id='upgrade-history'")).rows[0].n,1);
   assert((await upgrade.pool.query('SELECT password_hash FROM gp_cloud.users')).rows[0].password_hash===user.password_hash,'Upgrade changed credentials');
   assert.deepEqual((await upgrade.pool.query('SELECT checksum FROM gp_cloud.schema_migrations ORDER BY version')).rows.map(r=>r.checksum),migrations.map(sql=>createHash('sha256').update(sql).digest('hex')));
   await assert.rejects(upgrade.pool.query("DELETE FROM gp_cloud.documents WHERE kind='site' AND id=$1",[site.id]),{code:'23503'});
  }finally{await upgrade.close();}
 });
 await step('fixed same-origin /api proxy contract: secure host-only cookies, Origin and CSRF (local ingress simulation)',async()=>{
  const origin='https://green-pavlodar-mock.pages.dev';
  const backend=createCloudApp(f.db,{database:{},allowedHosts:['127.0.0.1'],frontendOrigins:[origin],port:3001,host:'127.0.0.1',secureCookies:true,proxyHops:1,localTest:false}).listen(0,'127.0.0.1');await once(backend,'listening');
  const target=`http://127.0.0.1:${(backend.address() as {port:number}).port}`;
  const proxy=httpServer(async(req,res)=>{try{
   if(!req.url?.startsWith('/api/')){res.writeHead(404).end();return;}
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   const headers:Record<string,string>={'X-Forwarded-Proto':'https'};
   for(const name of ['cookie','origin','content-type','x-csrf-token','idempotency-key','access-control-request-method','access-control-request-headers'])if(typeof req.headers[name]==='string')headers[name]=req.headers[name]!;
   const upstream=await fetch(target+req.url,{method:req.method,headers,redirect:'error',body:chunks.length?Buffer.concat(chunks):undefined});
   res.writeHead(upstream.status,Object.fromEntries(upstream.headers));res.end(Buffer.from(await upstream.arrayBuffer()));
  }catch{res.writeHead(502).end();}}).listen(0,'127.0.0.1');await once(proxy,'listening');
  const base=`http://127.0.0.1:${(proxy.address() as {port:number}).port}/api/v1`;
  try{
   // Reuse a real session. No public TLS is claimed by this loopback forwarding test.
   const cookie=f.sessions.get('viewer')!.cookie;
   const me=await fetch(base+'/auth/me',{headers:{Cookie:cookie,Origin:origin,'X-Forwarded-Host':'attacker.example'}});assert.equal(me.status,200);const body=await me.json() as any;
   assert.equal(body.data.user.role,'viewer');
   const allowed=await fetch(base+`/reports/${accepted.report.id}`,{headers:{Cookie:cookie,Origin:origin}});assert.equal(allowed.status,200);await allowed.arrayBuffer();
   const wrongOrigin=await fetch(base+'/auth/me',{headers:{Cookie:cookie,Origin:'https://untrusted.example'}});assert.equal(wrongOrigin.status,403);await wrongOrigin.arrayBuffer();
   const csrf=await fetch(base+'/auth/logout',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(csrf.status,403);assert.equal((await csrf.json() as any).error.code,'CSRF_REQUIRED');
   const preflight=await fetch(base+'/tasks/id/report-draft',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'Content-Type,X-CSRF-Token,Idempotency-Key'}});assert.equal(preflight.status,204);
  }finally{proxy.closeAllConnections();backend.closeAllConnections();await Promise.all([new Promise<void>(done=>proxy.close(()=>done())),new Promise<void>(done=>backend.close(()=>done()))]);}
 });
 await step('restart backend and native PostgreSQL, repeat seed; passwords, records and history survive unchanged',async()=>{
  const before=await f.snapshot(tables);const history=await f.ok(`/tasks/${planting.task.id}/history`,'GET','viewer');
  await f.restart();assert.deepEqual(await f.snapshot(tables),before);
  assert.equal((await f.ok(`/reports/${planting.report.id}`,'GET','viewer')).reviewStatus,'accepted');
  assert.deepEqual(await f.ok(`/tasks/${planting.task.id}/history`,'GET','viewer'),history);
  await f.reseed();assert.deepEqual(await f.snapshot(tables),before);await f.login('worker-b');await f.login('viewer');
  writeFileSync(join(f.dir,'stage-b-persistence.json'),JSON.stringify({mode:'isolated synthetic DEMO; not field observations',before,after:await f.snapshot(tables),acceptedReportId:planting.report.id,taskId:planting.task.id},null,2));
 });
});
