import { Store } from '../db.js';
import { getDoc, getUser, insertDoc, now } from '../v2/core.js';
import { snapshot, createCohort, inspection } from './service.js';
import { today } from './shared.js';
// Explicit opt-in synthetic scenario; uses the existing plant registry, never a second registry.
export function seedOutcomes(s:Store){
 return s.transaction(()=>{
  const cohortId='outcomes-demo-cohort';if(s.get('SELECT id FROM outcome_cohorts WHERE id=?',cohortId))return{cohortId,created:false};
  const a=getUser(s,'demo-coordinator-1'),siteId='site-osm-1569993037',at=now();
  if(!s.get("SELECT id FROM v2_documents WHERE kind='evidence' AND id='outcomes-demo-evidence'"))insertDoc(s,'evidence',{id:'outcomes-demo-evidence',sourceType:'fixture',sourceLabel:'Synthetic outcomes teaching fixture; not field research',dataClass:'demo',isDemo:true,observedAt:at,version:1});
  const f=snapshot(s,a,{id:'outcomes-demo-forecast',siteId,expectedVersion:getDoc(s,'site',siteId).version,variant:'econom'});
  const plantIds:string[]=[];
  for(const item of f.snapshot.analysis.scheme){
   for(let n=0;n<item.quantity;n++){
    const id=`outcomes-demo-tree-${plantIds.length+1}`;plantIds.push(id);
    // Fail on collisions; never overwrite an existing record with fixture data.
    insertDoc(s,'plant',{id,name:'DEMO synthetic outcome tree',kind:'tree',siteId,speciesId:item.speciesId,species:f.snapshot.catalog.find((sp:any)=>sp.id===item.speciesId).latin,plantedAt:at,condition:'unknown',lat:52.28,lng:76.95,evidenceIds:['outcomes-demo-evidence'],isDemo:true,version:1});
   }
  }
  createCohort(s,a,{id:cohortId,siteId,plantIds,plantedOn:today(),snapshotId:f.id,evidenceIds:['outcomes-demo-evidence']});
  inspection(s,a,cohortId,{id:'outcomes-demo-inspection',expectedVersion:1,observedOn:today(),evidenceIds:['outcomes-demo-evidence'],observations:plantIds.slice(0,3).map((plantId,n)=>({plantId,state:['alive','dead','unknown'][n],reportId:null,evidenceIds:['outcomes-demo-evidence']}))});
  return{cohortId,created:true,trees:plantIds.length,isDemo:true};
 });
}
