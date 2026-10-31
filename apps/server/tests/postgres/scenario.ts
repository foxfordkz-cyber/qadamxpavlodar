import type { postgresFixture } from './workflow-helpers.js';
export type Fixture=Awaited<ReturnType<typeof postgresFixture>>;
/** Real admin/coordinator HTTP preparation; no direct task/report insertion. */
export async function workflowScenario(f:Fixture,prefix='photo'){
 const day=new Date();day.setUTCDate(day.getUTCDate()+1);day.setUTCHours(0,0,0,0);let slot=0;
 const profile={shiftStart:day.toISOString(),shiftEnd:new Date(+day+86400000-1).toISOString(),capacityMinutes:1000,skills:['inspect','plant','water'],unavailableIntervals:[]};
 const foremanLogin=prefix+'-foreman',workerLogin=prefix+'-worker',otherLogin=prefix+'-other';
 const foreman=await f.createUser(foremanLogin,'foreman',profile),worker=await f.createUser(workerLogin,'worker',profile),other=await f.createUser(otherLogin,'worker',profile);
 let crew=await f.ok('/crews','POST','admin',{name:'Synthetic DEMO '+prefix+' crew',foremanId:foreman.id},201);
 for(const user of [worker,other])crew=await f.ok(`/crews/${crew.id}/members`,'POST','admin',{expectedVersion:crew.version,userId:user.id,active:true});
 const source=await f.ok('/evidence','POST','coordinator',{sourceType:'fixture',sourceLabel:'Synthetic DEMO '+prefix+' acceptance',dataClass:'demo',note:'Not a field observation'},201);
 const plant=await f.ok('/plants','POST','coordinator',{name:'Synthetic DEMO '+prefix+' tree',kind:'tree',lat:52.281,lng:76.951,evidenceIds:[source.id]},201);
 async function startTask(minWorkers=1,existing?:any){
  let task=existing??await f.ok('/tasks','POST','coordinator',{objectType:'plant',objectId:plant.id,action:'inspect',description:'Synthetic DEMO '+prefix+' task',estimatedMinutes:30,minWorkers,evidenceIds:[source.id]},201);
  const scheduledStart=new Date(+day+(++slot)*3600000).toISOString(),scheduledEnd=new Date(+day+slot*3600000+1800000).toISOString();
  task=await f.ok(`/tasks/${task.id}/assign`,'POST','coordinator',{expectedVersion:task.version,crewId:crew.id,scheduledStart,scheduledEnd,resourceIds:[]});
  task=await f.ok(`/tasks/${task.id}/assign-workers`,'POST',foremanLogin,{expectedVersion:task.version,workerIds:minWorkers>1?[worker.id,other.id]:[worker.id]});
  return f.ok(`/tasks/${task.id}/start`,'POST',workerLogin,{expectedVersion:task.version});
 }
 return {foreman,worker,other,foremanLogin,workerLogin,otherLogin,crew,source,plant,startTask};
}
