import type { Request } from 'express';
import { z } from 'zod';
import { actor } from '../v2/auth.js';
import { allow, fail, id, type User } from '../v2/core.js';
import { openApi, param, type Api, type Operation } from '../v2/api-contract.js';
import { queries as s } from '../v2/flow.js';
import * as service from '../outcomes/flows.js';
import { cohortInput, inspectInput, snapshotInput, extensionResponse } from '../outcomes/routes.js';
import { runPostgres } from './workflow-store.js';
import { PostgresWorkflowRepository } from './workflow-repository.js';

/** Existing Outcomes transport and domain rules, on the same canonical PostgreSQL registry. */
export function outcomesRoutes(api:Pick<Api,'route'>,repo:PostgresWorkflowRepository) {
 const object=z.object({}).passthrough(),common={response:object},operations:Operation[]=[];
 const route:Api['route']=(op,...handlers)=>{operations.push(op);api.route({...op,path:'/outcomes'+op.path},...handlers);};
 const writer=(a:User)=>allow(a,'admin','coordinator');
 const write=(op:Operation,change:(c:Parameters<typeof runPostgres>[0],a:User,b:any,q:Request)=>Promise<unknown>)=>
  route({...op,idempotent:true},async(q,r)=>{
   const a=actor(r),b=op.input!.parse(q.body),result=await repo.mutate(a,q.method,q.path,q.get('Idempotency-Key'),b as any,op.status??200,writer,c=>change(c,a,b,q));
   r.set('Idempotency-Replayed',String(result.replayed)).status(result.status).json(result.body);
  });
 route({method:'get',path:'/openapi.json',rawResponse:true,response:extensionResponse,summary:'Outcomes transport extension'},(_q,r)=>{const spec=openApi(operations);r.json({...spec,info:{...spec.info,title:'Green Pavlodar — PostgreSQL Outcomes API',version:'2.5.0-cloud-outcomes',description:'Persistent DEMO Outcomes. Production requires HTTPS, secure session cookies, CSRF and idempotency on writes. No SQLite or mock fallback.'},servers:[{url:'/api/v1/outcomes'}]});});
 route({...common,method:'get',path:'/sites/:id',summary:'Specialist/viewer workflow: saved forecasts, validated registry and inspection history'},async(q,r)=>{
  const result=await repo.read(async(input,c)=>runPostgres(c,service.siteOutcomes(s,actor(r),param(q),input.catalog as any)));
  r.json({data:result});
 });
 write({...common,method:'post',path:'/snapshots',status:201,summary:'Capture current tree-only forecast before planting',input:snapshotInput},async(c,a,b)=>{
  const input=await repo.inputs(c),site=input.sites.find(v=>v.zone.id===b.siteId)?.zone;
  if(!site)fail('NOT_FOUND','Zone not found',404);
  return runPostgres(c,service.snapshot(s,a,b,{site,ref:repo.ref(input)} as service.SnapshotInput));
 });
 route({method:'get',path:'/cohorts',summary:'Role-scoped cohorts',response:z.array(object)},async(_q,r)=>r.json({data:await repo.readFlow(service.cohorts(s,actor(r)))}));
 write({...common,method:'post',path:'/cohorts',status:201,summary:'Register immutable cohort from existing trees',input:cohortInput},async(c,a,b)=>
  runPostgres(c,service.createCohort(s,a,b,await repo.list('species',c) as any)));
 route({...common,method:'get',path:'/cohorts/:id',summary:'Read cohort and creation metadata'},async(q,r)=>r.json(await repo.readFlow(service.cohort(s,actor(r),param(q)))));
 route({method:'get',path:'/cohorts/:id/inspections',summary:'Append-only inspection history',response:z.array(object)},async(q,r)=>r.json({data:await repo.readFlow(service.history(s,actor(r),param(q)))}));
 write({...common,method:'post',path:'/cohorts/:id/inspections',status:201,summary:'Coordinator/admin attest inspection with accepted sources',input:inspectInput},(c,a,b,q)=>runPostgres(c,service.inspection(s,a,param(q),b)));
 route({...common,method:'get',path:'/cohorts/:id/summary',summary:'Explicit inspection comparison; absent inspection remains unknown',query:z.object({inspectionId:id.optional()}).strict()},async(q,r)=>{
  const query=z.object({inspectionId:id.optional()}).strict().parse(q.query);
  r.json({data:await repo.readFlow(service.summary(s,actor(r),param(q),query.inspectionId??null))});
 });
}
