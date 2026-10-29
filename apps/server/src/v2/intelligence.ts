import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../db.js';
import { id,text,shortText,uniqueIds,version,timestamp,allow,fail,hash,now,getDoc,listDocs,insertDoc,updateDoc,matchVersion,mutate,replay,fresh,audit,type User,type Doc } from './core.js';
import { allTasks,task,assign } from './tasks.js';
import { actor } from './auth.js';
import { type Api,param } from './router.js';
import { localDayRange } from '../time.js';
export type V2Adapters={
  interpretObservation?:(input:Readonly<Record<string,unknown>>,context:Readonly<Record<string,unknown>>)=>unknown|Promise<unknown>;
  buildPlanPreview?:(snapshot:Readonly<Record<string,unknown>>,constraints:Readonly<Record<string,unknown>>)=>unknown|Promise<unknown>;
};
export const constraints=z.object({shiftDate:z.iso.date(),crewIds:uniqueIds.min(1),notes:text.optional()}).strict();
export const planRequest=z.object({constraints}).strict();
const proposal=z.object({taskId:id,crewId:id,expectedTaskVersion:version,scheduledStart:timestamp,scheduledEnd:timestamp,resourceIds:uniqueIds,proposedWorkerIds:uniqueIds}).strict();
export const planResult=z.object({proposedAssignments:z.array(proposal).max(100),unassignedTasks:z.array(z.object({taskId:id,reasonCode:shortText,explanation:text}).strict()).max(100),warnings:z.array(text).max(100),metrics:z.array(z.object({name:shortText,value:z.number().finite().nullable(),unit:shortText,definition:text}).strict()).max(30),method:z.enum(['rules','model','recorded_demo'])}).strict();
export const observationRequest=z.object({taskId:id,text}).strict();
export const observationResult=z.object({objectId:id,category:z.enum(['access_problem','visible_damage','care_completed','needs_inspection','other']),extractedFacts:z.array(text).max(30),proposedAction:z.enum(['inspect','water','weed','plant']).nullable().optional(),evidenceIds:uniqueIds,missingData:z.array(text).max(30),needsHumanReview:z.literal(true)}).strict();
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export function snapshot(s:Store){
  const input={tasks:allTasks(s),workers:s.all('SELECT u.id,COALESCE(m.role,u.role) AS role,u.active,u.version,p.data AS profile FROM v2_users u LEFT JOIN v2_profiles p ON p.user_id=u.id LEFT JOIN municipal_roles m ON m.user_id=u.id').map(r=>({...r,profile:r.profile?JSON.parse(String(r.profile)):null})),crews:s.all('SELECT data FROM v2_crews').map(r=>JSON.parse(String(r.data))),memberships:s.all('SELECT * FROM v2_memberships'),resources:listDocs(s,'resource'),sites:listDocs(s,'site'),plants:listDocs(s,'plant'),evidence:listDocs(s,'evidence'),issues:s.all('SELECT data FROM v2_issues').map(r=>JSON.parse(String(r.data))),designs:s.all('SELECT data FROM v2_designs').map(r=>JSON.parse(String(r.data)))};
  if(Object.values(input).some(rows=>rows.length>500))fail('SNAPSHOT_LIMIT','Bounded local snapshot exceeds 500 rows per collection',503);
  return freeze({...input,inputVersion:hash(input)});
}
async function invoke<T>(fn:(()=>unknown|Promise<unknown>)|undefined,schema:z.ZodType<T>):Promise<T>{
  if(!fn)fail('INTEGRATION_UNAVAILABLE','Participant 1 server adapter is not connected; manual operations remain available',503);
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{const result=await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),1000);})]);return schema.parse(result);}
  catch{return fail('INTEGRATION_FAILED','Adapter timed out, failed or returned invalid data; no assignments were changed',503);}finally{if(timer)clearTimeout(timer);}
}
export function intelligenceRoutes(s:Store,api:Api,adapters:V2Adapters={}){
  const{route,write}=api;
  route({method:'get',path:'/integration/snapshot',summary:'Coordinator: immutable V2 planning inputs, without passwords or sessions'},(_req,res)=>{allow(actor(res),'coordinator');res.json({data:s.transaction(()=>snapshot(s))});});
  route({method:'post',path:'/observations/interpret',idempotent:true,input:observationRequest,summary:'Participant 1 adapter: draft only; 503 when not connected'},async(req,res)=>{
    const a=actor(res);allow(a,'worker','foreman','coordinator');const b=observationRequest.parse(req.body);const context=task(s,a,b.taskId);
    const old=s.transaction(()=>{fresh(s,a);task(s,a,b.taskId);return replay(s,a,req.method,req.path,req.get('Idempotency-Key'),b);});
    if(old){res.set('Idempotency-Replayed','true').status(old.status).json(old.body);return;}
    const draft=await invoke(adapters.interpretObservation?()=>adapters.interpretObservation!(freeze({text:b.text}),freeze({task:structuredClone(context)})):undefined,observationResult);
    if(draft.objectId!==context.objectId||draft.evidenceIds.some(e=>!context.evidenceIds.includes(e)))fail('INVALID_AI_REFERENCE','Adapter referenced data outside authorized context',503);
    const result=mutate(s,a,req.method,req.path,req.get('Idempotency-Key'),b,200,()=>{allow(a,'worker','foreman','coordinator');task(s,a,b.taskId);},()=>{
      matchVersion(task(s,a,b.taskId),context.version);return{...draft,inputVersion:context.version,sourceText:b.text,method:'external_adapter',savedAsFact:false};
    });res.set('Idempotency-Replayed',String(result.replayed)).status(result.status).json(result.body);
  });
  route({method:'post',path:'/plans/preview',idempotent:true,input:planRequest,status:201,summary:'Participant 1 adapter: persist preview snapshot; proposed people gain no task access'},async(req,res)=>{
    const a=actor(res);allow(a,'coordinator');const b=planRequest.parse(req.body);
    const old=s.transaction(()=>{fresh(s,a);allow(a,'coordinator');return replay(s,a,req.method,req.path,req.get('Idempotency-Key'),b);});if(old){res.set('Idempotency-Replayed','true').status(old.status).json(old.body);return;}
    const input=s.transaction(()=>snapshot(s));const result=await invoke(adapters.buildPlanPreview?()=>adapters.buildPlanPreview!(input,freeze(structuredClone(b.constraints))):undefined,planResult);
    const ids=result.proposedAssignments.map(x=>x.taskId);if(new Set(ids).size!==ids.length)fail('DUPLICATE_PLAN_TASK','Plan repeats a task',503);
    const day=localDayRange(b.constraints.shiftDate);
    for(const p of result.proposedAssignments){const t=input.tasks.find(t=>t.id===p.taskId);if(!t||p.expectedTaskVersion!==t.version||!b.constraints.crewIds.includes(p.crewId)||p.scheduledStart<day.start||p.scheduledEnd>day.end||p.scheduledStart>=p.scheduledEnd)fail('INVALID_PLAN_REFERENCE','Plan references an unknown/stale input or falls outside the UTC+5 shift date',503);}
    for(const p of result.unassignedTasks)if(!input.tasks.some(t=>t.id===p.taskId)||ids.includes(p.taskId))fail('INVALID_PLAN_REFERENCE','Invalid unassigned task',503);
    const saved=mutate(s,a,req.method,req.path,req.get('Idempotency-Key'),b,201,()=>allow(a,'coordinator'),()=>{
      if(snapshot(s).inputVersion!==input.inputVersion)fail('SNAPSHOT_STALE','Planning inputs changed; rebuild preview');
      return insertDoc(s,'plan',{...result,id:randomUUID(),inputVersion:input.inputVersion,inputSnapshot:input,constraints:b.constraints,status:'draft',createdAt:now(),version:1});
    });res.set('Idempotency-Replayed',String(saved.replayed)).status(saved.status).json(saved.body);
  });
  route({method:'get',path:'/plans/:id',summary:'Coordinator: persisted plan and exact input snapshot'},(req,res)=>{allow(actor(res),'coordinator');res.json({data:getDoc(s,'plan',param(req))});});
  write({method:'post',path:'/plans/:id/approve',input:z.object({expectedVersion:version}).strict(),summary:'Coordinator: atomically apply all crew assignments if inputs still match'},a=>allow(a,'coordinator'),(a,b,req)=>{
    const plan=getDoc(s,'plan',param(req));matchVersion(plan,b.expectedVersion);if(plan.status!=='draft')fail('PLAN_ALREADY_APPROVED','Plan is already approved');
    if(snapshot(s).inputVersion!==plan.inputVersion)fail('SNAPSHOT_STALE','Tasks, availability or resources changed; rebuild the plan');
    const assignments=[];for(const p of plan.proposedAssignments)assignments.push(assign(s,a,p.taskId,{expectedVersion:p.expectedTaskVersion,crewId:p.crewId,scheduledStart:p.scheduledStart,scheduledEnd:p.scheduledEnd,resourceIds:p.resourceIds}));
    const after=updateDoc(s,'plan',{...plan,status:'approved',approvedBy:a.id,approvedAt:now(),version:plan.version+1},plan.version);audit(s,a,'plan',plan.id,'approve',plan,after);return{plan:after,assignments};
  });
}
