// Operator-only synthetic acceptance. No provider control, migrations, seed, or automatic retries.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { workflowScenario } from '../tests/postgres/scenario.ts';
import { checkNames } from '../src/v2/data.ts';

// PostgreSQL JSONB may reorder object keys on replay; array order and all values remain significant.
const canonical = value => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
const digest = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
const day = iso => new Date(Date.parse(iso) + 5 * 3600000).toISOString().slice(0,10);
export async function runAcceptance({mode, manifestPath, origin, browserOrigin, password, demoOptIn, localTest = false}) {
  assert(demoOptIn === '1', 'CLOUD_ACCEPTANCE_DEMO=1 required for an owner-approved synthetic database');
  const url = new URL(origin), browser = new URL(browserOrigin);
  const isLoopback = u => u.protocol === 'http:' && u.hostname === '127.0.0.1';
  assert(url.origin === origin && browser.origin === browserOrigin && !url.username && !url.password);
  assert(localTest ? isLoopback(url) && isLoopback(browser) : url.protocol === 'https:' && browser.protocol === 'https:');
  assert(password && password.length >= 12, 'Private acceptance password is required');
  assert(['create','verify'].includes(mode));
  const sessions = new Map(), trace = [];
  const m = mode === 'create'
    ? {format:1, prefix:'release-' + randomUUID().slice(0,8), origin, browserOrigin, complete:false, reads:[], replays:[], checks:[], trace:[]}
    : JSON.parse(readFileSync(manifestPath,'utf8'));
  assert.equal(m.origin, origin); assert.equal(m.browserOrigin, browserOrigin);
  if (mode === 'create') writeFileSync(manifestPath, JSON.stringify(m,null,2), {flag:'wx',mode:0o600});
  else assert(m.complete, 'Incomplete scenario; inspect its trace, do not restart it blindly');
  const base = origin + '/api/v1';
  const save = () => {m.trace.push(...trace.splice(0)); writeFileSync(manifestPath, JSON.stringify(m,null,2), {mode:0o600});};
  async function http(path, method, headers, body) {
    const res = await fetch(base+path, {method,redirect:'error',signal:AbortSignal.timeout(90000),
      headers:{Origin:browserOrigin,...headers},body});
    trace.push({path,method,status:res.status});
    return res;
  }
  async function login(role) {
    const res = await http('/auth/login','POST',{'Content-Type':'application/json'},JSON.stringify({login:role,password}));
    assert.equal(res.status,200,'Login failed (details redacted)');
    const body = await res.json(), cookie = res.headers.get('set-cookie');
    assert(cookie && /HttpOnly/i.test(cookie) && /SameSite=Strict/i.test(cookie) && /Path=\/api\/v1/i.test(cookie));
    if (!localTest) assert(/;\s*Secure/i.test(cookie), 'HTTPS cookie must be Secure');
    const session = {cookie:cookie.split(';')[0],csrf:body.data.csrfToken};
    sessions.set(role,session); return session;
  }
  async function request(path,method='GET',role='coordinator',body,key=randomUUID(),csrf=true) {
    const s = sessions.get(role) ?? await login(role);
    const res = await http(path,method,{Cookie:s.cookie,...(csrf?{'X-CSRF-Token':s.csrf}:{}),
      'Idempotency-Key':key,...(body===undefined?{}:{'Content-Type':'application/json'})},
      body===undefined?undefined:JSON.stringify(body));
    const json = await res.json();
    return {status:res.status,data:json.data,code:json.error?.code,replayed:res.headers.get('Idempotency-Replayed')};
  }
  async function ok(path,method='GET',role='coordinator',body,status=200,key) {
    const r = await request(path,method,role,body,key);
    assert.equal(r.status,status,method+' '+path+' '+(r.code??'')); return r.data;
  }
  async function replayable(path,body,status=201) {
    const key = m.prefix+'-'+m.replays.length, data = await ok(path,'POST','coordinator',body,status,key);
    m.replays.push({path,body,status,key,hash:digest(data)}); save(); return data;
  }
  async function capture(path) {const data=await ok(path,'GET','viewer');m.reads.push({path,hash:digest(data)});return data;}
  async function photoBytes() {
    const s = sessions.get('viewer') ?? await login('viewer');
    const res = await http('/uploads/'+m.photo.id,'GET',{Cookie:s.cookie});
    assert.equal(res.status,200); assert(res.headers.get('content-type')?.includes('image/webp'));
    assert(res.headers.get('cache-control')?.includes('no-store'));
    assert.equal(digest(Buffer.from(await res.arrayBuffer())),m.photo.sha256);
  }
  try {
    const health=await http('/health','GET',{});assert.equal(health.status,200);await health.body?.cancel();
    const ready = await http('/ready','GET',{}), readiness=await ready.json();
    assert.equal(ready.status,200);assert.equal(readiness.schemaVersion,5);assert.equal(readiness.database,'ok');
    assert.equal(readiness.photos,'private-storage-configured');assert(readiness.capabilities.includes('outcomes'));
    for(const role of ['admin','coordinator','viewer']) await login(role);
    if (mode === 'create') {
      const s = await workflowScenario({ok,createUser:(name,role,profile)=>ok('/users','POST','admin',
        {login:name,displayName:'Synthetic DEMO '+name,role,password,profile},201)},m.prefix);
      // Reuse the established Stage D fixture and original, public DTOs.
      let site = await ok('/sites/site-osm-1568405606');
      site = await ok('/sites/'+site.id,'PATCH','coordinator',{expectedVersion:site.version,
        checks:Object.fromEntries(checkNames.map(k=>[k,{status:'cleared',comment:'Synthetic DEMO, not a real survey'}]))});
      const rates=await ok('/rates'),species=await ok('/species');
      const analysis=await ok('/zones/'+site.id+'/analysis','POST','coordinator',
        {options:{variant:'econom',careYears:3,excluded:species.filter(v=>v.form!=='tree').map(v=>v.id)}});
      assert(analysis.scheme.length>0 && analysis.cost);
      const forecast = await replayable('/outcomes/snapshots',{id:m.prefix+'-forecast',siteId:site.id,
        expectedVersion:site.version,expectedRatesVersion:rates.version,variant:'econom'});
      assert.equal(digest(forecast.snapshot.analysis.scheme),digest(analysis.scheme));
      const items=forecast.snapshot.analysis.scheme.map((row,i)=>({id:m.prefix+'-item-'+i,catalogItemId:row.speciesId,
        quantity:row.quantity,geometry:{type:'MultiPoint',coordinates:Array.from({length:row.quantity},(_,n)=>[site.centroid.lng+(i+n)*0.000001,site.centroid.lat])},
        quantityMethod:'Synthetic DEMO forecast positions',evidenceIds:[s.source.id]}));
      const design=await ok('/designs','POST','coordinator',{siteId:site.id,name:'Synthetic DEMO '+m.prefix,
        objective:'Provider persistence acceptance only',contextVersion:1,plantingItems:items,evidenceIds:[s.source.id]},201);
      await ok('/designs/'+design.id+'/submit','POST','coordinator',{expectedVersion:1});
      await ok('/designs/'+design.id+'/review','POST','admin',{expectedVersion:2,decision:'approved',comment:'Synthetic DEMO'});
      const issued=await ok('/designs/'+design.id+'/create-tasks','POST','coordinator',{expectedVersion:3,revision:1,estimatedMinutes:30,minWorkers:1},201);
      const task=await s.startTask(1,issued[0]), worker=sessions.get(s.workerLogin);
      const bytes=await sharp({create:{width:8,height:8,channels:3,background:'#15803d'}}).png().toBuffer();
      const form=new FormData();form.set('taskId',task.id);form.set('file',new Blob([new Uint8Array(bytes)],{type:'image/png'}),'synthetic-demo.png');
      const upload=await http('/uploads','POST',{Cookie:worker.cookie,'X-CSRF-Token':worker.csrf,'Idempotency-Key':m.prefix+'-photo'},form);
      assert.equal(upload.status,201);m.photo=(await upload.json()).data;save();
      const uploadReplay=await http('/uploads','POST',{Cookie:worker.cookie,'X-CSRF-Token':worker.csrf,'Idempotency-Key':m.prefix+'-photo'},form);
      assert.equal(uploadReplay.status,201);assert.equal(uploadReplay.headers.get('Idempotency-Replayed'),'true');
      assert.equal(digest((await uploadReplay.json()).data),digest(m.photo));
      const sent=await ok('/tasks/'+task.id+'/reports','POST',s.workerLogin,{expectedVersion:task.version,
        note:'Synthetic DEMO, not field evidence',photoIds:[m.photo.id],actualWorkerIds:[s.worker.id],
        actualPlantingItems:items.map(v=>({plantingItemId:v.id,catalogItemId:v.catalogItemId,quantity:v.quantity,geometry:v.geometry}))},201);
      const review = r=>({expectedVersion:r.task.version,expectedReportVersion:r.report.version,decision:'accepted',comment:'Synthetic DEMO acceptance'});
      const accepted=await replayable('/reports/'+sent.report.id+'/review',review(sent),200);
      assert(accepted.plants.length>1 && accepted.plants.every(p=>p.isDemo));
      const cohort=await replayable('/outcomes/cohorts',{id:m.prefix+'-cohort',siteId:site.id,plantIds:accepted.plants.map(p=>p.id),
        plantedOn:null,snapshotId:forecast.id,evidenceIds:[s.source.id],expectedVersion:0});
      const inspect=await s.startTask(1,await ok('/tasks','POST','coordinator',{objectType:'plant',objectId:accepted.plants[0].id,
        action:'inspect',description:'Synthetic DEMO, not field observation',estimatedMinutes:30,evidenceIds:[s.source.id]},201));
      const inspectionReport=await ok('/tasks/'+inspect.id+'/reports','POST',s.workerLogin,{expectedVersion:inspect.version,
        note:'Synthetic DEMO inspection',actualWorkerIds:[s.worker.id]},201);
      await replayable('/reports/'+inspectionReport.report.id+'/review',review(inspectionReport),200);
      const inspection=await replayable('/outcomes/cohorts/'+cohort.id+'/inspections',{id:m.prefix+'-inspection',
        observedOn:day(inspectionReport.report.createdAt),expectedVersion:cohort.version,evidenceIds:[s.source.id],
        observations:[{plantId:accepted.plants[0].id,state:'alive',reportId:inspectionReport.report.id,evidenceIds:[]},
          {plantId:accepted.plants[1].id,state:'unknown',reportId:null,evidenceIds:[]}]});
      const summary=await ok('/outcomes/cohorts/'+cohort.id+'/summary?inspectionId='+inspection.id,'GET','viewer');
      assert.equal(summary.summary.alive,1);assert.equal(summary.summary.unknown,accepted.plants.length-1);
      assert.equal(summary.summary.wholeCohortSurvivalPct,null);
      for(const path of ['/tasks/'+task.id,'/tasks/'+task.id+'/history','/reports/'+sent.report.id,
        '/tasks/'+inspect.id+'/history','/reports/'+inspectionReport.report.id,'/outcomes/cohorts/'+cohort.id,
        '/outcomes/cohorts/'+cohort.id+'/inspections']) await capture(path);
      // asOf legitimately changes over time; persist immutable records, compare summary counts separately.
      m.summary={path:'/outcomes/cohorts/'+cohort.id+'/summary?inspectionId='+inspection.id,alive:1,unknown:accepted.plants.length-1};
      m.scoped={worker:s.workerLogin,foreman:s.foremanLogin,other:s.otherLogin,taskId:task.id};
      const createBody={objectType:'plant',objectId:s.plant.id,action:'inspect',description:'Synthetic DEMO denied write',estimatedMinutes:30,evidenceIds:[s.source.id]};
      m.denials=[
        {path:'/tasks',body:createBody},{path:'/tasks/'+task.id+'/assign',body:{expectedVersion:accepted.task.version,crewId:s.crew.id,
          scheduledStart:task.scheduledStart,scheduledEnd:task.scheduledEnd,resourceIds:[]}},
        {path:'/reports/'+sent.report.id+'/review',body:review(sent)},
        {path:'/sites/'+site.id,method:'PATCH',body:{expectedVersion:site.version,name:'Synthetic DEMO denied update'}},
        {path:'/outcomes/cohorts',body:{id:m.prefix+'-denied',siteId:site.id,plantIds:accepted.plants.map(p=>p.id),plantedOn:null,snapshotId:null,evidenceIds:[s.source.id],expectedVersion:0}},
      ];
      m.csrf={path:'/tasks',body:createBody};
      m.crewId=s.crew.id;m.workerId=s.worker.id;
      m.complete=true; save();
    }
    for(const {path,hash} of m.reads) assert.equal(digest(await ok(path,'GET','viewer')),hash,'Persisted DTO changed: '+path);
    for(const r of m.replays) {
      const got=await request(r.path,'POST','coordinator',r.body,r.key);
      assert.equal(got.status,r.status);assert.equal(got.replayed,'true');assert.equal(digest(got.data),r.hash,'Replay changed: '+r.path);
    }
    for(const d of m.denials) assert.equal((await request(d.path,d.method??'POST','viewer',d.body)).status,403,'Viewer write denied: '+d.path);
    assert.equal((await request(m.csrf.path,'POST','coordinator',m.csrf.body,randomUUID(),false)).status,403);
    assert((await ok('/crews','GET','viewer')).some(c=>c.id===m.crewId));
    assert((await ok('/workers','GET','viewer')).some(w=>w.id===m.workerId));
    await ok('/tasks/'+m.scoped.taskId,'GET',m.scoped.worker);
    await ok('/tasks/'+m.scoped.taskId,'GET',m.scoped.foreman);
    assert.equal((await request('/tasks/'+m.scoped.taskId,'GET',m.scoped.other)).status,404);
    const summary=await ok(m.summary.path,'GET','viewer');
    assert.equal(summary.summary.alive,m.summary.alive);assert.equal(summary.summary.unknown,m.summary.unknown);
    assert.equal(summary.summary.wholeCohortSurvivalPct,null);
    await photoBytes();
    const anonymous=await http('/uploads/'+m.photo.id,'GET',{});assert.equal(anonymous.status,401);await anonymous.body?.cancel();
    m.checks.push({at:new Date().toISOString(),mode,result:'PASS',transport:localTest?'local HTTP test storage':'HTTPS; provider restart/SHA must be recorded separately'});
    save();return {result:'PASS',mode,reads:m.reads.length,replays:m.replays.length,environment:localTest?'local-test':'HTTPS'};
  } finally {
    // Revoke only this runner's sessions. Do not store cookies, CSRF tokens or passwords in the manifest.
    for(const s of sessions.values()) {
      try{const r=await http('/auth/logout','POST',{Cookie:s.cookie,'X-CSRF-Token':s.csrf,'Content-Type':'application/json'},'{}');await r.body?.cancel();}catch{}
    }
    save();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode,manifestPath]=process.argv.slice(2);
    console.log(JSON.stringify(await runAcceptance({mode,manifestPath,origin:process.env.CLOUD_ACCEPTANCE_ORIGIN,
      browserOrigin:process.env.CLOUD_ACCEPTANCE_BROWSER_ORIGIN,password:process.env.CLOUD_ACCEPTANCE_PASSWORD,
      demoOptIn:process.env.CLOUD_ACCEPTANCE_DEMO})));
  } catch {console.error('FAIL: cloud HTTPS acceptance; details redacted. Inspect the non-secret manifest trace. No automatic retry or cleanup was attempted.');process.exitCode=1;}
}
