import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const sha256=b=>createHash('sha256').update(b).digest('hex');
const source=new URL('../../evidence/2026-11-01-final-public-84d009e/reference/api-manifest.json',import.meta.url);
// Relative to test-results/cloud-access-2026-11-01: ../../ is the e2e directory.
const manifestBytes=readFileSync(source), manifest=JSON.parse(manifestBytes);
const expectedManifest='d8b042398be87fc8c7283a82499dda317ee2d6e77f8d4979f55c226d93b67f60';
if(sha256(manifestBytes)!==expectedManifest)throw Error('Unexpected publisher manifest');
const entries=manifest.entries.filter(e=>!['_worker.js','_routes.json'].includes(e.path));
const startedAt=new Date().toISOString();
const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).stdout.trim();
const origins=['https://green-pavlodar-api.pages.dev','https://a26bd214.green-pavlodar-api.pages.dev'];
const results=[];
for(const origin of origins){
 for(let i=0;i<entries.length;i+=4){
  results.push(...await Promise.all(entries.slice(i,i+4).map(async e=>{
   try{const r=await fetch(origin+'/'+(e.path==='index.html'?'':e.path),{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});const bytes=Buffer.from(await r.arrayBuffer());return {origin,path:e.path,status:r.status,bytes:bytes.length,sha256:sha256(bytes),match:r.status===200&&bytes.length===e.bytes&&sha256(bytes)===e.sha256};}
   catch{return {origin,path:e.path,match:false,error:'REQUEST_FAILED'};}
  })));
 }
}
const checks=[];
for(const [path,status] of [['/api/v1/ready',200],['/api/v1/auth/me',401]]){
 try{const r=await fetch(origins[0]+path,{redirect:'error',signal:AbortSignal.timeout(30000)});const body=await r.json();checks.push({path,status:r.status,pass:r.status===status&&(path.endsWith('/ready')?body.database==='ok'&&body.photos==='private-storage-configured':body.error?.code==='AUTH_REQUIRED')});}
 catch{checks.push({path,pass:false,error:'REQUEST_FAILED'});}
}
const outcome={startedAt,endedAt:new Date().toISOString(),qaHead:head,scope:'Unauthenticated HTTP and static assets only; no login, business writes, browser E2E or restart',frontend:{sha:'c970264919de2f7a62d0e1ea8a28cc70c95a3864',deployment:'a26bd214-1c78-4a83-9536-74a35c85b49f',publisherManifestSha256:expectedManifest},backend:{ownerReportedSha:'3b14927def04b35bf97782eae6b550da276c779f',ownerReportedDeployment:'dep-dbj223h42hec73bqnttg',independentlyAttested:false},assets:results,checks,counts:{assetPass:results.filter(r=>r.match).length,assetFail:results.filter(r=>!r.match).length,httpPass:checks.filter(c=>c.pass).length,httpFail:checks.filter(c=>!c.pass).length}};
writeFileSync(new URL('./public-readonly.json',import.meta.url),JSON.stringify(outcome,null,2)+'\n');
console.log(JSON.stringify({startedAt,endedAt:outcome.endedAt,qaHead:head,counts:outcome.counts,checks}));
process.exitCode=results.every(r=>r.match)&&checks.every(c=>c.pass)?0:1;
