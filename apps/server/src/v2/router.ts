import { param, openApi, type Api, type Operation } from './api-contract.js';
export { param, openApi, type Api, type Operation, type Method } from './api-contract.js';
import { sessionRoutes } from './session-routes.js';
import { municipalRoutes } from '../municipal/routes.js';
import { Router } from 'express';
import { z } from 'zod';
import { Store } from '../db.js';
import { allow,fail,mutate,parseRow,type User } from './core.js';
import { actor,hashPassword } from './auth.js';
import * as people from './people.js';
import { domainRoutes } from './domain-routes.js';
import { reportRoutes } from './report-routes.js';
import { intelligenceRoutes,type V2Adapters } from './intelligence.js';
import { visualizationRoutes } from './visualizations.js';
import { adminHtml,adminJs } from './admin-ui.js';
import { tzRoutes,type TzOptions } from '../tz/routes.js';

export function defineApi(s:Store):Api {
  const router=Router(),operations:Operation[]=[];
  const route:Api['route']=(op,...handlers)=>{if(operations.some(x=>x.method===op.method&&x.path===op.path))throw Error(`Duplicate API operation: ${op.method} ${op.path}`);operations.push(op);router[op.method](op.path,...handlers);};
  const write:Api['write']=(op,authorize,change)=>route({...op,idempotent:true},(req,res)=>{
    const body=op.input!.parse(req.body); const a=actor(res);
    const result=mutate(s,a,req.method,req.path,req.get('Idempotency-Key'),body,op.status??200,()=>authorize(a,req),()=>change(a,body,req));
    res.set('Idempotency-Replayed',String(result.replayed)).status(result.status).json(result.body);
  });
  return{router,operations,route,write};
}
export function authRoutes(s:Store,api:Api) {
  const{router}=api;
  router.use((_req,res,next)=>{res.set('X-API-Contract','V2');next();});
  router.get('/admin',(_req,res)=>res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'").type('html').send(adminHtml));
  router.get('/admin.js',(_req,res)=>res.type('js').send(adminJs));
  router.get('/openapi.json',(_req,res)=>res.json(openApi(api.operations)));
  router.get('/docs',(_req,res)=>res.type('html').send('<!doctype html><html><head><meta charset="utf-8"><title>Green Pavlodar V2</title><link rel="stylesheet" href="/api-docs/assets/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="/api-docs/assets/swagger-ui-bundle.js"></script><script src="/api/v1/docs/init.js"></script></body></html>'));
  router.get('/docs/init.js',(_req,res)=>res.type('js').send('window.ui=SwaggerUIBundle({url:"/api/v1/openapi.json",dom_id:"#swagger-ui",validatorUrl:null,withCredentials:true,persistAuthorization:false});'));
  sessionRoutes(s,api);
}
export function peopleRoutes(s:Store,api:Api) {
  const{route,write}=api;
  const admin=(a:User)=>allow(a,'admin');
  route({method:'get',path:'/users',summary:'Admin: users and availability, no authentication secrets'},(_req,res)=>res.json({data:people.listUsers(s,actor(res))}));
  for(const updating of [false,true]){
    const op:Operation={idempotent:true,method:updating?'patch':'post',path:updating?'/users/:id':'/users',status:updating?200:201,input:updating?people.userPatch:people.userCreate,summary:updating?'Admin: change user, role or availability; revoke sessions':'Admin: create account'};
    route(op,async(req,res)=>{
      const a=actor(res);allow(a,'admin');const b=op.input!.parse(req.body) as any;
      const passwordHash=b.password?await hashPassword(b.password):undefined;
      const result=mutate(s,a,req.method,req.path,req.get('Idempotency-Key'),b,op.status!,()=>admin(a),()=>updating?people.patchUser(s,a,param(req),b,passwordHash):people.createUser(s,a,b,passwordHash!));
      res.set('Idempotency-Replayed',String(result.replayed)).status(result.status).json(result.body);
    });
  }
  route({method:'get',path:'/workers',summary:'Viewer reads public employee DTOs and availability; workers/foremen retain scope'},(_req,res)=>res.json({data:people.workers(s,actor(res))}));
  route({method:'get',path:'/crews',summary:'Viewer reads crews and membership history; workers/foremen retain scope'},(_req,res)=>res.json({data:s.all('SELECT data FROM v2_crews ORDER BY id').map(r=>parseRow(r)).filter(c=>people.canCrew(s,actor(res),c)).map(c=>({...c,members:people.members(s,c.id)}))}));
  write({method:'post',path:'/crews',input:people.crewCreate,status:201,summary:'Admin: create crew'},admin,(a,b)=>people.createCrew(s,a,b));
  write({method:'patch',path:'/crews/:id',input:people.crewPatch,summary:'Admin: change crew or foreman'},admin,(a,b,req)=>people.patchCrew(s,a,param(req),b));
  write({method:'post',path:'/crews/:id/members',input:people.membershipInput,summary:'Admin: add/remove effective membership; preserve history'},admin,(a,b,req)=>people.membership(s,a,param(req),b));
  route({method:'get',path:'/users/:id/history',summary:'Admin: audited changes to user privileges'},(req,res)=>{
    allow(actor(res),'admin');res.json({data:s.all("SELECT * FROM v2_history WHERE entity_type='user' AND entity_id=? ORDER BY created_at,id",param(req)).map(r=>({id:r.id,actorId:r.actor_id,action:r.action,before:r.before_json?JSON.parse(String(r.before_json)):null,after:JSON.parse(String(r.after_json)),createdAt:r.created_at}))});
  });
}
function excluding(api:Api,paths:Set<string>):Api {
  return {...api,route:(op,...handlers)=>{if(!paths.has(`${op.method} ${op.path}`))api.route(op,...handlers);},write:(op,authorize,change)=>{if(!paths.has(`${op.method} ${op.path}`))api.write(op,authorize,change);}};
}
export function createV2Router(s:Store,uploadsPath:string,adapters:V2Adapters={},tz:TzOptions={}) {
  const api=defineApi(s);authRoutes(s,api);
  // One owner for each shared URL. Durable municipal imports/calculations stay canonical;
  // Damir's assistant keeps its provider/fallback boundary and all additional TZ routes.
  municipalRoutes(s,excluding(api,new Set(['post /assistant','get /assistant/history'])));
  peopleRoutes(s,api);domainRoutes(s,api);reportRoutes(s,api,uploadsPath);
  intelligenceRoutes(s,api,adapters);
  visualizationRoutes(s,api);
  tzRoutes(s,excluding(api,new Set(['get /species','get /layers/soils','get /layers/greenery','post /zones/:id/analysis','post /zones/:id/variants','get /problems','post /priorities','get /rates','patch /rates','post /imports/preview'])),tz);
  api.router.use((_req,_res)=>fail('NOT_FOUND','V2 route not found',404));
  return api.router;
}
