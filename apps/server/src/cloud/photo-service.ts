import { createHash,randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ImageNormalizer } from '../photos.js';
import { ApiError } from '../errors.js';
import { fail,hash,now,type User } from '../v2/core.js';
import { queries } from '../v2/flow.js';
import { fresh } from '../v2/flows/core.js';
import { uploadActor } from '../v2/flows/uploads.js';
import { task } from '../v2/flows/tasks.js';
import { uploadFields,uploadDto } from '../v2/uploads.js';
import { runPostgres } from './workflow-store.js';
import { PostgresWorkflowRepository } from './workflow-repository.js';
import { SupabasePrivateStorage,type StoredPhoto } from './private-storage.js';

const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
type Intent={id:string;owner_id:string;task_id:string;key:string;request_hash:string;storage_name:string;sha256:string;byte_size:number;state:string};
export class CloudPhotos {
  private readonly normalizer=new ImageNormalizer();
  constructor(readonly repo:PostgresWorkflowRepository,readonly storage:SupabasePrivateStorage|undefined){}
  private configured(){if(!this.storage)fail('PHOTO_STORAGE_NOT_CONFIGURED','Configure private storage before uploading or reading photos',503);return this.storage;}
  private async authorize(c:PoolClient,a:User,taskId:string){await runPostgres(c,fresh(queries,a));return runPostgres(c,uploadActor(queries,a,taskId));}
  private async writable(c:PoolClient,a:User,taskId:string){
    const t=await this.authorize(c,a,taskId);if(t.status!=='in_progress')fail('REPORT_LOCKED','Upload task materials while in_progress');
    if((await c.query('SELECT count(*)::int n FROM gp_cloud.uploads WHERE task_id=$1',[taskId])).rows[0].n>=50)fail('PHOTO_LIMIT','At most 50 uploads per task');
  }
  async save(a:User,fields:unknown,file:Express.Multer.File|undefined,key:string|undefined){
    const b=uploadFields.parse(fields);await this.repo.readFlow(uploadActor(queries,a,b.taskId));
    if(!file)fail('PHOTO_REQUIRED','One file field is required',400);
    if(!key||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key))fail('INVALID_IDEMPOTENCY_KEY','Supply Idempotency-Key',400);
    const storage=this.configured(),bytes=await this.normalizer.normalize(file.buffer);
    const body={taskId:b.taskId,sha256:sha(file.buffer)},requestHash=hash(body);
    // Durable reservation precedes remote I/O. Crashes cannot leave an untracked server-created object.
    const reservation=await this.repo.db.transaction(async c=>{
      await c.query('SELECT pg_advisory_xact_lock(733112623)');await this.authorize(c,a,b.taskId);
      const old=(await c.query("SELECT * FROM gp_cloud.idempotency WHERE actor_id=$1 AND method='POST' AND path='/uploads' AND key=$2",[a.id,key])).rows[0];
      if(old){if(old.request_hash!==requestHash)fail('IDEMPOTENCY_CONFLICT','Key already used with a different request');return {receipt:{status:old.response_status,body:old.response_json,replayed:true}};}
      await this.writable(c,a,b.taskId);
      let intent=(await c.query('SELECT * FROM gp_cloud.upload_intents WHERE owner_id=$1 AND key=$2',[a.id,key])).rows[0] as Intent|undefined;
      if(intent){
        if(intent.request_hash!==requestHash)fail('IDEMPOTENCY_CONFLICT','Key already used with a different request');
        if(intent.state==='committed')fail('PHOTO_UNAVAILABLE','Committed photo receipt needs reconciliation',503);
        if(intent.sha256!==sha(bytes)||intent.byte_size!==bytes.length)fail('PHOTO_UNAVAILABLE','Normalization changed; reconcile the reserved object',503);
        await c.query("UPDATE gp_cloud.upload_intents SET state='pending',updated_at=$1 WHERE id=$2",[now(),intent.id]);
      }else{
        const reserved=(await c.query("SELECT (SELECT count(*) FROM gp_cloud.uploads WHERE task_id=$1)+(SELECT count(*) FROM gp_cloud.upload_intents WHERE task_id=$1 AND state='pending') AS n",[b.taskId])).rows[0];
        if(Number(reserved.n)>=50)fail('PHOTO_LIMIT','At most 50 stored or pending photos per task');
        const id=randomUUID();intent={id,owner_id:a.id,task_id:b.taskId,key,request_hash:requestHash,storage_name:'demo/'+id+'.webp',sha256:sha(bytes),byte_size:bytes.length,state:'pending'};
        await c.query("INSERT INTO gp_cloud.upload_intents VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$9)",[id,a.id,b.taskId,key,requestHash,intent.storage_name,intent.sha256,intent.byte_size,now()]);
      }
      return {intent};
    });
    if(reservation.receipt)return reservation.receipt;
    const intent=reservation.intent!;
    return this.repo.mutate(a,'POST','/uploads',key,body,201,async(_a,c)=>{await this.authorize(c,a,b.taskId);},async c=>{
      await this.writable(c,a,b.taskId);
      const current=(await c.query('SELECT state FROM gp_cloud.upload_intents WHERE id=$1',[intent.id])).rows[0];
      if(current?.state!=='pending')fail('PHOTO_RETRY_REQUIRED','Upload reservation changed; retry the same request',503);
      const photo:StoredPhoto={name:intent.storage_name,sha256:intent.sha256,byteSize:intent.byte_size};
      // The write lock also excludes reconciliation; it can never delete a concurrently finalized object.
      try{await storage.put(photo.name,bytes);}catch(error){
        if(!(error instanceof ApiError)||error.code!=='STORAGE_OBJECT_EXISTS')throw error;
        await storage.read(photo); // A retry may reuse only the exact immutable object, never overwrite it.
      }
      const row=(await c.query('INSERT INTO gp_cloud.uploads VALUES ($1,$2,$3,NULL,$4,$5,$6,$7) RETURNING *',[intent.id,b.taskId,a.id,photo.name,photo.sha256,photo.byteSize,now()])).rows[0];
      await c.query("UPDATE gp_cloud.upload_intents SET state='committed',updated_at=$1 WHERE id=$2",[now(),intent.id]);
      return uploadDto(row);
    });
  }
  async read(a:User,id:string){
    const row=await this.repo.db.transaction(async c=>{
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await runPostgres(c,fresh(queries,a));const row=(await c.query('SELECT * FROM gp_cloud.uploads WHERE id=$1',[id])).rows[0];
      if(!row)fail('NOT_FOUND','Upload not found',404);await runPostgres(c,task(queries,a,row.task_id));
      if(row.report_id===null&&row.owner_id!==a.id&&a.role==='worker')fail('NOT_FOUND','Upload not found',404);
      return row;
    });
    return this.configured().read({name:row.storage_name,sha256:row.sha256,byteSize:row.byte_size});
  }
  /** Explicit maintenance only: no bucket listing, public objects, committed photos or user volumes. */
  async reconcile(cutoff:string,apply=false){
    const storage=this.configured();
    return this.repo.db.transaction(async c=>{
      await c.query('SELECT pg_advisory_xact_lock(733112623)');
      const rows=(await c.query("SELECT i.id,i.storage_name FROM gp_cloud.upload_intents i WHERE i.state='pending' AND i.updated_at<$1 AND NOT EXISTS(SELECT 1 FROM gp_cloud.uploads p WHERE p.storage_name=i.storage_name) ORDER BY i.updated_at,i.id LIMIT 100 FOR UPDATE",[cutoff])).rows;
      if(apply)for(const row of rows){await storage.remove(row.storage_name);await c.query("UPDATE gp_cloud.upload_intents SET state='cleaned',updated_at=$1 WHERE id=$2",[now(),row.id]);}
      return {candidates:rows.length,cleaned:apply?rows.length:0,dryRun:!apply};
    });
  }
}
