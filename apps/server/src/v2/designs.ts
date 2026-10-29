import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../db.js';
import { id,text,shortText,uniqueIds,version,allow,fail,getDoc,parseRow,matchVersion,audit,now,evidence,type User,type Doc } from './core.js';
import { geometry,requireSiteCleared } from './data.js';

// kind/note/origin/conflicts — поля редактора проекта (веб-контракт v1.1): разобранные конфликты хранятся вместе с позицией.
const conflict=z.object({type:z.enum(['exclusion_zone','outside_site','near_building']),message:text,resolution:text.nullable()}).strict();
export const plantingItem=z.object({id,catalogItemId:id,geometry,quantity:z.number().int().positive().max(5000).nullable(),quantityMethod:text.nullable(),spacingM:z.number().positive().nullable().default(null),bedAreaM2:z.number().positive().nullable().default(null),phase:shortText.nullable().default(null),carePolicyId:id.nullable().default(null),evidenceIds:uniqueIds.min(1),
  kind:z.enum(['point','bed']).optional(),note:text.optional(),origin:z.enum(['manual','suggested']).optional(),conflicts:z.array(conflict).max(20).optional()}).strict();
// Черновик может быть пустым (редактор добавляет позиции после создания); на согласование — только с позициями.
const designFields={name:shortText,objective:text,season:shortText.nullable(),contextVersion:version,plantingItems:z.array(plantingItem).max(50),exclusionZones:z.array(geometry).max(20),sourcePhotoIds:uniqueIds.max(0),evidenceIds:uniqueIds.min(1)};
export const designCreate=z.object({siteId:id,...designFields,season:designFields.season.default(null),exclusionZones:designFields.exclusionZones.default([]),sourcePhotoIds:designFields.sourcePhotoIds.default([])}).strict();
// Без значений по умолчанию: .partial() в Zod 4 их сохраняет, и правка затирала бы season, exclusionZones и sourcePhotoIds.
export const designPatch=z.object(designFields).partial().extend({expectedVersion:version}).strict().refine(b=>Object.keys(b).length>1,'No changes');
export const designReview=z.object({expectedVersion:version,decision:z.enum(['approved','changes_requested']),comment:text}).strict();
export function design(s:Store,designId:string) { return parseRow(s.get('SELECT data FROM v2_designs WHERE id=?',designId),'Design'); }
export function approvedRevision(s:Store,designId:string,revision:number) {
  const row=s.get("SELECT data FROM v2_design_revisions WHERE design_id=? AND revision=? AND status='approved'",designId,revision);
  if(!row)fail('DESIGN_NOT_APPROVED','This exact design revision is not approved');return parseRow(row);
}
function validate(s:Store,d:Record<string,any>) {
  const site=getDoc(s,'site',d.siteId);const context=getDoc(s,'context',site.contextId);
  if(context.version!==d.contextVersion)fail('CONTEXT_CHANGED','Design must reference the current site context version');
  if(new Set(d.plantingItems.map((i:any)=>i.id)).size!==d.plantingItems.length)fail('DUPLICATE_PLANTING_ITEM','Planting item IDs must be unique',400);
  evidence(s,d.evidenceIds);
  for(const item of d.plantingItems){getDoc(s,'catalog',item.catalogItemId);evidence(s,item.evidenceIds);if(item.carePolicyId)getDoc(s,'care_policy',item.carePolicyId);}
  return site;
}
function save(s:Store,d:Doc) {
  s.run('UPDATE v2_designs SET revision=?,status=?,version=?,data=? WHERE id=?',d.revision,d.status,d.version,JSON.stringify(d),d.id);
  s.run('INSERT INTO v2_design_revisions VALUES (?,?,?,?) ON CONFLICT(design_id,revision) DO UPDATE SET status=excluded.status,data=excluded.data',d.id,d.revision,d.status,JSON.stringify(d));
  return d;
}
export function createDesign(s:Store,a:User,b:z.infer<typeof designCreate>) {
  allow(a,'coordinator');const site=validate(s,b);const d={...b,id:randomUUID(),revision:1,status:'draft',version:1,createdBy:a.id,createdByName:a.displayName,createdAt:now(),updatedAt:now(),checkSnapshot:site.checks,siteVersion:site.version,estimatedCost:null,costCompleteness:'unknown'};
  s.run('INSERT INTO v2_designs VALUES (?,?,1,\'draft\',1,?)',d.id,d.siteId,JSON.stringify(d));save(s,d);audit(s,a,'design',d.id,'create',null,d);return d;
}
export function patchDesign(s:Store,a:User,designId:string,b:z.infer<typeof designPatch>) {
  allow(a,'coordinator');const before=design(s,designId);matchVersion(before,b.expectedVersion);
  if(before.status==='submitted')fail('DESIGN_UNDER_REVIEW','Request changes before editing a submitted design');
  const{expectedVersion,...patch}=b;const after:Doc={...before,...patch,revision:before.revision+(before.status==='approved'?1:0),status:'draft',version:before.version+1,updatedAt:now(),submittedAt:null,approvedBy:null,approvedAt:null,reviewComment:null};
  const site=validate(s,after);after.checkSnapshot=site.checks;after.siteVersion=site.version;
  save(s,after);audit(s,a,'design',designId,'edit',before,after);return after;
}
export function submitDesign(s:Store,a:User,designId:string,expectedVersion:number) {
  allow(a,'coordinator');const before=design(s,designId);matchVersion(before,expectedVersion);
  if(!['draft','changes_requested'].includes(before.status))fail('INVALID_TRANSITION','Only drafts or requested changes can be submitted');
  if(!before.plantingItems.length)fail('DESIGN_EMPTY','Add at least one planting item before submitting',400);
  const site=validate(s,before);
  const after={...before,status:'submitted',checkSnapshot:site.checks,siteVersion:site.version,submittedAt:now(),version:before.version+1,updatedAt:now()};
  save(s,after);audit(s,a,'design',designId,'submit',before,after);return after;
}
export function reviewDesign(s:Store,a:User,designId:string,b:z.infer<typeof designReview>) {
  allow(a,'admin');const before=design(s,designId);matchVersion(before,b.expectedVersion);if(before.status!=='submitted')fail('INVALID_TRANSITION','Only submitted designs can be reviewed');
  const site=validate(s,before);
  if(b.decision==='approved'){
    requireSiteCleared(site);if(site.version!==before.siteVersion)fail('SITE_CHANGED','Resubmit the project with current site checks');
    for(const item of before.plantingItems){if(item.quantity===null||!item.quantityMethod)fail('QUANTITY_UNKNOWN','Known sourced quantities required for approval');}
  }
  const after={...before,status:b.decision,reviewComment:b.comment,reviewedBy:a.id,reviewedByName:a.displayName,reviewedAt:now(),approvedBy:b.decision==='approved'?a.id:null,approvedByName:b.decision==='approved'?a.displayName:null,approvedAt:b.decision==='approved'?now():null,version:before.version+1,updatedAt:now()};
  save(s,after);audit(s,a,'design',designId,b.decision,before,after);return after;
}
// Coordinator withdraws a submitted design back to draft (before the admin decision).
export function withdrawDesign(s:Store,a:User,designId:string,expectedVersion:number) {
  allow(a,'coordinator');const before=design(s,designId);matchVersion(before,expectedVersion);
  if(before.status!=='submitted')fail('INVALID_TRANSITION','Only a submitted design can be withdrawn');
  const after={...before,status:'draft',submittedAt:null,version:before.version+1,updatedAt:now()};
  save(s,after);audit(s,a,'design',designId,'withdraw',before,after);return after;
}
