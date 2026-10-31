import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {chromium,expect} from '@playwright/test';
const here=fileURLToPath(new URL('.',import.meta.url)), root=resolve(here,'../../../..');
const project=`gp-aidana-qa-${Date.now()}`, port=18083, base=`http://localhost:${port}`;
const password=randomBytes(32).toString('hex'), secrets=[password];
const env={...process.env,DEMO_PASSWORD:password,WEB_PORT:String(port),FRONTEND_ORIGINS:base+',http://127.0.0.1:'+port};
const compose=['compose','-p',project,'-f','docker-compose.yml','-f','tools/e2e/test-results/docker-qa/compose.override.json'];
const report={kind:'independent-isolated-docker',startedAt:new Date().toISOString(),applicationBase:'98cf6c68d5370331d6f95aa9e749f82d504e5670',testSHA:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).stdout.trim(),appsTree:spawnSync('git',['rev-parse','HEAD:apps'],{cwd:root,encoding:'utf8',windowsHide:true}).stdout.trim(),project,port,baseURL:base,volume:project+'_gp-data',checks:[],commands:[],limitations:['Local Docker HTTP through nginx; not public HTTPS or cloud storage.','All records and images are explicitly synthetic/demo.','No native Microsoft Word opening is claimed.']};
assert.equal(report.appsTree,'16454d07e3b76df4bf7b0bc86933f52acd394ad0');
const clean=s=>secrets.reduce((v,key)=>v.split(key).join('[redacted]'),String(s));
function save(){writeFileSync(join(here,'result.json'),JSON.stringify(report,null,2));}
function digest(data){return createHash('sha256').update(Buffer.isBuffer(data)?data:JSON.stringify(data)).digest('hex');}
async function command(args,{input='',label=args.slice(0,3).join(' ')}={}){
  return new Promise((resolve,reject)=>{const child=spawn('docker',args,{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
    child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',()=>reject(new Error('Docker command could not start: '+label)));
    child.on('exit',code=>{report.commands.push({command:label,exitCode:code,at:new Date().toISOString()});save();if(code!==0){writeFileSync(join(here,'command-failure.log'),clean(out+'\n'+err));reject(new Error('Docker command failed: '+label+'; see sanitized command-failure.log'));}else resolve(clean(out).trim());});child.stdin.end(input);
  });
}
const dc=(args,options)=>command([...compose,...args],options);
async function ready(){for(let i=0;i<120;i++){try{if((await fetch(base+'/health',{signal:AbortSignal.timeout(2500)})).ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw new Error('Isolated Docker health failed within 60 seconds');}
async function check(name,run){console.log('Docker QA: '+name);const start=Date.now();try{const details=await run();report.checks.push({name,status:'passed',durationMs:Date.now()-start,...(details?{details}:{})});save();return details;}catch(e){report.checks.push({name,status:'failed',durationMs:Date.now()-start,reason:clean(e.message).slice(0,1800)});save();throw e;}}
const sessions=new Map();let sequence=0,browser;
async function login(user){const r=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({login:user,password}),signal:AbortSignal.timeout(10000)});assert.equal(r.status,200,'Login '+user);const b=await r.json(),cookie=r.headers.get('set-cookie');assert(cookie?.includes('HttpOnly'));assert(cookie?.includes('SameSite=Strict'));const ss={cookie:cookie.split(';')[0],csrf:b.data.csrfToken};secrets.push(ss.cookie,ss.csrf);sessions.set(user,ss);return b.data.user.role;}
async function call(path,method='GET',body,user='coordinator',key=`aidana-${++sequence}`,csrf=true){const auth=sessions.get(user);assert(auth,'Missing in-memory session');const r=await fetch(base+'/api/v1'+path,{method,headers:{Cookie:auth.cookie,Origin:base,...(csrf?{'X-CSRF-Token':auth.csrf}:{}),'Idempotency-Key':key,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const data=r.headers.get('content-type')?.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer());return{status:r.status,body:data,replay:r.headers.get('idempotency-replayed')};}
async function ok(path,method='GET',body,user='coordinator',status=200,key){const r=await call(path,method,body,user,key);assert.equal(r.status,status,method+' '+path+': '+(r.body?.error?.code??''));return r.body.data;}
async function containerCode(code,input=''){return dc(['exec','-T','server','node','--import','tsx','--input-type=module','-e',code],{input,label:'compose exec server node [QA fixture/read-only hash program]'});}
const tables=['v2_tasks','v2_reports','v2_uploads','v2_report_drafts','v2_history','v2_documents','v2_crews','v2_memberships','v2_users','v2_profiles','v2_idempotency','outcome_snapshots','outcome_cohorts','outcome_members','outcome_inspections','outcome_sources'];
async function fingerprint(){return JSON.parse(await containerCode(`import {DatabaseSync} from 'node:sqlite';import {createHash} from 'node:crypto';const db=new DatabaseSync('/data/db/green-pavlodar.sqlite',{readOnly:true});const tables=${JSON.stringify(tables)};const data=Object.fromEntries(tables.map(t=>{const rows=db.prepare('SELECT * FROM '+t).all().map(r=>JSON.stringify(r)).sort();return[t,{count:rows.length,sha256:createHash('sha256').update(rows.join('\\n')).digest('hex')}]}));const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;const foreignKeys=db.prepare('PRAGMA foreign_key_check').all();db.close();console.log(JSON.stringify({tables:data,integrity,foreignKeyFailures:foreignKeys.length}));`));}
async function context(user,width=1280,lang='ru'){const ss=sessions.get(user),[name,...value]=ss.cookie.split('=');const c=await browser.newContext({viewport:{width,height:812},locale:'ru-RU',timezoneId:'Asia/Qyzylorda'});await c.addCookies([{name,value:value.join('='),domain:'localhost',path:'/api/v1',httpOnly:true,sameSite:'Strict'}]);const p=await c.newPage();p.setDefaultTimeout(12000);p.setDefaultNavigationTimeout(30000);return{c,p};}
const siteId='site-osm-1569993037',cohortId='aidana-docker-cohort',forecastId='aidana-docker-forecast',inspectionId='aidana-docker-inspection';
let task,reportRecord,photoId,forecast,cohort,summary,photoHash,photoBytes,savedReads,baseline;
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
// The canonical demo worker is available on this seeded Wednesday, not Saturday 31.10.
const taskDay='2026-10-28';
try{
  await check('isolated deployment identity and health',async()=>{
    const running=await command(['ps','--format','{{.Names}} {{.Ports}}'],{label:'docker ps names/ports only'});
    assert(!running.includes('18083->'),'QA port must be unused');
    const volumes=await command(['volume','ls','--format','{{.Name}}'],{label:'docker volume ls names only'});
    assert(!volumes.split(/\r?\n/).includes(report.volume),'QA volume must not already exist');
    await dc(['up','-d','--no-build'],{label:'compose -p '+project+' up -d --no-build'});await ready();
    report.images=JSON.parse(await command(['image','inspect','gp-aidana-qa-20261031-web','gp-aidana-qa-20261031-server','--format','{{json .Id}}'],{label:'docker image inspect [Id only]'}).then(s=>'['+s.split(/\r?\n/).join(',')+']'));
    report.dockerEngine=await command(['version','--format','{{.Server.Version}}'],{label:'docker version server only'});
    return{health:200,newVolume:report.volume,existing8080Untouched:true};
  });
  await check('image source provenance',async()=>{
    const paths=['apps/web/src/shared/analytics/decisionLab.ts','apps/server/src/outcomes/service.ts','apps/server/src/v2/report-routes.ts','apps/server/src/tz/seed-cli.ts'];
    const sourceHashes=Object.fromEntries(paths.map(p=>[p,digest(readFileSync(join(root,p)))]));
    const checked=JSON.parse(await containerCode(`import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(paths)}.map(p=>[p,createHash('sha256').update(readFileSync('/app/'+p)).digest('hex')]))));`));
    assert.deepEqual(checked,sourceHashes);return sourceHashes;
  });
  await check('opt-in synthetic Outcomes seed',async()=>{const output=await dc(['exec','-T','server','node','--import','./scripts/local-network-guard.mjs','--import','tsx','src/outcomes/seed-cli.ts'],{label:'compose exec server seed:outcomes'});const s=JSON.parse(output);assert.equal(s.created,true);assert.equal(s.trees,32);return{created:true,trees:32};});
  await check('five real roles authenticate through nginx',async()=>{const roles={};for(const u of ['admin','coordinator','viewer','worker1','foreman1'])roles[u]=await login(u);assert.deepEqual(Object.values(roles),['admin','coordinator','viewer','worker','foreman']);return{roles:Object.values(roles),httpOnly:true,sameSite:'Strict',passwordPersistedToFiles:false};});
  await check('snapshot and cohort from 32 canonical synthetic registry trees',async()=>{
    const site=await ok('/sites/'+siteId);assert.equal(site.name,'Газон, улица Толстого');
    forecast=await ok('/outcomes/snapshots','POST',{id:forecastId,siteId,expectedVersion:site.version,variant:'econom'},'coordinator',201);
    const plants=[];for(const item of forecast.snapshot.analysis.scheme)for(let n=0;n<item.quantity;n++)plants.push({id:'aidana-docker-tree-'+(plants.length+1),name:'QA DEMO Docker synthetic tree',kind:'tree',siteId,speciesId:item.speciesId,species:forecast.snapshot.catalog.find(s=>s.id===item.speciesId).latin,plantedAt:new Date().toISOString(),condition:'unknown',lat:52.2726,lng:76.9695,evidenceIds:['demo-v2-evidence'],isDemo:true,version:1});
    assert.equal(plants.length,32,'Fixed demo control cohort must have 32 plants');
    await containerCode(`import {readFileSync} from 'node:fs';import {Store} from './src/db.ts';import {insertDoc} from './src/v2/core.ts';if(process.env.STORAGE_ROOT!=='/data')throw Error('Unexpected QA storage');const rows=JSON.parse(readFileSync(0,'utf8'));if(rows.length!==32||rows.some(p=>!p.id.startsWith('aidana-docker-tree-')||p.isDemo!==true))throw Error('Not QA fixture');const s=new Store('/data/db/green-pavlodar.sqlite');try{s.transaction(()=>{for(const row of rows)insertDoc(s,'plant',row)});console.log(JSON.stringify({inserted:rows.length,synthetic:true}));}finally{s.close()}`,JSON.stringify(plants));
    cohort=await ok('/outcomes/cohorts','POST',{id:cohortId,siteId,plantIds:plants.map(p=>p.id),plantedOn:today,snapshotId:forecastId,evidenceIds:['demo-v2-evidence'],expectedVersion:0},'coordinator',201);
    assert.equal(cohort.plants.length,32);assert.equal(cohort.provenance.isDemo,true);report.forecastHash=digest(forecast.snapshot);return{siteId,siteName:site.name,cohortId,forecastId,plants:32,provenance:'demo'};
  });
  await check('task assignment and worker start through real API',async()=>{
    task=await ok('/tasks','POST',{objectType:'plant',objectId:'aidana-docker-tree-1',action:'inspect',description:'QA DEMO Docker inspection; synthetic, not field evidence',estimatedMinutes:30,minWorkers:1,requiredSkills:['inspect'],evidenceIds:['demo-v2-evidence']},'coordinator',201);
    task=await ok('/tasks/'+task.id+'/assign','POST',{expectedVersion:task.version,crewId:'demo-crew-1',scheduledStart:taskDay+'T04:00:00Z',scheduledEnd:taskDay+'T04:30:00Z',resourceIds:[]});
    task=await ok('/tasks/'+task.id+'/assign-workers','POST',{expectedVersion:task.version,workerIds:['demo-worker-1']},'foreman1');
    task=await ok('/tasks/'+task.id+'/start','POST',{expectedVersion:task.version},'worker1');assert.equal(task.status,'in_progress');return{taskId:task.id,status:task.status};
  });
  browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
  await check('worker browser uploads synthetic photo and submits report through nginx',async()=>{
    const{c,p}=await context('worker1',375);try{
      await p.goto(base+'/?source=api#/worker',{waitUntil:'domcontentloaded'});const cabinet=p.locator('green-worker');await expect(cabinet).toBeVisible();await expect(cabinet.locator('.date-tools button[data-action=refresh]')).toBeEnabled();
      await cabinet.locator('#shift-date').fill(taskDay);await cabinet.locator('#shift-date').press('Tab');await cabinet.locator(`[data-action=select][data-id="${task.id}"]`).click();await cabinet.getByRole('button',{name:'Отчитаться',exact:true}).click();
      const png=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=96;c.height=64;const x=c.getContext('2d');x.fillStyle='#cfe9d8';x.fillRect(0,0,96,64);x.fillStyle='#184c30';x.font='14px sans-serif';x.fillText('QA DEMO',10,36);return c.toDataURL('image/png').split(',')[1];});
      await cabinet.locator('input#photo').setInputFiles({name:'qa-docker-synthetic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await expect(cabinet.locator('.preview img')).toBeVisible();
      await cabinet.locator('textarea#note').fill('QA DEMO Docker synthetic observation; not actual field research');await expect(cabinet.locator('[data-save-status]')).toContainText('Сохранено на устройстве');
      const sending=p.waitForResponse(r=>r.url().endsWith('/tasks/'+task.id+'/reports')&&r.request().method()==='POST');await cabinet.getByRole('button',{name:'Отправить на проверку',exact:true}).click();const response=await sending;assert.equal(response.status(),201);const saved=(await response.json()).data;reportRecord=saved.report;task=saved.task;photoId=reportRecord.photoIds[0];assert.equal(reportRecord.photoIds.length,1);assert.equal(reportRecord.reviewStatus,'pending');
      await expect(cabinet.getByText('Отчёт сохранён. Ожидает проверки координатором.',{exact:true})).toBeVisible();await p.screenshot({path:join(here,'worker-submitted-375.png')});return{reportId:reportRecord.id,photoId,status:reportRecord.reviewStatus,browserWidth:375};
    }finally{await c.close();}
  });
  await check('coordinator acceptance, replay and linked inspection',async()=>{
    const review={expectedVersion:task.version,expectedReportVersion:reportRecord.version,decision:'accepted',comment:'QA DEMO accepted synthetic Docker report'};
    assert.equal((await call('/reports/'+reportRecord.id+'/review','POST',review,'coordinator','csrf-negative',false)).status,403);
    const accepted=await call('/reports/'+reportRecord.id+'/review','POST',review,'coordinator','aidana-accept-once');assert.equal(accepted.status,200);const replay=await call('/reports/'+reportRecord.id+'/review','POST',review,'coordinator','aidana-accept-once');assert.equal(replay.replay,'true');assert.deepEqual(replay.body,accepted.body);
    const inspectionBody={id:inspectionId,observedOn:today,expectedVersion:1,evidenceIds:['demo-v2-evidence'],observations:[{plantId:'aidana-docker-tree-1',state:'alive',reportId:reportRecord.id,evidenceIds:['demo-v2-evidence']}]};
    for(const u of ['viewer','worker1','foreman1'])assert.equal((await call('/outcomes/cohorts/'+cohortId+'/inspections','POST',inspectionBody,u)).status,403);
    const inspected=await ok('/outcomes/cohorts/'+cohortId+'/inspections','POST',inspectionBody,'coordinator',201,'aidana-inspect-once');assert.equal(inspected.provenance.isDemo,true);assert.equal((await call('/outcomes/cohorts/'+cohortId+'/inspections','POST',inspectionBody,'coordinator','aidana-inspect-once')).replay,'true');
    summary=await ok('/outcomes/cohorts/'+cohortId+'/summary?inspectionId='+inspectionId,'GET',undefined,'viewer');assert.equal(summary.summary.alive,1);assert.equal(summary.summary.dead,0);assert.equal(summary.summary.unknown,31);assert.equal(summary.summary.wholeCohortSurvivalPct,null);
    const links=JSON.parse(await containerCode(`import {DatabaseSync} from 'node:sqlite';const s=new DatabaseSync('/data/db/green-pavlodar.sqlite',{readOnly:true});const row=s.prepare('SELECT inspection_id,plant_id,report_id FROM outcome_sources WHERE inspection_id=?').get('${inspectionId}');s.close();console.log(JSON.stringify(row));`));assert.equal(links.report_id,reportRecord.id);assert.equal(links.plant_id,'aidana-docker-tree-1');
    return{reportId:reportRecord.id,inspectionId,reportLinked:true,acceptanceReplay:true,inspectionReplay:true,summary:summary.summary};
  });
  await check('viewer reads existing data and cannot mutate',async()=>{
    const paths=['/tasks?limit=200','/reports?limit=200','/crews','/workers','/tasks/'+task.id,'/reports/'+reportRecord.id,'/uploads/'+photoId,'/outcomes/cohorts/'+cohortId];for(const path of paths){const r=await call(path,'GET',undefined,'viewer');assert.equal(r.status,200,path);}
    const accepted=await ok('/reports/'+reportRecord.id,'GET',undefined,'viewer');assert.equal(accepted.reviewStatus,'accepted');assert.equal((await ok('/tasks/'+task.id,'GET',undefined,'viewer')).status,'verified');
    const bytes=await call('/uploads/'+photoId,'GET',undefined,'viewer');assert(Buffer.isBuffer(bytes.body));photoBytes=bytes.body.length;photoHash=digest(bytes.body);assert(photoBytes>0);
    const denied=[['/tasks',{objectType:'plant',objectId:'aidana-docker-tree-1',action:'inspect',description:'QA viewer forbidden',estimatedMinutes:15,evidenceIds:['demo-v2-evidence']}],['/crews',{name:'QA viewer forbidden',foremanId:'demo-foreman-1',resourceIds:[]}],['/reports/'+reportRecord.id+'/review',{expectedVersion:task.version,expectedReportVersion:reportRecord.version,decision:'accepted',comment:'forbidden'}]];
    const before=await fingerprint();for(const[path,body]of denied)assert.equal((await call(path,'POST',body,'viewer')).status,403,path);assert.deepEqual(await fingerprint(),before);
    return{readPaths:paths.length,rejectedWrites:denied.length,photoBytes,photoSha256:photoHash,businessStateUnchanged:true};
  });
  await check('saved forecast remains immutable after current price change',async()=>{
    const original=await ok('/outcomes/cohorts/'+cohortId),rates=await ok('/rates');const beforeHash=digest(original.forecast);const price=rates.rates.find(r=>r.key==='price.tree').value;assert.equal(typeof price,'number');
    await ok('/rates','PATCH',{key:'price.tree',value:price+1234,source:'QA DEMO isolated temporary rate',expectedVersion:rates.version},'admin');const changed=await ok('/outcomes/cohorts/'+cohortId);assert.equal(digest(changed.forecast),beforeHash);
    const next=await ok('/rates');await ok('/rates','PATCH',{key:'price.tree',value:price,source:'QA DEMO isolated restore rate',expectedVersion:next.version},'admin');return{forecastSha256:beforeHash,unchanged:true};
  });
  const readPaths=['/tasks/'+task.id,'/reports/'+reportRecord.id,'/uploads/'+photoId,'/outcomes/cohorts/'+cohortId,'/outcomes/cohorts/'+cohortId+'/inspections','/outcomes/cohorts/'+cohortId+'/summary?inspectionId='+inspectionId,'/outcomes/sites/'+siteId];
  savedReads=await Promise.all(readPaths.map(async p=>{const r=await call(p,'GET',undefined,'viewer');assert.equal(r.status,200,p);return digest(r.body);}));baseline=await fingerprint();assert.equal(baseline.integrity,'ok');assert.equal(baseline.foreignKeyFailures,0);
  async function preserved(){await ready();assert.equal((await call('/auth/me','GET',undefined,'viewer')).status,200);const current=await fingerprint();assert.deepEqual(current,baseline);for(let i=0;i<readPaths.length;i++){const r=await call(readPaths[i],'GET',undefined,'viewer');assert.equal(r.status,200,readPaths[i]);assert.equal(digest(r.body),savedReads[i],readPaths[i]);}return{tablesPreserved:tables.length,readEndpointsPreserved:readPaths.length,photoSha256:photoHash,viewerSessionRetained:true,integrity:'ok',foreignKeyFailures:0};}
  await check('restart retains data, photo, history, forecast and session',async()=>{await dc(['restart','server'],{label:'compose -p '+project+' restart server'});return preserved();});
  await check('repeated seed is idempotent with accepted report and inspection',async()=>{await dc(['exec','-T','server','node','--import','./scripts/local-network-guard.mjs','--import','tsx','src/tz/seed-cli.ts'],{label:'compose exec server seed:tz repeat'});const text=await dc(['exec','-T','server','node','--import','./scripts/local-network-guard.mjs','--import','tsx','src/outcomes/seed-cli.ts'],{label:'compose exec server seed:outcomes repeat'});assert.equal(JSON.parse(text).created,false);return preserved();});
  await check('container recreation retains the same isolated volume',async()=>{await dc(['up','-d','--no-build','--force-recreate','server'],{label:'compose -p '+project+' up --force-recreate server'});return preserved();});
  await check('browser reads preserved photo and real renamed zone through nginx',async()=>{
    const{c,p}=await context('viewer',1280);try{await p.goto(base+'/?source=api#/reports?report='+reportRecord.id,{waitUntil:'domcontentloaded'});await expect(p.locator('.gp-report h2')).toHaveText(reportRecord.id);const photo=p.locator('.gp-report .gp-photo img');await expect(photo).toHaveCount(1);await photo.scrollIntoViewIfNeeded();await expect.poll(()=>photo.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);await expect(p.getByRole('button',{name:/Принять отчёт|Вернуть на доработку/})).toHaveCount(0);await p.screenshot({path:join(here,'viewer-preserved-photo-1280.png')});await p.reload({waitUntil:'domcontentloaded'});await expect(p.locator('.gp-report h2')).toHaveText(reportRecord.id);await expect.poll(()=>p.locator('.gp-report .gp-photo img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
      await p.goto(base+'/?source=api#/map',{waitUntil:'domcontentloaded'});await expect(p.locator('.gp-sites__items').getByText('Газон, улица Толстого',{exact:true})).toBeVisible();await p.screenshot({path:join(here,'renamed-zone-1280.png')});return{reportId:reportRecord.id,photoDecodedAfterReload:true,zoneName:'Газон, улица Толстого',viewerMutationControlsAbsent:true};
    }finally{await c.close();}
  });
  await check('worker navigation remains usable on desktop and phone after recreation',async()=>{
    for(const width of[1280,375]){const{c,p}=await context('worker1',width);try{await p.goto(base+'/?source=api#/worker',{waitUntil:'domcontentloaded'});const cabinet=p.locator('green-worker');await expect(cabinet.locator('.date-tools button[data-action=refresh]')).toBeEnabled();for(const[name,heading]of[['Журнал','Журнал работ'],['Профиль','Карточка сотрудника'],['Смена','Моя смена']]){const button=cabinet.getByRole('button',{name:new RegExp(name+'$')}).filter({visible:true});await expect(button).toHaveCount(1);await button.click();await expect(cabinet.getByRole('heading',{name:heading,exact:true})).toBeVisible();}const sizes=await p.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));assert(sizes.scroll<=sizes.client);await p.screenshot({path:join(here,`worker-preserved-${width}.png`)});}finally{await c.close();}}return{widths:[1280,375],sections:['shift','journal','profile']};
  });
  await check('logout revokes session and fresh login still works',async()=>{assert.equal((await call('/auth/logout','POST',{},'viewer')).status,200);assert.equal((await call('/auth/me','GET',undefined,'viewer')).status,401);await login('viewer');assert.equal((await call('/reports/'+reportRecord.id,'GET',undefined,'viewer')).status,200);return{logout:200,oldSession:401,relogin:200};});
  report.status='PASS';report.summary={alive:1,dead:0,unknown:31,wholeCohortSurvivalPct:null};report.persistenceBaseline=baseline;report.ids={task:task.id,report:reportRecord.id,photo:photoId,cohort:cohortId,inspection:inspectionId,forecast:forecastId};
}catch(error){report.status='FAIL';report.error=clean(error.message).slice(0,1800);console.log('Docker QA failed: '+clean(error.message).slice(0,500));process.exitCode=1;}finally{
  if(browser)await browser.close();
  try{await dc(['stop'],{label:'compose -p '+project+' stop [only QA containers; volume preserved]'});report.stopped=true;}catch(error){report.stopFailure=clean(error.message);process.exitCode=1;}
  report.finishedAt=new Date().toISOString();report.counts={passed:report.checks.filter(c=>c.status==='passed').length,failed:report.checks.filter(c=>c.status==='failed').length,skipped:0,fixme:0,flaky:0};
  save();const textFiles=['result.json','compose.override.json','build.log','command-failure.log'].filter(n=>{try{readFileSync(join(here,n));return true;}catch{return false;}});for(const name of textFiles){const bytes=readFileSync(join(here,name));if(secrets.some(s=>s&&bytes.includes(Buffer.from(s))))throw new Error('Secret found in Docker QA output; do not publish');}report.secretScan='passed';save();console.log(JSON.stringify({status:report.status,counts:report.counts,project,port,result:'test-results/docker-qa/result.json'}));
}
