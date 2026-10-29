import { readFileSync } from 'node:fs';
import { area,centroid,booleanPointInPolygon,point } from '@turf/turf';
import { Store } from '../db.js';
import { fail,now,hash,allow,matchVersion,audit,type User } from '../v2/core.js';
import { createUser } from '../v2/people.js';
import { hashPassword } from '../v2/auth.js';
import { DEMO_PASSWORD } from '../v2/seed.js';
import { DEFAULT_RATES,ratesMap,type RateEntry } from './vendor/rates.js';
import { species,speciesEvidence,priceEvidence,pavlodarEvidence } from './vendor/species.js';
import { analyzeZone,type PlanOptions } from './vendor/plan.js';
import { contextEvidence } from './vendor/context.js';
import type { CandidateSite } from './vendor/types.js';
export function state(s:Store,key:string,fallback:any){const r=s.get('SELECT data,version FROM municipal_state WHERE key=?',key);return r?{data:JSON.parse(String(r.data)),version:Number(r.version)}:{data:fallback,version:1};}
export function putState(s:Store,key:string,data:any,version=1){s.run('INSERT INTO municipal_state VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,version=excluded.version',key,JSON.stringify(data),version);}
export function rates(s:Store):{rates:RateEntry[];version:number}{const r=state(s,'rates',DEFAULT_RATES);return{rates:r.data,version:r.version};}
export function patchRate(s:Store,a:User,b:any){allow(a,'admin');const before=rates(s);matchVersion(before,b.expectedVersion);const next=structuredClone(before.rates),r=next.find(x=>x.key===b.key);if(!r)fail('NOT_FOUND','Rate not found',404);
  if(b.value!==null&&((r.unit.includes('%')&&b.value>100)||(r.unit==='доля'&&(b.value<=0||b.value>1))))fail('RATE_RANGE','Value outside unit range',400);
  Object.assign(r,{value:b.value,source:b.source,sourceUrl:b.sourceUrl??undefined,dataClass:b.dataClass??'estimate',updatedAt:now(),updatedBy:a.id});
  putState(s,'rates',next,before.version+1);audit(s,a,'rates',b.key,'update',before,{rates:next,version:before.version+1});return rates(s);
}
export function features(s:Store,layer:string){return s.all('SELECT data FROM municipal_features WHERE layer=? ORDER BY id',layer).map(r=>JSON.parse(String(r.data)));}
export function sites(s:Store):CandidateSite[]{
  const imported=features(s,'zones').filter(f=>['Point','Polygon','MultiPolygon'].includes(f.geometry.type)).map(f=>{const c=centroid(f).geometry.coordinates;return{id:f.properties.id,name:f.properties.name??'Imported zone',geometry:f.geometry,centroid:{lng:c[0],lat:c[1]},areaM2:f.geometry.type==='Point'?null:area(f),factors:Object.fromEntries(['greeneryGap','publicUsePriority','waterAvailability','maintenanceFeasibility'].map(k=>[k,{value:null,evidenceIds:[],method:'Not measured'}])),checks:Object.fromEntries(['landPermission','utilities','access','siteSuitability'].map(k=>[k,{state:'unknown'}])),evidenceIds:[],missingData:[{field:'checks',reason:'Field checks required'}],isDemo:f.properties.dataClass!=='real',version:1,provenance:f.properties};});
  return [...state(s,'sites',[]).data,...imported];
}
export function site(s:Store,id:string){const value=sites(s).find(x=>x.id===id);if(!value)fail('NOT_FOUND','Zone not found',404);return value;}
export function catalog(s:Store){return [...state(s,'species',species).data,...features(s,'catalog').map(f=>f.properties)] as typeof species;}
export function evidence(s:Store){return [...state(s,'evidence',[]).data,speciesEvidence,priceEvidence,contextEvidence,...pavlodarEvidence,...s.all('SELECT id,data,committed_at FROM municipal_imports WHERE committed_at IS NOT NULL').map(r=>{const d=JSON.parse(String(r.data));return{id:`import-${r.id}`,sourceType:'manual',sourceLabel:d.source,sourceUrl:d.sourceUrl,observedAt:d.observedAt,dataClass:d.dataClass,note:`Imported ${r.committed_at}; user-declared provenance, not independently verified`};})];}
export function withSoil(s:Store,site:CandidateSite){
  const zone=structuredClone(site),soil=features(s,'soils').find(f=>['Polygon','MultiPolygon'].includes(f.geometry.type)&&booleanPointInPolygon(point([zone.centroid!.lng,zone.centroid!.lat]),f));
  if(soil)(zone as any).soilOverride={cellId:soil.properties.id,type:String(soil.properties.type??'Imported soil'),ph:Number(soil.properties.ph),salinity:soil.properties.salinity,moisture:String(soil.properties.moisture??'unknown'),fertility:String(soil.properties.fertility??'unknown'),synthetic:soil.properties.dataClass!=='real'};
  return{zone,soil};
}
export const analysisSites=(s:Store)=>sites(s).map(x=>withSoil(s,x).zone);
export const calculationSites=(s:Store)=>analysisSites(s).filter(x=>x.areaM2!==null&&x.areaM2!==undefined&&x.areaM2>0);
export function calculationRates(s:Store){const current=rates(s);
  // Never convert an unknown mandatory rate into a zero-cost or certain prediction.
  const missing=current.rates.filter(r=>r.value===null&&!['eff.dust.tree','eff.population'].includes(r.key)).map(r=>r.key);
  if(missing.length)fail('MISSING_RATES',`Supply mandatory coefficients before calculation: ${missing.join(', ')}`,422);
  return current;
}
export function analyze(s:Store,id:string,options:Partial<PlanOptions>){
  const {zone,soil}=withSoil(s,site(s,id)),current=calculationRates(s);
  if(zone.areaM2===null||zone.areaM2===undefined||zone.areaM2<=0)fail('MISSING_AREA','A measured positive area is required; import a polygon before calculating costs or effects',422);
  const known=new Set(catalog(s).map(x=>x.id));for(const x of [...(options.locked??[]),...(options.excluded??[]),...Object.keys(options.replacements??{}),...Object.values(options.replacements??{})])if(!known.has(x))fail('UNKNOWN_SPECIES','Unknown species in options',400);
  const result=analyzeZone(zone,catalog(s),ratesMap(current.rates),options);
  return {...result,inputSnapshot:{zone,catalog:catalog(s),rates:current,options},provenance:{method:'team-expert-rules',calibrated:false,estimated:true,ratesVersion:current.version,inputHash:hash({zone,catalog:catalog(s),rates:current,options}),generatedAt:now(),soilSource:soil?.properties??'synthetic demo soil',sources:evidence(s)},assumptions:[...result.assumptions,'All forecasts are expert estimates, not calibrated municipal measurements.']};
}
export async function seedMunicipal(s:Store){
  const adminRow=s.get("SELECT id FROM v2_users WHERE role='admin' LIMIT 1");if(!adminRow)fail('SEED_ORDER','Run seed:v2 first',400);
  const admin={id:String(adminRow.id),displayName:'Seed',role:'admin' as const,active:true,version:1};
  for(const role of ['specialist','viewer'] as const)if(!s.get('SELECT id FROM v2_users WHERE login=?',role))createUser(s,admin,{login:role,displayName:`DEMO ${role}`,role,password:DEMO_PASSWORD},await hashPassword(DEMO_PASSWORD));
  const osm=JSON.parse(readFileSync(new URL('../../fixtures/sites.json',import.meta.url),'utf8'));
  s.transaction(()=>{for(const[key,value]of Object.entries({sites:osm.sites,evidence:osm.evidence,species,rates:DEFAULT_RATES,greenery:JSON.parse(readFileSync(new URL('../../fixtures/greenery.json',import.meta.url),'utf8'))}))if(!s.get('SELECT key FROM municipal_state WHERE key=?',key))putState(s,key,value);});
  return{sites:sites(s).length,species:catalog(s).length,mode:'OSM + explicitly labelled team estimates'};
}
