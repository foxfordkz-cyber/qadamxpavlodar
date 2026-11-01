import {spawn,execFileSync} from 'node:child_process';
import {createWriteStream,writeFileSync,cpSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const dir=fileURLToPath(new URL('.',import.meta.url)), root=resolve(dir,'../..');
const testSHA='c7f15755c80292509aaeeb9f9e4638f62c8b6810', appSHA='84d009e3b72c4fe637ef30607e29701054b6c621', appsTree='2fd878cfbec10d93942afeb5add57a39a230304f';
const git=a=>execFileSync('git',a,{cwd:root,encoding:'utf8',windowsHide:true}).trim();
assert.equal(git(['rev-parse','HEAD']),testSHA);assert.equal(git(['rev-parse','HEAD:apps']),appsTree);assert.equal(git(['status','--porcelain']),'');
const results=[];
for(const [name,args] of [['mock',['scripts/isolated.mjs','mock']],['api',['scripts/isolated.mjs','api','--outcomes']]]) {
 assert.equal(git(['rev-parse','HEAD']),testSHA);assert.equal(git(['status','--porcelain']),'');
 const startedAt=new Date().toISOString(),log=createWriteStream(join(dir,name+'.log'));
 const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
 console.log(name+' started '+startedAt+' pid '+child.pid);
 const exitCode=await new Promise((r,j)=>{child.once('error',j);child.once('close',r)});await new Promise(r=>log.end(r));
 const snap=join(dir,name+'-complete');mkdirSync(snap,{recursive:true});
 for(const p of ['playwright-report/'+name,'playwright-report/runs/'+name+'.json',...(name==='mock'?['screens','test-results/mock']:[])])cpSync(join(root,p),join(snap,p),{recursive:true});
 results.push({name,args,startedAt,endedAt:new Date().toISOString(),exitCode});
 writeFileSync(join(dir,'run-control.json'),JSON.stringify({testSHA,appSHA,appsTree,fullRun:true,results},null,2));
 console.log(name+' completed: '+exitCode);
}
