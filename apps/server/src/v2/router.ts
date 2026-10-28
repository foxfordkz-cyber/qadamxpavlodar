import { Router, type Request, type Response, type RequestHandler } from 'express';
import { z } from 'zod';
import { Store } from '../db.js';
import { id,allow,fail,mutate,parseRow,type User } from './core.js';
import { authenticate,actor,login,logout,loginInput,hashPassword } from './auth.js';
import * as people from './people.js';
import { domainRoutes } from './domain-routes.js';
import { reportRoutes } from './report-routes.js';
import { intelligenceRoutes,type V2Adapters } from './intelligence.js';
import { visualizationRoutes } from './visualizations.js';
import { responseData,responseModels } from './responses.js';
import { adminHtml,adminJs } from './admin-ui.js';

export type Method='get'|'post'|'patch'|'put';
export type Operation={method:Method;path:string;summary:string;input?:z.ZodType;public?:boolean;multipart?:boolean;binary?:boolean;status?:number};
export type Api={router:Router;operations:Operation[];route:(op:Operation,...handlers:RequestHandler[])=>void;
  write:(op:Operation,authorize:(a:User,req:Request)=>void,change:(a:User,body:any,req:Request)=>unknown)=>void};
export const param=(req:Request)=>id.parse(req.params.id);
export function defineApi(s:Store):Api {
  const router=Router(),operations:Operation[]=[];
  const route:Api['route']=(op,...handlers)=>{operations.push(op);router[op.method](op.path,...handlers);};
  const write:Api['write']=(op,authorize,change)=>route(op,(req,res)=>{
    const body=op.input!.parse(req.body); const a=actor(res);
    const result=mutate(s,a,req.method,req.path,req.get('Idempotency-Key'),body,op.status??200,()=>authorize(a,req),()=>change(a,body,req));
    res.set('Idempotency-Replayed',String(result.replayed)).status(result.status).json(result.body);
  });
  return{router,operations,route,write};
}
export function openApi(operations:Operation[]) {
  const paths:Record<string,any>={};
  for(const op of operations){
    const path=op.path.replace(/:([a-zA-Z]+)/g,'{$1}');
    const parameters:any[]=[...(op.path.includes(':id')?[{in:'path',name:'id',required:true,schema:{type:'string'}}]:[])];
    if(!['get'].includes(op.method)&&!op.public&&op.path!=='/auth/logout')parameters.push({in:'header',name:'Idempotency-Key',required:true,schema:{type:'string',minLength:1,maxLength:128}});
    (paths[path]??={})[op.method]={summary:op.summary,tags:['Contract V2 / local DEMO'],security:op.public?[]:[{SessionCookie:[],...(op.method==='get'?{}:{CsrfToken:[]})}],parameters,
      ...(op.input?{requestBody:{required:true,content:{[op.multipart?'multipart/form-data':'application/json']:{schema:z.toJSONSchema(op.input,{io:'input',unrepresentable:'any'})}}}}:{}),
      responses:{[op.status??200]:{description:'Success',content:op.binary?{'image/webp':{schema:{type:'string',format:'binary'}}}:{'application/json':{schema:{type:'object',required:['data'],properties:{data:z.toJSONSchema(responseData(op),{io:'input',unrepresentable:'any'}),meta:{type:'object'}},additionalProperties:false}}}},
        ...Object.fromEntries([400,401,403,404,409,413,415,429,500,503].map(status=>[status,{description:'Structured error',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}}]))}};
  }
  return{openapi:'3.1.0',info:{title:'Green Pavlodar — team contract V2, local DEMO',version:'2.0.0-local',description:'Implemented V2 routes only. Server session required; X-Demo-User is ignored. Cookie is HttpOnly/SameSite=Strict; local HTTP only. Send X-CSRF-Token from login/me on writes. Mutation replay rechecks current rights.'},servers:[{url:'/api/v1'}],paths,
    components:{securitySchemes:{SessionCookie:{type:'apiKey',in:'cookie',name:'gp_v2_session'},CsrfToken:{type:'apiKey',in:'header',name:'X-CSRF-Token'}},schemas:{...Object.fromEntries(Object.entries(responseModels).map(([name,schema])=>[name,z.toJSONSchema(schema,{io:'input',unrepresentable:'any'})])),Error:{type:'object',required:['error'],properties:{error:{type:'object',required:['code','message','requestId'],properties:{code:{type:'string'},message:{type:'string'},requestId:{type:'string'},details:{}}}}}}}};
}
export function authRoutes(s:Store,api:Api) {
  const{router,route}=api;
  router.use((_req,res,next)=>{res.set('X-API-Contract','V2');next();});
  router.get('/admin',(_req,res)=>res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'").type('html').send(adminHtml));
  router.get('/admin.js',(_req,res)=>res.type('js').send(adminJs));
  router.get('/openapi.json',(_req,res)=>res.json(openApi(api.operations)));
  router.get('/docs',(_req,res)=>res.type('html').send('<!doctype html><html><head><meta charset="utf-8"><title>Green Pavlodar V2</title><link rel="stylesheet" href="/api-docs/assets/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="/api-docs/assets/swagger-ui-bundle.js"></script><script src="/api/v1/docs/init.js"></script></body></html>'));
  router.get('/docs/init.js',(_req,res)=>res.type('js').send('window.ui=SwaggerUIBundle({url:"/api/v1/openapi.json",dom_id:"#swagger-ui",validatorUrl:null,withCredentials:true,persistAuthorization:false});'));
  route({method:'post',path:'/auth/login',input:loginInput,public:true,summary:'Login with password; rotate persistent server session'},async(req,res)=>res.json({data:await login(s,req,res)}));
  router.use(authenticate(s));
  route({method:'get',path:'/auth/me',summary:'Current server identity and CSRF token'},(_req,res)=>res.json({data:{user:actor(res),csrfToken:res.locals.csrf}}));
  route({method:'post',path:'/auth/logout',input:z.object({}).strict(),summary:'Revoke the current session'},(req,res)=>{z.object({}).strict().parse(req.body);res.json({data:logout(s,res)});});
}
export function peopleRoutes(s:Store,api:Api) {
  const{route,write}=api;
  const admin=(a:User)=>allow(a,'admin');
  route({method:'get',path:'/users',summary:'Admin: users and availability, no authentication secrets'},(_req,res)=>res.json({data:people.listUsers(s,actor(res))}));
  for(const updating of [false,true]){
    const op:Operation={method:updating?'patch':'post',path:updating?'/users/:id':'/users',status:updating?200:201,input:updating?people.userPatch:people.userCreate,summary:updating?'Admin: change user, role or availability; revoke sessions':'Admin: create account'};
    route(op,async(req,res)=>{
      const a=actor(res);allow(a,'admin');const b=op.input!.parse(req.body) as any;
      const passwordHash=b.password?await hashPassword(b.password):undefined;
      const result=mutate(s,a,req.method,req.path,req.get('Idempotency-Key'),b,op.status!,()=>admin(a),()=>updating?people.patchUser(s,a,param(req),b,passwordHash):people.createUser(s,a,b,passwordHash!));
      res.set('Idempotency-Replayed',String(result.replayed)).status(result.status).json(result.body);
    });
  }
  route({method:'get',path:'/workers',summary:'Role-scoped employees and availability'},(_req,res)=>res.json({data:people.workers(s,actor(res))}));
  route({method:'get',path:'/crews',summary:'Role-scoped crews and membership history'},(_req,res)=>res.json({data:s.all('SELECT data FROM v2_crews ORDER BY id').map(r=>parseRow(r)).filter(c=>people.canCrew(s,actor(res),c)).map(c=>({...c,members:people.members(s,c.id)}))}));
  write({method:'post',path:'/crews',input:people.crewCreate,status:201,summary:'Admin: create crew'},admin,(a,b)=>people.createCrew(s,a,b));
  write({method:'patch',path:'/crews/:id',input:people.crewPatch,summary:'Admin: change crew or foreman'},admin,(a,b,req)=>people.patchCrew(s,a,param(req),b));
  write({method:'post',path:'/crews/:id/members',input:people.membershipInput,summary:'Admin: add/remove effective membership; preserve history'},admin,(a,b,req)=>people.membership(s,a,param(req),b));
  route({method:'get',path:'/users/:id/history',summary:'Admin: audited changes to user privileges'},(req,res)=>{
    allow(actor(res),'admin');res.json({data:s.all("SELECT * FROM v2_history WHERE entity_type='user' AND entity_id=? ORDER BY created_at,id",param(req)).map(r=>({id:r.id,actorId:r.actor_id,action:r.action,before:r.before_json?JSON.parse(String(r.before_json)):null,after:JSON.parse(String(r.after_json)),createdAt:r.created_at}))});
  });
}
export function createV2Router(s:Store,uploadsPath:string,adapters:V2Adapters={}) {
  const api=defineApi(s);authRoutes(s,api);peopleRoutes(s,api);domainRoutes(s,api);reportRoutes(s,api,uploadsPath);
  intelligenceRoutes(s,api,adapters);
  visualizationRoutes(s,api);
  api.router.use((_req,_res)=>fail('NOT_FOUND','V2 route not found',404));
  return api.router;
}
