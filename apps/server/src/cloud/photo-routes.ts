import { z } from 'zod';
import { type Api,param } from '../v2/api-contract.js';
import { actor } from '../v2/auth.js';
import { allow,id } from '../v2/core.js';
import { multipart } from '../v2/uploads.js';
import { CloudPhotos } from './photo-service.js';

export function photoRoutes({route}:Pick<Api,'route'>,photos:CloudPhotos){
  route({method:'post',path:'/uploads',idempotent:true,status:201,multipart:true,input:z.object({taskId:id,file:z.string().meta({format:'binary'})}).strict(),summary:'Assigned participant: normalized private JPEG/PNG/WebP upload, 5 MiB'},
    (_req,res,next)=>{allow(actor(res),'worker','foreman');next();},multipart,async(req,res)=>{
      const result=await photos.save(actor(res),req.body,req.file,req.get('Idempotency-Key'));
      res.set('Idempotency-Replayed',String(result.replayed)).status(result.status).json(result.body);
    });
  route({method:'get',path:'/uploads/:id',binary:true,summary:'Private normalized photo in current task read scope; worker draft ownership retained'},async(req,res)=>{
    const bytes=await photos.read(actor(res),param(req));res.set('Content-Disposition','inline; filename="report.webp"').type('image/webp').send(bytes);
  });
}
