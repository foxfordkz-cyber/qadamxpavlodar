import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedV2, DEMO_PASSWORD } from '../src/v2/seed.js';
import { seedTz } from '../src/tz/seed.js';
import { seedMunicipal } from '../src/municipal/data.js';

function seedCli(root:string,envFile?:string){
 const env={...process.env,STORAGE_ROOT:root,DB_PATH:join(root,'db/green-pavlodar.sqlite'),UPLOADS_PATH:join(root,'uploads'),LLM_API_KEY:'',LLM2_API_KEY:''};
 delete (env as NodeJS.ProcessEnv).DEMO_PASSWORD;
 return execFileSync(process.execPath,[...(envFile?['--env-file='+envFile]:[]),'--import','./scripts/local-network-guard.mjs','--import','tsx','src/tz/seed-cli.ts'],{env,encoding:'utf8',stdio:'pipe'});
}

test('deployment Case A local equivalent: no env file, random credentials stay private and repeat seed preserves them',()=>{
 const root=mkdtempSync(join(tmpdir(),'gp-no-env-'));
 const output=seedCli(root);
 assert(!/demo-[A-Za-z0-9_-]{12}|scrypt32768\$/.test(output),'Seed must not print generated passwords or hashes');
 let store=new Store(join(root,'db/green-pavlodar.sqlite'));
 const before=store.all('SELECT * FROM v2_users ORDER BY id');assert.equal(before.length,10); // Nine V2 users plus TZ specialist alias.
 assert(before.every(row=>String(row.password_hash).startsWith('scrypt32768$')));store.close();
 seedCli(root);store=new Store(join(root,'db/green-pavlodar.sqlite'));
 try{assert.deepEqual(store.all('SELECT * FROM v2_users ORDER BY id'),before);}finally{store.close();}
});

test('deployment Case B local equivalent: private env password, real login/cookie/CSRF and persistent session',async()=>{
 const root=mkdtempSync(join(tmpdir(),'gp-private-env-')),file=join(root,'.env'),password=randomBytes(24).toString('base64url');
 writeFileSync(file,`DEMO_PASSWORD=${password}\n`,{mode:0o600});
 const output=seedCli(root,file);assert(!output.includes(password));assert(!output.includes('scrypt32768$'));
 const path=join(root,'db/green-pavlodar.sqlite');let store=new Store(path);
 let server=createApp(store,{uploadsPath:join(root,'uploads')}).listen(0,'127.0.0.1');await once(server,'listening');
 const base=()=>`http://127.0.0.1:${(server.address() as any).port}`;
 try{
  let cookie='',csrf='';
  for(const login of ['admin','coordinator','viewer']){
   const r=await fetch(base()+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login,password})});
   assert.equal(r.status,200);const raw=r.headers.get('set-cookie')!;assert.match(raw,/HttpOnly/i);assert.match(raw,/SameSite=Strict/i);
   cookie=raw.split(';')[0]!;csrf=(await r.json()).data.csrfToken;
  }
  const headers={Cookie:cookie,'Content-Type':'application/json'};
  assert.equal((await fetch(base()+'/api/v1/auth/logout',{method:'POST',headers,body:'{}'})).status,403);
  server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));store.close();
  seedCli(root,file);store=new Store(path);server=createApp(store,{uploadsPath:join(root,'uploads')}).listen(0,'127.0.0.1');await once(server,'listening');
  assert.equal((await fetch(base()+'/api/v1/auth/me',{headers})).status,200);
  assert.equal((await fetch(base()+'/api/v1/auth/logout',{method:'POST',headers:{...headers,'X-CSRF-Token':csrf},body:'{}'})).status,200);
  assert.equal((await fetch(base()+'/api/v1/auth/me',{headers})).status,401);
 }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));store.close();}
});

test('deployment: all roles, CSRF, repeat seed, real HTTP restart/session persistence and logout',async()=>{
 const root=mkdtempSync(join(tmpdir(),'gp-deploy-'));const path=join(root,'db/green-pavlodar.sqlite');
 let store=new Store(path);await seedV2(store);seedTz(store);await seedMunicipal(store);
 let server=createApp(store,{uploadsPath:join(root,'uploads')}).listen(0,'127.0.0.1');await once(server,'listening');
 const base=()=>`http://127.0.0.1:${(server.address() as any).port}`;
 const sessions:Record<string,{cookie:string;csrf:string}>={};
 try{
  for(const login of ['admin','coordinator','viewer','foreman1','worker1']){
   const r=await fetch(base()+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login,password:DEMO_PASSWORD})});
   assert.equal(r.status,200);const b=await r.json();sessions[login]={cookie:r.headers.get('set-cookie')!.split(';')[0]!,csrf:b.data.csrfToken};
  }
  const request=(path:string,method='GET',csrf=true)=>fetch(base()+path,{method,headers:{Cookie:sessions.coordinator!.cookie,...(method==='POST'?{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':sessions.coordinator!.csrf}:{})}:{})},body:method==='POST'?'{}':undefined});
  assert.equal((await request('/health')).status,200);
  assert.equal((await request('/api/v1/auth/logout','POST',false)).status,403);
  const before=store.all('SELECT * FROM v2_users ORDER BY id');const docs=store.all('SELECT * FROM v2_documents ORDER BY kind,id');
  await seedV2(store);seedTz(store);await seedMunicipal(store);
  assert.deepEqual(store.all('SELECT * FROM v2_users ORDER BY id'),before);assert.deepEqual(store.all('SELECT * FROM v2_documents ORDER BY kind,id'),docs);
  server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));store.close();
  store=new Store(path);server=createApp(store,{uploadsPath:join(root,'uploads')}).listen(0,'127.0.0.1');await once(server,'listening');
  assert.equal((await request('/api/v1/auth/me')).status,200);
  assert.equal((await request('/api/v1/auth/logout','POST')).status,200);
  assert.equal((await request('/api/v1/auth/me')).status,401);
 }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));store.close();}
});

test('deployment: SQLite WAL backup and disposable restore retain committed data and files',()=>{
 const root=mkdtempSync(join(tmpdir(),'gp-backup-')),storage=join(root,'storage'),backup=join(root,'backup'),restored=join(root,'restored');
 const s=new Store(join(storage,'db/green-pavlodar.sqlite'));
 s.db.exec('CREATE TABLE backup_probe(value TEXT); INSERT INTO backup_probe VALUES (\'durable\')');s.close();
 mkdirSync(join(storage,'uploads'),{recursive:true});writeFileSync(join(storage,'uploads','test.txt'),'synthetic upload persistence probe');
 execFileSync(process.execPath,['scripts/backup.mjs',storage,backup],{stdio:'pipe'});
 mkdirSync(join(restored,'db'),{recursive:true});cpSync(join(backup,'green-pavlodar.sqlite'),join(restored,'db/green-pavlodar.sqlite'));
 cpSync(join(backup,'uploads'),join(restored,'uploads'),{recursive:true});
 const copy=new Store(join(restored,'db/green-pavlodar.sqlite'));
 try{assert.equal(copy.get('SELECT value FROM backup_probe')?.value,'durable');assert.deepEqual(copy.all('PRAGMA foreign_key_check'),[]);assert.equal(copy.get('PRAGMA integrity_check')?.integrity_check,'ok');}finally{copy.close();}
 assert.equal(readFileSync(join(restored,'uploads/test.txt'),'utf8'),'synthetic upload persistence probe');
 assert.throws(()=>execFileSync(process.execPath,['scripts/backup.mjs',storage,backup],{stdio:'pipe'}));
});
