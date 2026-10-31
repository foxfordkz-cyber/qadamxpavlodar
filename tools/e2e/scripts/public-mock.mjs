import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root=fileURLToPath(new URL('..',import.meta.url));
const folder=join(root,'test-results/public-mock'); mkdirSync(folder,{recursive:true});
const require=createRequire(import.meta.url);
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim();
const metadata={target:'https://green-pavlodar-mock.pages.dev/',startedAt:new Date().toISOString(),
  testSHA:git(['rev-parse','HEAD']),dirty:!!git(['status','--porcelain','--untracked-files=normal']),
  applicationSHA:null,deploymentId:null,publisherReportedSHA:'a66d542c63c527d608400c84b34d49f982855369',
  provenance:'Publisher-reported SHA from docs/cloud-web-deployment.md; no deployed SHA endpoint or deployment ID supplied. Not acceptance of the local fixed build.',
  environment:{node:process.versions.node,playwright:require('@playwright/test/package.json').version,platform:process.platform,workers:2,retries:0},
  scope:'Public HTTPS mock only. No API, cloud persistence, Microsoft Word opening or private credentials.'};
const env={...process.env}; delete env.E2E_PASSWORD; delete env.DEMO_PASSWORD;
const child=spawn(process.execPath,[require.resolve('@playwright/test/cli'),'test','--config','playwright.public.config.ts'],{cwd:root,env,stdio:'inherit',windowsHide:true});
const code=await new Promise(resolve=>{child.on('error',()=>resolve(1));child.on('close',resolve);});
const report=JSON.parse(readFileSync(join(folder,'raw-results.json'),'utf8'));
const tests=[];
function visit(suite,path=[]) {for(const spec of suite.specs??[])for(const test of spec.tests??[])tests.push({title:[...path,spec.title].join(' > '),project:test.projectName,status:test.status,
  attempts:test.results.map(r=>({status:r.status,duration:r.duration})),
  failure:test.results.flatMap(r=>(r.errors??[]).map(e=>(e.message??'').replace(/\u001b\[[0-9;]*m/g,'').split('\n').filter(Boolean).slice(0,3).join(' ')))});
  for(const nested of suite.suites??[])visit(nested,[...path,nested.title]);}
for(const suite of report.suites??[])visit(suite,[suite.title]);
const counts={passed:tests.filter(t=>t.status==='expected').length,failed:tests.filter(t=>t.status==='unexpected').length,
  skipped:tests.filter(t=>t.status==='skipped').length,fixme:0,flaky:tests.filter(t=>t.status==='flaky').length};
const artifacts=[];
function images(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())images(path);else if(entry.name.endsWith('.png'))artifacts.push({path:path.slice(folder.length+1).replaceAll('\\','/'),sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});}}
images(folder);
const result={...metadata,endedAt:new Date().toISOString(),exitCode:code,counts,tests,artifacts};
writeFileSync(join(folder,'results.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({target:metadata.target,applicationSHA:null,deploymentId:null,counts,exitCode:code}));
process.exitCode=code??1;
