import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../db.js';
import { type Api,param } from './router.js';
import { actor } from './auth.js';
import { allow,fail,version,text,shortText,getDoc,insertDoc,updateDoc,audit,now,matchVersion } from './core.js';
import { design } from './designs.js';
export const visualizationInput=z.object({expectedVersion:version,designRevision:version,method:z.enum(['schematic','generated','recorded_demo']),seasonLabel:shortText,growthStageLabel:shortText}).strict();
export function visualizationRoutes(s:Store,api:Api){
  api.write({method:'post',path:'/designs/:id/visualizations',input:visualizationInput,status:201,summary:'Persist a schematic scene tied to the design revision; generation unavailable'},a=>allow(a,'coordinator'),(a,b,req)=>{
    const d=design(s,param(req));matchVersion(d,b.expectedVersion);if(d.revision!==b.designRevision)fail('DESIGN_REVISION_CONFLICT','Read the current design revision');
    if(b.method!=='schematic')fail('INTEGRATION_UNAVAILABLE','No image-generation or recorded-demo adapter is connected',503);
    const site=getDoc(s,'site',d.siteId),context=getDoc(s,'context',site.contextId);if(context.version!==d.contextVersion)fail('CONTEXT_CHANGED','Refresh the design context');
    const visual=insertDoc(s,'visualization',{id:randomUUID(),designId:d.id,designRevision:d.revision,sourcePhotoId:null,method:'schematic',seasonLabel:b.seasonLabel,growthStageLabel:b.growthStageLabel,assetId:null,status:'ready',consistencyStatus:'unreviewed',reviewedBy:null,sourceEvidenceIds:[...new Set([...context.sourceEvidenceIds,...d.evidenceIds])],generatedAt:now(),isDemo:true,version:1,
      scene:{type:'FeatureCollection',features:[...context.features.map((f:any)=>({type:'Feature',id:f.id,geometry:f.geometry,properties:{layer:'context',...f,geometry:undefined}})),...d.plantingItems.map((p:any)=>({type:'Feature',id:p.id,geometry:p.geometry,properties:{layer:'planned_planting',catalogItemId:p.catalogItemId,quantity:p.quantity}}))]},label:'DEMO top-down scheme; not as-built documentation',missingData:context.missingData});
    audit(s,a,'visualization',visual.id,'create',null,visual);return visual;
  });
  api.route({method:'get',path:'/visualizations/:id',summary:'Read scheme with computed stale flag'},(req,res)=>{allow(actor(res),'admin','coordinator');const v=getDoc(s,'visualization',param(req));res.json({data:{...v,stale:design(s,v.designId).revision!==v.designRevision}});});
  api.write({method:'post',path:'/visualizations/:id/review',input:z.object({expectedVersion:version,consistencyStatus:z.enum(['accepted','needs_changes']),comment:text}).strict(),summary:'Coordinator: record human consistency check; cannot approve stale scheme'},a=>allow(a,'coordinator'),(a,b,req)=>{
    const v=getDoc(s,'visualization',param(req));matchVersion(v,b.expectedVersion);if(design(s,v.designId).revision!==v.designRevision)fail('VISUALIZATION_STALE','Scheme belongs to an older design revision');
    const after=updateDoc(s,'visualization',{...v,consistencyStatus:b.consistencyStatus,reviewComment:b.comment,reviewedBy:a.id,reviewedAt:now(),version:v.version+1},v.version);audit(s,a,'visualization',v.id,'review',v,after);return after;
  });
}
