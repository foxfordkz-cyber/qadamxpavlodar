import { randomBytes } from 'node:crypto';
import { Store } from '../db.js';
import { hashPassword } from './auth.js';
import { now } from './core.js';
import { checkNames } from './data.js';
// Пароль демо-аккаунтов — только из окружения (apps/server/.env, образец в .env.example), не из кода.
// Если его нет, seed генерирует случайный и возвращает его один раз (печатает seed-cli).
export const DEMO_PASSWORD=process.env.DEMO_PASSWORD??'';
export function demoPassword(){
  if(DEMO_PASSWORD&&DEMO_PASSWORD.length<12)throw new Error('DEMO_PASSWORD must be at least 12 characters');
  return DEMO_PASSWORD||generated;
}
const generated=`demo-${randomBytes(9).toString('base64url')}`;
// [id, login, role, displayName]: три роли ТЗ (Администратор, Специалист, Просмотр) и кабинеты бригады.
export const demoAccounts=[['demo-admin-1','admin','admin','Администратор (демо)'],['demo-coordinator-1','coordinator','coordinator','Специалист (демо)'],
  ['demo-viewer-1','viewer','viewer','Просмотр (демо)'],
  ['demo-foreman-1','foreman1','foreman','Бригадир 1 (демо)'],['demo-foreman-2','foreman2','foreman','Бригадир 2 (демо)'],
  ...[1,2,3,4].map(i=>[`demo-worker-${i}`,`worker${i}`,'worker',`Работник ${i} (демо)`])] as const;
export async function seedV2(s:Store) {
  const credentials=new Map<string,string>();
  for(const[userId,login]of demoAccounts)if(!s.get('SELECT id FROM v2_users WHERE id=? OR login=? COLLATE NOCASE',userId,login))credentials.set(userId!,await hashPassword(demoPassword()));
  s.transaction(()=>{
    for(const[userId,login,role,displayName]of demoAccounts){
      if(credentials.has(userId!))s.run('INSERT INTO v2_users VALUES (?,?,?,?,1,?,1,?,?)',userId!,login!,displayName!,role!,credentials.get(userId!)!,now(),now());
      if(role==='worker'||role==='foreman'){
        const p={userId,shiftStart:'2026-10-28T03:00:00.000Z',shiftEnd:login==='worker4'?'2026-10-28T07:00:00.000Z':'2026-10-28T12:00:00.000Z',capacityMinutes:login==='worker4'?240:480,skills:['inspect','plant','water','weed'],unavailableIntervals:[],startLocation:null,version:1};
        s.run('INSERT INTO v2_profiles VALUES (?,?,1) ON CONFLICT(user_id) DO NOTHING',userId!,JSON.stringify(p));
      }
    }
    for(const n of [1,2]){
      const c={id:`demo-crew-${n}`,name:`DEMO Бригада ${n}`,foremanId:`demo-foreman-${n}`,active:true,resourceIds:[],version:1};
      s.run('INSERT INTO v2_crews VALUES (?,?,?,1,?,1) ON CONFLICT(id) DO NOTHING',c.id,c.name,c.foremanId,JSON.stringify(c));
      for(const worker of n===1?[1,2]:[3,4])s.run('INSERT INTO v2_memberships VALUES (?,?,?,?,NULL,1) ON CONFLICT(id) DO NOTHING',`demo-membership-${worker}`,c.id,`demo-worker-${worker}`,'2026-10-27T00:00:00.000Z');
    }
    const add=(kind:string,data:Record<string,any>)=>s.run('INSERT INTO v2_documents VALUES (?,?,?,?) ON CONFLICT(kind,id) DO NOTHING',kind,data.id,JSON.stringify(data),data.version??1);
    add('evidence',{id:'demo-v2-evidence',sourceType:'fixture',sourceLabel:'DEMO synthetic V2 scenario; not a municipal register',sourceUrl:null,observedAt:'2026-10-28T00:00:00.000Z',validUntil:null,dataClass:'demo',note:'All quantities, geometry, resources and care intervals are synthetic',version:1});
    add('care_policy',{id:'demo-care-policy',label:'DEMO inspect after 7 days; not an agronomic recommendation',applicableKinds:['tree','shrub','flowerbed'],allowedActions:['inspect'],intervals:{inspect:7},waterLiters:null,constraints:['DEMO only; no watering norm'],sourceEvidenceIds:['demo-v2-evidence'],reviewedBy:null,isDemo:true,version:1});
    for(const row of s.all('SELECT * FROM plants'))add('plant',{id:row.id,name:row.name,kind:'tree',species:row.species,plantedAt:null,lat:row.latitude,lng:row.longitude,condition:row.condition==='needs_care'?'attention':'unknown',lastVerifiedCareAt:null,carePolicyId:null,evidenceIds:['demo-v2-evidence'],isDemo:true,version:1});
    for(let i=1;i<=8;i++)add('catalog',{id:`demo-catalog-${i}`,displayName:`DEMO растение каталога ${i}`,botanicalName:null,kind:i<=3?'tree':i<=6?'shrub':'flowerbed',colors:[],bloomPeriod:null,lightRequirement:null,soilRequirement:null,moistureRequirement:null,climateSuitabilityNotes:null,matureHeightM:null,spreadM:null,spacingM:null,carePolicyId:i===1?'demo-care-policy':null,unitCost:null,currency:null,priceDate:null,stockQuantity:null,evidenceIds:['demo-v2-evidence'],reviewedBy:null,isDemo:true,version:1});
    for(const row of s.all('SELECT * FROM candidate_sites')){
      const cleared=row.id==='demo-site-1';const blocked=row.id==='demo-site-3';
      const siteChecks=Object.fromEntries(checkNames.map(key=>[key,{status:cleared?'cleared':blocked&&key==='utilities'?'blocked':'unknown',comment:cleared?'DEMO synthetic clearance only':'DEMO field check required',reviewedBy:cleared?'demo-coordinator-1':null,reviewedAt:cleared?'2026-10-28T00:00:00.000Z':null}]));
      add('context',{id:`context-${row.id}`,siteId:row.id,radiusM:100,features:[{id:`building-${row.id}`,featureType:'building',geometry:{type:'Polygon',coordinates:[[[Number(row.longitude)+.0003,Number(row.latitude)],[Number(row.longitude)+.0004,Number(row.latitude)],[Number(row.longitude)+.0004,Number(row.latitude)+.0001],[Number(row.longitude)+.0003,Number(row.latitude)]]]},name:null,address:null,mappedUse:null,heightM:null,distanceM:null,distanceMethod:null,evidenceIds:['demo-v2-evidence']}],sourceEvidenceIds:['demo-v2-evidence'],fetchedAt:'2026-10-28T00:00:00.000Z',missingData:['Synthetic geometry, no verified map source','Distances and underground utilities unknown'],isDemo:true,version:1});
      add('site',{id:row.id,name:row.name,geometry:{type:'Point',coordinates:[row.longitude,row.latitude]},areaM2:null,isIntersection:row.id==='demo-site-1',factors:Object.fromEntries(['greeneryGap','publicUsePriority','waterAvailability','maintenanceFeasibility'].map(k=>[k,{value:null,evidenceIds:[],method:null}])),checks:siteChecks,contextId:`context-${row.id}`,currentDesignId:null,evidenceIds:['demo-v2-evidence'],missingData:['No field survey; DEMO geometry'],isDemo:true,version:1});
    }
    add('resource',{id:'demo-water',label:'DEMO shared water 100 L',type:'water',ownerCrewId:null,capacity:100,unit:'L',availableIntervals:[{start:'2026-10-28T03:00:00.000Z',end:'2026-10-28T12:00:00.000Z'}],evidenceIds:['demo-v2-evidence'],version:1});
    add('resource',{id:'demo-vehicle',label:'DEMO shared vehicle',type:'vehicle',ownerCrewId:null,capacity:1,unit:'vehicle',availableIntervals:[{start:'2026-10-28T03:00:00.000Z',end:'2026-10-28T12:00:00.000Z'}],evidenceIds:['demo-v2-evidence'],version:1});
  });
  return{mode:'DEMO',accounts:demoAccounts.map(([id,login,role])=>({id,login,role})),crews:2,generatedPassword:credentials.size&&!DEMO_PASSWORD?generated:null};
}
// Opt-in scenario rows for the demo CLI. Tests compose their own risky scenarios.
export function seedV2Scenario(s:Store){s.transaction(()=>{
  for(let i=1;i<=12;i++){
    const taskId=`demo-v2-task-${i}`,status=i===1?'in_progress':i===2?'submitted':'draft';
    const assigned=i<=2,reportId=i===2?'demo-v2-report-2':null;
    const t={id:taskId,objectType:'plant',objectId:`demo-plant-${i}`,action:'inspect',description:`DEMO V2 inspection ${i}`,priority:'medium',priorityWeight:50,estimatedMinutes:15,requiredWaterLiters:null,minWorkers:1,requiredSkills:['inspect'],dueAt:null,evidenceIds:['demo-v2-evidence'],createdAt:'2026-10-28T00:00:00.000Z',updatedAt:'2026-10-28T00:00:00.000Z',status,version:1,isDemo:true,assignedCrewId:assigned?'demo-crew-2':null,assignedWorkerIds:assigned?['demo-worker-3']:[],resourceIds:[],scheduledStart:assigned?`2026-10-28T0${i+2}:00:00.000Z`:null,scheduledEnd:assigned?`2026-10-28T0${i+2}:15:00.000Z`:null,planId:null,approvedDesignId:null,approvedDesignVersion:null,latestReportId:reportId};
    const inserted=s.run('INSERT INTO v2_tasks VALUES (?,?,?,NULL,NULL,1,?) ON CONFLICT(id) DO NOTHING',taskId,status,t.assignedCrewId,JSON.stringify(t));
    if(inserted.changes&&assigned)s.run('INSERT INTO v2_assignments VALUES (?,?)',taskId,'demo-worker-3');
    if(inserted.changes)s.run('INSERT INTO v2_history VALUES (?,?,?,?,?,NULL,?,?)',`history-${taskId}`,'task',taskId,'demo-coordinator-1','seed_scenario',JSON.stringify(t),'2026-10-28T00:00:00.000Z');
    if(reportId&&inserted.changes){const r={id:reportId,taskId,authorId:'demo-worker-3',contributorIds:[],actualWorkerIds:['demo-worker-3'],actualPlantingItems:[],createdAt:'2026-10-28T00:00:00.000Z',photoIds:[],note:'DEMO pending review fixture',location:null,confirmedObservation:null,foremanCheckedAt:null,foremanCheckedBy:null,reviewStatus:'pending',reviewerId:null,reviewComment:null,reviewedAt:null,idempotencyKey:'seed-report-2',revision:1,version:1};s.run('INSERT INTO v2_reports VALUES (?,?,1,?,\'pending\',1,?)',r.id,taskId,r.authorId,JSON.stringify(r));}
  }
  for(const status of['draft','submitted','approved']){
    const d={id:`demo-design-${status}`,siteId:'demo-site-1',revision:1,status,name:`DEMO перекрёсток — ${status}`,objective:'Synthetic versioned planting scenario',contextVersion:1,plantingItems:[{id:'demo-bed-1',catalogItemId:'demo-catalog-1',geometry:{type:'MultiPoint',coordinates:[[76.951,52.281],[76.9511,52.2811]]},quantity:2,quantityMethod:'DEMO explicit specialist input',spacingM:null,bedAreaM2:null,phase:null,carePolicyId:'demo-care-policy',evidenceIds:['demo-v2-evidence']}],exclusionZones:[],sourcePhotoIds:[],checkSnapshot:JSON.parse(String(s.get("SELECT data FROM v2_documents WHERE kind='site' AND id='demo-site-1'")!.data)).checks,siteVersion:1,estimatedCost:null,costCompleteness:'unknown',evidenceIds:['demo-v2-evidence'],createdBy:'demo-coordinator-1',createdAt:'2026-10-28T00:00:00.000Z',updatedAt:'2026-10-28T00:00:00.000Z',submittedAt:status==='draft'?null:'2026-10-28T00:00:00.000Z',approvedBy:status==='approved'?'demo-admin-1':null,approvedAt:status==='approved'?'2026-10-28T00:00:00.000Z':null,reviewComment:status==='approved'?'DEMO seeded approval state, not a real permit':null,version:1};
    const inserted=s.run('INSERT INTO v2_designs VALUES (?,?,1,?,1,?) ON CONFLICT(id) DO NOTHING',d.id,d.siteId,status,JSON.stringify(d));
    if(inserted.changes)s.run('INSERT INTO v2_design_revisions VALUES (?,1,?,?)',d.id,status,JSON.stringify(d));
  }
});}
