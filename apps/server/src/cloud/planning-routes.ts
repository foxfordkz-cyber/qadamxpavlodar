import { z } from 'zod';
import { allow, now } from '../v2/core.js';
import { actor } from '../v2/auth.js';
import { page } from '../v2/data.js';
import { param, type Api } from '../v2/api-contract.js';
import { analysisInput } from '../municipal/analysis-input.js';
import { exportAnalysis } from '../municipal/exports.js';
import { decisionLab, priorities } from '../tz/data.js';
import { web } from '../tz/shared.js';
import { PostgresPlanningRepository, planningReader } from './planning-repository.js';

export function planningRoutes({route}:Pick<Api,'route'>,repo:PostgresPlanningRepository) {
  const radius=z.object({radius:z.coerce.number().refine(n=>[30,50,100,200].includes(n),'radius: 30, 50, 100 or 200')}).strict();
  route({method:'get',path:'/zones/:id/context',summary:'Persisted OSM context at 30/50/100/200 m; geometry version checked'},async(q,r)=>{planningReader(actor(r));r.json({data:await repo.context(param(q),radius.parse(q.query).radius)});});
  route({method:'get',path:'/species',summary:'Persisted species, original IDs/prices/provenance'},async(_q,r)=>{planningReader(actor(r));r.json({data:await repo.list('species')});});
  route({method:'get',path:'/rates',summary:'Persisted rates with version; unknown values stay null'},async(_q,r)=>{planningReader(actor(r));r.json({data:await repo.get('settings','rates')});});
  route({method:'get',path:'/layers/sources',summary:'Persisted OSM source version and attribution'},async(_q,r)=>{planningReader(actor(r));r.json({data:await repo.get('settings','osm')});});
  route({method:'get',path:'/reference/facts',summary:'Persisted verified source references; no live weather claim'},async(_q,r)=>{planningReader(actor(r));r.json(await repo.get('settings','reference-facts'));});
  for(const layer of ['soils','greenery','city','zones'])route({method:'get',path:`/layers/${layer}`,summary:'Persisted layer; synthetic soil explicitly labelled'},async(_q,r)=>{planningReader(actor(r));r.json(await repo.get('layer',layer));});
  route({method:'post',path:'/zones/:id/analysis',input:analysisInput,readOnly:true,summary:'Shared calculation over a consistent PostgreSQL input snapshot'},async(q,r)=>{planningReader(actor(r));const b=analysisInput.parse(q.body);r.json({data:await repo.read(input=>repo.analyze(input,param(q),b.options))});});
  route({method:'post',path:'/zones/:id/variants',input:analysisInput,readOnly:true,summary:'Shared econom/optimal/max calculations'},async(q,r)=>{planningReader(actor(r));const b=analysisInput.parse(q.body);r.json({data:await repo.read(input=>web.variantSummaries(b.options,o=>repo.analyze(input,param(q),o)))});});
  route({method:'get',path:'/problems',summary:'Shared explainable problem detection'},async(_q,r)=>{planningReader(actor(r));r.json({data:await repo.read(input=>web.detectProblems(input.sites.map(s=>s.zone)))});});
  const priorityInput=z.object({weights:z.object(Object.fromEntries(Object.keys(web.DEFAULT_PRIORITY_WEIGHTS).map(k=>[k,z.number().min(0).max(100)]))).strict().default(web.DEFAULT_PRIORITY_WEIGHTS).refine(w=>Object.values(w).some(x=>x>0),'At least one positive weight'),budget:z.number().nonnegative().max(1e12).nullable().default(null)}).strict();
  route({method:'post',path:'/priorities',input:priorityInput,readOnly:true,summary:'Shared priority and budget roadmap calculations'},async(q,r)=>{
    planningReader(actor(r));const b=priorityInput.parse(q.body);
    r.json({data:await repo.read(input=>{const sites=input.sites.map(s=>s.zone),items=priorities(sites.filter(s=>s.areaM2!=null&&s.areaM2>0),repo.ref(input),b.weights);return {items,excluded:sites.filter(s=>!s.areaM2||s.areaM2<=0).map(s=>({siteId:s.id,reason:'Missing measured area; no estimate or budget allocation'})),roadmap:b.budget===null?null:web.roadmap(items,b.budget)};})});
  });
  const labInput=z.object({budgetKzt:z.number().finite().positive(),waterLimitM3:z.number().finite().nonnegative().nullable().default(null),watering:z.enum(['regular','rare','none']),goal:z.enum(['balanced','schools','deficit','social']).default('balanced')}).strict();
  route({method:'post',path:'/decision-lab',input:labInput,readOnly:true,summary:'Existing shared Decision Lab using persistent inputs'},async(q,r)=>{planningReader(actor(r));const b=labInput.parse(q.body);r.json({data:await repo.read(input=>decisionLab(input.sites.map(s=>s.zone).filter(s=>s.areaM2!=null&&s.areaM2>0),repo.ref(input),b))});});
  route({method:'get',path:'/dashboard/metrics',summary:'Shared metrics over persisted sites, assignments, reports and projects'},async(_q,r)=>{
    planningReader(actor(r));const data=await repo.read(async(input,c)=>{
      const rows=async(table:string)=>(await c.query('SELECT data FROM gp_cloud.'+table)).rows.map(r=>r.data);
      const projects=[];for(const design of await rows('designs')){
        const revisions=(await c.query('SELECT data FROM gp_cloud.design_revisions WHERE design_id=$1 ORDER BY revision',[design.id])).rows.map(r=>r.data);
        projects.push(web.projectFromDesign(design,revisions));
      }
      return web.dashboardMetrics({sites:input.sites.map(s=>s.zone).filter(s=>s.areaM2!=null&&s.areaM2>0),tasks:(await rows('tasks')).map(web.taskFromV2),reports:await rows('reports'),projects,osmBase:(await repo.get('settings','osm',c)).osm.osmBase});
    });r.json({data,meta:{fetchedAt:now()}});
  });
  const ratesInput=z.object({key:z.string().max(100),value:z.number().nonnegative().max(1e9).nullable(),source:z.string().trim().min(3).max(2000),sourceUrl:z.url().optional(),dataClass:z.enum(['real','demo','estimate']).default('estimate'),expectedVersion:z.number().int().positive()}).strict();
  route({method:'patch',path:'/rates',input:ratesInput,idempotent:true,summary:'Admin: versioned persistent rate update and audit'},async(q,r)=>{
    const a=actor(r),b=ratesInput.parse(q.body),result=await repo.mutate(a,q.method,q.path,q.get('Idempotency-Key'),b,200,a=>allow(a,'admin'),c=>repo.patchRates(c,a,b));
    r.set('Idempotency-Replayed',String(result.replayed)).status(result.status).json(result.body);
  });
  route({method:'post',path:'/zones/:id/snapshots',input:analysisInput,status:201,idempotent:true,summary:'Persist immutable analysis, exact inputs and hash'},async(q,r)=>{
    const a=actor(r),b=analysisInput.parse(q.body),result=await repo.mutate(a,q.method,q.path,q.get('Idempotency-Key'),b,201,a=>allow(a,'admin','coordinator'),c=>repo.saveSnapshot(c,a,param(q),b.options));
    r.set('Idempotency-Replayed',String(result.replayed)).status(result.status).json(result.body);
  });
  route({method:'get',path:'/analysis-snapshots/:id',summary:'Read immutable persisted analysis and inputs'},async(q,r)=>{planningReader(actor(r));r.json({data:await repo.snapshot(param(q))});});
  const exportInput=analysisInput.extend({format:z.enum(['pdf','xlsx'])});
  route({method:'post',path:'/zones/:id/export',input:exportInput,binary:true,readOnly:true,summary:'Existing PDF/XLSX renderer over shared PostgreSQL calculation'},async(q,r)=>{
    planningReader(actor(r));const b=exportInput.parse(q.body),analysis=await repo.read(input=>repo.analyze(input,param(q),b.options));
    r.type(b.format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition',`attachment; filename="zone-${param(q)}.${b.format}"`).send(await exportAnalysis(analysis,b.format));
  });
}
