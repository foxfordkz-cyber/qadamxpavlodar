import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';
import EmbeddedPostgres from 'embedded-postgres';
import { Store } from '../../src/db.js';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/v2/auth.js';
import { seedTz } from '../../src/tz/seed.js';
import { seedMunicipal } from '../../src/municipal/data.js';
import { PostgresDatabase } from '../../src/cloud/database.js';
import { migrate, migration1 } from '../../src/cloud/migrations.js';
import { seedCloudDemo } from '../../src/cloud/seed.js';
import { seedCloudPlanning } from '../../src/cloud/planning-seed.js';

const webRoot=new URL('../../../web/src/',import.meta.url);
const load=(file:string):Promise<any>=>import(new URL(file,webRoot).href);
async function freePort(){const s=createServer().listen(0,'127.0.0.1');await once(s,'listening');const p=(s.address() as {port:number}).port;await new Promise<void>(r=>s.close(()=>r()));return p;}
const cleanAnalysis=(a:any)=>{const copy=structuredClone(a);delete copy.provenance.generatedAt;return copy;};

test('Stage A: real PostgreSQL + HTTP frontend path, exact SQLite parity and both-process restart',{timeout:300000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'gp-cloud-planning-'));
  const pgPort=await freePort(),port=await freePort(),dbPassword=randomBytes(24).toString('hex'),password=randomBytes(24).toString('hex');
  const cluster=new EmbeddedPostgres({databaseDir:join(dir,'postgres'),port:pgPort,user:'postgres',password:dbPassword,authMethod:'scram-sha-256',persistent:true,
    createPostgresUser:false,autoRehydrateSymlinks:true,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
  const connectionString=`postgresql://postgres:${dbPassword}@127.0.0.1:${pgPort}/postgres`,base=`http://127.0.0.1:${port}/api/v1`;
  let db=new PostgresDatabase({connectionString,ssl:false}),child:ChildProcess|undefined,started=false;
  const sqlite=new Store(join(dir,'parity.sqlite'));
  const sqliteServer=createApp(sqlite,{uploadsPath:join(dir,'unused-uploads')}).listen(0,'127.0.0.1');await once(sqliteServer,'listening');
  const sqliteBase=`http://127.0.0.1:${(sqliteServer.address() as {port:number}).port}/api/v1`;
  const nativeFetch=globalThis.fetch,cookies=new Map<string,string>(),trace:{path:string;status:number}[]=[];
  // Node has no browser cookie jar. Only add cookie persistence; every response still comes over real HTTP.
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input)),headers=new Headers(init?.headers),cookie=cookies.get(url.origin);
    if(cookie)headers.set('Cookie',cookie);
    const res=await nativeFetch(input,{...init,headers});const set=res.headers.get('set-cookie');if(set)cookies.set(url.origin,set.split(';')[0]!);
    trace.push({path:url.pathname,status:res.status});return res;
  };
  async function startBackend(){
    child=spawn(process.execPath,['--import','./scripts/local-network-guard.mjs','--import','tsx','dist/cloud/server.js'],{windowsHide:true,stdio:['ignore','ignore','pipe'],
      env:{...process.env,DATABASE_URL:connectionString,CLOUD_LOCAL_TEST:'1',PORT:String(port),ALLOWED_HOSTS:'127.0.0.1',FRONTEND_ORIGINS:`http://127.0.0.1:${port}`}});
    child.stderr?.resume();
    for(let i=0;i<300;i++){
      if(child.exitCode!==null)throw Error('Compiled cloud server exited before readiness (no credentials logged)');
      try{if((await nativeFetch(base+'/ready')).status===200)return;}catch{}
      await new Promise(r=>setTimeout(r,100));
    }throw Error('Cloud readiness timeout');
  }
  async function stopBackend(){if(child&&child.exitCode===null){const end=once(child,'exit');child.kill();await end;}child=undefined;}
  let raw:any,api:any,sqlApi:any,zoneId='',analysis:any,snapshotId='',snapshot:any;
  async function step(name:string,run:()=>Promise<void>){
    let failed=false;
    await t.test(name,async()=>{try{await run();}catch(error){failed=true;throw error;}});
    if(failed)throw Error('Dependent acceptance stopped after: '+name);
  }

  try {
    await cluster.initialise();await cluster.start();started=true;
    await step('upgrade from published v1 preserves accounts, sessions and reference documents',async()=>{
      await db.pool.query('CREATE SCHEMA gp_cloud');
      await db.pool.query('CREATE TABLE gp_cloud.schema_migrations(version integer PRIMARY KEY,checksum text NOT NULL)');
      await db.pool.query(migration1);
      const checksum=createHash('sha256').update(migration1).digest('hex');
      await db.pool.query('INSERT INTO gp_cloud.schema_migrations VALUES (1,$1)',[checksum]);
      await seedCloudDemo(db,password);
      const before=JSON.stringify((await db.pool.query('SELECT * FROM gp_cloud.users ORDER BY id')).rows);
      await db.pool.query("INSERT INTO gp_cloud.documents VALUES ('evidence','upgrade-source',$1,1)",[JSON.stringify({id:'upgrade-source',version:1,dataClass:'demo'})]);
      await db.pool.query('INSERT INTO gp_cloud.sessions VALUES ($1,$2,$3,$4,$5)',[randomBytes(32).toString('hex'),'cloud-demo-viewer',randomBytes(32).toString('hex'),'2026-10-31','2026-11-01']);
      const sessionRows=JSON.stringify((await db.pool.query('SELECT * FROM gp_cloud.sessions')).rows);
      // Deliberate collision after the first v2 DDL statement proves all migration DDL is atomic.
      await db.pool.query('CREATE TABLE gp_cloud.zone_contexts(sentinel integer)');
      await db.pool.query('INSERT INTO gp_cloud.zone_contexts VALUES (7)');
      await assert.rejects(migrate(db),{code:'42P07'});
      assert.equal((await db.pool.query("SELECT to_regclass('gp_cloud.planning_documents') name")).rows[0].name,null);
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM gp_cloud.schema_migrations')).rows[0].n,1);
      assert.equal((await db.pool.query('SELECT sentinel FROM gp_cloud.zone_contexts')).rows[0].sentinel,7);
      await db.pool.query('DROP TABLE gp_cloud.zone_contexts'); // Only this test-created collision table in this isolated cluster.
      await migrate(db);await migrate(db);
      assert(JSON.stringify((await db.pool.query('SELECT * FROM gp_cloud.sessions')).rows)===sessionRows,'Migration changed sessions');
      assert.equal((await db.pool.query("SELECT count(*)::int n FROM gp_cloud.documents WHERE id='upgrade-source'")).rows[0].n,1);
      assert.equal((await db.pool.query('SELECT checksum FROM gp_cloud.schema_migrations WHERE version=1')).rows[0].checksum,checksum);
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM gp_cloud.schema_migrations')).rows[0].n,2);
      assert(JSON.stringify((await db.pool.query('SELECT * FROM gp_cloud.users ORDER BY id')).rows)===before,'Upgrade changed account data');
      await assert.rejects(db.pool.query("INSERT INTO gp_cloud.zone_contexts(site_id,radius,site_version,data) VALUES ('missing',100,1,'{}')"),{code:'23503'});
      await assert.rejects(db.pool.query("INSERT INTO gp_cloud.planning_documents VALUES ('site','bad','{}',1,0)"),{code:'23514'});
    });
    await step('explicit seed uses original IDs and persists all contexts, sources, rates and geometry',async()=>{
      await seedCloudPlanning(db);
      const hash=await hashPassword(password),at=new Date().toISOString();
      for(const role of ['admin','coordinator','viewer'])sqlite.run('INSERT INTO v2_users VALUES (?,?,?,?,1,?,1,?,?)',`cloud-demo-${role}`,role,`Cloud DEMO ${role}`,role,hash,at,at);
      seedTz(sqlite);await seedMunicipal(sqlite);
      const counts=(await db.pool.query('SELECT kind,count(*)::int n FROM gp_cloud.planning_documents GROUP BY kind ORDER BY kind')).rows;
      assert.equal(counts.find(r=>r.kind==='site')?.n,114);assert.equal(counts.find(r=>r.kind==='species')?.n,50);
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM gp_cloud.zone_contexts')).rows[0].n,456);
      writeFileSync(join(dir,'seed-counts.json'),JSON.stringify(counts,null,2));
      await startBackend();
      const [{createHttpTransport},{createV2CompatTransport},{createApi}]=await Promise.all([load('shared/api/transport.ts'),load('shared/api/v2compat.ts'),load('shared/api/api.ts')]);
      raw=createHttpTransport(base);api=createApi(createV2CompatTransport(raw));sqlApi=createApi(createV2CompatTransport(createHttpTransport(sqliteBase)));
      await api.login('coordinator',password);await sqlApi.login('coordinator',password);
    });
    assert(api&&sqlApi,'Seed and HTTP setup must succeed before the dependent acceptance scenario');
    await step('actual frontend transport: lists, selection, details, contexts and source/rate DTO parity',async()=>{
      const pgSites=await api.sites(),sqlSites=await sqlApi.sites();assert.deepEqual(pgSites.data,sqlSites.data);assert.deepEqual(pgSites.meta.osm,sqlSites.meta.osm);
      zoneId=pgSites.data.find((s:any)=>s.geometry.type==='Polygon'&&s.centroid).id;
      assert.deepEqual(await api.site(zoneId),await sqlApi.site(zoneId));
      for(const radius of [30,50,100,200])assert.deepEqual(await api.siteContext(zoneId,radius),await sqlApi.siteContext(zoneId,radius));
      assert.deepEqual(await api.species(),await sqlApi.species());assert.deepEqual(await api.rates(),await sqlApi.rates());
      assert.deepEqual(await api.soilsLayer(),await sqlApi.soilsLayer());assert.deepEqual(await api.greeneryLayer(),await sqlApi.greeneryLayer());
      const dashboard=await api.dashboard(),sqliteDashboard=await sqlApi.dashboard();
      assert.deepEqual(dashboard.data.filter((x:any)=>x.key.startsWith('sites_')),sqliteDashboard.data.filter((x:any)=>x.key.startsWith('sites_')));
      assert(dashboard.data.filter((x:any)=>!x.key.startsWith('sites_')).every((x:any)=>x.value===null&&x.unavailableReason==='CLOUD_WORKFLOW_NOT_MIGRATED'));
      await assert.rejects(api.siteContext(zoneId,75),{status:400});await assert.rejects(api.site('missing'),{status:404});
    });
    await step('exact recommendations, quantities, costs, survival, effects, variants and immutable inputs',async()=>{
      for(const opts of [{},{variant:'econom',watering:'rare'},{variant:'max',improveSoil:true,careYears:3}]){
        const pg=await api.zoneAnalysis(zoneId,opts),sql=await sqlApi.zoneAnalysis(zoneId,opts);
        assert.deepEqual(cleanAnalysis(pg),cleanAnalysis(sql));analysis=pg;
      }
      assert.deepEqual(await api.zoneVariants(zoneId,{}),await sqlApi.zoneVariants(zoneId,{}));
      assert(analysis.scheme.length>0);assert(analysis.cost.total>0);assert(analysis.effect.some((x:any)=>x.canopyM2>0));
      await assert.rejects(api.zoneAnalysis(zoneId,{locked:['nonexistent']}),{status:400,code:'unknown_species'});
      const writes=await Promise.all(Array.from({length:4},()=>raw.request('POST',`/zones/${zoneId}/snapshots`,{body:{options:{}},idempotencyKey:'planning-snapshot'})));
      assert.equal(new Set(writes.map(x=>x.data.id)).size,1);snapshotId=writes[0].data.id;snapshot=(await raw.request('GET','/analysis-snapshots/'+snapshotId)).data;
      assert.deepEqual(snapshot.inputSnapshot,(await api.zoneAnalysis(zoneId,{})).inputSnapshot);
      await assert.rejects(db.pool.query('UPDATE gp_cloud.analysis_snapshots SET created_at=created_at WHERE id=$1',[snapshotId]),{code:'23514'});
    });
    await step('remaining planning routes: real HTTP references, layers, problems, priorities, laboratory and exports',async()=>{
      for(const path of ['/plant-catalog','/sites/'+zoneId+'/context','/reference/facts','/layers/city','/layers/zones']) {
        const response=await raw.request('GET',path);assert(response.data);
      }
      assert.deepEqual((await api.problems()).data,(await sqlApi.problems()).data);
      const {web}=await import('../../src/tz/shared.js');
      assert.deepEqual(await api.priorities(web.DEFAULT_PRIORITY_WEIGHTS,50e6),await sqlApi.priorities(web.DEFAULT_PRIORITY_WEIGHTS,50e6));
      const lab=await api.decisionLab({budgetKzt:50e6,waterLimitM3:500,watering:'regular'});assert(lab);
      const {data:{csrfToken}}=await (await fetch(base+'/auth/me')).json() as any;
      for(const format of ['xlsx','pdf']) {
        const res=await fetch(base+`/zones/${zoneId}/export`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({options:{},format})});
        assert.equal(res.status,200);const bytes=new Uint8Array(await res.arrayBuffer());
        assert(bytes.length>1000);assert(res.headers.get('content-disposition')?.includes('.'+format));
        if(format==='xlsx')assert(unzipSync(bytes)['xl/workbook.xml']);else assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');
        writeFileSync(join(dir,'http-export.'+format),bytes);
      }
    });
    await step('Word and growth use the unchanged frontend renderers with real HTTP inputs, RU and KK',async()=>{
      const [{loadMemo},{buildMemoDocx,memoBlocks},{buildGrowthScene,growthFrame,streetLines}]=await Promise.all([load('shared/export/loadMemo.ts'),load('shared/export/memo.ts'),load('features/coordinator/zone/timeMachine.ts')]);
      const pg=await loadMemo(api,[zoneId],{},'api'),sql=await loadMemo(sqlApi,[zoneId],{},'api');
      const normalize=(x:any)=>({...x,generatedAt:'2026-10-31T00:00:00.000Z',zones:x.zones.map((z:any)=>({...z,analysis:cleanAnalysis(z.analysis)}))});
      assert.deepEqual(normalize(pg),normalize(sql));
      for(const language of ['ru','kk']){
        assert.deepEqual(memoBlocks(normalize(pg),language),memoBlocks(normalize(sql),language));
        const bytes=buildMemoDocx(normalize(pg),language),files=unzipSync(bytes),xml=strFromU8(files['word/document.xml']!);
        assert(xml.includes(zoneId));assert(xml.includes('w:tbl'));assert(xml.length>10000);
        writeFileSync(join(dir,`http-memo-${language}.docx`),bytes);
      }
      const context=await api.siteContext(zoneId,50);
      const scene=(m:any)=>buildGrowthScene(m.zones[0].site,m.zones[0].analysis,new Map(m.species.map((s:any)=>[s.id,s])),streetLines(context.roads));
      const pgScene=scene(pg),sqlScene=scene(sql);assert(pgScene&&pgScene.total>0);
      for(const year of [0,5,10,20])assert.deepEqual(growthFrame(pgScene,year),growthFrame(sqlScene,year));
    });
    await step('read-only viewer and worker/foreman restrictions; CSRF retained for calculations',async()=>{
      await api.login('viewer',password);
      assert.equal((await api.site(zoneId)).id,zoneId);assert((await api.zoneAnalysis(zoneId,{})).scheme.length);
      assert.deepEqual((await raw.request('GET','/analysis-snapshots/'+snapshotId)).data,snapshot);
      await assert.rejects(raw.request('POST',`/zones/${zoneId}/snapshots`,{body:{options:{}},idempotencyKey:'viewer-deny'}),{status:403});
      await assert.rejects(api.patchRate({key:'price.tree',value:1,source:'DEMO test',expectedVersion:1}),{status:403});
      const noCsrf=await fetch(base+`/zones/${zoneId}/analysis`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"options":{}}'});
      assert.equal(noCsrf.status,403);assert.equal((await noCsrf.json() as any).error.code,'CSRF_REQUIRED');
      for(const role of ['worker','foreman']){
        await api.login(role,password);await assert.rejects(api.zoneAnalysis(zoneId,{}),{status:403});
        await assert.rejects(api.sites(),{status:403});
      }
      await api.login('admin',password);
    });
    await step('rate changes, nulls, optimistic versions, replay, rollback and calculation invalidation',async()=>{
      const rates=await api.rates(),rate=rates.rates.find((r:any)=>r.value!==null&&r.value>0&&r.unit!=='доля'&&!r.unit.includes('%'));
      const body={key:rate.key,value:rate.value+1,source:'Synthetic Stage A test; not observed',expectedVersion:rates.version};
      const changed=await raw.request('PATCH','/rates',{body,idempotencyKey:'rates-change'});assert.equal(changed.data.version,2);
      assert.deepEqual(await raw.request('PATCH','/rates',{body,idempotencyKey:'rates-change'}),changed);
      await assert.rejects(raw.request('PATCH','/rates',{body,idempotencyKey:'rates-stale'}),{status:409,code:'VERSION_CONFLICT'});
      assert.notEqual((await api.zoneAnalysis(zoneId,{})).provenance.inputHash,snapshot.provenance.inputHash);
      await db.pool.query("ALTER TABLE gp_cloud.planning_history ADD CONSTRAINT qa_reject_history CHECK(action<>'update') NOT VALID");
      try{await assert.rejects(raw.request('PATCH','/rates',{body:{...body,expectedVersion:2},idempotencyKey:'rate-rollback'}),{status:503});}
      finally{await db.pool.query('ALTER TABLE gp_cloud.planning_history DROP CONSTRAINT qa_reject_history');}
      assert.equal((await api.rates()).version,2);assert.equal((await db.pool.query("SELECT count(*)::int n FROM gp_cloud.idempotency WHERE key='rate-rollback'")).rows[0].n,0);
      await api.patchRate({...body,value:null,expectedVersion:2});
      await assert.rejects(api.zoneAnalysis(zoneId,{}),{status:422,code:'missing_rates'});
      assert.equal((await api.rates()).rates.find((r:any)=>r.key===rate.key).value,null);
      await api.patchRate({...body,expectedVersion:3});
      assert.deepEqual((await raw.request('GET','/analysis-snapshots/'+snapshotId)).data,snapshot);
    });
    await step('both backend and native PostgreSQL restart; repeat seed never overwrites snapshots, versions or passwords',async()=>{
      const tables=['planning_documents','zone_contexts','analysis_snapshots','planning_history','documents','idempotency'];
      const persisted=async()=>Object.fromEntries(await Promise.all(tables.map(async name=>[name,(await db.pool.query(`SELECT to_jsonb(t) data FROM gp_cloud.${name} t ORDER BY to_jsonb(t)::text`)).rows])));
      const before=await persisted(),rates=await api.rates(),beforeAnalysis=await api.zoneAnalysis(zoneId,{});
      const accounts=JSON.stringify((await db.pool.query('SELECT * FROM gp_cloud.users ORDER BY id')).rows);
      await stopBackend();await db.close();await cluster.stop();started=false;await cluster.start();started=true;
      db=new PostgresDatabase({connectionString,ssl:false});await migrate(db);await seedCloudDemo(db,randomBytes(24).toString('hex'));await seedCloudPlanning(db);await seedCloudPlanning(db);
      await startBackend();assert.equal((await api.me()).role,'admin');
      assert.deepEqual(await api.rates(),rates);assert.deepEqual(cleanAnalysis(await api.zoneAnalysis(zoneId,{})),cleanAnalysis(beforeAnalysis));
      assert.deepEqual((await raw.request('GET','/analysis-snapshots/'+snapshotId)).data,snapshot);assert.deepEqual(await persisted(),before);
      assert(JSON.stringify((await db.pool.query('SELECT * FROM gp_cloud.users ORDER BY id')).rows)===accounts,'Seed changed passwords or accounts');
      await api.login('admin',password); // Old password still works; never print it or its hash.
      writeFileSync(join(dir,'persistence-evidence.json'),JSON.stringify({tables:tables.map(name=>({name,rows:before[name].length,sha256:createHash('sha256').update(JSON.stringify(before[name])).digest('hex')})),zoneId,snapshotId,restart:'backend + native PostgreSQL',repeatSeed:'unchanged',demo:true},null,2));
    });
    await step('database outage cannot serve cached analyses',async()=>{
      await db.close();await cluster.stop();started=false;
      await assert.rejects(api.zoneAnalysis(zoneId,{}),{status:503,code:'database_unavailable'});
      await cluster.start();started=true;db=new PostgresDatabase({connectionString,ssl:false});
      assert((await api.zoneAnalysis(zoneId,{})).cost.total>0);
    });
    writeFileSync(join(dir,'http-trace.json'),JSON.stringify(trace,null,2));
    t.diagnostic('Retained isolated evidence (no secrets): '+dir);
  } finally {
    globalThis.fetch=nativeFetch;await stopBackend();sqliteServer.closeAllConnections();await new Promise<void>(r=>sqliteServer.close(()=>r()));sqlite.close();if(!db.pool.ended)await db.close();if(started)await cluster.stop();
  }
});
