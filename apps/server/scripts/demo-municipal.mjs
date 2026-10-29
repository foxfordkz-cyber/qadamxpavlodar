// Real HTTP process restart, persisted cookies, import replay and repeat seed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdirSync,writeFileSync,createWriteStream } from 'node:fs';
import { resolve,join } from 'node:path';
import { Store } from '../dist/db.js';
import { seed } from '../dist/seed.js';
import { seedV2,DEMO_PASSWORD } from '../dist/v2/seed.js';
import { seedMunicipal } from '../dist/municipal/data.js';
const name=process.argv[2]??`verification-${Date.now()}`;
assert(/^[a-zA-Z0-9_-]{1,50}$/.test(name));
const dir=resolve('data','municipal-demo',name),dbPath=join(dir,'demo.sqlite'),uploads=resolve('uploads','municipal-demo',name);
mkdirSync(dir,{recursive:true});mkdirSync(uploads,{recursive:true});
let store=new Store(dbPath);seed(store);await seedV2(store);await seedMunicipal(store);store.close();
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(done=>probe.close(done));
const base=`http://127.0.0.1:${port}`;let server,iteration=0;
async function launch(){server=spawn(process.execPath,['--import','./scripts/local-network-guard.mjs','dist/server.js'],{cwd:process.cwd(),windowsHide:true,env:{...process.env,NODE_ENV:'development',PORT:String(port),DB_PATH:dbPath,UPLOADS_PATH:uploads},stdio:['ignore','pipe','pipe']});
 server.stdout.pipe(createWriteStream(join(dir,`server-${++iteration}.log`)));server.stderr.pipe(createWriteStream(join(dir,`server-${iteration}.error.log`)));
 for(let n=0;n<100;n++){if(server.exitCode!==null)throw Error('Server exited');try{if((await fetch(base+'/health')).ok)return;}catch{}await new Promise(done=>setTimeout(done,100));}throw Error('Server startup timeout');}
async function stop(){const child=server;server=undefined;if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done;}}
const sessions=new Map();
async function login(user){const r=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:user,password:DEMO_PASSWORD})});const b=await r.json();assert.equal(r.status,200);sessions.set(user,{cookie:r.headers.get('set-cookie').split(';')[0],csrf:b.data.csrfToken});}
async function api(path,method='GET',body,user='specialist',key='municipal-demo',expected=200){const ss=sessions.get(user),r=await fetch(base+'/api/v1'+path,{method,headers:{Cookie:ss.cookie,'X-CSRF-Token':ss.csrf,'Idempotency-Key':key,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const b=await r.json();assert.equal(r.status,expected,JSON.stringify(b));return b.data;}
try{
 await launch();await login('admin');await login('specialist');
 const baseline=(await api('/municipal/sites')).length;
 const input={format:'csv',content:'name,lat,lng\nRestart verification DEMO,52.283719,76.945721',source:'Synthetic restart fixture',dataClass:'demo'};
 const preview=await api('/imports/preview','POST',input);assert.equal(preview.invalid,0);
 await api(`/imports/${preview.id}/commit`,'POST',{acknowledgeWarnings:true},'specialist','durable-import');
 const rates=await api('/rates');const saved=await api('/rates','PATCH',{key:'price.tree',value:19029,source:'Synthetic persistence verification',dataClass:'demo',expectedVersion:rates.version},'admin','durable-rate');
 const zone=(await api('/municipal/sites'))[0].id;
 const analysis=await api(`/zones/${zone}/analysis`,'POST',{options:{}});
 const {id:snapshotId,...persistedCalculation}=await api(`/zones/${zone}/snapshots`,'POST',{options:{}},'specialist','durable-calculation',201);
 for(const format of ['pdf','xlsx']){const ss=sessions.get('specialist'),r=await fetch(base+`/api/v1/zones/${zone}/export`,{method:'POST',headers:{Cookie:ss.cookie,'X-CSRF-Token':ss.csrf,'Content-Type':'application/json'},body:JSON.stringify({format,options:{}})});assert.equal(r.status,200);writeFileSync(join(dir,`example-report.${format}`),Buffer.from(await r.arrayBuffer()));}
 await stop();await launch();
 assert.equal((await api('/auth/me')).user.role,'specialist');
 assert.deepEqual(await api('/rates'),saved);
 assert.equal((await api('/municipal/sites')).length,baseline+1);
 assert.equal((await api(`/zones/${zone}/analysis`,'POST',{options:{}})).provenance.inputHash,analysis.provenance.inputHash);
 assert.deepEqual(await api(`/analysis-snapshots/${snapshotId}`),persistedCalculation);
 await api(`/imports/${preview.id}/commit`,'POST',{acknowledgeWarnings:true},'specialist','durable-import');
 await api(`/imports/${preview.id}/commit`,'POST',{acknowledgeWarnings:true},'specialist','another-import-key');
 assert.equal((await api('/imports/preview','POST',input)).invalid,1);
 assert.equal((await api('/municipal/sites')).length,baseline+1);
 const spec=await (await fetch(base+'/api/v1/openapi.json')).json();writeFileSync(join(dir,'openapi.json'),JSON.stringify(spec,null,2));
 // Exercise the actual React API module and HTTP transport, without loading its mock module.
 // Run this script with --import tsx to load the team's frontend TypeScript.
 const {createApi}=await import('../../web/src/shared/api/api.ts');
 const {createHttpTransport}=await import('../../web/src/shared/api/transport.ts');
 const nativeFetch=globalThis.fetch;let browserCookie='';const transportRequests=[];
 globalThis.fetch=async(input,init={})=>{const url=new URL(String(input),base);assert.equal(url.origin,base);const headers=new Headers(init.headers);if(browserCookie)headers.set('Cookie',browserCookie);const response=await nativeFetch(url,{...init,headers});const setCookie=response.headers.get('set-cookie');if(setCookie)browserCookie=setCookie.split(';')[0];transportRequests.push(`${init.method??'GET'} ${url.pathname}`);return response;};
 try{const client=createApi(createHttpTransport());assert.equal(client.kind,'api');
  assert.equal((await client.login('specialist',DEMO_PASSWORD)).role,'coordinator');assert.equal((await client.me()).role,'coordinator');
  assert.equal((await client.sites()).data.length,baseline+1);assert.equal((await client.site(zone)).id,zone);
  assert(await client.siteContext(zone,100));assert((await client.species()).length>=50);assert((await client.evidence([])).length>0);
  assert.equal((await client.zoneAnalysis(zone,{})).siteId,zone);assert.equal((await client.zoneVariants(zone,{})).length,3);
  assert(Array.isArray((await client.problems()).data.problems));assert.equal((await client.priorities({deficit:.25,density:.15,social:.2,load:.15,soil:.1,benefit:.15},0)).roadmap.chosen.length,0);
  assert.equal((await client.soilsLayer()).data.type,'FeatureCollection');assert.equal((await client.greeneryLayer()).data.type,'FeatureCollection');assert((await client.dashboard()).data.length>0);
  assert(await client.ask('Приоритеты',zone));assert((await client.assistantHistory()).length>0);
  const previewAgain=await client.importFile({...input,layer:'zones'});assert.equal(previewAgain.invalid,1);assert((await client.commitImport(preview.id,true)).committed);
  await client.logout();await assert.rejects(client.me(),e=>e.status===401);
  await client.login('admin',DEMO_PASSWORD);const previous=await client.rates();assert.equal((await client.patchRate({key:'price.tree',value:19029,source:'Synthetic frontend integration test',expectedVersion:previous.version})).version,previous.version+1);await client.logout();
  const {createBackendClient}=await import('../examples/team-client.mjs');const shared=createBackendClient();
  assert.equal((await shared.login('specialist',DEMO_PASSWORD)).user.role,'specialist');
  assert.equal((await shared.request('GET','/municipal/sites')).data.length,baseline+1);
  assert.equal((await shared.request('POST',`/zones/${zone}/analysis`,{body:{options:{}}})).data.siteId,zone);
  assert.equal((await shared.request('GET',`/analysis-snapshots/${snapshotId}`)).data.provenance.inputHash,persistedCalculation.provenance.inputHash);
  assert((await shared.listAll('/plants')).length>=30);await shared.logout();await assert.rejects(shared.session(),e=>e.status===401&&e.code==='AUTH_REQUIRED');
 }finally{globalThis.fetch=nativeFetch;}
 await stop();store=new Store(dbPath);
 const oldCounts=store.all("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'v2_%' OR name IN ('plants','tasks','reports')) ORDER BY name").map(r=>[r.name,store.get(`SELECT count(*) AS n FROM "${r.name}"`).n]);
 seed(store);await seedV2(store);await seedMunicipal(store);
 for(const [name,n]of oldCounts)assert.equal(store.get(`SELECT count(*) AS n FROM "${name}"`).n,n,`Seed must preserve ${name}`);
 assert.equal(store.get('SELECT count(*) AS n FROM municipal_features').n,1);
 assert.equal(JSON.parse(store.get("SELECT data FROM municipal_state WHERE key='rates'").data).find(x=>x.key==='price.tree').value,19029);
 assert.equal(store.get('PRAGMA integrity_check').integrity_check,'ok');assert.deepEqual(store.all('PRAGMA foreign_key_check'),[]);store.close();
 const result={restart:'PASS',persistentSession:'PASS',persistentRates:'PASS',persistentImport:'PASS',persistedCalculationSnapshot:'PASS',repeatedImportNoDuplicates:'PASS',repeatSeedPreservesLegacyAndV2:'PASS',stableAnalysisInputHash:'PASS',sqliteIntegrity:'PASS',frontendHttpTransport:'PASS',handoffClientExample:'PASS',frontendRequests:transportRequests,sites:baseline+1,operations:Object.values(spec.paths).reduce((n,x)=>n+Object.keys(x).length,0),exports:['example-report.pdf','example-report.xlsx']};
 writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({directory:dir,...result},null,2));
}finally{await stop();}
