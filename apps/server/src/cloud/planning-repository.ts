import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { allow, fail, hash, matchVersion, now, userDto, type User } from '../v2/core.js';
import { analyzeInputs, withSoilInputs, checkedRates } from '../municipal/data.js';
import { web, type Json } from '../tz/shared.js';
import { PostgresDatabase } from './database.js';

export const planningReader=(a:User)=>allow(a,'admin','coordinator','viewer');
export class PostgresPlanningRepository {
  constructor(readonly db:PostgresDatabase) {}
  async list(kind:string,c:Pick<PoolClient,'query'>=this.db.pool):Promise<Json[]> {
    return (await c.query('SELECT data FROM gp_cloud.planning_documents WHERE kind=$1 ORDER BY position,id',[kind])).rows.map(r=>r.data);
  }
  async get(kind:string,id:string,c:Pick<PoolClient,'query'>=this.db.pool):Promise<Json> {
    const row=(await c.query('SELECT data FROM gp_cloud.planning_documents WHERE kind=$1 AND id=$2',[kind,id])).rows[0];
    if(!row)fail(kind==='settings'?'CLOUD_DATA_MISSING':'NOT_FOUND',kind==='settings'?'Run the explicit cloud planning seed':'Object not found',kind==='settings'?503:404);
    return row.data;
  }
  async context(id:string,radius:number) {
    const row=(await this.db.pool.query(`SELECT x.data,x.site_version,d.version FROM gp_cloud.zone_contexts x
      JOIN gp_cloud.planning_documents d ON d.kind=x.site_kind AND d.id=x.site_id WHERE x.site_id=$1 AND x.radius=$2`,[id,radius])).rows[0];
    if(!row)fail('NOT_FOUND','Zone context not found',404);
    if(row.site_version!==row.version)fail('CONTEXT_STALE','Context needs to be regenerated for the current geometry',409);
    return row.data;
  }
  async inputs(c:PoolClient) {
    const rows=await this.list('site',c),catalog=await this.list('species',c);
    const order=await this.get('settings','site-order',c),position=new Map<string,number>(order.ids.map((id:string,i:number)=>[id,i]));
    // Municipal calculations preserve source order for equal-priority ties; the public V2 list stays ID-ordered.
    rows.sort((a,b)=>(position.get(a.id)??Number.MAX_SAFE_INTEGER)-(position.get(b.id)??Number.MAX_SAFE_INTEGER));
    const current=await this.get('settings','rates',c),sources=await this.get('settings','sources',c),soils=await this.get('settings','imported-soils',c);
    return {sites:rows.map(web.siteFromV2).map(s=>withSoilInputs(s as any,soils.features)),catalog,current:current as any,sources:sources.sources};
  }
  async read<T>(fn:(input:Awaited<ReturnType<PostgresPlanningRepository['inputs']>>,c:PoolClient)=>Promise<T>|T) {
    return this.db.transaction(async c=>{
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      return fn(await this.inputs(c),c);
    });
  }
  analyze(input:Awaited<ReturnType<PostgresPlanningRepository['inputs']>>,id:string,options:Json) {
    const found=input.sites.find(s=>s.zone.id===id);if(!found)fail('NOT_FOUND','Zone not found',404);
    return analyzeInputs({...found,catalog:input.catalog as any,current:input.current,sources:input.sources},options);
  }
  async snapshot(id:string) {
    const row=(await this.db.pool.query('SELECT data FROM gp_cloud.analysis_snapshots WHERE id=$1',[id])).rows[0];
    if(!row)fail('NOT_FOUND','Snapshot not found',404);return row.data;
  }
  // Same transaction boundary as the reference slice: permissions precede replay, late errors roll back everything.
  async mutate(a:User,method:string,path:string,key:string|undefined,body:Json,status:number,authorize:(a:User)=>void,change:(c:PoolClient)=>Promise<unknown>) {
    return this.db.transaction(async c=>{
      const row=(await c.query('SELECT * FROM gp_cloud.users WHERE id=$1 FOR UPDATE',[a.id])).rows[0];
      if(!row)fail('SESSION_REVOKED','Sign in again',401);
      const current=userDto(row);if(!current.active||current.version!==a.version||current.role!==a.role)fail('SESSION_REVOKED','Sign in again',401);
      authorize(current);
      if(!key||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key))fail('INVALID_IDEMPOTENCY_KEY','Supply Idempotency-Key',400);
      const requestHash=hash(body),old=(await c.query('SELECT * FROM gp_cloud.idempotency WHERE actor_id=$1 AND method=$2 AND path=$3 AND key=$4',[a.id,method,path,key])).rows[0];
      if(old){if(old.request_hash!==requestHash)fail('IDEMPOTENCY_CONFLICT','Key already used with a different request');return {status:old.response_status,body:old.response_json,replayed:true};}
      const response={data:await change(c)};
      await c.query('INSERT INTO gp_cloud.idempotency VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[a.id,method,path,key,requestHash,status,JSON.stringify(response),now()]);
      return {status,body:response,replayed:false};
    });
  }
  async saveSnapshot(c:PoolClient,a:User,siteId:string,options:Json) {
    // All planning writers and seed take this lock while capturing a complete input snapshot.
    await c.query('SELECT pg_advisory_xact_lock(733112623)');
    const result=this.analyze(await this.inputs(c),siteId,options),id=randomUUID();
    await c.query('INSERT INTO gp_cloud.analysis_snapshots(id,site_id,actor_id,input_hash,data,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [id,siteId,a.id,result.provenance.inputHash,JSON.stringify(result),now()]);
    return {id,...result};
  }
  async patchRates(c:PoolClient,a:User,b:Json) {
    await c.query('SELECT pg_advisory_xact_lock(733112623)');
    const before=await this.get('settings','rates',c);matchVersion({version:before.version},b.expectedVersion);
    const next=structuredClone(before),rate=next.rates.find((r:Json)=>r.key===b.key);
    if(!rate)fail('NOT_FOUND','Rate not found',404);
    if(b.value!==null&&((rate.unit.includes('%')&&b.value>100)||(rate.unit==='доля'&&(b.value<=0||b.value>1))))fail('RATE_RANGE','Value outside unit range',400);
    Object.assign(rate,{value:b.value,source:b.source,sourceUrl:b.sourceUrl??undefined,dataClass:b.dataClass??'estimate',updatedAt:now(),updatedBy:a.id});next.version++;
    await c.query("UPDATE gp_cloud.planning_documents SET data=$1,version=$2 WHERE kind='settings' AND id='rates'",[JSON.stringify(next),next.version]);
    await c.query("INSERT INTO gp_cloud.planning_history VALUES ($1,'settings','rates',$2,'update',$3,$4,$5)",[randomUUID(),a.id,JSON.stringify(before),JSON.stringify(next),now()]);
    return next;
  }
  ref(input:Awaited<ReturnType<PostgresPlanningRepository['inputs']>>) {return {species:input.catalog,rates:checkedRates(input.current).rates,map:web.ratesMap(input.current.rates),version:input.current.version};}
}
