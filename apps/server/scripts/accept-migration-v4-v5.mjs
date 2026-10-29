// Run with --import tsx. Uses an archived coordinator source tree and NEW synthetic databases only.
// Never reads .env, user databases or shared Docker volumes. Passwords/hashes stay in memory.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [sourceArg, outputArg, sourceSha] = process.argv.slice(2);
assert(sourceArg && outputArg && /^[a-f0-9]{40}$/.test(sourceSha ?? ''), 'Usage: script <archived repository> <new output directory> <source SHA>');
const source=resolve(sourceArg), current=process.cwd(), out=resolve(outputArg);
assert(!existsSync(out), 'Output directory must not exist: previous evidence is never overwritten');
mkdirSync(out,{recursive:true});
const password=`acceptance-${randomBytes(24).toString('base64url')}`;
process.env.DEMO_PASSWORD=password;
const originalPath=join(out,'synthetic-v4.sqlite'), copyPath=join(out,'migration-copy.sqlite');
const {Store:OldStore}=await import(pathToFileURL(join(source,'apps/server/src/db.ts')));
const {seedV2}=await import(pathToFileURL(join(source,'apps/server/src/v2/seed.ts')));
const {seedTz}=await import(pathToFileURL(join(source,'apps/server/src/tz/seed.ts')));
let old=new OldStore(originalPath);
assert.equal(old.get('PRAGMA user_version').user_version,4);
assert(!old.get("SELECT name FROM sqlite_master WHERE name='municipal_state'"));
await seedV2(old);seedTz(old);
const siteId=old.get("SELECT id FROM v2_documents WHERE kind='site' ORDER BY id LIMIT 1").id;
const task={id:'acceptance-task',status:'submitted',action:'inspect',objectType:'candidate_site',objectId:siteId,title:'Synthetic migration acceptance',version:1,createdBy:'demo-coordinator-1',crewId:'demo-crew-1'};
const report={id:'acceptance-report',taskId:task.id,revision:1,authorId:'demo-foreman-1',status:'pending',version:1,note:'Synthetic migration fixture'};
old.run('INSERT INTO v2_tasks VALUES (?,?,?,NULL,NULL,1,?)',task.id,task.status,task.crewId,JSON.stringify(task));
old.run('INSERT INTO v2_reports VALUES (?,?,1,?,?,1,?)',report.id,task.id,report.authorId,report.status,JSON.stringify(report));
old.run("INSERT INTO v2_assignments VALUES (?,?)",task.id,'demo-worker-1');
const priorRate=JSON.parse(old.get("SELECT data FROM tz_rates WHERE key='price.tree'").data), rate={...priorRate,value:12345,source:'Synthetic acceptance source'};
old.run("UPDATE tz_rates SET data=? WHERE key='price.tree'",JSON.stringify(rate));
old.run('INSERT INTO tz_rate_history VALUES (7,?,?,?,?,?)',rate.key,'demo-admin-1',JSON.stringify(priorRate),JSON.stringify(rate),new Date().toISOString());
old.run('INSERT INTO v2_idempotency VALUES (?,?,?,?,?,?,?,?)','demo-coordinator-1','POST','/acceptance-original','preserved-key','fixture-hash',201,JSON.stringify({data:{id:report.id}}),new Date().toISOString());
old.close();
let child,base,serverLog='',run=0;
const cleanEnv={...process.env};for(const k of Object.keys(cleanEnv))if(/^(LLM|OPENAI|ANTHROPIC)/.test(k))delete cleanEnv[k];
async function launch(serverDir,dbPath,host){
 const portProbe=createServer().listen(0,'127.0.0.1');await once(portProbe,'listening');const port=portProbe.address().port;await new Promise(r=>portProbe.close(r));base=`http://127.0.0.1:${port}`;
 serverLog='';child=spawn(process.execPath,['--import','./scripts/local-network-guard.mjs','--import','tsx','src/server.ts'],{cwd:serverDir,windowsHide:true,env:{...cleanEnv,NODE_ENV:'test',HOST:host,PORT:String(port),STORAGE_ROOT:out,DB_PATH:dbPath,UPLOADS_PATH:join(out,'uploads'),DEMO_PASSWORD:password,ALLOWED_HOSTS:'127.0.0.1,localhost'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>serverLog+=b);child.stderr.on('data',b=>serverLog+=b);
 const started=Date.now(),deadline=started+60000;let lastProbe='not attempted';
 while(Date.now()<deadline){assert.equal(child.exitCode,null,'Server exited during startup');try{const r=await fetch(base+'/health',{signal:AbortSignal.timeout(2000)});lastProbe=`HTTP ${r.status}`;if(r.ok){console.log(JSON.stringify({phase:run===0?'old-v4':run===1?'migrating-v5':'reopening-v5',health:'PASS',startupMs:Date.now()-started}));return;}}catch(e){lastProbe=`${e.name}: ${e.cause?.code??e.message}`;}await new Promise(r=>setTimeout(r,100));}throw Error(`Server health timeout after 60 seconds: ${lastProbe}`);
}
async function stop(){const p=child;child=undefined;if(p&&p.exitCode===null){const exited=once(p,'exit');p.kill();await exited;}assert(!serverLog.includes(password),'Generated password leaked to server log');writeFileSync(join(out,`server-${++run}.log`),serverLog);}
async function login(login){const r=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login,password})});assert.equal(r.status,200);const b=await r.json();return{cookie:r.headers.get('set-cookie').split(';')[0],csrf:b.data.csrfToken,role:b.data.user.role};}
async function request(session,path,method='GET',body,expected=200,headers={}){const r=await fetch(base+'/api/v1'+path,{method,headers:{Cookie:session.cookie,'X-CSRF-Token':session.csrf,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});const b=await r.json();assert.equal(r.status,expected,JSON.stringify(b));return b;}
function inventory(db){const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);const counts=Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT count(*) n FROM "${t}"`).get().n]));return{schemaVersion:db.prepare('PRAGMA user_version').get().user_version,tables,counts,zones:db.prepare("SELECT count(*) n FROM v2_documents WHERE kind='site'").get().n,catalog:db.prepare("SELECT count(*) n FROM v2_documents WHERE kind='catalog'").get().n,accountsWithPasswordHashes:db.prepare("SELECT count(*) n FROM v2_users WHERE password_hash LIKE 'scrypt32768$%'").get().n,roles:db.prepare('SELECT role,count(*) n FROM v2_users GROUP BY role ORDER BY role').all(),integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,foreignKeys:db.prepare('PRAGMA foreign_key_check').all()};}
try{
 await launch(join(source,'apps/server'),originalPath,'127.0.0.1');const oldSession=await login('coordinator');await stop();
 old=new OldStore(originalPath);const before=inventory(old.db);assert.equal(before.integrity,'ok');assert.deepEqual(before.foreignKeys,[]);
 const original=new Map(before.tables.map(t=>[t,JSON.stringify(old.all(`SELECT * FROM "${t}" ORDER BY rowid`))]));
 await backup(old.db,copyPath);old.close();
 await launch(current,copyPath,'0.0.0.0');
 const migrated=new DatabaseSync(copyPath,{readOnly:true}),after=inventory(migrated);assert.equal(after.schemaVersion,5);
 for(const [t,rows]of original)assert.equal(JSON.stringify(migrated.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()),rows,`${t} changed`);
 assert.equal(after.integrity,'ok');assert.deepEqual(after.foreignKeys,[]);const schema=JSON.stringify(migrated.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all());migrated.close();
 assert.equal((await request(oldSession,'/auth/me')).data.user.role,'coordinator');
 const roles={admin:'admin',coordinator:'coordinator',viewer:'viewer',foreman1:'foreman',foreman2:'foreman',worker1:'worker',worker2:'worker',worker3:'worker',worker4:'worker'};for(const [name,role]of Object.entries(roles))assert.equal((await login(name)).role,role);
 const admin=await login('admin');assert.equal((await request(admin,'/rates')).data.version,7);
 assert.equal((await request(oldSession,'/municipal/sites')).data.length,114);
 const snapshot=await request(oldSession,`/zones/${siteId}/snapshots`,'POST',{options:{}},201,{'Idempotency-Key':'acceptance-snapshot'});
 assert.deepEqual(await request(oldSession,`/zones/${siteId}/snapshots`,'POST',{options:{}},201,{'Idempotency-Key':'acceptance-snapshot'}),snapshot);
 await request(oldSession,'/assistant','POST',{message:'Какие зоны озеленить?'},403,{'X-CSRF-Token':''});
 const assistant=(await request(oldSession,'/assistant','POST',{message:'Какие зоны озеленить?'})).data;assert.equal(assistant.method,'rules');
 await request(admin,'/rates','PATCH',{key:'price.tree',value:12346,source:'Synthetic acceptance source',expectedVersion:6},409,{'Idempotency-Key':'stale-version'});
 const snapshotId=snapshot.data.id;await stop();await launch(current,copyPath,'0.0.0.0');
 assert.equal((await request(oldSession,'/auth/me')).data.user.role,'coordinator');
 assert.equal((await request(oldSession,`/analysis-snapshots/${snapshotId}`)).data.provenance.inputHash,snapshot.data.provenance.inputHash);
 assert((await request(oldSession,'/assistant/history')).data.length>0);await stop();
 const finalDb=new DatabaseSync(copyPath,{readOnly:true}),afterRestart=inventory(finalDb);assert.equal(JSON.stringify(finalDb.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all()),schema);assert.equal(afterRestart.zones,114);assert.equal(afterRestart.counts.v2_tasks,1);assert.equal(afterRestart.counts.v2_reports,1);assert.equal(afterRestart.counts.municipal_analyses,1);assert.equal(afterRestart.integrity,'ok');assert.deepEqual(afterRestart.foreignKeys,[]);finalDb.close();
 const result={status:'PASS',sourceSha,before,after,afterRestart,allOriginalRowsUnchanged:true,walSafeBackup:'node:sqlite backup API',oldSession:'PASS',oldPasswordsAndRoles:'PASS: all 9 original accounts; admin/coordinator/viewer/foreman/worker',newEndpoints:'PASS',snapshotReplayAndRestart:'PASS',schemaUnchangedOnSecondStart:true,csrf:'PASS',optimisticVersion:'PASS',networkGuardListenAllInterfaces:'PASS',assistantMode:'rules',userDataUsed:false};
 writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,sourceSha,zones:after.zones,tablesPreserved:before.tables.length,accounts:after.counts.v2_users,output:out}));
}finally{if(child)await stop();}
