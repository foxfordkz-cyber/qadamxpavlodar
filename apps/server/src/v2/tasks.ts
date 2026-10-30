import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../db.js';
import { id,text,uniqueIds,version,timestamp,now,allow,fail,getDoc,getUser,parseRow,matchVersion,audit,evidence,inside,overlap,type User,type Doc } from './core.js';
import { crew,isMember,profile } from './people.js';
import { design,approvedRevision } from './designs.js';
import { requireSiteCleared } from './data.js';
import { localDayRange } from '../time.js';
export const taskCreate=z.object({objectType:z.enum(['plant','candidate_site']),objectId:id,action:z.enum(['inspect','water','weed','plant']),description:text,priority:z.enum(['low','medium','high','critical']).default('medium'),priorityWeight:z.number().min(0).max(100).default(50),dueAt:timestamp.nullable().default(null),estimatedMinutes:z.number().int().positive().max(1440),requiredWaterLiters:z.number().positive().nullable().default(null),minWorkers:z.number().int().min(1).max(20).default(1),requiredSkills:z.array(text).max(20).default([]),evidenceIds:uniqueIds.min(1)}).strict();
export const designTasks=z.object({expectedVersion:version,revision:version,estimatedMinutes:z.number().int().positive().max(1440),minWorkers:z.number().int().min(1).max(20),requiredSkills:z.array(text).max(20).default(['plant'])}).strict();
// minWorkers (необязательно): минимальный состав задаёт специалист при назначении бригады; людей выбирает бригадир.
export const assignInput=z.object({expectedVersion:version,crewId:id,scheduledStart:timestamp,scheduledEnd:timestamp,resourceIds:uniqueIds.default([]),minWorkers:z.number().int().min(1).max(20).optional()}).strict().refine(b=>b.scheduledStart<b.scheduledEnd,'Invalid assignment interval');
export const assignWorkersInput=z.object({expectedVersion:version,workerIds:uniqueIds.min(1)}).strict();
export const taskQuery=z.object({status:z.enum(['draft','assigned','in_progress','submitted','verified']).optional(),crewId:id.optional(),workerId:id.optional(),objectId:id.optional(),date:z.iso.date().optional(),limit:z.coerce.number().int().min(1).max(200).default(100),offset:z.coerce.number().int().nonnegative().default(0)}).strict();
export function allTasks(s:Store){return s.all('SELECT data FROM v2_tasks ORDER BY id').map(r=>parseRow(r));}
// Read scope only. Mutations keep their separate role/assignment checks before idempotent replay.
export function canTask(s:Store,a:User,t:Doc){return a.role==='admin'||a.role==='coordinator'||a.role==='specialist'||a.role==='viewer'||(a.role==='worker'&&t.assignedWorkerIds.includes(a.id))||(a.role==='foreman'&&!!t.assignedCrewId&&crew(s,t.assignedCrewId).foremanId===a.id);}
export function task(s:Store,a:User,taskId:string){const t=parseRow(s.get('SELECT data FROM v2_tasks WHERE id=?',taskId),'Task');if(!canTask(s,a,t))fail('NOT_FOUND','Task not found',404);return t;}
export function listTasks(s:Store,a:User,q:unknown){const query=taskQuery.parse(q),day=query.date?localDayRange(query.date):null;const rows=allTasks(s).filter(t=>{const at=t.scheduledStart??t.dueAt;return canTask(s,a,t)&&(!query.status||t.status===query.status)&&(!query.crewId||t.assignedCrewId===query.crewId)&&(!query.workerId||t.assignedWorkerIds.includes(query.workerId))&&(!query.objectId||t.objectId===query.objectId)&&(!day||(typeof at==='string'&&at>=day.start&&at<day.end));});return{data:rows.slice(query.offset,query.offset+query.limit),meta:{limit:query.limit,offset:query.offset,total:rows.length}};}
export function saveTask(s:Store,a:User,before:Doc,after:Doc,action:string){
  after.version=before.version+1;after.updatedAt=now();
  if(s.run('UPDATE v2_tasks SET status=?,crew_id=?,version=?,data=? WHERE id=? AND version=?',after.status,after.assignedCrewId??null,after.version,JSON.stringify(after),after.id,before.version).changes!==1)fail('VERSION_CONFLICT','Task changed');
  s.run('DELETE FROM v2_assignments WHERE task_id=?',after.id);
  for(const userId of after.assignedWorkerIds)s.run('INSERT INTO v2_assignments VALUES (?,?)',after.id,userId);
  audit(s,a,'task',after.id,action,before,after);return after;
}
export function insertTask(s:Store,a:User,b:Record<string,any>,designRef?:Doc){
  allow(a,'coordinator');getDoc(s,b.objectType==='plant'?'plant':'site',b.objectId);evidence(s,b.evidenceIds);
  if(b.action==='plant'&&!designRef)fail('APPROVED_DESIGN_REQUIRED','Create planting tasks from the approved design endpoint');
  if(['water','weed'].includes(b.action)&&b.objectType!=='plant')fail('INVALID_ACTION_TARGET','Care requires a registered plant',400);
  const t={...b,id:randomUUID(),createdAt:now(),updatedAt:now(),status:'draft',version:1,isDemo:true,assignedCrewId:null,assignedWorkerIds:[],resourceIds:[],scheduledStart:null,scheduledEnd:null,planId:null,approvedDesignId:designRef?.id??null,approvedDesignVersion:designRef?.revision??null,latestReportId:null};
  s.run('INSERT INTO v2_tasks VALUES (?,\'draft\',NULL,?,?,1,?)',t.id,t.approvedDesignId,t.approvedDesignVersion,JSON.stringify(t));audit(s,a,'task',t.id,'create',null,t);return t;
}
export function createDesignTasks(s:Store,a:User,designId:string,b:z.infer<typeof designTasks>){
  allow(a,'coordinator');const d=design(s,designId);matchVersion(d,b.expectedVersion);
  if(d.status!=='approved'||d.revision!==b.revision)fail('DESIGN_NOT_APPROVED','Only the current approved revision may release work');
  approvedRevision(s,designId,b.revision);currentSite(s,d);
  if(s.get('SELECT id FROM v2_tasks WHERE design_id=? AND design_revision=?',designId,b.revision))fail('DESIGN_ALREADY_ISSUED','Tasks already exist for this revision');
  // A later revision must not silently duplicate existing planting volume.
  if(s.get('SELECT id FROM v2_tasks WHERE design_id=?',designId))fail('DESIGN_REISSUE_REQUIRES_RECONCILIATION','Earlier revision has issued work; reconcile scope before issuing another revision');
  return[insertTask(s,a,{objectType:'candidate_site',objectId:d.siteId,action:'plant',description:`Посадка: ${d.name}, revision ${d.revision}`,priority:'medium',priorityWeight:50,dueAt:null,estimatedMinutes:b.estimatedMinutes,requiredWaterLiters:null,minWorkers:b.minWorkers,requiredSkills:b.requiredSkills,evidenceIds:d.evidenceIds},d)];
}
export function authorizeForeman(s:Store,a:User,t:Doc){allow(a,'foreman');if(!t.assignedCrewId||crew(s,t.assignedCrewId).foremanId!==a.id)fail('NOT_FOUND','Task not found',404);}
function currentSite(s:Store,d:Doc){const site=getDoc(s,'site',d.siteId);requireSiteCleared(site);if(site.version!==d.siteVersion||getDoc(s,'context',site.contextId).version!==d.contextVersion)fail('SITE_CHANGED','Site/context changed since approval; reconcile and approve the design again');}
export function validateAssignment(s:Store,t:Doc,workerIds:string[],requireWorkers=true){
  const c=crew(s,t.assignedCrewId);if(!c.active||!getUser(s,c.foremanId).active)fail('CREW_INACTIVE','Crew and foreman must be active');
  const span={start:t.scheduledStart as string,end:t.scheduledEnd as string};const duration=(Date.parse(span.end)-Date.parse(span.start))/60000;
  if(!Number.isFinite(duration)||duration<t.estimatedMinutes)fail('INTERVAL_TOO_SHORT','Interval must fit estimatedMinutes; do not divide by worker count');
  if(t.dueAt&&span.end>t.dueAt)fail('AFTER_DEADLINE','Assignment exceeds task deadline');
  const other=allTasks(s).filter(x=>x.id!==t.id&&x.status!=='draft'&&x.scheduledStart&&x.scheduledEnd);
  if(requireWorkers){
    if(workerIds.length<t.minWorkers)fail('INSUFFICIENT_WORKERS','Assignment does not meet minWorkers');
    const skills=new Set<string>();
    for(const userId of workerIds){
      const u=getUser(s,userId);if(!u.active||!['worker','foreman'].includes(u.role)||!isMember(s,c.id,userId,span.start,span.end))fail('INVALID_WORKER','Choose active members of this crew for the entire interval');
      const p=profile(s,userId);if(!p||!inside(span,{start:p.shiftStart,end:p.shiftEnd})||p.unavailableIntervals.some((i:any)=>overlap(span,i)))fail('WORKER_UNAVAILABLE','Worker shift or unavailability conflicts');
      const assigned=other.filter(x=>x.assignedWorkerIds.includes(userId));
      if(assigned.some(x=>overlap(span,{start:x.scheduledStart,end:x.scheduledEnd})))fail('WORKER_OVERLAP','Worker has an overlapping assignment');
      const used=assigned.filter(x=>overlap({start:p.shiftStart,end:p.shiftEnd},{start:x.scheduledStart,end:x.scheduledEnd})).reduce((n,x)=>n+(Date.parse(x.scheduledEnd)-Date.parse(x.scheduledStart))/60000,0);
      if(used+duration>p.capacityMinutes)fail('WORKER_CAPACITY','Worker capacity exceeded');
      p.skills.forEach((skill:string)=>skills.add(skill));
    }
    if(t.requiredSkills.some((skill:string)=>!skills.has(skill)))fail('MISSING_SKILLS','Crew composition lacks a required skill');
  }
  let knownWater=0;let waterCount=0;
  for(const resourceId of t.resourceIds){
    const r=getDoc(s,'resource',resourceId);if(r.ownerCrewId&&r.ownerCrewId!==c.id)fail('RESOURCE_OWNER','Resource belongs to another crew');
    const window=r.availableIntervals.find((i:any)=>inside(span,i));if(!window)fail('RESOURCE_UNAVAILABLE','Resource interval does not cover the task');
    const reservations=other.filter(x=>x.resourceIds.includes(resourceId));
    if(r.type==='water'){
      waterCount++;if(r.unit!=='L'||r.capacity===null)fail('WATER_UNKNOWN','Water capacity and unit L must be known');
      if(t.requiredWaterLiters===null)fail('WATER_UNKNOWN','Task water consumption must be known before reserving shared water');
      const consumed=reservations.filter(x=>overlap(window,{start:x.scheduledStart,end:x.scheduledEnd})).reduce((sum,x)=>sum+(x.requiredWaterLiters??r.capacity),0);
      if(consumed+t.requiredWaterLiters>r.capacity)fail('WATER_CAPACITY','Shared water is counted once and is exhausted');knownWater+=r.capacity-consumed;
    }else if(reservations.some(x=>overlap(span,{start:x.scheduledStart,end:x.scheduledEnd})))fail('RESOURCE_OVERLAP','Shared equipment is already assigned');
  }
  if(waterCount>1)fail('WATER_ALLOCATION_UNSUPPORTED','Use one shared water source per task; explicit split accounting is not implemented',400);
  if((t.action==='water'||t.requiredWaterLiters!==null)&&(t.requiredWaterLiters===null||knownWater<t.requiredWaterLiters))fail('WATER_UNKNOWN','Known water requirement and sufficient reservation required');
  if(t.action==='plant')currentSite(s,approvedRevision(s,t.approvedDesignId,t.approvedDesignVersion));
}
export function assign(s:Store,a:User,taskId:string,b:z.infer<typeof assignInput>){
  allow(a,'coordinator');const before=task(s,a,taskId);matchVersion(before,b.expectedVersion);if(!['draft','assigned'].includes(before.status))fail('INVALID_TRANSITION','Only unstarted tasks can be assigned');
  const after={...before,status:'assigned',assignedCrewId:b.crewId,assignedWorkerIds:[],scheduledStart:b.scheduledStart,scheduledEnd:b.scheduledEnd,resourceIds:b.resourceIds,minWorkers:b.minWorkers??before.minWorkers};
  validateAssignment(s,after,[],false);return saveTask(s,a,before,after,'assign_crew');
}
export function assignWorkers(s:Store,a:User,taskId:string,b:z.infer<typeof assignWorkersInput>){
  const before=task(s,a,taskId);authorizeForeman(s,a,before);matchVersion(before,b.expectedVersion);if(before.status!=='assigned')fail('INVALID_TRANSITION','Only assigned tasks accept composition changes');
  const after={...before,assignedWorkerIds:b.workerIds};validateAssignment(s,after,b.workerIds);return saveTask(s,a,before,after,'assign_workers');
}
export function start(s:Store,a:User,taskId:string,expectedVersion:number){
  const before=task(s,a,taskId);allow(a,'worker','foreman');if(a.role==='foreman')authorizeForeman(s,a,before);
  matchVersion(before,expectedVersion);if(before.status!=='assigned')fail('INVALID_TRANSITION','Only assigned tasks can start');
  validateAssignment(s,before,before.assignedWorkerIds);return saveTask(s,a,before,{...before,status:'in_progress'},'start');
}
