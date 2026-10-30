import { Store } from '../db.js';
import { ApiError } from '../errors.js';
import { allow, fail, getDoc, maybeDoc, parseRow, now, matchVersion, audit, type User } from '../v2/core.js';
import { allTasks, canTask } from '../v2/tasks.js';
import { candidate, reference, analyze, speciesList } from '../tz/data.js';
import { shared, today, day, type Json } from './shared.js';

function validate<T>(work:()=>T):T {
 try{return work();}catch(e){
  if(e instanceof Error && e.name==='OutcomeValidationError')throw new ApiError(400,(e as any).code,e.message,{field:(e as any).field});
  throw e;
 }
}
const metadata=(row:Json)=>({createdAt:row.created_at,createdBy:row.created_by??row.reviewer_id});
export function canRead(s:Store,a:User,c:Json) {
 if(['admin','coordinator','specialist','viewer'].includes(a.role))return true;
 // Explicit task links only; coordinate proximity never establishes ownership.
 const tasks=allTasks(s).filter(t=>canTask(s,a,t));
 return tasks.some(t=>t.objectType==='candidate_site'&&t.objectId===c.siteId)||c.plants.every((p:Json)=>tasks.some(t=>t.objectType==='plant'&&t.objectId===p.plantId));
}
export function cohort(s:Store,a:User,id:string){const row=s.get('SELECT * FROM outcome_cohorts WHERE id=?',id);const c=parseRow(row,'Cohort');if(!canRead(s,a,c))fail('NOT_FOUND','Cohort not found',404);return{data:c,meta:metadata(row!)};}
export function cohorts(s:Store,a:User){return s.all('SELECT * FROM outcome_cohorts ORDER BY created_at,id').map(r=>({data:parseRow(r),meta:metadata(r)})).filter(r=>canRead(s,a,r.data));}
export function registry(s:Store,plantId:string){
 const p=getDoc(s,'plant',plantId);if(p.kind!=='tree')fail('TREE_ONLY','MVP requires individually registered trees',400);
 const receipt=s.get("SELECT r.data AS report,t.data AS task FROM v2_planting_receipts x JOIN v2_reports r ON r.id=x.report_id JOIN v2_tasks t ON t.id=x.task_id WHERE x.plant_id=? AND r.status='accepted'",plantId);
 const report=receipt?JSON.parse(String(receipt.report)):null,t=receipt?JSON.parse(String(receipt.task)):null;
 const siteId=p.siteId??(t?.objectType==='candidate_site'?t.objectId:null);
 if(!siteId)fail('PLANT_SITE_UNCONFIRMED','Plant requires an explicit site or accepted planting receipt',400);
 if(p.siteId&&t&&t.objectId!==p.siteId)fail('PLANT_SITE_CONFLICT','Registry and planting receipt disagree',400);
 const catalog=speciesList(s).filter(sp=>sp.id===p.speciesId||sp.latin===p.species);
 if(catalog.length!==1)fail('SPECIES_UNCONFIRMED','Registry species must match exactly one catalog species',400);
 const date=p.plantedAt??report?.createdAt??null;
 return{plantId,speciesId:catalog[0]!.id,siteId,kind:'tree',plantedOn:date?day(date):null,isDemo:p.isDemo===true};
}
function provenance(s:Store,isDemo:boolean,evidenceIds:string[],siteId:string){
 for(const id of evidenceIds)getDoc(s,'evidence',id);
 return{source:'api',capturedAt:now(),dataClass:isDemo?'demo':'real',isDemo,evidenceIds,siteVersion:getDoc(s,'site',siteId).version,ratesVersion:null};
}
export function snapshot(s:Store,a:User,b:Json){
 allow(a,'admin','coordinator');if(s.get('SELECT id FROM outcome_snapshots WHERE id=?',b.id))fail('DUPLICATE_ID','Snapshot already exists');
 const site=candidate(s,b.siteId), ref=reference(s);matchVersion(getDoc(s,'site',b.siteId),b.expectedVersion);
 const analysis=analyze(site,ref,{variant:b.variant,careYears:3,excluded:ref.species.filter(sp=>sp.form!=='tree').map(sp=>sp.id)});
 const p={source:'api',capturedAt:now(),dataClass:'estimate',isDemo:true,evidenceIds:site.evidenceIds??[],siteVersion:site.version??null,ratesVersion:ref.version};
 const result=validate(()=>shared.createOutcomeSnapshot({id:b.id,site,analysis,catalog:ref.species,rates:ref.rates,provenance:p}));
 s.run('INSERT INTO outcome_snapshots(id,site_id,data,created_at,created_by) VALUES (?,?,?,?,?)',b.id,b.siteId,JSON.stringify(result),p.capturedAt,a.id);
 audit(s,a,'outcome_snapshot',b.id,'create',null,{id:b.id,siteId:b.siteId});return{id:b.id,snapshot:result,createdAt:p.capturedAt};
}
export function createCohort(s:Store,a:User,b:Json){
 allow(a,'admin','coordinator');if(s.get('SELECT id FROM outcome_cohorts WHERE id=?',b.id))fail('DUPLICATE_ID','Cohort already exists');
 getDoc(s,'site',b.siteId);const plants=b.plantIds.map((id:string)=>registry(s,id));
 for(const id of b.plantIds)if(s.get('SELECT plant_id FROM outcome_members WHERE plant_id=?',id))fail('PLANT_ALREADY_IN_COHORT','Tree already belongs to an original cohort');
 let forecast=null;if(b.snapshotId){const row=s.get('SELECT data FROM outcome_snapshots WHERE id=?',b.snapshotId);if(!row)fail('NOT_FOUND','Snapshot not found',404);forecast=JSON.parse(String(row!.data));}
 const p=provenance(s,plants.some((v:Json)=>v.isDemo),b.evidenceIds,b.siteId);
 const c=validate(()=>shared.createOutcomeCohort({id:b.id,siteId:b.siteId,plants:plants.map((v:Json)=>({plantId:v.plantId,speciesId:v.speciesId})),plantedOn:b.plantedOn,forecast,provenance:p,version:1},plants,today()));
 s.run('INSERT INTO outcome_cohorts(id,site_id,snapshot_id,data,version,created_at,created_by) VALUES (?,?,?,?,1,?,?)',c.id,c.siteId,b.snapshotId,JSON.stringify(c),p.capturedAt,a.id);
 for(const v of plants)s.run('INSERT INTO outcome_members(cohort_id,plant_id) VALUES (?,?)',c.id,v.plantId);
 audit(s,a,'outcome_cohort',c.id,'create',null,c);return c;
}
function confirmObservation(s:Store,c:Json,o:Json,observedOn:string){
 if(!c.plants.some((p:Json)=>p.plantId===o.plantId))fail('FOREIGN_PLANT','Observation outside cohort',400);
 let confirmed=false;
 if(o.reportId){
  const row=s.get('SELECT * FROM v2_reports WHERE id=?',o.reportId);if(!row)fail('INVALID_REPORT','Report not found',400);
  const report=parseRow(row);const t=parseRow(s.get('SELECT data FROM v2_tasks WHERE id=?',report.taskId));
  if(row.status!=='accepted'||report.reviewStatus!=='accepted'||!report.reviewerId||!report.reviewedAt)fail('UNACCEPTED_REPORT','Report must be accepted and reviewed',400);
  if(t.objectType!=='plant'||t.objectId!==o.plantId||t.action!=='inspect')fail('REPORT_TARGET_MISMATCH','Require an inspection report for this tree',400);
  // Existing V2 report has no structured alive/dead assertion. Do not interpret prose or late watering.
  // Coordinator explicitly attests state when submitting this immutable inspection with accepted evidence.
  if(day(report.createdAt)!==observedOn)fail('REPORT_DATE_MISMATCH','Observation must match the report calendar day',400);
  confirmed=true;
 }
 for(const id of o.evidenceIds){
  const e=getDoc(s,'evidence',id);
  if(c.provenance.isDemo&&id==='outcomes-demo-evidence'&&e.sourceType==='fixture'&&e.dataClass==='demo')confirmed=true;
  else if(!o.reportId)fail('UNCONFIRMED_EVIDENCE','Evidence alone is not an accepted plant inspection',400);
 }
 if(o.state!=='unknown'&&!confirmed)fail('UNCONFIRMED_OBSERVATION','Alive/dead requires accepted report or labelled demo fixture',400);
}
export function inspection(s:Store,a:User,cohortId:string,b:Json){
 allow(a,'admin','coordinator');const c=cohort(s,a,cohortId).data;matchVersion(c,b.expectedVersion);
 if(s.get('SELECT id FROM outcome_inspections WHERE id=? OR (cohort_id=? AND observed_on=?)',b.id,cohortId,b.observedOn))fail('DUPLICATE_INSPECTION','One immutable inspection per cohort and day');
 for(const o of b.observations)confirmObservation(s,c,o,b.observedOn);
 const p=provenance(s,c.provenance.isDemo,b.evidenceIds,c.siteId);
 const i={id:b.id,cohortId,observedOn:b.observedOn,observations:b.observations,provenance:p,version:1};
 validate(()=>shared.summarizeOutcomeInspection(c,i,today()));
 s.run('INSERT INTO outcome_inspections VALUES (?,?,?,?,?,?)',i.id,cohortId,i.observedOn,JSON.stringify(i),p.capturedAt,a.id);
 for(const o of i.observations)s.run('INSERT INTO outcome_sources(inspection_id,plant_id,report_id) VALUES (?,?,?)',i.id,o.plantId,o.reportId);
 const after={...c,version:c.version+1};
 s.run('UPDATE outcome_cohorts SET data=?,version=? WHERE id=? AND version=?',JSON.stringify(after),after.version,c.id,c.version);
 audit(s,a,'outcome_inspection',i.id,'accept',null,i);return i;
}
export function history(s:Store,a:User,id:string){cohort(s,a,id);return s.all('SELECT * FROM outcome_inspections WHERE cohort_id=? ORDER BY observed_on,id',id).map(row=>({data:parseRow(row),meta:{createdAt:row.created_at,reviewerId:row.reviewer_id}}));}
export function summary(s:Store,a:User,id:string,inspectionId:string|null){
 const c=cohort(s,a,id).data;let i=null;
 if(inspectionId){const row=s.get('SELECT data FROM outcome_inspections WHERE id=? AND cohort_id=?',inspectionId,id);if(!row)fail('NOT_FOUND','Inspection not found',404);i=parseRow(row);}
 return{summary:validate(()=>shared.summarizeOutcomeInspection(c,i,today())),comparison:validate(()=>shared.compareOutcomeForecast(c,i,today())),asOf:today()};
}
