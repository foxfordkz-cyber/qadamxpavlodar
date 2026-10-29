import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdirSync,writeFileSync,createWriteStream } from 'node:fs';
import { resolve,join } from 'node:path';
import sharp from 'sharp';
import { Store } from '../dist/db.js';
import { seed } from '../dist/seed.js';
import { seedV2,seedV2Scenario,demoPassword } from '../dist/v2/seed.js';
const DEMO_PASSWORD=demoPassword();
const name=process.argv[2]??'verification-v2';
assert(/^[a-zA-Z0-9_-]{1,40}$/.test(name),'Run name must contain safe characters');
const dir=resolve('data','v2-demo',name),dbPath=join(dir,'demo.sqlite'),uploads=resolve('uploads','v2-demo',name);
mkdirSync(dir,{recursive:true});mkdirSync(uploads,{recursive:true});
let store=new Store(dbPath);seed(store);await seedV2(store);seedV2Scenario(store);store.close();
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(done=>probe.close(done));
const base=`http://127.0.0.1:${port}`;let server;let iteration=0;
async function launch(){
  server=spawn(process.execPath,['--import','./scripts/local-network-guard.mjs','--import','tsx','dist/server.js'],{cwd:process.cwd(),windowsHide:true,env:{...process.env,NODE_ENV:'development',PORT:String(port),DB_PATH:dbPath,UPLOADS_PATH:uploads},stdio:['ignore','pipe','pipe']});
  server.stdout.pipe(createWriteStream(join(dir,`server-${++iteration}.log`),{flags:'a'}));server.stderr.pipe(createWriteStream(join(dir,`server-${iteration}.error.log`),{flags:'a'}));
  const deadline=Date.now()+60000;let probe='not attempted';
  while(Date.now()<deadline){if(server.exitCode!==null)throw Error('Demo server exited; inspect the isolated server error log');try{const r=await fetch(base+'/health',{signal:AbortSignal.timeout(2000)});probe=`HTTP ${r.status}`;if(r.ok)return;}catch(e){probe=`${e.name}: ${e.cause?.code??e.message}`;}await new Promise(done=>setTimeout(done,100));}throw Error(`Server startup timeout: ${probe}`);
}
async function stop(){const child=server;server=undefined;if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done;}}
const sessions=new Map();
async function login(login){const r=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login,password:DEMO_PASSWORD})});const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));sessions.set(login,{cookie:r.headers.get('set-cookie').split(';')[0],csrf:b.data.csrfToken});}
async function api(path,method='GET',user='coordinator',body,key,expected=200){const session=sessions.get(user);const r=await fetch(base+'/api/v1'+path,{method,headers:{Cookie:session.cookie,'X-CSRF-Token':session.csrf,...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined});const b=await r.json();assert.equal(r.status,expected,JSON.stringify(b));return b.data;}
try{
  await launch();for(const user of['admin','coordinator','foreman1','worker1','worker3'])await login(user);
  const d=await api('/designs','POST','coordinator',{siteId:'demo-site-1',name:'DEMO V2 complete local flow',objective:'Four real server roles, approved planting and private evidence',contextVersion:1,plantingItems:[{id:'item-1',catalogItemId:'demo-catalog-1',geometry:{type:'MultiPoint',coordinates:[[76.951,52.281],[76.9511,52.2811]]},quantity:2,quantityMethod:'DEMO explicit specialist input',carePolicyId:'demo-care-policy',evidenceIds:['demo-v2-evidence']}],evidenceIds:['demo-v2-evidence']},'demo-design',201);
  await api(`/designs/${d.id}/submit`,'POST','coordinator',{expectedVersion:1},'demo-design-submit');
  await api(`/designs/${d.id}/review`,'POST','admin',{expectedVersion:2,decision:'approved',comment:'DEMO simulated checks reviewed'},'demo-design-review');
  const[t]=await api(`/designs/${d.id}/create-tasks`,'POST','coordinator',{expectedVersion:3,revision:1,estimatedMinutes:30,minWorkers:2},'demo-release',201);
  await api(`/tasks/${t.id}/assign`,'POST','coordinator',{expectedVersion:1,crewId:'demo-crew-1',scheduledStart:'2026-10-28T05:00:00+00:00',scheduledEnd:'2026-10-28T05:30:00+00:00',resourceIds:[]},'demo-assign');
  await api(`/tasks/${t.id}/assign-workers`,'POST','foreman1',{expectedVersion:2,workerIds:['demo-worker-1','demo-worker-2']},'demo-people');
  await api(`/tasks/${t.id}/start`,'POST','worker1',{expectedVersion:3},'demo-start');
  const bytes=await sharp({create:{width:32,height:32,channels:3,background:'#1b8f51'}}).png().toBuffer();
  const form=new FormData();form.set('taskId',t.id);form.set('file',new Blob([bytes],{type:'image/png'}),'DEMO-synthetic.png');
  const session=sessions.get('worker1');const photoResponse=await fetch(base+'/api/v1/uploads',{method:'POST',headers:{Cookie:session.cookie,'X-CSRF-Token':session.csrf,'Idempotency-Key':'demo-photo'},body:form});const photoBody=await photoResponse.json();assert.equal(photoResponse.status,201,JSON.stringify(photoBody));const photo=photoBody.data;
  await api(`/tasks/${t.id}/report-draft/contributions`,'POST','worker1',{expectedVersion:4,expectedDraftVersion:0,note:'DEMO two actual positions',photoIds:[photo.id]},'demo-material');
  const submitted=await api(`/tasks/${t.id}/reports`,'POST','foreman1',{expectedVersion:4,expectedDraftVersion:1,note:'DEMO complete planting checked by own foreman',actualWorkerIds:['demo-worker-1','demo-worker-2'],photoIds:[photo.id],actualPlantingItems:[{plantingItemId:'item-1',catalogItemId:'demo-catalog-1',quantity:2,geometry:{type:'MultiPoint',coordinates:[[76.951,52.281],[76.9511,52.2811]]}}]},'demo-report',201);
  const reviewBody={expectedVersion:5,expectedReportVersion:1,decision:'accepted',comment:'DEMO quantity and actual positions accepted'};
  const accepted=await api(`/reports/${submitted.report.id}/review`,'POST','coordinator',reviewBody,'demo-accept');assert.equal(accepted.plants.length,2);assert.equal(accepted.careTasks.length,2);
  await api(`/tasks/${t.id}`,'GET','worker3',undefined,undefined,404);
  await stop();await launch();
  const me=await api('/auth/me','GET','worker1');assert.equal(me.user.id,'demo-worker-1');
  assert.equal((await api(`/tasks/${t.id}`)).status,'verified');assert.deepEqual(await api(`/reports/${submitted.report.id}/review`,'POST','coordinator',reviewBody,'demo-accept'),accepted);
  assert.deepEqual(await api(`/reports/${submitted.report.id}`),accepted.report);
  const file=await fetch(base+photo.contentUrl,{headers:{Cookie:session.cookie}});assert.equal(file.status,200);assert((await file.arrayBuffer()).byteLength>0);
  const denied=await fetch(base+photo.contentUrl,{headers:{Cookie:sessions.get('worker3').cookie}});assert.equal(denied.status,404);
  await stop();store=new Store(dbPath);seed(store);await seedV2(store);seedV2Scenario(store);
  const result={mode:'DEMO',contract:'V2',taskId:t.id,reportId:submitted.report.id,status:'verified',newPlants:accepted.plants.length,careDrafts:accepted.careTasks.length,storedPlants:store.get("SELECT count(*) n FROM v2_documents WHERE kind='plant'").n,legacyPlants:store.get('SELECT count(*) n FROM plants').n,legacyTasks:store.get('SELECT count(*) n FROM tasks').n,restart:'PASS',persistentSession:'PASS',persistentAcceptedReport:'PASS',privatePhoto:'PASS',idempotentReview:'PASS',repeatSeed:'PASS',integrity:store.get('PRAGMA integrity_check').integrity_check};
  assert.equal(store.get('SELECT count(*) n FROM v2_planting_receipts WHERE task_id=?',t.id).n,2);assert.equal(result.storedPlants,32);assert.equal(result.integrity,'ok');assert.deepEqual(store.all('PRAGMA foreign_key_check'),[]);store.close();
  writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await stop();}
