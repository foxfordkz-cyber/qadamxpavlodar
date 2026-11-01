import test from 'node:test';
import assert from 'node:assert/strict';
import {installGuard,strictValidateInitialTask,ORIGIN} from './network-guard.mjs';
const taskId='9050ea3c-369b-4864-b30b-caede24c96f2',siteId='site-osm-1568405606',workerId='a1d3d1e8-d046-4511-bb48-ee5be5fc3905';
const photoId='11111111-1111-4111-8111-111111111111',reportId='22222222-2222-4222-8222-222222222222';
function initial(){return {id:taskId,objectId:siteId,objectType:'candidate_site',action:'inspect',status:'assigned',version:3,minWorkers:1,assignedWorkerIds:[workerId],isDemo:true};}
async function harness(){
 const handlers={},state={taskId,siteId,workerId,currentRole:'worker',password:'SYNTHETIC_OFFLINE_ONLY',note:'QA synthetic note',comment:'QA synthetic accept',safe:{}};
 const context={on:(name,fn)=>{handlers[name]=fn;},route:async(_pattern,fn)=>{handlers.route=fn;}};
 const guard=await installGuard(context,state);
 let forwarded=0;
 const send=async(path,{body={},method='POST',key='offline-key',status=200,data={},headers={},raw}={})=>{
  const request={url:()=>path.startsWith('https://')?path:ORIGIN+'/api/v1'+path,method:()=>method,headers:()=>({'idempotency-key':key,...headers}),postDataJSON:()=>body,postDataBuffer:()=>raw};
  let aborted=false;
  await handlers.route({request:()=>request,continue:async()=>{forwarded++;handlers.response({request:()=>request,status:()=>status,json:async()=>data});},abort:async()=>{aborted=true;}});
  await guard.flush();return {aborted,forwarded};
 };
 return {state,send};
}
test('initial task rejects wrong scope/version and admits only approved assigned inspect task',()=>{
 for(const bad of [{...initial(),version:4},{...initial(),action:'plant'},{...initial(),assignedWorkerIds:[]},{...initial(),isDemo:false}])assert.throws(()=>strictValidateInitialTask(bad,{taskId,siteId,workerId}));
 const state={taskId,siteId,workerId};assert.equal(strictValidateInitialTask(initial(),state),true);assert.equal(state.initialTaskVerified,true);
});
test('one approved start/upload/submit/review chain updates sanitized state; viewer write is blocked',async()=>{
 const {state,send}=await harness();strictValidateInitialTask(initial(),state);
 assert.equal((await send(`/tasks/${taskId}/start`,{body:{expectedVersion:3},data:{data:{...initial(),status:'in_progress',version:4}}})).aborted,false);
 assert.equal(state.taskVersion,4);
 const file=Buffer.from('RIFF\x04\x00\x00\x00WEBP','latin1'),boundary='offline-boundary';
 const raw=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="qa.webp"\r\nContent-Type: image/webp\r\n\r\n`),file,Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="taskId"\r\n\r\n${taskId}\r\n--${boundary}--\r\n`)]);
 const upload={id:photoId,taskId,ownerId:workerId,reportId:null,sha256:'a'.repeat(64),byteSize:12,mediaType:'image/webp',createdAt:'2026-11-01T00:00:00Z',contentUrl:`/api/v1/uploads/${photoId}`};
 assert.equal((await send('/uploads',{raw,headers:{'content-type':`multipart/form-data; boundary=${boundary}`},status:201,data:{data:upload}})).aborted,false);
 assert.equal(state.newPhoto.id,photoId);
 const body={expectedVersion:4,photoIds:[photoId],note:state.note,location:null,confirmedObservation:null,actualWorkerIds:[workerId],actualPlantingItems:[]};
 const report={...body,id:reportId,taskId,authorId:workerId,reviewStatus:'pending',version:1,idempotencyKey:'PRIVATE_OFFLINE_KEY'};
 await send(`/tasks/${taskId}/reports`,{body,status:201,data:{data:{task:{id:taskId,status:'submitted',version:5},report}}});
 assert.equal(state.newReport.id,reportId);assert.equal(state.taskVersion,5);assert.equal(Object.hasOwn(state.newReport,'idempotencyKey'),false);
 state.currentRole='coordinator';
 await send(`/reports/${reportId}/review`,{body:{expectedVersion:5,expectedReportVersion:1,decision:'accepted',comment:state.comment,acceptGeometryDeviation:false},data:{data:{task:{id:taskId,status:'verified',version:6},report:{...report,reviewStatus:'accepted',version:2,reviewComment:state.comment},plants:[],careTasks:[],warnings:[]}}});
 assert.equal(state.taskVersion,6);assert.equal(state.newReport.version,2);assert.equal(state.safe.blockedRequests.length,0);
 state.currentRole='viewer';assert.equal((await send(`/reports/${reportId}/review`)).aborted,true);
 assert.equal(JSON.stringify(state.safe).includes(state.password),false);assert.equal(JSON.stringify(state.safe).includes('PRIVATE_OFFLINE_KEY'),false);
});
test('only same-body same-key native CSRF recovery is admitted once',async()=>{
 const {state,send}=await harness();strictValidateInitialTask(initial(),state);
 const path=`/tasks/${taskId}/start`,body={expectedVersion:3};
 await send(path,{body,status:403,data:{error:{code:'CSRF_REQUIRED'}}});
 const second=await send(path,{body,data:{data:{...initial(),status:'in_progress',version:4}}});assert.equal(second.aborted,false);
 const third=await send(path,{body,data:{data:{}}});assert.equal(third.aborted,true);
 assert.equal(state.taskVersion,4);assert.equal(state.safe.mutations.length,2);
});
test('unapproved task, snapshot, interpret, assignment, and external writes are not forwarded',async()=>{
 const {state,send}=await harness();strictValidateInitialTask(initial(),state);
 for(const path of ['/tasks/other/start','/outcomes/snapshots','/observations/interpret',`/tasks/${taskId}/assign-workers`,'https://not-approved.example/collect'])assert.equal((await send(path)).aborted,true);
 state.currentRole='coordinator';assert.equal((await send(`/zones/${siteId}/analysis`,{body:{options:{variant:'optimal',careYears:3}}})).aborted,false);
 assert.equal((await send('/zones/other/analysis',{body:{options:{}}})).aborted,true);
 assert.equal(state.safe.mutations.length,0);
});
