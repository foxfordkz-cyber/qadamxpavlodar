import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Store} from '../src/db.js';
import {schema} from '../src/schema.js';
import {migration2} from '../src/migrations.js';
import {migration3,migration4 as tz4} from '../src/v2/migration.js';
import {migration4 as municipal4} from '../src/municipal/migration.js';
import {seedV2,DEMO_PASSWORD} from '../src/v2/seed.js';
import {hashPassword} from '../src/v2/auth.js';
import {getUser} from '../src/v2/core.js';
import {rates} from '../src/municipal/data.js';

for(const fork of ['municipal','tz'] as const)test(`Merge migration: ${fork} schema 4 retains sessions, reports, replay, rates and prior account identity`,async t=>{
  const dir=mkdtempSync(join(tmpdir(),'green-pavlodar-merge-')),path=join(dir,'existing.sqlite');
  const old=new DatabaseSync(path);let current:Store|undefined;
  t.after(()=>{try{old.close();}catch{}current?.close();assert(resolve(dir).startsWith(resolve(tmpdir())+sep)&&dir.includes('green-pavlodar-merge-'));rmSync(dir,{recursive:true,force:true});});
  old.exec(schema+migration2+migration3+(fork==='municipal'?municipal4:tz4)+'PRAGMA user_version=4;');
  const passwordHash=await hashPassword(DEMO_PASSWORD);
  old.prepare('INSERT INTO v2_users VALUES (?,?,?,?,1,?,7,?,?)').run('existing-viewer','viewer','Existing identity',fork==='municipal'?'coordinator':'viewer',passwordHash,'2026-01-01','2026-01-01');
  old.exec(`INSERT INTO v2_sessions VALUES ('existing-session','existing-viewer','existing-csrf','2026-01-01','2999-01-01');
    INSERT INTO v2_tasks VALUES ('old-task','submitted',NULL,NULL,NULL,5,'{"id":"old-task","version":5,"status":"submitted"}');
    INSERT INTO v2_reports VALUES ('old-report','old-task',1,'existing-viewer','pending',1,'{"id":"old-report","taskId":"old-task","note":"keep original report"}');
    INSERT INTO v2_idempotency VALUES ('existing-viewer','POST','/original','stable-key','original-hash',201,'{"data":{"id":"old-report"}}','2026-01-01');`);
  const rate={key:'price.tree',value:12345,source:'Previously saved source',unit:'KZT',dataClass:'estimate'};
  if(fork==='municipal'){
    old.exec("INSERT INTO municipal_roles VALUES ('existing-viewer','viewer');");
    old.prepare('INSERT INTO municipal_state VALUES (?, ?, 7)').run('rates',JSON.stringify([rate]));
    old.exec(`INSERT INTO municipal_imports VALUES ('existing-import','existing-viewer','{"committed":true}','2026','2999','2026');
      INSERT INTO municipal_features VALUES ('existing-feature','zones','existing-fingerprint','{"geometry":{"type":"Point","coordinates":[76.95,52.28]}}','existing-import');
      INSERT INTO municipal_analyses VALUES ('existing-calculation','old-zone','existing-viewer','input-hash','{"cost":{"total":12345}}','2026');`);
  }else{
    old.prepare('INSERT INTO tz_rates VALUES (?,0,?)').run(rate.key,JSON.stringify(rate));
    old.prepare('INSERT INTO tz_rate_history VALUES (7,?,?,?,?,?)').run(rate.key,'existing-viewer',JSON.stringify({...rate,value:100}),JSON.stringify(rate),'2026');
  }
  const tables=old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>String(r.name));
  const original=new Map(tables.map(name=>[name,JSON.stringify(old.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all())]));old.close();
  current=new Store(path);assert.equal(current.get('PRAGMA user_version')?.user_version,5);
  for(const [name,rows] of original)assert.equal(JSON.stringify(current.all(`SELECT * FROM "${name}" ORDER BY rowid`)),rows,`${name} must survive migration unchanged`);
  assert.equal(getUser(current,'existing-viewer').role,'viewer');assert.equal(rates(current).version,7);assert.equal(rates(current).rates[0]!.value,12345);
  for(const name of ['tz_species','tz_rates','tz_rate_history','tz_assistant_history','municipal_state','municipal_imports','municipal_features','municipal_analyses','municipal_roles'])assert(current.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?",name));
  await seedV2(current);assert.equal(current.get("SELECT id FROM v2_users WHERE login='viewer'")?.id,'existing-viewer');assert.equal(current.get("SELECT password_hash FROM v2_users WHERE id='existing-viewer'")?.password_hash,passwordHash);
  assert.equal(current.get("SELECT data FROM v2_reports WHERE id='old-report'")?.data,JSON.parse(original.get('v2_reports')!)[0].data);
  assert.deepEqual(current.all('PRAGMA foreign_key_check'),[]);assert.equal(current.get('PRAGMA integrity_check')?.integrity_check,'ok');
  current.close();current=new Store(path);assert.equal(current.get('PRAGMA user_version')?.user_version,5);assert.equal(current.get('SELECT count(*) n FROM v2_sessions')?.n,1);
  assert.equal(current.get('SELECT response_json FROM v2_idempotency')?.response_json,'{"data":{"id":"old-report"}}');
});
