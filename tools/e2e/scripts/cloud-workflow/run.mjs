import { chromium, expect as baseExpect } from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {workerFlow} from './worker-flow.mjs';
import {coordinatorAccept,viewerRead,outcomesRead} from './review-viewer-flow.mjs';
import {installGuard,strictValidateInitialTask as validateInitialTask} from './network-guard.mjs';

const ORIGIN='https://green-pavlodar-api.pages.dev';
const TASK='9050ea3c-369b-4864-b30b-caede24c96f2';
const SITE='site-osm-1568405606';
const COHORT='release-738f96b2-cohort';
const WORKER='a1d3d1e8-d046-4511-bb48-ee5be5fc3905';
const COMMENT='QA synthetic DEMO inspection acceptance; no real-world verification claimed.';
const NOTE='QA SYNTHETIC DEMO 2026-11-01: browser inspection workflow. This image and report are test data, not a real field observation. Unknown plant states remain unknown.';
// Same assertion timeout as tools/e2e/playwright.config.ts, fixed before first cloud run.
const expect=baseExpect.configure({timeout:12000});
const root=new URL('../../',import.meta.url);
const outputBase=new URL('test-results/cloud-workflow-2026-11-01/',root);
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>hash(Buffer.from(JSON.stringify(canonical(v))));
const outcomeProjection=data=>Object.fromEntries(['siteId','cohorts','inspections','registry','forecasts'].map(key=>[key,data[key]]));
function outcomeHashes(data){
  const forecast=data.forecasts.find(item=>item.id==='release-738f96b2-forecast');
  const cohort=data.cohorts.find(item=>item.id===COHORT);
  expect(forecast).toBeTruthy();expect(cohort).toBeTruthy();
  return {historySha256:digest(outcomeProjection(data)),forecastSha256:digest(forecast),cohortSha256:digest(cohort),asOf:data.asOf};
}
const safeEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>['systemroot','windir','path','pathext','temp','tmp','userprofile','localappdata','appdata','programfiles','programfiles(x86)'].includes(k.toLowerCase())));
let out, report, state, browser, currentPage, currentGuard, currentContext, authenticated=false;
const pending=[];
const save=()=>{if(out&&report)writeFileSync(new URL('result.json',out),JSON.stringify({...report,network:state?.safe},null,2)+'\n');};
async function record(item){
  const event=item.step??item.event??'checkpoint';
  report.stage=event;
  report.events.push({at:new Date().toISOString(),...item});
  save();
}
async function getJson(page,path){
  const r=await page.request.get(ORIGIN+'/api/v1'+path,{maxRedirects:0});
  expect(r.status(),'Scoped read status '+path).toBe(200);
  const j=await r.json();return j.data;
}
async function fingerprint(label){
  const bytes=readFileSync(new URL('evidence/2026-11-01-final-public-84d009e/reference/api-manifest.json',root));
  expect(hash(bytes)).toBe('d8b042398be87fc8c7283a82499dda317ee2d6e77f8d4979f55c226d93b67f60');
  const entries=JSON.parse(bytes).entries.filter(e=>!['_worker.js','_routes.json'].includes(e.path));
  const rows=[];
  for(let i=0;i<entries.length;i+=4) rows.push(...await Promise.all(entries.slice(i,i+4).map(async e=>{
    const r=await fetch(ORIGIN+'/'+(e.path==='index.html'?'':e.path),{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
    const body=Buffer.from(await r.arrayBuffer());
    return {path:e.path,status:r.status,bytes:body.length,sha256:hash(body),match:r.status===200&&body.length===e.bytes&&hash(body)===e.sha256};
  })));
  report.fingerprints.push({label,at:new Date().toISOString(),rows});save();
  expect(rows.every(r=>r.match),'Publication must match c970264 manifest').toBe(true);
}
async function login(role,route){
  state.currentRole=role;
  currentContext=await browser.newContext({baseURL:ORIGIN,viewport:{width:1280,height:900},locale:'ru-RU',timezoneId:'Asia/Almaty',serviceWorkers:'block'});
  currentContext.setDefaultTimeout(30000);currentContext.setDefaultNavigationTimeout(30000);
  currentGuard=await installGuard(currentContext,state,record);
  currentPage=await currentContext.newPage();
  currentPage.on('pageerror',()=>{report.browserErrors.push({role,kind:'pageerror',stage:report.stage});save();});
  await record({step:role+'-login-ui',status:'RUNNING'});
  await currentPage.goto('/?source=api&lang=ru#'+route,{waitUntil:'domcontentloaded'});
  await expect(currentPage.locator('.gp-login')).toBeVisible();
  const loginName=role==='worker'?'release-738f96b2-worker':role;
  await currentPage.locator('input[autocomplete=username]').fill(loginName);
  await currentPage.locator('input[type=password]').evaluate((input,value)=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
  },state.password);
  const responsePromise=currentPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/auth/login'&&r.request().method()==='POST');
  await currentPage.locator('.gp-login button[type=submit]').click();
  const response=await responsePromise;
  expect(response.status(),'One UI login attempt').toBe(200);
  authenticated=true;
  await expect(currentPage.locator('.gp-login')).toHaveCount(0);
  const me=await getJson(currentPage,'/auth/me');expect(me.user.role).toBe(role);
  await record({step:role+'-login-ui',status:'PASS',method:'browser form'});
  return currentPage;
}
async function logout(){
  if(!currentContext)return;
  if(authenticated){
    const button=currentPage.locator('.gp-header__right').getByRole('button',{name:/^(Выйти|Шығу)$/});
    await expect(button).toBeVisible();
    const responsePromise=currentPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/auth/logout'&&r.request().method()==='POST');
    await button.click();const r=await responsePromise;expect(r.status()).toBe(200);
    await expect(currentPage.locator('.gp-login')).toBeVisible();
    await expect(currentPage.locator('green-worker')).toHaveCount(0);
    await expect(currentPage.locator('.gp-nav')).toHaveCount(0);
    await currentPage.locator('input[type=password]').fill('');
    await currentPage.locator('input[autocomplete=username]').fill('');
    await record({step:state.currentRole+'-logout-ui',status:'PASS',identityAndNavigationRemoved:true});
  }
  await currentGuard.flush();await currentContext.close();authenticated=false;currentContext=null;currentPage=null;
}
async function photoRead(page,role){
  const photo=state.newPhoto;
  expect(photo?.id).toBeTruthy();
  const r=await page.request.get(ORIGIN+'/api/v1/uploads/'+photo.id,{maxRedirects:0});
  expect(r.status()).toBe(200);expect(r.headers()['content-type']).toContain('image/webp');
  const b=await r.body();expect(b.toString('ascii',0,4)).toBe('RIFF');expect(b.toString('ascii',8,12)).toBe('WEBP');
  const sha256=hash(b);expect(sha256).toBe(photo.sha256);
  report.photos.push({role,id:photo.id,sha256,bytes:b.length,method:'Authenticated HTTP GET of actual normalized WebP; displayed photo checked separately in UI'});save();
}
async function screenshot(page,name,selector){
  expect(await page.locator('input[type=password]').count()).toBe(0);
  const element=page.locator(selector);await expect(element).toBeVisible();
  const dest=new URL(name+'.png',out);await element.screenshot({path:fileURLToPath(dest),animations:'disabled'});
  report.screenshots.push({file:name+'.png',sha256:hash(readFileSync(dest)),reviewed:false,syntheticOnly:true});save();
}
async function main(){
  const env=process.env;
  if(env.CLOUD_ACCEPTANCE_DEMO!=='1'||env.CLOUD_ACCEPTANCE_ORIGIN!==ORIGIN||env.CLOUD_ACCEPTANCE_BROWSER_ORIGIN!==ORIGIN||!env.CLOUD_ACCEPTANCE_PASSWORD||env.CLOUD_ACCEPTANCE_PASSWORD.length<12){console.log(JSON.stringify({result:'BLOCKED_ACCESS'}));process.exitCode=2;return;}
  const qaHead=execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(root),env:safeEnv(),encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();
  const tracked=execFileSync('git',['status','--porcelain'],{cwd:fileURLToPath(root),env:safeEnv(),encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();
  if(tracked)throw Error('QA_CHECKOUT_DIRTY');
  const startedAt=new Date().toISOString(),id='run-'+startedAt.replaceAll(':','-').replaceAll('.','-')+'-'+randomUUID().slice(0,6);
  out=new URL(id+'/',outputBase);mkdirSync(out,{recursive:true});
  writeFileSync(new URL('mutation-window.lock',outputBase),JSON.stringify({id,taskId:TASK,startedAt}),{flag:'wx'});
  const methods=['run.mjs','worker-flow.mjs','review-viewer-flow.mjs','network-guard.mjs'].map(name=>({name,sha256:hash(readFileSync(new URL(name,import.meta.url)))}));
  report={schema:1,id,startedAt,qaHead,methods,status:'RUNNING',stage:'initial',events:[],photos:[],screenshots:[],browserErrors:[],fingerprints:[],
    identity:{frontendSha:'c970264919de2f7a62d0e1ea8a28cc70c95a3864',frontendDeployment:'a26bd214-1c78-4a83-9536-74a35c85b49f',backendOwnerConfirmedSha:'3b14927def04b35bf97782eae6b550da276c779f',backendDeployment:'dep-dbj223h42hec73bqnttg'},
    authorization:'PR39 issuecomment-6554168897; one synthetic inspect UI workflow, no restart or append inspection',apiPreparation:{owner:'Bekzat',action:'assign-workers',taskId:TASK,status:'assigned',version:3,notBrowserStep:true},
    scope:{browserWorkflow:true,newInspectionApi:false,restart:false,trace:false,HAR:false,retries:0},timeouts:{expect:12000,action:30000,navigation:30000}};
  state={currentRole:null,taskId:TASK,siteId:SITE,workerId:WORKER,note:NOTE,comment:COMMENT,password:env.CLOUD_ACCEPTANCE_PASSWORD,initialTaskVerified:false,taskVersion:3,newPhoto:null,newReport:null,safe:{network:[],blockedRequests:[],mutations:[]}};
  delete process.env.CLOUD_ACCEPTANCE_PASSWORD;delete process.env.E2E_PASSWORD;delete process.env.DEBUG;delete process.env.PWDEBUG;
  save();
  try{
    await fingerprint('before');
    browser=await chromium.launch({headless:true,env:safeEnv(),args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
    const canvasPage=await browser.newPage();
    const b64=await canvasPage.evaluate(()=>{const c=document.createElement('canvas');c.width=480;c.height=320;const x=c.getContext('2d');x.fillStyle='#dcefe3';x.fillRect(0,0,480,320);x.fillStyle='#286746';x.beginPath();x.arc(240,115,55,0,Math.PI*2);x.fill();x.fillStyle='#825d40';x.fillRect(231,155,18,60);x.fillStyle='#143d29';x.font='bold 22px sans-serif';x.fillText('QA SYNTHETIC DEMO',105,250);x.font='16px sans-serif';x.fillText('2026-11-01: not a real field photo',115,280);return c.toDataURL('image/webp',0.9).split(',')[1];});
    await canvasPage.close();const photoPath=fileURLToPath(new URL('synthetic-inspection.webp',out));writeFileSync(photoPath,Buffer.from(b64,'base64'));
    report.syntheticPhoto={file:'synthetic-inspection.webp',sha256:hash(readFileSync(photoPath))};save();
    const worker=await login('worker','/worker');
    const task=await getJson(worker,'/tasks/'+TASK);validateInitialTask(task,state);state.initialTaskVerified=true;
    await record({step:'initial-task-http-read',status:'PASS',taskId:TASK,siteId:SITE,version:3,workerId:WORKER,readOnlyApi:true});
    await workerFlow({page:worker,expect,taskId:TASK,siteId:SITE,photoPath,note:NOTE,record});
    await currentGuard.flush();expect(state.newReport?.id).toBeTruthy();expect(state.newPhoto?.id).toBeTruthy();expect(state.taskVersion).toBe(5);
    report.newReport={...state.newReport};report.newPhoto={...state.newPhoto};save();
    await screenshot(worker,'worker-submitted-kk-375','green-worker');await logout();
    const coordinator=await login('coordinator','/reports?report='+state.newReport.id);
    const before=await getJson(coordinator,'/outcomes/sites/'+SITE);report.outcomesBefore=outcomeHashes(before);
    await coordinatorAccept({page:coordinator,expect,reportId:state.newReport.id,taskId:TASK,note:NOTE,record});
    await currentGuard.flush();expect(state.taskVersion).toBe(6);expect(state.newReport.reviewStatus).toBe('accepted');expect(state.newReport.version).toBe(2);
    report.newReport={...state.newReport};report.newPhoto={...state.newPhoto};save();
    await photoRead(coordinator,'coordinator');await screenshot(coordinator,'coordinator-accepted-ru-1280','.gp-report');await logout();
    const viewer=await login('viewer','/reports?report='+state.newReport.id);
    await viewerRead({page:viewer,expect,reportId:state.newReport.id,taskId:TASK,siteId:SITE,note:NOTE,record});
    await photoRead(viewer,'viewer');await screenshot(viewer,'viewer-accepted-kk-375','.gp-report');
    await outcomesRead({page:viewer,expect,siteId:SITE,cohortId:COHORT,record});
    const after=await getJson(viewer,'/outcomes/sites/'+SITE);report.outcomesAfter={...outcomeHashes(after),unchanged:digest(outcomeProjection(before))===digest(outcomeProjection(after))};expect(digest(outcomeProjection(after)),'Inspect review must not change saved Outcomes history/forecast').toBe(digest(outcomeProjection(before)));
    const finalTask=await getJson(viewer,'/tasks/'+TASK);expect(finalTask.status).toBe('verified');expect(finalTask.version).toBe(6);
    const finalReport=await getJson(viewer,'/reports/'+state.newReport.id);expect(finalReport.reviewStatus).toBe('accepted');expect(finalReport.version).toBe(2);
    report.finalRecords={taskId:TASK,taskVersion:6,taskStatus:'verified',reportId:state.newReport.id,reportVersion:2,reviewStatus:'accepted',reportSha256:digest(finalReport),taskSha256:digest(finalTask)};
    await screenshot(viewer,'viewer-outcomes-kk-375','.gp-outcomes-page');await logout();
    await fingerprint('after');expect(state.safe.blockedRequests).toHaveLength(0);expect(report.browserErrors).toHaveLength(0);
    report.status='PASS';report.stage='completed-ui-segment';
  }catch(error){
    report.status='FAIL';report.failure={stage:report.stage,kind:'ASSERTION_OR_UI_STEP_FAILED',name:error?.name==='TimeoutError'?'TimeoutError':'Error',matcher:/^[a-zA-Z]{1,40}$/.test(error?.matcherResult?.name??'')?error.matcherResult.name:null,details:'Raw messages, DOM, request bodies and credentials deliberately omitted'};
    if(authenticated&&currentPage)try{
      if(await currentPage.locator('input[type=password]').count()===0){
        const path=new URL('failure-ui.png',out);
        await currentPage.screenshot({path:fileURLToPath(path),animations:'disabled'});
        report.screenshots.push({file:'failure-ui.png',sha256:hash(readFileSync(path)),reviewed:false,syntheticOnly:true,diagnostic:true});
      }
    }catch{}
  }
  finally{
    if(currentContext){
      if(authenticated)try{
        const status=await currentPage.evaluate(async()=>{const me=await fetch('/api/v1/auth/me').then(r=>r.json());const r=await fetch('/api/v1/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me.data.csrfToken},body:'{}'});return r.status;});
        report.failureCleanup={method:'API logout fallback, not counted as UI',status};
      }catch{report.failureCleanup={method:'API logout fallback',status:'NOT_CONFIRMED'};}
      try{await currentGuard?.flush();await currentContext.close();}catch{}
    }
    await browser?.close();state.password=undefined;
    report.newReport=state.newReport;report.newPhoto=state.newPhoto;report.finalTaskVersion=state.taskVersion;report.endedAt=new Date().toISOString();
    save();console.log(JSON.stringify({result:report.status,artifact:id+'/result.json',stage:report.stage}));process.exitCode=report.status==='PASS'?0:1;
  }
}
main().catch(()=>{if(report){report.status='BLOCKED_CONFIGURATION';save();}console.log(JSON.stringify({result:'BLOCKED_CONFIGURATION',details:'Safe configuration check failed; no raw error emitted'}));process.exitCode=1;});
