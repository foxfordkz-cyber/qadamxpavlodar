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
function reported(name, pattern) {
  const value=process.env[name]?.trim();
  if (!value) return null;
  if (!pattern.test(value)) throw new Error(`Invalid ${name}; only non-secret publication metadata is accepted`);
  return value;
}
const publisherReportedSHA=reported('E2E_PUBLIC_PUBLISHER_SHA', /^[a-f0-9]{40}$/i);
const publisherReportedDeploymentId=reported('E2E_PUBLIC_DEPLOYMENT_ID', /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
const publisherReportedImmutableUrl=reported('E2E_PUBLIC_IMMUTABLE_URL', /^https:\/\/[a-f0-9]{8}\.green-pavlodar-mock\.pages\.dev\/$/i);
const metadata={target:'https://green-pavlodar-mock.pages.dev/',startedAt:new Date().toISOString(),
  testSHA:git(['rev-parse','HEAD']),dirty:!!git(['status','--porcelain','--untracked-files=normal']),
  applicationSHA:null,deploymentId:null,publisherReportedSHA,publisherReportedDeploymentId,publisherReportedImmutableUrl,
  provenance:'Optional publisher-reported metadata is supplied explicitly through E2E_PUBLIC_PUBLISHER_SHA, E2E_PUBLIC_DEPLOYMENT_ID and E2E_PUBLIC_IMMUTABLE_URL. Browser results alone do not infer an application SHA or deployment ID; independent HTTP hash evidence is recorded separately.',
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
