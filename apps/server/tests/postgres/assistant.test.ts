import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {migrate,migrations} from '../../src/cloud/migrations.js';
import {postgresFixture} from './workflow-helpers.js';

// Several real PostgreSQL/process restarts also run on Windows, where startup is slower.
test('cloud assistant: PostgreSQL rules, own history, provider failures and persistence',{timeout:360000},async t=>{
 let mode='ok';const payloads:any[]=[];
 let providerEntered:()=>void=()=>{},providerRelease:Promise<void>=Promise.resolve();
 const provider=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const b=JSON.parse(raw);payloads.push(b);
  if(mode==='hold'){providerEntered();await providerRelease;}
  if(req.url==='/primary/chat/completions'&&!['ok','hold'].includes(mode)){
   if(mode==='timeout')return;
   if(mode==='invalid')return void res.end('invalid JSON');
   res.writeHead(mode==='429'?429:500,{'Retry-After':'1'});res.end('{}');return;
  }
  if(mode==='all-fail'){res.writeHead(500);res.end('{}');return;}
  const tool=b.messages.find((m:any)=>m.role==='tool');
  const message=tool?{content:'Расчёт сохранённой зоны: '+JSON.parse(tool.content).cost.totalKzt}:
   {content:null,tool_calls:[{id:'zone',type:'function',function:{name:'analyze_zone',arguments:JSON.stringify({zoneId:'site-osm-1568405606'})}}]};
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message}]}));
 });provider.listen(0,'127.0.0.1');await once(provider,'listening');
 t.after(()=>{provider.closeAllConnections();provider.close();});
 const port=(provider.address() as {port:number}).port;
 const providerEnv={CLOUD_LLM_ENABLED:'1',LLM_ALLOWED_HOSTS:'127.0.0.1',LLM_API_KEY:'synthetic-provider-key',LLM_MODEL:'controlled-primary',LLM_BASE_URL:`http://127.0.0.1:${port}/primary`,LLM2_API_KEY:'synthetic-reserve-key',LLM2_MODEL:'controlled-reserve',LLM2_BASE_URL:`http://127.0.0.1:${port}/reserve`,LLM_TIMEOUT_MS:'8000'};
 // Guard permits loopback already; IP names are deliberately not configured in LLM_ALLOWED_HOSTS.
 const f=await postgresFixture(t);
 // Provider-mode changes restart only the app. Full DB restart/reseed is tested separately.
 const restartBackend=async(env:Record<string,string>)=>{await f.stop();await f.start(env);};
 const siteId='site-osm-1568405606',ask=(message:string,role='coordinator')=>f.ok('/assistant','POST',role,{message,siteId});
 await t.test('upgrade published v5 to v6 preserves rows/checksums; repeat migration is inert',async()=>{
  const db=await f.isolatedDatabase('qa_assistant_upgrade');
  try {
  await db.pool.query('CREATE SCHEMA gp_cloud; CREATE TABLE gp_cloud.schema_migrations(version integer PRIMARY KEY,checksum text NOT NULL)');
  for(let i=0;i<5;i++){await db.pool.query(migrations[i]!);await db.pool.query('INSERT INTO gp_cloud.schema_migrations VALUES($1,$2)',[i+1,createHash('sha256').update(migrations[i]!).digest('hex')]);}
  await db.pool.query("INSERT INTO gp_cloud.users VALUES('preserved','preserved','Synthetic preserved viewer','viewer',1,'synthetic-not-a-password',1,'2026-01-01','2026-01-01')");
  const before=(await db.pool.query('SELECT * FROM gp_cloud.users')).rows,old=(await db.pool.query('SELECT * FROM gp_cloud.schema_migrations ORDER BY version')).rows;
  await migrate(db);await migrate(db);
  assert.deepEqual((await db.pool.query('SELECT * FROM gp_cloud.users')).rows,before);
  assert.deepEqual((await db.pool.query('SELECT * FROM gp_cloud.schema_migrations WHERE version<=5 ORDER BY version')).rows,old);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM gp_cloud.schema_migrations')).rows[0].n,6);
  } finally {await db.close();}
 });
 await t.test('auth, roles and CSRF precede all work',async()=>{
  assert.equal((await fetch(f.base+'/assistant/history')).status,401);
  assert.equal((await f.request('/assistant','POST','viewer',{message:'Смета',siteId},'csrf',false)).status,403);
  await f.createUser('assistant-worker','worker');
  assert.equal((await f.request('/assistant/history','GET','assistant-worker')).status,403);
  assert.equal((await f.request('/assistant','POST','assistant-worker',{message:'Смета',siteId})).status,403);
  assert.equal((await f.request('/assistant/history?userId=admin','GET','viewer')).status,400);
  assert.equal((await f.request('/assistant','POST','viewer',{message:'password=private'})).status,400);
 });
 await t.test('rules use same PostgreSQL inputs; RU/KK; per-user history',async()=>{
  const r=await ask('Стоимость выбранной зоны');assert.equal(r.method,'rules');assert(!('model' in r),'optional model must be omitted, not null, matching AssistantReply');assert(r.fallbackReason);assert(r.text.length>10);
  const kk=await ask('Осы аумаққа қандай өсімдіктер ұсынылады?','viewer');assert.equal(kk.method,'rules');assert(/[әғқңөұүһі]/i.test(kk.text));
  const h=await f.ok('/assistant/history');assert.equal(h.length,1);assert.equal(h[0].q,'Стоимость выбранной зоны');
  assert.equal((await f.ok('/assistant/history','GET','viewer')).length,1);
  assert.equal((await f.request('/assistant','POST','viewer',{message:'zone',siteId:'missing'})).status,404);
  await f.db.pool.query("UPDATE gp_cloud.documents SET data=jsonb_set(data,'{name}',to_jsonb('PostgreSQL only test zone'::text)) WHERE kind='site' AND id=$1",[siteId]);
  assert((await ask('Стоимость выбранной зоны')).text.includes('PostgreSQL only test zone'));
  const ordered=await f.ok('/assistant/history');
  assert.deepEqual(ordered.map((x:any)=>x.at),ordered.map((x:any)=>x.at).sort(),'same chronological history contract as SQLite');
 });
 await t.test('history survives backend/PostgreSQL restart and repeat seed',async()=>{
  const before=await f.snapshot(['assistant_history','users']);await f.restart();await f.reseed();assert.deepEqual(await f.snapshot(['assistant_history','users']),before);
  assert.equal((await f.ok('/assistant/history')).length,2);
 });
 await t.test('real HTTP controlled provider uses PostgreSQL tool numbers, no private profile/session payload',async()=>{
  // localhost is the exact permitted DNS name; server is bound to IPv4 loopback.
  const e={...providerEnv,LLM_ALLOWED_HOSTS:'localhost',LLM_BASE_URL:providerEnv.LLM_BASE_URL.replace('127.0.0.1','localhost'),LLM2_BASE_URL:providerEnv.LLM2_BASE_URL.replace('127.0.0.1','localhost')};
  await restartBackend(e);
  const analysis=await f.ok('/zones/'+siteId+'/analysis','POST','coordinator',{options:{}});
  const r=await ask('Смета зоны');assert.equal(r.method,'model');assert.equal(r.model,'controlled-primary');assert(!('fallbackReason' in r));assert(r.text.includes(String(analysis.cost.total)));assert.equal(r.toolCalls[0].name,'analyze_zone');
  const sent=JSON.stringify(payloads);assert(!sent.includes(f.acceptancePassword));assert(!sent.includes('csrfToken'));assert(!sent.includes('password_hash'));assert(!sent.includes('Synthetic DEMO assistant-worker'));
  for(const failure of ['429','invalid','timeout']){mode=failure;await restartBackend(e);const r=await ask('Стоимость зоны','viewer');assert.equal(r.method,'model',`reserve after controlled ${failure}`);assert.equal(r.model,'controlled-reserve');assert(r.fallbackReason);}
  mode='all-fail';await restartBackend(e);assert.equal((await ask('Стоимость зоны')).method,'rules');
 });
 await t.test('in-flight logout revokes answer/history; concurrent user request is bounded',async()=>{
  await restartBackend({...providerEnv,LLM_ALLOWED_HOSTS:'localhost',LLM_BASE_URL:providerEnv.LLM_BASE_URL.replace('127.0.0.1','localhost'),LLM2_BASE_URL:providerEnv.LLM2_BASE_URL.replace('127.0.0.1','localhost'),LLM_TIMEOUT_MS:'10000'});
  mode='hold';let release!:()=>void;providerRelease=new Promise<void>(r=>release=r);
  const entered=new Promise<void>(r=>providerEntered=r),before=await f.snapshot(['assistant_history']);
  const pending=f.request('/assistant','POST','viewer',{message:'Стоимость зоны',siteId});
  try {
   await Promise.race([entered,new Promise((_,reject)=>setTimeout(()=>reject(Error('Provider was not reached')),8000))]);
   assert.equal((await f.request('/assistant','POST','viewer',{message:'Стоимость зоны',siteId})).status,429);
   await f.ok('/auth/logout','POST','viewer',{});
  } finally {release();}
  assert.equal((await pending).status,401);
  assert.deepEqual(await f.snapshot(['assistant_history']),before);
  await f.login('viewer');mode='ok';
 });
 await t.test('history limited to 50; no-key mode never claims a provider',async()=>{
  await restartBackend({CLOUD_LLM_ENABLED:'0'});
  const user=(await f.ok('/auth/me')).user;
  await f.db.pool.query("INSERT INTO gp_cloud.assistant_history SELECT 'old-'||n,$1,'2020-01-01T00:00:00.000Z','synthetic old question','test','rules','[]'::jsonb FROM generate_series(1,55) n",[user.id]);
  assert.equal((await ask('Приоритеты')).method,'rules');
  assert.equal((await f.ok('/assistant/history')).length,50);
  assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM gp_cloud.assistant_history WHERE user_id=$1',[user.id])).rows[0].n,50);
  await f.createUser('assistant-rate-viewer','viewer');
  const limited=(await f.ok('/auth/me','GET','assistant-rate-viewer')).user;
  await f.db.pool.query("INSERT INTO gp_cloud.assistant_history SELECT 'rate-'||n,$1,$2,'synthetic rate question','test','rules','[]'::jsonb FROM generate_series(1,10) n",[limited.id,new Date().toISOString()]);
  const before=await f.snapshot(['assistant_history']);
  assert.equal((await f.request('/assistant','POST','assistant-rate-viewer',{message:'Стоимость зоны',siteId})).status,429);
  assert.deepEqual(await f.snapshot(['assistant_history']),before);
 });
 await t.test('assistant disable switch keeps v6/history and existing workflow readable',async()=>{
  const before=await f.snapshot(['assistant_history']);await restartBackend({CLOUD_ASSISTANT_ENABLED:'0'});
  const r=await fetch(f.base+'/assistant/history',{headers:{Cookie:(await f.login('viewer')).cookie}});assert.equal(r.status,503);
  assert.deepEqual(await f.snapshot(['assistant_history']),before);assert(Array.isArray(await f.ok('/tasks')));
 });
});
