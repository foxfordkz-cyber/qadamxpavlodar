import type { Doc } from "./core.js";
import * as workflow from "./flows/uploads.js";
import { runSync, queries } from "./flow.js";
import { randomUUID,createHash } from 'node:crypto';
import { writeFileSync,readFileSync,linkSync,unlinkSync,lstatSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { Store,type Row } from '../db.js';
import { PhotoStorage,MAX_PHOTO_BYTES } from '../photos.js';
import { id,now,allow,fail,mutate,type User } from './core.js';
import { task,authorizeForeman } from './tasks.js';
export const uploadFields=z.object({taskId:id}).strict();
export const multipart=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_PHOTO_BYTES,files:1,fields:1,fieldSize:100,parts:2}}).single('file');
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export const uploadDto=(r:Row)=>({id:r.id,taskId:r.task_id,ownerId:r.owner_id,reportId:r.report_id,sha256:r.sha256,byteSize:r.byte_size,mediaType:'image/webp',createdAt:r.created_at,contentUrl:`/api/v1/uploads/${r.id}`});
export function uploadActor(s:Store,a:User,taskId:string): Doc { return runSync(s, workflow.uploadActor(queries, a, taskId)); }
export class Uploads {
  readonly files:PhotoStorage;
  constructor(root:string){this.files=new PhotoStorage(root);}
  path(name:string,temp=false){if(!/^[0-9a-f-]{36}\.(webp|tmp)$/.test(name))fail('INVALID_STORAGE_NAME','Invalid photo name',500);return join(temp?this.files.temporary:this.files.root,name);}
  remove(name:string,temp=false){try{const path=this.path(name,temp);if(lstatSync(path).isFile())unlinkSync(path);}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}}
  async save(s:Store,a:User,fields:unknown,file:Express.Multer.File|undefined,key:string|undefined){
    const b=uploadFields.parse(fields);uploadActor(s,a,b.taskId);if(!file)fail('PHOTO_REQUIRED','One file field is required',400);
    const bytes=await this.files.normalize(file.buffer);let created:string|undefined;
    try{return mutate(s,a,'POST','/uploads',key,{taskId:b.taskId,sha256:sha(file.buffer)},201,()=>{uploadActor(s,a,b.taskId);},()=>{
      const t=task(s,a,b.taskId);if(t.status!=='in_progress')fail('REPORT_LOCKED','Upload task materials while in_progress');
      if(Number(s.get('SELECT count(*) n FROM v2_uploads WHERE task_id=?',b.taskId)?.n)>=50)fail('PHOTO_LIMIT','At most 50 uploads per task');
      created=randomUUID();const temporary=created+'.tmp',final=created+'.webp';
      try{writeFileSync(this.path(temporary,true),bytes,{flag:'wx'});linkSync(this.path(temporary,true),this.path(final));}finally{this.remove(temporary,true);}
      s.run('INSERT INTO v2_uploads VALUES (?,?,?,NULL,?,?,?,?)',created,b.taskId,a.id,final,sha(bytes),bytes.length,now());
      return uploadDto(s.get('SELECT * FROM v2_uploads WHERE id=?',created)!);
    });}catch(error){if(created)this.remove(created+'.webp');throw error;}
  }
  read(s:Store,a:User,photoId:string){
    const row=s.get('SELECT * FROM v2_uploads WHERE id=?',photoId);if(!row)fail('NOT_FOUND','Upload not found',404);
    task(s,a,String(row.task_id));
    if(row.report_id===null&&row.owner_id!==a.id&&a.role==='worker')fail('NOT_FOUND','Upload not found',404);
    try{const path=this.path(String(row.storage_name));const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_PHOTO_BYTES)throw Error('Invalid stored file');const bytes=readFileSync(path);if(bytes.length!==row.byte_size||sha(bytes)!==row.sha256)throw Error('Integrity');return bytes;}catch{fail('PHOTO_UNAVAILABLE','Photo missing or integrity check failed',503);}
  }
  cleanup(s:Store,at=Date.now()){
    const drafts=s.all('SELECT data FROM v2_report_drafts').map(r=>String(r.data));
    for(const row of s.all('SELECT * FROM v2_uploads WHERE report_id IS NULL')){
      if(at-Date.parse(String(row.created_at))>24*3600000&&!drafts.some(d=>d.includes(JSON.stringify(row.id)))){
        s.run('DELETE FROM v2_uploads WHERE id=? AND report_id IS NULL',row.id!);this.remove(String(row.storage_name));
      }
    }
    const referenced=new Set(s.all('SELECT storage_name FROM v2_uploads').map(r=>r.storage_name));
    for(const temp of[true,false])for(const name of readdirSync(temp?this.files.temporary:this.files.root)){
      if(!/^[0-9a-f-]{36}\.(webp|tmp)$/.test(name)||(!temp&&referenced.has(name)))continue;
      const stat=lstatSync(this.path(name,temp));if(stat.isFile()&&at-stat.mtimeMs>24*3600000)this.remove(name,temp);
    }
  }
}
export function validatePhotos(s:Store,a:User,taskId:string,photoIds:string[],allowedOwners:string[]=[a.id]): void { return runSync(s, workflow.validatePhotos(queries, a, taskId, photoIds, allowedOwners)); }
