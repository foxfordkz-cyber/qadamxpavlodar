import { z } from 'zod';
import { Store } from '../db.js';
import { defineApi, openApi, param } from '../v2/router.js';
import { authenticate, actor } from '../v2/auth.js';
import { allow, id, version, uniqueIds } from '../v2/core.js';
import * as service from './service.js';
const object=z.object({}).passthrough();
const common={response:object};
const cohortInput=z.object({id,siteId:id,plantIds:uniqueIds.min(1),plantedOn:z.iso.date().nullable(),snapshotId:id.nullable(),evidenceIds:uniqueIds,expectedVersion:z.literal(0)}).strict();
const observation=z.object({plantId:id,state:z.enum(['alive','dead','unknown']),reportId:id.nullable(),evidenceIds:uniqueIds}).strict();
const inspectInput=z.object({id,observedOn:z.iso.date(),observations:z.array(observation).max(100),evidenceIds:uniqueIds,expectedVersion:version}).strict();
export function outcomesRouter(s:Store){
 const api=defineApi(s),{route,write,router}=api;router.use(authenticate(s));
 const writer=(a:Parameters<typeof service.canRead>[1])=>allow(a,'admin','coordinator');
 route({method:'get',path:'/openapi.json',summary:'Outcomes transport extension'},(_req,res)=>res.json({...openApi(api.operations),servers:[{url:'/api/v1/outcomes'}]}));
 write({...common,method:'post',path:'/snapshots',status:201,summary:'Capture current tree-only forecast before planting',input:z.object({id,siteId:id,expectedVersion:version,variant:z.enum(['econom','optimal','max']).default('optimal')}).strict()},writer,(a,b)=>service.snapshot(s,a,b));
 route({method:'get',path:'/cohorts',summary:'Role-scoped cohorts',response:z.array(object)},(_req,res)=>res.json({data:service.cohorts(s,actor(res))}));
 write({...common,method:'post',path:'/cohorts',status:201,summary:'Register immutable cohort from existing trees',input:cohortInput},writer,(a,b)=>service.createCohort(s,a,b));
 route({...common,method:'get',path:'/cohorts/:id',summary:'Read cohort and creation metadata'},(req,res)=>res.json(service.cohort(s,actor(res),param(req))));
 route({method:'get',path:'/cohorts/:id/inspections',summary:'Append-only inspection history',response:z.array(object)},(req,res)=>res.json({data:service.history(s,actor(res),param(req))}));
 write({...common,method:'post',path:'/cohorts/:id/inspections',status:201,summary:'Coordinator/admin attest inspection with accepted sources',input:inspectInput},writer,(a,b,req)=>service.inspection(s,a,param(req),b));
 route({...common,method:'get',path:'/cohorts/:id/summary',summary:'Explicit inspection comparison; absent inspection remains unknown',query:z.object({inspectionId:id.optional()}).strict()},(req,res)=>{
  const q=z.object({inspectionId:id.optional()}).strict().parse(req.query);res.json({data:service.summary(s,actor(res),param(req),q.inspectionId??null)});
 });return router;
}
