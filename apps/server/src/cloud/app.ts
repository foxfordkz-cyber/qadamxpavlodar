import express, { Router, type ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { ApiError } from '../errors.js';
import { sessionRoutes } from '../v2/session-routes.js';
import { referenceDataRoutes } from '../v2/reference-data.js';
import { openApi, type Api, type Operation } from '../v2/api-contract.js';
import { PostgresAuthRepository } from './auth-repository.js';
import { PostgresReferenceRepository } from './reference-repository.js';
import { PostgresDatabase } from './database.js';
import { planningRoutes } from './planning-routes.js';
import { PostgresPlanningRepository } from './planning-repository.js';
import { workflowRoutes } from './workflow-routes.js';
import { PostgresWorkflowRepository } from './workflow-repository.js';
import { schemaVersion } from './migrations.js';
import type { CloudConfig } from './config.js';

export function createCloudApp(db: PostgresDatabase, config: CloudConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.proxyHops === 1 ? 1 : false);
  app.use((req,res,next) => {
    res.locals.requestId=randomUUID();
    res.set({'X-Request-Id':res.locals.requestId,'X-API-Contract':'V2','X-Data-Mode':'DEMO',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    // Never authorize the host from X-Forwarded-Host, even when one ingress hop is trusted.
    let host=''; try { host=new URL(`http://${req.get('Host')}`).hostname; } catch { /* deny below */ }
    if (!config.allowedHosts.includes(host)) return next(new ApiError(403,'LOCAL_ONLY','Host is not allowed'));
    const origin=req.get('Origin');
    if (origin && !config.frontendOrigins.includes(origin)) return next(new ApiError(403,'LOCAL_ONLY','Origin is not explicitly allowed'));
    if (origin) {
      res.set({'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true',
        'Access-Control-Expose-Headers':'X-Request-Id,Idempotency-Replayed,X-API-Contract,X-Data-Mode'});res.vary('Origin');
    }
    if (req.method==='OPTIONS') {
      const headers=(req.get('Access-Control-Request-Headers')??'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
      if (!origin || !['GET','POST','PATCH','PUT'].includes(req.get('Access-Control-Request-Method')??'') || headers.some(x=>!['content-type','x-csrf-token','idempotency-key'].includes(x)))
        return next(new ApiError(403,'CORS_FORBIDDEN','Preflight is not allowed'));
      res.set({'Access-Control-Allow-Methods':'GET,POST,PATCH,PUT','Access-Control-Allow-Headers':'Content-Type,X-CSRF-Token,Idempotency-Key'}).sendStatus(204);return;
    }
    if (!config.localTest && !req.secure && !['/health','/api/v1/health','/api/v1/ready'].includes(req.path))
      return next(new ApiError(403,'HTTPS_REQUIRED','HTTPS ingress required'));
    if (['POST','PATCH','PUT'].includes(req.method) && req.path!=='/api/v1/uploads' && !req.is('application/json'))
      return next(new ApiError(415,'UNSUPPORTED_MEDIA_TYPE','Use application/json'));
    next();
  });
  app.use(express.json({limit:'32kb',strict:true}));
  for (const path of ['/health','/api/v1/health']) app.get(path,(_req,res)=>res.json({status:'ok',mode:'DEMO',storage:'postgresql',scope:'auth-reference-planning-workflow'}));
  app.get('/api/v1/ready',async(_req,res)=>{await db.ready();res.json({status:'ok',database:'ok',mode:'DEMO',schemaVersion,capabilities:['auth','evidence','resources','sites','context','analysis','rates','snapshots','crews','workers','designs','tasks','reports'],photos:'unsupported'});});
  const router=Router(),operations:Operation[]=[];
  const route:Api['route']=(op,...handlers)=>{if(operations.some(x=>x.method===op.method&&x.path===op.path))throw Error('Duplicate cloud operation');operations.push(op);router[op.method](op.path,...handlers);};
  router.get('/openapi.json',(_req,res)=>{
    const spec=openApi(operations);
    spec.info={...spec.info,title:'Green Pavlodar — PostgreSQL workflow API',version:'2.3.0-cloud-workflow',
      description:'Auth, reference data, planning, crews, profiles, designs, tasks and reports are supported. Photo/Outcomes workflow is not migrated. Other domains return 503 CLOUD_ENDPOINT_UNSUPPORTED. Secure HttpOnly SameSite=Strict sessions; CSRF and idempotency required on writes. No SQLite or mock fallback.'};
    res.json(spec);
  });
  sessionRoutes(new PostgresAuthRepository(db),{router,route},config.secureCookies);
  referenceDataRoutes({route},new PostgresReferenceRepository(db));
  planningRoutes({route},new PostgresPlanningRepository(db));
  workflowRoutes({route},new PostgresWorkflowRepository(db));
  router.use((_req,_res,next)=>next(new ApiError(503,'CLOUD_ENDPOINT_UNSUPPORTED','This endpoint is not migrated; use the local SQLite release')));
  app.use('/api/v1',router);
  app.use((_req,_res,next)=>next(new ApiError(404,'NOT_FOUND','Route not found')));
  const errors:ErrorRequestHandler=(error,_req,res,_next)=>{
    let status=500,code='INTERNAL_ERROR',message='Unexpected server error',details:unknown;
    if(error instanceof ApiError)({status,code,message,details}=error);
    else if(error instanceof ZodError){status=400;code='VALIDATION_ERROR';message='Invalid request';details=error.issues.map(({path,message})=>({path,message}));}
    else if(error?.type==='entity.parse.failed'){status=400;code='INVALID_JSON';message='Malformed JSON body';}
    else if(error?.type==='entity.too.large'){status=413;code='BODY_TOO_LARGE';message='JSON body exceeds 32 KiB';}
    else if(error?.type==='charset.unsupported'||error?.type==='encoding.unsupported'){status=415;code='UNSUPPORTED_MEDIA_TYPE';message='Unsupported body encoding';}
    else if(error?.code || /connection|timeout/i.test(String(error?.message))){status=503;code='DATABASE_UNAVAILABLE';message='Persistent database unavailable; retry with the same idempotency key';}
    if(status>=500)console.error('Cloud request failed',res.locals.requestId,code);
    res.status(status).json({error:{code,message,requestId:res.locals.requestId,...(details?{details}:{})}});
  };
  app.use(errors);return app;
}
