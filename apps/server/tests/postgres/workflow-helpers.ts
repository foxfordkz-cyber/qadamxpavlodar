import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { randomBytes,createHash } from 'node:crypto';
import { mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { spawn,type ChildProcess } from 'node:child_process';
import EmbeddedPostgres from 'embedded-postgres';
import { PostgresDatabase } from '../../src/cloud/database.js';
import { migrate } from '../../src/cloud/migrations.js';
import { seedCloudDemo } from '../../src/cloud/seed.js';
import { seedCloudPlanning } from '../../src/cloud/planning-seed.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
export async function freePort(){const server=createServer().listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as {port:number}).port;await new Promise<void>(done=>server.close(()=>done()));return port;}
export async function postgresFixture(t:TestContext){
 const dir=mkdtempSync(join(tmpdir(),'gp-cloud-workflow-')),pgPort=await freePort(),port=await freePort();
 const password=randomBytes(24).toString('hex'),dbPassword=randomBytes(24).toString('hex');
 const cluster=new EmbeddedPostgres({databaseDir:join(dir,'postgres'),port:pgPort,user:'postgres',password:dbPassword,authMethod:'scram-sha-256',persistent:true,createPostgresUser:false,autoRehydrateSymlinks:true,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
 const connectionString=`postgresql://postgres:${dbPassword}@127.0.0.1:${pgPort}/postgres`,base=`http://127.0.0.1:${port}/api/v1`;
 let db=new PostgresDatabase({connectionString,ssl:false}),child:ChildProcess|undefined,started=false,sequence=0;
 const sessions=new Map<string,{cookie:string;csrf:string}>();
 const ajv=new Ajv2020({strict:false,validateFormats:false}),validators=new Map<string,ReturnType<typeof ajv.compile>>();let spec:any;const trace:{method:string;path:string;role:string;status:number}[]=[];
 async function stop(){if(child&&child.exitCode===null){const end=once(child,'exit');child.kill();await end;}child=undefined;}
 async function start(extra:Record<string,string>={}){
   child=spawn(process.execPath,['--import','./scripts/local-network-guard.mjs','--import','tsx','dist/cloud/server.js'],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,DATABASE_URL:connectionString,CLOUD_LOCAL_TEST:'1',PORT:String(port),ALLOWED_HOSTS:'127.0.0.1',FRONTEND_ORIGINS:`http://127.0.0.1:${port}`,...extra}});child.stderr?.resume();
   for(let i=0;i<250;i++){if(child.exitCode!==null)throw Error('Compiled cloud backend exited (configuration redacted)');try{if((await fetch(base+'/ready')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Backend readiness timeout');
 }
 t.after(async()=>{writeFileSync(join(dir,'http-trace.json'),JSON.stringify(trace,null,2));t.diagnostic('Retained isolated evidence: '+dir);await stop();await db.close();if(started)await cluster.stop();});
 await cluster.initialise();await cluster.start();started=true;await migrate(db);await seedCloudDemo(db,password);await seedCloudPlanning(db);await start();
 spec=await (await fetch(base+'/openapi.json')).json();
 function validate(path:string,method:string,status:number,body:any){
   const found=Object.entries(spec.paths).find(([p])=>new RegExp('^'+p.replace(/\{id\}/g,'[^/]+')+'$').test(path.split('?')[0]!));assert(found,`Undocumented ${method} ${path}`);
   const schema=(found[1] as any)[method.toLowerCase()]?.responses[status]?.content?.['application/json']?.schema;assert(schema,`Undocumented ${method} ${path} ${status}`);
   const key=found[0]+method+status;if(!validators.has(key))validators.set(key,ajv.compile({...schema,components:spec.components}));const v=validators.get(key)!;assert(v(body),`${key}: ${JSON.stringify(v.errors)}`);
 }
 async function login(role:string){
   const response=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:role,password})});assert.equal(response.status,200,'Login role '+role);
   const b=await response.json() as any;const session={cookie:response.headers.get('set-cookie')!.split(';')[0]!,csrf:b.data.csrfToken};sessions.set(role,session);return session;
 }
 async function request(path:string,method='GET',role='coordinator',body?:unknown,key=`workflow-${++sequence}`,csrf=true){
   const session=sessions.get(role)??await login(role);
   const res=await fetch(base+path,{method,headers:{Cookie:session.cookie,...(csrf?{'X-CSRF-Token':session.csrf}:{}),'Idempotency-Key':key,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
   const json=await res.json() as any;trace.push({method,path,role,status:res.status});validate(path,method,res.status,json);return {status:res.status,body:json,replayed:res.headers.get('Idempotency-Replayed')};
 }
 async function ok(path:string,method='GET',role='coordinator',body?:unknown,status=200,key?:string){const r=await request(path,method,role,body,key);assert.equal(r.status,status,`${method} ${path}: ${r.body.error?.code??''}`);return r.body.data;}
 async function restart(extra:Record<string,string>={}){await stop();await db.close();await cluster.stop();started=false;await cluster.start();started=true;db=new PostgresDatabase({connectionString,ssl:false});await migrate(db);await start(extra);}
 async function snapshot(tables:string[]){const out:Record<string,{count:number;sha256:string}>={};for(const table of tables){assert(/^[a-z_]+$/.test(table));const rows=(await db.pool.query(`SELECT * FROM gp_cloud.${table}`)).rows.map(r=>JSON.stringify(r)).sort();out[table]={count:rows.length,sha256:createHash('sha256').update(rows.join('\n')).digest('hex')};}return out;}
 async function reseed(){await seedCloudDemo(db,randomBytes(24).toString('hex'));await seedCloudPlanning(db);}
 async function createUser(loginName:string,role:string,profile?:unknown){return ok('/users','POST','admin',{login:loginName,displayName:'Synthetic DEMO '+loginName,role,password,...(profile?{profile}:{})},201);}
 async function isolatedDatabase(name:string){assert(/^qa_[a-z_]+$/.test(name));await db.pool.query('CREATE DATABASE '+name);const url=new URL(connectionString);url.pathname='/'+name;return new PostgresDatabase({connectionString:url.toString(),ssl:false});}
 return {isolatedDatabase,get db(){return db;},dir,base,request,ok,login,sessions,start,stop,restart,reseed,snapshot,createUser,spec};
}
