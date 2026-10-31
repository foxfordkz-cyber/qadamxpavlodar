import type { Router, Request, RequestHandler } from 'express';
import { z } from 'zod';
import { id, type User } from './core.js';
import { responseData, responseModels } from './responses.js';

export type Method='get'|'post'|'patch'|'put';
export type Operation={method:Method;path:string;summary:string;input?:z.ZodType;query?:z.ZodType;response?:z.ZodType;rawResponse?:boolean;readOnly?:boolean;public?:boolean;multipart?:boolean;binary?:boolean;idempotent?:boolean;status?:number};
export type Api={router:Router;operations:Operation[];route:(op:Operation,...handlers:RequestHandler[])=>void;
  write:(op:Operation,authorize:(a:User,req:Request)=>void,change:(a:User,body:any,req:Request)=>unknown)=>void};
export const param=(req:Request)=>id.parse(req.params.id);
export function openApi(operations:Operation[]) {
  const paths:Record<string,any>={};
  for(const op of operations){
    const path=op.path.replace(/:([a-zA-Z]+)/g,'{$1}');
    const parameters:any[]=[...(op.path.includes(':id')?[{in:'path',name:'id',required:true,schema:{type:'string'}}]:[])];
    if(op.query){const query=z.toJSONSchema(op.query,{io:'input',unrepresentable:'any'});for(const[name,schema]of Object.entries(query.properties??{}))parameters.push({in:'query',name,required:query.required?.includes(name)??false,schema});}
    if(op.idempotent)parameters.push({in:'header',name:'Idempotency-Key',required:true,schema:{type:'string',minLength:1,maxLength:128}});
    (paths[path]??={})[op.method]={summary:op.summary,tags:['Contract V2 / local DEMO'],security:op.public?[]:[{SessionCookie:[],...(op.method==='get'?{}:{CsrfToken:[]})}],parameters,
      ...(op.input?{requestBody:{required:true,content:{[op.multipart?'multipart/form-data':'application/json']:{schema:z.toJSONSchema(op.input,{io:'input',unrepresentable:'any'})}}}}:{}),
      responses:{[op.status??200]:{description:'Success',content:op.binary?{[op.path.endsWith('/export')?'application/pdf':'image/webp']:{schema:{type:'string',format:'binary'}},...(op.path.endsWith('/export')?{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':{schema:{type:'string',format:'binary'}}}:{})}:{'application/json':{schema:op.rawResponse?z.toJSONSchema(op.response??z.object({}).passthrough(),{io:'input',unrepresentable:'any'}):{type:'object',required:['data'],properties:{data:z.toJSONSchema((op.response??responseData(op)),{io:'input',unrepresentable:'any'}),meta:{type:'object'}},additionalProperties:false}}}},
        ...Object.fromEntries([400,401,403,404,409,413,415,422,429,500,503].map(status=>[status,{description:'Structured error',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}}]))}};
  }
  return{openapi:'3.1.0',info:{title:'Green Pavlodar — V2 + municipal API',version:'2.1.0-local',description:'V2 workflow and municipal import/analysis/export routes. Municipal calculations use labelled expert estimates; LLM adapter is optional; unconfigured or failed providers are explicitly labelled as rules fallback. Server session required; X-Demo-User is ignored. Cookie is HttpOnly/SameSite=Strict; local HTTP only. Send X-CSRF-Token from login/me on writes. Mutation replay rechecks current rights.'},servers:[{url:'/api/v1'}],paths,
    components:{securitySchemes:{SessionCookie:{type:'apiKey',in:'cookie',name:'gp_v2_session'},CsrfToken:{type:'apiKey',in:'header',name:'X-CSRF-Token'}},schemas:{...Object.fromEntries(Object.entries(responseModels).map(([name,schema])=>[name,z.toJSONSchema(schema,{io:'input',unrepresentable:'any'})])),Error:{type:'object',required:['error'],properties:{error:{type:'object',required:['code','message','requestId'],properties:{code:{type:'string'},message:{type:'string'},requestId:{type:'string'},details:{}}}}}}}};
}
