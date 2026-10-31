import { referenceDataRoutes, SqliteReferenceRepository } from './reference-data.js';
import { z } from 'zod';
import { Store } from '../db.js';
import { type Api,param } from './router.js';
import { actor } from './auth.js';
import { allow,expected,getDoc,listDocs,parseRow,fail,type User,type Kind } from './core.js';
import * as d from './data.js';
import * as designs from './designs.js';
import * as tasks from './tasks.js';

export function domainRoutes(s:Store,api:Api){
  const{route,write}=api;
  const managers=(a:User)=>allow(a,'admin','coordinator'),coordinator=(a:User)=>allow(a,'coordinator'),admin=(a:User)=>allow(a,'admin');
  function visible(a:User,kind:Kind,objectId:string){
    if(a.role==='admin'||a.role==='coordinator'||a.role==='specialist'||a.role==='viewer')return true;
    return tasks.allTasks(s).some(t=>tasks.canTask(s,a,t)&&t.objectType===(kind==='plant'?'plant':'candidate_site')&&t.objectId===objectId);
  }
  function requireVisible(a:User,kind:Kind,objectId:string){if(!visible(a,kind,objectId))fail('NOT_FOUND','Object not found',404);}
  route({method:'get',path:'/plants',summary:'V2 plants; workers see only assigned object context'},(req,res)=>{
    const q=d.listQuery.extend({condition:z.enum(['unknown','observed_ok','needs_inspection','attention']).optional()}).parse(req.query);
    const items=listDocs(s,'plant').filter(p=>visible(actor(res),'plant',p.id)&&(!q.condition||p.condition===q.condition));res.json(d.page(items,{limit:q.limit,offset:q.offset}));
  });
  route({method:'get',path:'/plants/geojson',summary:'V2 map points, coordinates [lng,lat]'},(req,res)=>{
    const result=d.page(listDocs(s,'plant').filter(p=>visible(actor(res),'plant',p.id)),req.query);
    res.json({data:{type:'FeatureCollection',features:result.data.map(p=>({type:'Feature',id:p.id,geometry:{type:'Point',coordinates:[p.lng,p.lat]},properties:p}))},meta:result.meta});
  });
  route({method:'get',path:'/plants/:id',summary:'Plant detail'},(req,res)=>{requireVisible(actor(res),'plant',param(req));res.json({data:getDoc(s,'plant',param(req))});});
  write({method:'post',path:'/plants',input:d.plantInput,status:201,summary:'Coordinator: register a sourced DEMO plant'},coordinator,(a,b)=>d.createData(s,a,'plant',b));
  write({method:'patch',path:'/plants/:id',input:d.plantPatch,summary:'Coordinator: update a plant with expectedVersion'},coordinator,(a,b,req)=>d.patchData(s,a,'plant',param(req),b));
  route({method:'get',path:'/sites',summary:'Role-scoped candidate sites and explicit checks'},(req,res)=>res.json(d.page(listDocs(s,'site').filter(p=>visible(actor(res),'site',p.id)),req.query)));
  route({method:'get',path:'/sites/:id',summary:'Site detail'},(req,res)=>{requireVisible(actor(res),'site',param(req));res.json({data:getDoc(s,'site',param(req))});});
  write({method:'patch',path:'/sites/:id',input:d.sitePatch,summary:'Record human site checks with server reviewer and time'},managers,(a,b,req)=>d.patchData(s,a,'site',param(req),b));
  route({method:'get',path:'/sites/:id/context',summary:'Stored context with provenance; no live mapping claim'},(req,res)=>{requireVisible(actor(res),'site',param(req));const site=getDoc(s,'site',param(req));res.json({data:getDoc(s,'context',site.contextId)});});
  for(const[kind,path,input,patch,authorize]of [
    ['catalog','/plant-catalog',d.catalogInput,d.catalogPatch,managers],
    ['care_policy','/care-policies',d.carePolicyInput,null,managers]
  ] as const){
    route({method:'get',path,query:d.listQuery,summary:`Read ${kind} with sources; worker catalog is scoped to assigned approved revisions`},(req,res)=>{
      const a=actor(res);allow(a,'admin','coordinator','viewer','foreman',...(kind==='catalog'?['worker' as const]:[]));
      let rows=listDocs(s,kind);
      if(a.role==='worker'){
        const catalogIds=new Set<string>();
        for(const t of tasks.allTasks(s).filter(t=>tasks.canTask(s,a,t)&&t.approvedDesignId&&t.approvedDesignVersion)){
          const revision=designs.approvedRevision(s,t.approvedDesignId,t.approvedDesignVersion);
          for(const item of revision.plantingItems)catalogIds.add(item.catalogItemId);
        }
        rows=rows.filter(row=>catalogIds.has(row.id));
      }
      res.json(d.page(rows,req.query));
    });
    write({method:'post',path,input,status:201,summary:`Create ${kind}`},authorize,(a,b)=>d.createData(s,a,kind,b));
    if(patch)write({method:'patch',path:path+'/:id',input:patch,summary:`Update ${kind} with expectedVersion`},authorize,(a,b,req)=>d.patchData(s,a,kind,param(req),b));
  }
  referenceDataRoutes(api,new SqliteReferenceRepository(s));
  function designAccess(a:User,designId:string){
    if(a.role==='admin'||a.role==='coordinator'||a.role==='specialist'||a.role==='viewer')return;
    if(!tasks.allTasks(s).some(t=>t.approvedDesignId===designId&&tasks.canTask(s,a,t)))fail('NOT_FOUND','Design not found',404);
  }
  route({method:'get',path:'/designs',summary:'Coordinator/admin/viewer: design proposals'},(req,res)=>{allow(actor(res),'admin','coordinator','viewer');res.json(d.page(s.all('SELECT data FROM v2_designs ORDER BY id').map(r=>parseRow(r)),req.query));});
  route({method:'get',path:'/designs/:id',summary:'Design with immutable approved revisions'},(req,res)=>{designAccess(actor(res),param(req));
    const revisions=s.all('SELECT data FROM v2_design_revisions WHERE design_id=? ORDER BY revision',param(req)).map(r=>parseRow(r));
    if(['admin','coordinator','specialist','viewer'].includes(actor(res).role))res.json({data:{...designs.design(s,param(req)),revisions}});
    else{const allowed=tasks.allTasks(s).filter(t=>t.approvedDesignId===param(req)&&tasks.canTask(s,actor(res),t)).map(t=>t.approvedDesignVersion);res.json({data:{id:param(req),revisions:revisions.filter(r=>allowed.includes(r.revision))}});}
  });
  write({method:'post',path:'/designs',input:designs.designCreate,status:201,summary:'Coordinator: create a design draft'},coordinator,(a,b)=>designs.createDesign(s,a,b));
  write({method:'patch',path:'/designs/:id',input:designs.designPatch,summary:'Edit; approved design creates a new revision'},coordinator,(a,b,req)=>designs.patchDesign(s,a,param(req),b));
  write({method:'post',path:'/designs/:id/submit',input:expected,summary:'Coordinator: submit exact design version'},coordinator,(a,b,req)=>designs.submitDesign(s,a,param(req),b.expectedVersion));
  write({method:'post',path:'/designs/:id/withdraw',input:expected,summary:'Coordinator: withdraw a submitted design back to draft'},coordinator,(a,b,req)=>designs.withdrawDesign(s,a,param(req),b.expectedVersion));
  write({method:'post',path:'/designs/:id/review',input:designs.designReview,summary:'Admin: approve or request changes with comment'},admin,(a,b,req)=>designs.reviewDesign(s,a,param(req),b));
  write({method:'post',path:'/designs/:id/create-tasks',input:tasks.designTasks,status:201,summary:'Coordinator: release approved revision once'},coordinator,(a,b,req)=>tasks.createDesignTasks(s,a,param(req),b));
  route({method:'get',path:'/tasks',query:tasks.taskQuery,summary:'Viewer reads all assignments; workers/foremen retain scope; date uses scheduledStart or dueAt in UTC+5 [start,end)'},(req,res)=>res.json(tasks.listTasks(s,actor(res),req.query)));
  route({method:'get',path:'/tasks/:id',summary:'Task detail with reports; viewer reads all, workers/foremen retain assignment scope'},(req,res)=>{const task=tasks.task(s,actor(res),param(req));res.json({data:{...task,reports:s.all('SELECT data FROM v2_reports WHERE task_id=? ORDER BY revision',task.id).map(r=>parseRow(r))}});});
  route({method:'get',path:'/tasks/:id/history',summary:'Task change history with actor, time and snapshots'},(req,res)=>{tasks.task(s,actor(res),param(req));res.json({data:s.all("SELECT * FROM v2_history WHERE entity_type='task' AND entity_id=? ORDER BY created_at,id",param(req)).map(r=>({id:r.id,actorId:r.actor_id,action:r.action,before:r.before_json?JSON.parse(String(r.before_json)):null,after:JSON.parse(String(r.after_json)),createdAt:r.created_at}))});});
  write({method:'post',path:'/tasks',input:tasks.taskCreate,status:201,summary:'Coordinator: create a manual care/inspection draft'},coordinator,(a,b)=>tasks.insertTask(s,a,b));
  write({method:'post',path:'/tasks/:id/assign',input:tasks.assignInput,summary:'Coordinator: assign crew and interval, clear unconfirmed composition'},coordinator,(a,b,req)=>tasks.assign(s,a,param(req),b));
  write({method:'post',path:'/tasks/:id/assign-workers',input:tasks.assignWorkersInput,summary:'Own foreman: confirm active workers, skills and availability'},(a,req)=>tasks.authorizeForeman(s,a,tasks.task(s,a,param(req))),(a,b,req)=>tasks.assignWorkers(s,a,param(req),b));
  write({method:'post',path:'/tasks/:id/start',input:expected,summary:'Assigned executor or own foreman: start after revalidation'},(a,req)=>{allow(a,'worker','foreman');tasks.task(s,a,param(req));},(a,b,req)=>tasks.start(s,a,param(req),b.expectedVersion));
}
