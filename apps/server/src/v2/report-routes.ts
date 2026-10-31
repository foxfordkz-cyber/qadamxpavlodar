import { z } from 'zod';
import { existsSync } from 'node:fs';
import { Store } from '../db.js';
import { type Api,param } from './router.js';
import { actor } from './auth.js';
import { allow,parseRow,id,timestamp } from './core.js';
import { page } from './data.js';
import { task,canTask,authorizeForeman } from './tasks.js';
import * as reports from './reports.js';
import { Uploads,multipart } from './uploads.js';
export function reportRoutes(s:Store,api:Api,uploadsPath:string){
  const{route,write}=api;let uploads:Uploads|undefined;
  const storage=()=>uploads??=new Uploads(uploadsPath);
  if(existsSync(uploadsPath))storage().cleanup(s);
  route({method:'post',path:'/uploads',idempotent:true,status:201,multipart:true,input:z.object({taskId:id,file:z.string().meta({format:'binary'})}).strict(),summary:'Assigned participant: private JPEG/PNG/WebP upload, 5 MiB'},(_req,res,next)=>{allow(actor(res),'worker','foreman');next();},multipart,async(req,res)=>{
    const result=await storage().save(s,actor(res),req.body,req.file,req.get('Idempotency-Key'));res.set('Idempotency-Replayed',String(result.replayed)).status(result.status).json(result.body);
  });
  route({method:'get',path:'/uploads/:id',binary:true,summary:'Read private normalized photo within task read scope; viewer allowed, worker draft ownership retained'},(req,res)=>res.set('Content-Disposition','inline; filename="report.webp"').type('image/webp').send(storage().read(s,actor(res),param(req))));
  route({method:'get',path:'/tasks/:id/report-draft',summary:'Read group materials and draft version'},(req,res)=>res.json({data:reports.getDraft(s,actor(res),param(req))}));
  write({method:'put',path:'/tasks/:id/report-draft',input:reports.draftInput,summary:'Own foreman: save group report summary'},(a,req)=>authorizeForeman(s,a,task(s,a,param(req))),(a,b,req)=>reports.editDraft(s,a,param(req),b));
  write({method:'post',path:'/tasks/:id/report-draft/contributions',input:reports.contributionInput,summary:'Assigned participant: edit only own materials'},(a,req)=>{allow(a,'worker','foreman');task(s,a,param(req));},(a,b,req)=>reports.contribute(s,a,param(req),b));
  write({method:'post',path:'/tasks/:id/reports',input:reports.submitInput,status:201,summary:'Submit one report: own foreman for a group, assigned executor for solo task'},(a,req)=>{allow(a,'worker','foreman');task(s,a,param(req));},(a,b,req)=>reports.submit(s,a,param(req),b,req.get('Idempotency-Key')!));
  route({method:'get',path:'/reports',summary:'Viewer reads all reports; workers/foremen retain task scope'},(req,res)=>{
    const q=z.object({reviewStatus:z.enum(['pending','accepted','changes_requested']).optional(),taskId:id.optional(),limit:z.coerce.number().int().min(1).max(200).default(100),offset:z.coerce.number().int().nonnegative().default(0)}).strict().parse(req.query);
    const rows=s.all('SELECT data FROM v2_reports ORDER BY id').map(r=>parseRow(r)).filter(r=>canTask(s,actor(res),parseRow(s.get('SELECT data FROM v2_tasks WHERE id=?',r.taskId)))&&(!q.reviewStatus||r.reviewStatus===q.reviewStatus)&&(!q.taskId||r.taskId===q.taskId));res.json(page(rows,{limit:q.limit,offset:q.offset}));
  });
  route({method:'get',path:'/reports/:id',summary:'Read report within task scope; viewer allowed'},(req,res)=>res.json({data:reports.report(s,actor(res),param(req))}));
  write({method:'post',path:'/reports/:id/review',input:reports.reviewInput,summary:'Coordinator: accept or return; planting and care drafts committed atomically'},(a,req)=>{allow(a,'coordinator');reports.report(s,a,param(req));},(a,b,req)=>reports.review(s,a,param(req),b));
  write({method:'post',path:'/tasks/:id/issues',input:reports.issueInput,status:201,summary:'Record a field issue separately from completion'},(a,req)=>{allow(a,'worker','foreman','coordinator');task(s,a,param(req));},(a,b,req)=>reports.issue(s,a,param(req),b));
  route({method:'get',path:'/tasks/:id/issues',summary:'Read issues and explicitly confirmed observations'},(req,res)=>{task(s,actor(res),param(req));res.json({data:s.all('SELECT data FROM v2_issues WHERE task_id=? ORDER BY created_at,id',param(req)).map(r=>parseRow(r))});});
  route({method:'get',path:'/plants/:id/care-history',summary:'Accepted care events; inspection is not watering'},(req,res)=>{
    allow(actor(res),'admin','coordinator');res.json({data:s.all('SELECT * FROM v2_care_events WHERE object_id=? ORDER BY reviewed_at,id',param(req)).map(r=>({id:r.id,taskId:r.task_id,reportId:r.report_id,action:r.action,reviewedAt:r.reviewed_at,...JSON.parse(String(r.data))}))});
  });
  route({method:'get',path:'/dashboard',summary:'Counts by accepted report reviewedAt; empty sample is explicit'},(req,res)=>{
    allow(actor(res),'admin','coordinator');const q=z.object({from:timestamp,to:timestamp}).strict().refine(x=>x.from<x.to,'from must precede to').parse(req.query);
    const accepted=s.all('SELECT data FROM v2_reports WHERE status=\'accepted\'').map(r=>parseRow(r)).filter(r=>r.reviewedAt>=q.from&&r.reviewedAt<q.to);
    res.json({data:{from:q.from,to:q.to,acceptedReports:accepted.length,empty:accepted.length===0,definition:'Accepted reports with reviewedAt in [from,to); pending reports excluded',method:'database_count'}});
  });
}
