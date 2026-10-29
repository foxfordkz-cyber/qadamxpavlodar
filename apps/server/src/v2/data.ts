import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../db.js';
import { id,shortText,text,version,timestamp,uniqueIds,intervals,allow,fail,evidence,audit,getDoc,listDocs,insertDoc,updateDoc,matchVersion,now,type User,type Doc,type Kind } from './core.js';

const position=z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90)]);
export const point=z.object({type:z.literal('Point'),coordinates:position}).strict();
export const multiPoint=z.object({type:z.literal('MultiPoint'),coordinates:z.array(position).min(1).max(200)}).strict();
const ring=z.array(position).min(4).max(500).refine(r=>JSON.stringify(r[0])===JSON.stringify(r.at(-1)),'Polygon ring must be closed');
export const geometry=z.discriminatedUnion('type',[point,multiPoint,z.object({type:z.literal('Polygon'),coordinates:z.array(ring).min(1).max(10)}).strict()]);
export const plantInput=z.object({name:shortText,kind:z.enum(['tree','shrub','flowerbed']),species:shortText.nullable().default(null),plantedAt:timestamp.nullable().default(null),lat:z.number().min(-90).max(90),lng:z.number().min(-180).max(180),condition:z.enum(['unknown','observed_ok','needs_inspection','attention']).default('unknown'),carePolicyId:id.nullable().default(null),evidenceIds:uniqueIds.min(1),isDemo:z.literal(true).default(true)}).strict();
export const plantPatch=plantInput.partial().extend({expectedVersion:version}).strict();
const check=z.object({status:z.enum(['unknown','cleared','blocked','not_applicable']),comment:text}).strict();
export const checkNames=['landPermission','utilities','access','siteSuitability','trafficVisibility'] as const;
export const checks=z.object(Object.fromEntries(checkNames.map(n=>[n,check])) as Record<typeof checkNames[number],typeof check>).strict();
export const sitePatch=z.object({expectedVersion:version,name:shortText.optional(),geometry:geometry.optional(),checks:checks.partial().optional(),isIntersection:z.boolean().optional()}).strict();
export const resourceInput=z.object({label:shortText,type:z.enum(['vehicle','water','equipment','material']),ownerCrewId:id.nullable().default(null),capacity:z.number().positive().nullable().default(null),unit:shortText.nullable().default(null),availableIntervals:intervals.min(1),evidenceIds:uniqueIds.min(1)}).strict();
export const resourcePatch=resourceInput.partial().extend({expectedVersion:version}).strict();
export const catalogInput=z.object({displayName:shortText,botanicalName:shortText.nullable().default(null),kind:z.enum(['tree','shrub','flowerbed']),colors:z.array(shortText).max(20).default([]),bloomPeriod:shortText.nullable().default(null),lightRequirement:text.nullable().default(null),soilRequirement:text.nullable().default(null),moistureRequirement:text.nullable().default(null),climateSuitabilityNotes:text.nullable().default(null),matureHeightM:z.number().nonnegative().nullable().default(null),spreadM:z.number().positive().nullable().default(null),spacingM:z.number().positive().nullable().default(null),carePolicyId:id.nullable().default(null),unitCost:z.number().nonnegative().nullable().default(null),currency:z.string().regex(/^[A-Z]{3}$/).nullable().default(null),priceDate:z.iso.date().nullable().default(null),stockQuantity:z.number().int().nonnegative().nullable().default(null),evidenceIds:uniqueIds.min(1),isDemo:z.literal(true).default(true)}).strict()
  .refine(b=>b.unitCost===null||(b.currency!==null&&b.priceDate!==null),'Known prices require currency and date');
export const catalogPatch=z.object(catalogInput.shape).partial().extend({expectedVersion:version}).strict();
export const evidenceInput=z.object({sourceType:z.enum(['municipal','field_report','weather','care_reference','manual','fixture','map_data','catalog','source_photo']),sourceLabel:shortText,sourceUrl:z.url().nullable().default(null),observedAt:timestamp.nullable().default(null),validUntil:timestamp.nullable().default(null),dataClass:z.enum(['demo','estimate']),note:text.nullable().default(null)}).strict();
export const carePolicyInput=z.object({label:shortText,applicableKinds:z.array(z.enum(['tree','shrub','flowerbed'])).min(1),allowedActions:z.array(z.enum(['inspect','water','weed'])).min(1),intervals:z.partialRecord(z.enum(['inspect','water','weed']),z.number().positive()).default({}),waterLiters:z.number().positive().nullable().default(null),constraints:z.array(text).default([]),sourceEvidenceIds:uniqueIds.min(1),isDemo:z.literal(true).default(true)}).strict();
export function validateReferences(s:Store,body:Record<string,any>) {
  if(body.evidenceIds)evidence(s,body.evidenceIds);
  if(body.sourceEvidenceIds)evidence(s,body.sourceEvidenceIds);
  if(body.carePolicyId)getDoc(s,'care_policy',body.carePolicyId);
  if(body.ownerCrewId&&!s.get('SELECT id FROM v2_crews WHERE id=?',body.ownerCrewId))fail('INVALID_REFERENCE','Owner crew not found',400);
}
export function createData(s:Store,a:User,kind:Kind,body:Record<string,any>) {
  validateReferences(s,body);const result=insertDoc(s,kind,{...body,id:randomUUID(),version:1,createdAt:now(),updatedAt:now(),...(kind==='plant'?{lastVerifiedCareAt:null}:{})});audit(s,a,kind,result.id,'create',null,result);return result;
}
export function patchData(s:Store,a:User,kind:Kind,objectId:string,body:Record<string,any>) {
  const before=getDoc(s,kind,objectId);matchVersion(before,body.expectedVersion);const{expectedVersion,...patch}=body;validateReferences(s,patch);
  if(kind==='site'&&patch.checks){patch.checks={...before.checks,...Object.fromEntries(Object.entries(patch.checks).map(([key,value])=>[key,{...(value as object),reviewedBy:a.id,reviewedAt:now()}]))};}
  const after:Doc={...before,...patch,version:before.version+1,updatedAt:now()};
  if(kind==='catalog')catalogInput.parse(Object.fromEntries(Object.entries(after).filter(([k])=>!['id','version','createdAt','updatedAt','reviewedBy'].includes(k))));
  if(kind==='site'&&after.isIntersection&&after.checks.trafficVisibility.status==='not_applicable')fail('TRAFFIC_CHECK_REQUIRED','Intersection visibility cannot be not_applicable',400);
  updateDoc(s,kind,after,before.version);audit(s,a,kind,objectId,'update',before,after);return after;
}
export function requireSiteCleared(site:Doc) {
  for(const key of checkNames){const c=site.checks[key];if(!c||!['cleared','not_applicable'].includes(c.status)||!c.comment||!c.reviewedBy||!c.reviewedAt)fail('SITE_CHECKS_INCOMPLETE',`Site check ${key} is not cleared`);
    if(key==='trafficVisibility'&&site.isIntersection&&c.status!=='cleared')fail('SITE_CHECKS_INCOMPLETE','Intersection visibility must be cleared');}
}
export const listQuery=z.object({limit:z.coerce.number().int().min(1).max(200).default(100),offset:z.coerce.number().int().nonnegative().default(0)}).strict();
export function page<T>(values:T[],query:unknown){const{limit,offset}=listQuery.parse(query);return{data:values.slice(offset,offset+limit),meta:{limit,offset,total:values.length}};}
