import { loadHandoff, fingerprint, stable, safeEnvironment, assertAfterPublication, assertPinned, preservePublisherManifests } from './guard.mjs';
import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Anonymous entry checks only. Expectations are the existing session helpers and
// login labels, not a claim of authenticated cloud workflow or provider SHA.
const ownDirectory=dirname(fileURLToPath(import.meta.url));
const git=args=>execFileSync('git',args,{cwd:ownDirectory,encoding:'utf8',windowsHide:true}).trim();
let binding;
try { binding=loadHandoff('api'); } catch(error) { console.log(JSON.stringify({status:'BLOCKED',reason:/^BLOCKED_/.test(error.message)?error.message:'HANDOFF_INPUT_UNAVAILABLE'})); process.exit(2); }
const origin=binding.publication.origin;
const check=expect.configure({timeout:12_000});
const words={
  ru:{title:'Вход координатора',password:'Пароль',submit:'Войти',button:'Рус'},
  kk:{title:'Үйлестірушінің кіруі',password:'Құпиясөз',submit:'Кіру',button:'Қаз'},
};
const testSHA=git(['rev-parse','HEAD']);
const dirty=!!git(['status','--porcelain','--untracked-files=normal']);
assertPinned();
const runId=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const output=join(ownDirectory,`anonymous-entry-${runId}`);mkdirSync(output);
preservePublisherManifests(binding,output);
const report={kind:'post-publication-anonymous-api-four',startedAt:new Date().toISOString(),testSHA,dirty,target:origin,binding,
  provenance:'Publisher-reported frontend/backend SHA and deployment IDs; static HTTP bytes are compared to supplied manifests before/after. Anonymous access does not establish authenticated cloud workflow, backend source identity or durable storage.',
  scope:'Four anonymous entry scenarios: translated empty sign-in, language persistence, viewport fit and JSON 401. No sign-in, account, task, report, photo, cloud write, restart or full API acceptance.',
  environment:{node:process.versions.node,browser:'Chromium',workers:1,retries:0,scenarioTimeoutMs:45000,expectTimeoutMs:12000,navigationTimeoutMs:30000},results:[]};
const browserEnv=safeEnvironment();
let browser;
async function entryFingerprint(){ return fingerprint(binding); }

async function assertEntry(page,language){
  const text=words[language],login=page.locator('.gp-login');
  await check(login).toBeVisible();
  await check(login.getByRole('heading',{name:text.title,exact:true})).toBeVisible();
  await check(login.getByRole('textbox',{name:/^Логин/})).toBeVisible();
  await check(login.getByLabel(new RegExp(`^${text.password}`))).toBeVisible();
  await check(login.getByRole('button',{name:text.submit,exact:true})).toBeVisible();
  await check(page.getByRole('group',{name:'Язык / Тіл',exact:true}).getByRole('button',{name:text.button,exact:true})).toHaveAttribute('aria-pressed','true');
  await check(page.locator('.gp-header__right > span')).toHaveCount(0);
  await check(page.locator('nav.gp-nav a')).toHaveCount(0);
  await check(page.locator('green-worker')).toHaveCount(0);
  await check(page.getByRole('button',{name:/^(Выйти|Шығу)$/})).toHaveCount(0);
  if(!await page.locator('input,textarea').evaluateAll(nodes=>nodes.every(node=>node.value==='')))throw new Error('Anonymous entry inputs must be empty');
  const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
  check(size.scroll,'Anonymous entry must not overflow horizontally').toBeLessThanOrEqual(size.client);
  check(new URL(page.url()).origin).toBe(origin);
}

try{
  report.entryBefore=await entryFingerprint();
  if(!report.entryBefore.matchesHandoff) throw new Error('Static frontend identity mismatch before browser');
  browser=await chromium.launch({headless:true,env:browserEnv,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
  report.environment.browserVersion=browser.version();
  for(const width of [1280,375])for(const language of ['ru','kk']){
    const row={language,width,height:width===375?812:800,startedAt:new Date().toISOString(),status:'failed',step:'create context',blockedRequests:[],readErrors:[],pageErrorCount:0};
    const context=await browser.newContext({viewport:{width,height:row.height},locale:'ru-RU',timezoneId:'Asia/Qyzylorda',isMobile:width===375,hasTouch:width===375,serviceWorkers:'block'});
    const page=await context.newPage();page.setDefaultTimeout(12_000);page.setDefaultNavigationTimeout(30_000);
    page.on('pageerror',()=>{row.pageErrorCount++;});
    await context.route('**/*',async route=>{
      assertAfterPublication();
      const request=route.request(),url=new URL(request.url());
      const safe={method:request.method(),origin:url.origin,path:url.pathname};
      if(!['GET','HEAD'].includes(request.method())){row.blockedRequests.push({...safe,reason:'mutation prevented'});await route.abort('blockedbyclient');return;}
      const allowedStatic=['https://fonts.googleapis.com','https://fonts.gstatic.com'];
      if(url.origin!==origin&&(request.isNavigationRequest()||!allowedStatic.includes(url.origin))){row.blockedRequests.push({...safe,reason:'outside accepted read origins'});await route.abort('blockedbyclient');return;}
      try{
        let current=url,response;
        for(let redirects=0;redirects<=5;redirects++){
          response=await route.fetch({url:current.href,maxRedirects:0,timeout:12_000});
          if(response.status()<300||response.status()>=400)break;
          const location=response.headers()['location'];
          if(!location)throw new Error('Redirect without location');
          const next=new URL(location,current);
          if(current.origin!==origin||next.origin!==origin||next.username||next.password||redirects===5){row.blockedRequests.push({...safe,reason:'redirect outside accepted API origin or redirect limit'});await route.abort('blockedbyclient');return;}
          current=next;
        }
        await route.fulfill({response});
      }catch(error){row.readErrors.push({...safe,errorName:error.name});await route.abort('failed').catch(()=>{});}
    });
    let deadline;
    try{
      await Promise.race([(async()=>{
        row.step='open anonymous API frontend';
        await page.goto(`${origin}/?source=api&lang=${language}#/`,{waitUntil:'domcontentloaded'});
        row.step='initial translated empty sign-in';await assertEntry(page,language);
        row.step='anonymous auth/me rejects access';
        const response=await context.request.get(`${origin}/api/v1/auth/me`,{maxRedirects:0,timeout:12_000});
        const type=response.headers()['content-type']??'';
        row.anonymousAuth={status:response.status(),contentType:type};
        if(response.status()!==401||!type.includes('application/json'))throw new Error('Anonymous API must return JSON 401');
        const body=await response.json();
        if(body.error?.code!=='AUTH_REQUIRED')throw new Error('Anonymous API error must be AUTH_REQUIRED');
        row.anonymousAuth.errorCode='AUTH_REQUIRED';
        for(const selected of [language==='ru'?'kk':'ru',language]){
          row.step=`switch and persist ${selected}`;
          await page.getByRole('group',{name:'Язык / Тіл',exact:true}).getByRole('button',{name:words[selected].button,exact:true}).click();
          await assertEntry(page,selected);
          await page.evaluate(()=>{const url=new URL(location.href);url.searchParams.delete('lang');history.replaceState(history.state,'',url);});
          await page.reload({waitUntil:'domcontentloaded'});
          await assertEntry(page,selected);
        }
        row.step='safe empty sign-in screenshot';
        check(row.blockedRequests,'No mutating or disallowed redirect request may be attempted').toEqual([]);
        check(row.pageErrorCount,'Anonymous entry must not produce page errors').toBe(0);
        row.externalReadErrors=row.readErrors.filter(error=>error.origin!==origin);
        check(row.readErrors.filter(error=>error.origin===origin),'Application and same-origin API reads must not fail at transport level').toEqual([]);
        if(!await page.locator('input,textarea').evaluateAll(nodes=>nodes.every(node=>node.value==='')))throw new Error('Screenshot refused: inputs are not empty');
        await page.evaluate(async()=>{await document.fonts.ready;});
        const filename=`anonymous-${language}-${width}.png`;
        await page.screenshot({path:join(output,filename),animations:'disabled'});
        row.screenshot={file:filename,sha256:createHash('sha256').update(readFileSync(join(output,filename))).digest('hex'),inputsEmpty:true,reviewed:false};
        row.status='passed';row.step='complete';
      })(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Original 45000ms scenario limit exceeded')),45_000);})]);
    }catch(error){row.failure={name:error.name,step:row.step,category:error.message==='Original 45000ms scenario limit exceeded'?'scenario-timeout':'assertion-or-browser-error',note:'Raw error messages, DOM and input values are intentionally omitted.'};}
    finally{clearTimeout(deadline);await context.close();row.endedAt=new Date().toISOString();report.results.push(row);}
  }
}catch(error){report.setupFailure={name:error.name,note:'Browser setup failed; no credentials or raw environment written.'};}
finally{
  await browser?.close();try{report.entryAfter=await entryFingerprint();report.entryAssetsStable=stable(report.entryBefore,report.entryAfter);}catch(error){report.entryAssetsStable=false;report.finalFingerprintError=error.name;}report.endedAt=new Date().toISOString();
  report.counts={passed:report.results.filter(r=>r.status==='passed').length,failed:report.results.filter(r=>r.status==='failed').length,skipped:0,fixme:0,flaky:0,notRun:4-report.results.length};
  report.artifactPolicy='Only intentional screenshots after empty-input and signed-out checks; no trace, video, error-context, login credentials or raw DOM.';
  writeFileSync(join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,counts:report.counts,testSHA,startedAt:report.startedAt,endedAt:report.endedAt}));
  process.exitCode=report.counts.failed||report.counts.notRun||!report.entryAssetsStable?1:0;
}
