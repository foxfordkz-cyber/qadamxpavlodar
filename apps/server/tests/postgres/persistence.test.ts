import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { get as httpGet } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import EmbeddedPostgres from 'embedded-postgres';
import { PostgresDatabase } from '../../src/cloud/database.js';
import { migrate } from '../../src/cloud/migrations.js';
import { seedCloudDemo } from '../../src/cloud/seed.js';
import { cloudConfig } from '../../src/cloud/config.js';
import { createCloudApp } from '../../src/cloud/app.js';

async function freePort() {
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=(server.address() as {port:number}).port;
  await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));return port;
}
type Session={cookie:string;csrf:string};
test('real PostgreSQL: HTTP persistence slice (isolated native server, no SQLite/emulator)',{timeout:180000},async t=>{
  const databaseDir=mkdtempSync(join(tmpdir(),'gp-cloud-pg-'));
  const pgPort=await freePort(),port=await freePort(),dbPassword=randomBytes(24).toString('hex'),demoPassword=randomBytes(24).toString('hex');
  const cluster=new EmbeddedPostgres({databaseDir,port:pgPort,user:'postgres',password:dbPassword,authMethod:'scram-sha-256',persistent:true,
    createPostgresUser:false,autoRehydrateSymlinks:true,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
  const connectionString=`postgresql://postgres:${dbPassword}@127.0.0.1:${pgPort}/postgres`;
  let db=new PostgresDatabase({connectionString,ssl:false});let child:ChildProcess|undefined;let started=false;
  const origin=`http://127.0.0.1:${port}`;
  async function request(path:string,method='GET',body?:unknown,session?:Session,key?:string,extra:Record<string,string>={}) {
    const headers:Record<string,string>={...extra};
    if(body!==undefined)headers['Content-Type']='application/json';
    if(session){headers.Cookie=session.cookie;headers['X-CSRF-Token']=session.csrf;}
    if(key)headers['Idempotency-Key']=key;
    const res=await fetch(origin+'/api/v1'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    return {res,json:await res.json() as any};
  }
  async function startBackend() {
    child=spawn(process.execPath,['--import','./scripts/local-network-guard.mjs','--import','tsx','dist/cloud/server.js'],{windowsHide:true,
      env:{...process.env,DATABASE_URL:connectionString,CLOUD_LOCAL_TEST:'1',PORT:String(port),ALLOWED_HOSTS:'127.0.0.1',FRONTEND_ORIGINS:origin},stdio:['ignore','pipe','pipe']});
    // Deliberately do not forward process output/configuration into test failure logs.
    let diagnostic='';child.stdout?.resume();child.stderr?.on('data',(data:Buffer)=>{diagnostic=(diagnostic+data.toString()).slice(-6000);});
    for(let i=0;i<200;i++){
      if(child.exitCode!==null)throw Error('Cloud backend exited during startup: '+diagnostic.replaceAll(connectionString,'[DATABASE_URL]').replaceAll(dbPassword,'[REDACTED]').replaceAll(demoPassword,'[REDACTED]'));
      try{const r=await request('/ready');if(r.res.status===200)return;}catch{}
      await new Promise(r=>setTimeout(r,100));
    }
    throw Error('Cloud backend did not become ready');
  }
  async function stopBackend(){if(child&&child.exitCode===null){const end=once(child,'exit');child.kill();await end;}child=undefined;}
  async function login(role:string):Promise<Session>{
    const {res,json}=await request('/auth/login','POST',{login:role,password:demoPassword});assert.equal(res.status,200);
    assert.equal(json.data.user.role,role);assert.equal('password_hash' in json.data.user,false);
    const cookie=res.headers.get('set-cookie')!;assert(cookie.includes('HttpOnly'));assert(cookie.includes('SameSite=Strict'));assert(cookie.includes('Path=/api/v1'));
    return {cookie:cookie.split(';')[0]!,csrf:json.data.csrfToken};
  }
  try {
    await cluster.initialise();await cluster.start();started=true;
    await t.test('migration repeats, checksum rejection rolls back, seed preserves passwords and versions',async()=>{
      await migrate(db);await migrate(db);
      const engine=(await db.pool.query('SELECT version()')).rows[0].version;assert.match(engine,/PostgreSQL 18\./);
      await seedCloudDemo(db,demoPassword);
      const snapshot=(await db.pool.query('SELECT * FROM gp_cloud.users ORDER BY id')).rows;
      await seedCloudDemo(db,randomBytes(24).toString('hex'));
      assert(JSON.stringify(snapshot)===JSON.stringify((await db.pool.query('SELECT * FROM gp_cloud.users ORDER BY id')).rows),'Repeat seed changed existing account data');
      await db.pool.query("INSERT INTO gp_cloud.schema_migrations VALUES (999,'future')");
      await assert.rejects(migrate(db),/Unknown or changed cloud migration/);
      await assert.rejects(db.ready(),{code:'DATABASE_UNAVAILABLE'});
      await db.pool.query('DELETE FROM gp_cloud.schema_migrations WHERE version=999');await migrate(db);
    });
    await t.test('foreign keys, uniqueness and an awaited failed transaction roll back',async()=>{
      await assert.rejects(db.transaction(async c=>{
        await c.query("INSERT INTO gp_cloud.login_attempts VALUES ('rollback-sentinel',1,0)");
        await new Promise(r=>setTimeout(r,25));
        await c.query("INSERT INTO gp_cloud.sessions VALUES ($1,'missing-user',$2,'2026','2027')",['a'.repeat(64),'b'.repeat(64)]);
      }),{code:'23503'});
      assert.equal((await db.pool.query("SELECT count(*)::int n FROM gp_cloud.login_attempts WHERE key='rollback-sentinel'")).rows[0].n,0);
      await assert.rejects(db.pool.query("UPDATE gp_cloud.users SET login='admin' WHERE login='worker'"),{code:'23505'});
      await assert.rejects(db.pool.query("INSERT INTO gp_cloud.evidence_links(resource_id,evidence_id) VALUES ('missing','missing')"),{code:'23503'});
    });
    await startBackend();
    let admin:Session,coordinator:Session,viewer:Session,worker:Session,foreman:Session;
    await t.test('real HTTP role login, secret-free DTO, persistent session and CSRF',async()=>{
      admin=await login('admin');coordinator=await login('coordinator');viewer=await login('viewer');worker=await login('worker');foreman=await login('foreman');
      assert.equal((await request('/resources')).res.status,401);
      assert.equal((await request('/auth/me','GET',undefined,viewer)).json.data.user.role,'viewer');
      const spec=await request('/openapi.json');
      assert.deepEqual(spec.json,JSON.parse(readFileSync('openapi-cloud.json','utf8')));
      assert.equal(spec.json.paths['/tasks'],undefined);
      const rejectedEncodings:Record<string,string>[]=[{'Content-Type':'application/json; charset=unsupported'},{'Content-Type':'application/json','Content-Encoding':'unsupported'}];
      for(const headers of rejectedEncodings) {
        const rejected=await fetch(origin+'/api/v1/auth/login',{method:'POST',headers,body:'{}'});
        assert.equal(rejected.status,415);assert.equal((await rejected.json() as any).error.code,'UNSUPPORTED_MEDIA_TYPE');
      }
      const bad={...admin,csrf:''};assert.equal((await request('/evidence','POST',{},bad,'csrf')).json.error.code,'CSRF_REQUIRED');
      assert.equal((await request('/auth/me','GET',undefined,viewer,undefined,{Origin:'https://untrusted.example'})).res.status,403);
      // Fetch may normalize Host to the URL authority. Use the actual HTTP header for this guard check.
      const deniedHost=await new Promise<number|undefined>((resolve,reject)=>{
        const r=httpGet(origin+'/api/v1/auth/me',{headers:{Host:'untrusted.example','X-Forwarded-Host':'127.0.0.1',Cookie:viewer.cookie}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);
      });
      assert.equal(deniedHost,403);
      assert.equal((await request('/auth/me','GET',undefined,undefined,undefined,{Cookie:viewer.cookie+'; '+viewer.cookie})).res.status,401);
    });
    const evidenceBody={sourceType:'fixture',sourceLabel:'Synthetic cloud persistence test',dataClass:'demo',note:'Test fixture, not a field observation'};
    let evidenceId='',resourceId='';let resourceBody:any;
    await t.test('shared API schemas: source creation, resource creation, nulls and read RBAC',async()=>{
      const ev=await request('/evidence','POST',evidenceBody,coordinator!,'evidence-one');assert.equal(ev.res.status,201);evidenceId=ev.json.data.id;
      resourceBody={label:'DEMO test water tank',type:'water',capacity:null,unit:'litre',ownerCrewId:null,
        availableIntervals:[{start:'2026-11-01T00:00:00Z',end:'2026-11-02T00:00:00Z'}],evidenceIds:[evidenceId]};
      const created=await request('/resources','POST',resourceBody,admin!,'resource-one');assert.equal(created.res.status,201);resourceId=created.json.data.id;
      assert.equal(created.json.data.capacity,null);assert.equal(created.json.data.version,1);
      for(const session of [admin!,coordinator!,viewer!,foreman!])assert.equal((await request('/resources','GET',undefined,session)).res.status,200);
      assert.equal((await request('/resources','GET',undefined,worker!)).res.status,403);
      assert.equal((await request('/resources','POST',resourceBody,viewer!,'deny-viewer')).res.status,403);
      assert.equal((await request('/resources','POST',resourceBody,coordinator!,'deny-coordinator')).res.status,403);
      assert.equal((await request('/evidence','POST',evidenceBody,foreman!,'deny-foreman')).res.status,403);
      assert.equal((await request('/evidence','POST',evidenceBody,worker!,'deny-worker')).res.status,403);
    });
    await t.test('concurrent retry is exactly one write, key conflicts and optimistic versions',async()=>{
      const replies=await Promise.all(Array.from({length:8},()=>request('/resources','POST',resourceBody,admin!,'resource-concurrent')));
      assert(replies.every(x=>x.res.status===201));assert.equal(new Set(replies.map(x=>x.json.data.id)).size,1);
      assert.equal(replies.filter(x=>x.res.headers.get('idempotency-replayed')==='false').length,1);
      assert.equal((await request('/resources','POST',{...resourceBody,label:'conflict'},admin!,'resource-concurrent')).json.error.code,'IDEMPOTENCY_CONFLICT');
      const patch={expectedVersion:1,label:'DEMO updated'};
      const changed=await request('/resources/'+resourceId,'PATCH',patch,admin!,'update-one');assert.equal(changed.res.status,200);assert.equal(changed.json.data.version,2);
      assert.equal((await request('/resources/'+resourceId,'PATCH',patch,admin!,'stale')).json.error.code,'VERSION_CONFLICT');
      assert.equal((await request('/resources/'+resourceId,'PATCH',patch,admin!,'update-one')).res.headers.get('idempotency-replayed'),'true');
      assert.equal((await request('/resources/'+resourceId,'PATCH',{expectedVersion:2,label:'forbidden'},viewer!,'denied-update')).res.status,403);
    });
    await t.test('invalid references and unsupported domains do not produce successful writes',async()=>{
      const countBefore=(await db.pool.query('SELECT count(*)::int n FROM gp_cloud.documents')).rows[0].n;
      assert.equal((await request('/resources','POST',{...resourceBody,evidenceIds:['missing']},admin!,'missing-evidence')).res.status,404);
      assert.equal((await request('/resources','POST',{...resourceBody,ownerCrewId:'not-migrated'},admin!,'missing-crew')).json.error.code,'CLOUD_REFERENCE_UNSUPPORTED');
      for(const path of ['/tasks','/reports','/uploads','/outcomes/summary','/workers','/crews'])
        assert.equal((await request(path,'GET',undefined,viewer!)).json.error.code,'CLOUD_ENDPOINT_UNSUPPORTED');
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM gp_cloud.documents')).rows[0].n,countBefore);
      assert.equal((await db.pool.query("SELECT count(*)::int n FROM gp_cloud.idempotency WHERE key IN ('missing-evidence','missing-crew','stale','denied-update')")).rows[0].n,0);
    });
    await t.test('late HTTP mutation failure rolls back document, evidence links, history and idempotency',async()=>{
      const before=(await db.pool.query('SELECT count(*)::int n FROM gp_cloud.documents')).rows[0].n;
      await db.pool.query("ALTER TABLE gp_cloud.history ADD CONSTRAINT qa_reject_create CHECK(action<>'create') NOT VALID");
      try {
        assert.equal((await request('/resources','POST',resourceBody,admin!,'late-failure')).res.status,503);
        assert.equal((await db.pool.query('SELECT count(*)::int n FROM gp_cloud.documents')).rows[0].n,before);
        assert.equal((await db.pool.query("SELECT count(*)::int n FROM gp_cloud.idempotency WHERE key='late-failure'")).rows[0].n,0);
      } finally {await db.pool.query('ALTER TABLE gp_cloud.history DROP CONSTRAINT qa_reject_create');}
      assert.equal((await request('/resources','POST',resourceBody,admin!,'late-failure')).res.status,201);
    });
    await t.test('trusted ingress simulation sets Secure cookies and rejects unforwarded HTTP (not public TLS acceptance)',async()=>{
      const config=cloudConfig({DATABASE_URL:connectionString,CLOUD_LOCAL_TEST:'1',ALLOWED_HOSTS:'127.0.0.1'});
      const server=createCloudApp(db,{...config,localTest:false,secureCookies:true,proxyHops:1}).listen(0,'127.0.0.1');
      await once(server,'listening');const url='http://127.0.0.1:'+(server.address() as {port:number}).port+'/api/v1/auth/login';
      try {
        const input={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:'viewer',password:demoPassword})};
        assert.equal((await fetch(url,input)).status,403);
        const response=await fetch(url,{...input,headers:{...input.headers,'X-Forwarded-Proto':'https'}});
        assert.equal(response.status,200);assert(response.headers.get('set-cookie')?.includes('Secure'));await response.arrayBuffer();
      } finally {await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
    });
    await t.test('authorization is checked before replay after role revocation',async()=>{
      await db.pool.query("UPDATE gp_cloud.users SET role='viewer',version=version+1 WHERE login='admin'");
      assert.equal((await request('/resources','POST',resourceBody,admin!,'resource-one')).res.status,403);
      await db.pool.query("UPDATE gp_cloud.users SET role='admin',version=version+1 WHERE login='admin'");admin=await login('admin');
    });
    await t.test('backend process and PostgreSQL restart preserve records, nulls, history, sessions and replay',async()=>{
      const before=JSON.stringify((await db.pool.query('SELECT * FROM gp_cloud.documents ORDER BY kind,id')).rows);
      const history=JSON.stringify((await db.pool.query('SELECT * FROM gp_cloud.history ORDER BY id')).rows);
      await stopBackend();await db.close();await cluster.stop();started=false;await cluster.start();started=true;
      db=new PostgresDatabase({connectionString,ssl:false});await migrate(db);await seedCloudDemo(db,randomBytes(24).toString('hex'));
      await startBackend();
      assert.equal((await request('/auth/me','GET',undefined,viewer!)).res.status,200);
      const listing=await request('/resources','GET',undefined,viewer!);assert.equal(listing.res.status,200);
      assert.equal(listing.json.data.find((x:any)=>x.id===resourceId).capacity,null);
      assert.equal(listing.json.data.find((x:any)=>x.id===resourceId).version,2);
      assert.equal((await request('/resources','POST',resourceBody,admin!,'resource-one')).json.data.id,resourceId);
      assert.equal(JSON.stringify((await db.pool.query('SELECT * FROM gp_cloud.documents ORDER BY kind,id')).rows),before);
      assert.equal(JSON.stringify((await db.pool.query('SELECT * FROM gp_cloud.history ORDER BY id')).rows),history);
      await login('admin');
    });
    await t.test('logout revokes a real server session',async()=>{
      assert.equal((await request('/auth/logout','POST',{},viewer!)).res.status,200);
      assert.equal((await request('/auth/me','GET',undefined,viewer!)).res.status,401);
    });
    await t.test('database outage returns 503, never fake success; recovery keeps safe retry',async()=>{
      const live=await login('admin');
      await db.close();await cluster.stop();started=false;
      const down=await request('/resources','POST',resourceBody,live,'outage-write');assert.equal(down.res.status,503);assert.equal(down.json.error.code,'DATABASE_UNAVAILABLE');
      assert.equal((await request('/ready')).res.status,503);
      await cluster.start();started=true;db=new PostgresDatabase({connectionString,ssl:false});
      const recovered=await request('/resources','POST',resourceBody,live,'outage-write');assert.equal(recovered.res.status,201);
      assert.equal((await request('/resources','POST',resourceBody,live,'outage-write')).json.data.id,recovered.json.data.id);
    });
  } finally {await stopBackend();await db.close();if(started)await cluster.stop();}
});

test('cloud configuration requires verified TLS and exact hosts; test bypass is loopback only',()=>{
  const common={DATABASE_URL:'postgresql://placeholder:placeholder@db.example.com/demo',CLOUD_ALLOWED_HOSTS:'db.example.com',
    ALLOWED_HOSTS:'backend.example.com',FRONTEND_ORIGINS:'https://frontend.example.com'};
  const config=cloudConfig(common);assert.equal(config.secureCookies,true);assert.equal((config.database.ssl as any).rejectUnauthorized,true);
  assert.throws(()=>cloudConfig({...common,CLOUD_LOCAL_TEST:'1'}),/loopback/);
  assert.throws(()=>cloudConfig({...common,DATABASE_URL:common.DATABASE_URL+'?sslmode=no-verify'}),/without query/);
  assert.throws(()=>cloudConfig({...common,CLOUD_ALLOWED_HOSTS:''}),/CLOUD_ALLOWED_HOSTS/);
  assert.throws(()=>cloudConfig({...common,FRONTEND_ORIGINS:'http://frontend.example.com'}),/HTTPS/);
});
