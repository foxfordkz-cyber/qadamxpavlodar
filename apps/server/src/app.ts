import express, { type ErrorRequestHandler, type Request, type Response, type RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import multer from 'multer';
import { ZodError } from 'zod';
import { Store, present } from './db.js';
import { ApiError } from './errors.js';
import * as v from './validation.js';
import { type Actor, requireCoordinator, insertTask, updateTask, insertReport, idempotent, task } from './service.js';
import { PhotoStorage, uploadMultipart, reportAccess, readReport } from './photos.js';
import * as experiment from './experimental-workflow.js';
import * as ai from './ai-boundary.js';
import { previewCsv, csvRequest } from './csv-preview.js';
import { localDayRange } from './time.js';
import { buildOpenApi, routes, type RouteName, type RouteSpec } from './contracts.js';
import { createV2Router } from './v2/router.js';
import { type V2Adapters } from './v2/intelligence.js';

const require = createRequire(import.meta.url);
const swaggerRoot = dirname(require.resolve('swagger-ui-dist/swagger-ui-bundle.js'));
export type AppOptions = { uploadsPath?: string; frontendOrigins?: string[]; aiAdapter?: ai.AiAdapter; v2Adapters?:V2Adapters };
export function createApp(store: Store, options: AppOptions = {}) {
  const app = express();
  const photos = new PhotoStorage(options.uploadsPath ?? join(dirname(store.path), 'uploads'));
  photos.cleanupOrphans(store);
  const registered = new Set<RouteName>();
  function route(name: RouteName, ...handlers: RequestHandler[]) {
    if (registered.has(name)) throw new Error(`Duplicate route registration: ${name}`);
    const spec: RouteSpec = routes[name];
    app[spec.method](spec.path, ...handlers);
    registered.add(name);
  }
  const actor = (res: Response): Actor => res.locals.actor as Actor;
  const paramId = (req: Request) => v.id.parse(req.params.id);
  function write(name: RouteName, req: Request, res: Response, body: unknown, status: number, mutate: () => unknown) {
    const spec = routes[name];
    const path = spec.path.replace(':id', spec.path.includes(':id') ? paramId(req) : '');
    sendMutation(res, idempotent(store, actor(res), req.method, path, req.get('Idempotency-Key'), body, status, mutate));
  }
  function sendMutation(res: Response, result: { status: number; body: unknown; replayed: boolean }) {
    res.set('Idempotency-Replayed', String(result.replayed)).status(result.status).json(result.body);
  }
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.set({ 'X-Request-Id': res.locals.requestId, 'X-API-Contract': req.path.startsWith('/experimental') ? 'PROPOSED' : 'draft',
      'X-Data-Mode': 'DEMO', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    if (!['127.0.0.1','localhost','[::1]'].includes(req.hostname)) return next(new ApiError(403, 'LOCAL_ONLY', 'Loopback Host required'));
    const origin = req.get('Origin');
    if (origin) {
      if (origin !== `http://${req.get('Host')}` && !(options.frontendOrigins ?? []).includes(origin)) {
        return next(new ApiError(403, 'LOCAL_ONLY', 'Origin is not an explicitly allowed local frontend'));
      }
      res.set({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'X-Request-Id,Idempotency-Replayed,X-API-Contract,X-Data-Mode' });
      res.vary('Origin');
      if (req.method === 'OPTIONS') {
        const method = req.get('Access-Control-Request-Method') ?? '';
        const headers = (req.get('Access-Control-Request-Headers') ?? '').toLowerCase().split(',').map(h => h.trim()).filter(Boolean);
        if (!['GET','POST','PATCH','PUT'].includes(method) || headers.some(h => !['content-type','x-demo-user','idempotency-key','x-csrf-token'].includes(h))) {
          return next(new ApiError(403, 'CORS_FORBIDDEN', 'Preflight method or headers are not allowed'));
        }
        res.set({ 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT', 'Access-Control-Allow-Headers': 'Content-Type,X-Demo-User,Idempotency-Key,X-CSRF-Token', 'Access-Control-Allow-Credentials':'true' }).sendStatus(204);
        return;
      }
    }
    if (req.path.startsWith('/api/v1')) res.set('Access-Control-Allow-Credentials','true');
    if (['POST','PATCH','PUT'].includes(req.method)) {
      const photoRoute = req.path === '/api/v1/uploads' || /^\/(experimental\/)?reports\/[a-zA-Z0-9_-]+\/photos\/?$/.test(req.path);
      if (!(photoRoute ? req.is('multipart/form-data') : req.is('application/json'))) {
        return next(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', photoRoute ? 'Use multipart/form-data with one file' : 'Use application/json'));
      }
    }
    next();
  });
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use('/api/v1', createV2Router(store, join(photos.root,'v2'),options.v2Adapters));
  route('health', (_req, res) => {
    try { if (store.get('SELECT 1 AS ok')?.ok !== 1) throw new Error('Database check failed'); }
    catch { throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Local database unavailable'); }
    res.json({ status: 'ok', database: 'ok', mode: 'DEMO', contract: 'draft' });
  });
  route('openapi', (_req, res) => { res.json(buildOpenApi()); });
  route('docs', (_req, res) => {
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    res.type('html').send('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Green Pavlodar — DRAFT / DEMO</title><link rel="stylesheet" href="/api-docs/assets/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="/api-docs/assets/swagger-ui-bundle.js"></script><script src="/api-docs/assets/init.js"></script></body></html>');
  });
  app.use('/api-docs/assets', (req, res, next) => {
    if (!['GET','HEAD'].includes(req.method)) return next(new ApiError(405, 'METHOD_NOT_ALLOWED', 'Documentation assets are read-only'));
    if (req.path === '/init.js') {
      res.type('js').send('window.ui = SwaggerUIBundle({url:"/openapi.json",dom_id:"#swagger-ui",validatorUrl:null,persistAuthorization:false,deepLinking:true});'); return;
    }
    if (!['/swagger-ui.css','/swagger-ui-bundle.js'].includes(req.path)) return next(new ApiError(404, 'NOT_FOUND', 'Asset not found'));
    res.sendFile(join(swaggerRoot, req.path.slice(1)));
  });
  app.use((req, res, next) => {
    const parsed = v.id.safeParse(req.get('X-Demo-User'));
    if (!parsed.success) return next(new ApiError(401, 'DEMO_IDENTITY_REQUIRED', 'Supply X-Demo-User for local simulation'));
    const user = store.get('SELECT id,role FROM users WHERE id=?', parsed.data);
    if (!user) return next(new ApiError(401, 'UNKNOWN_DEMO_USER', 'Unknown local demo user'));
    res.locals.actor = { id: user.id, role: user.role } as Actor; next();
  });
  function list(req: Request, sql: string) {
    const { limit, offset } = v.listQuery.parse(req.query);
    return { data: store.all(`${sql} ORDER BY id LIMIT ? OFFSET ?`, limit, offset).map(present), pagination: { limit, offset } };
  }
  function plants(req: Request) {
    const { limit, offset, condition } = v.plantQuery.parse(req.query);
    const rows = condition ? store.all('SELECT * FROM plants WHERE condition=? ORDER BY id LIMIT ? OFFSET ?', condition, limit, offset)
      : store.all('SELECT * FROM plants ORDER BY id LIMIT ? OFFSET ?', limit, offset);
    return { data: rows.map(present), pagination: { limit, offset } };
  }
  function tasks(req: Request, user: Actor, experimental = false) {
    const { limit, offset, date } = v.taskQuery.parse(req.query);
    const where: string[] = []; const params: (string | number)[] = [];
    if (user.role === 'worker') { where.push('assigned_to_id=?'); params.push(user.id); }
    if (date) { const range = localDayRange(date); where.push('created_at>=? AND created_at<?'); params.push(range.start,range.end); }
    const table = experimental ? 'experimental_tasks' : 'tasks';
    return { data: store.all(`SELECT * FROM ${table}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY id LIMIT ? OFFSET ?`, ...params, limit, offset).map(present), pagination: { limit, offset } };
  }
  route('plants', (req, res) => { res.json(plants(req)); });
  route('geojson', (req, res) => {
    const result = plants(req);
    res.json({ type: 'FeatureCollection', pagination: result.pagination, features: result.data.map(p => ({ type: 'Feature', id: p.id,
      geometry: { type: 'Point', coordinates: [p.longitude,p.latitude] }, properties: { id: p.id, name: p.name, species: p.species, condition: p.condition, isDemo: p.isDemo } })) });
  });
  route('plant', (req, res) => {
    const plant = store.get('SELECT * FROM plants WHERE id=?', paramId(req));
    if (!plant) throw new ApiError(404, 'NOT_FOUND', 'Plant not found'); res.json({ data: present(plant) });
  });
  route('sites', (req, res) => { res.json(list(req, 'SELECT * FROM candidate_sites')); });
  route('workers', (req, res) => { requireCoordinator(actor(res)); res.json(list(req, "SELECT id,display_name,role,is_demo FROM users WHERE role='worker'")); });
  route('tasks', (req, res) => { res.json(tasks(req, actor(res))); });
  route('task', (req, res) => { res.json({ data: present(task(store, actor(res), paramId(req))),
    reports: store.all('SELECT * FROM reports WHERE task_id=? ORDER BY created_at,id',paramId(req)).map(present) }); });
  route('history', (req, res) => { task(store, actor(res), paramId(req)); res.json({ data: experiment.readHistory(store, paramId(req)) }); });
  route('createTask', (req, res) => { const body = v.createTask.parse(req.body); write('createTask', req,res,body,201,() => insertTask(store,actor(res),body)); });
  route('patchTask', (req, res) => { const body = v.patchTask.parse(req.body); write('patchTask',req,res,body,200,() => updateTask(store,actor(res),paramId(req),body)); });
  route('submitReport', (req, res) => { const body = v.createReport.parse(req.body); write('submitReport',req,res,body,201,() => insertReport(store,actor(res),body)); });
  route('report', (req, res) => { res.json(readReport(store,actor(res),paramId(req))); });
  for (const experimental of [false,true]) {
    route(experimental ? 'expUpload' : 'uploadPhoto', (req,res,next) => {
      const { report } = reportAccess(store,actor(res),paramId(req),experimental);
      if (actor(res).role !== 'worker' || report.author_id !== actor(res).id) throw new ApiError(403, 'FORBIDDEN', 'Only the assigned author can upload'); next();
    }, uploadMultipart, async (req,res) => {
      sendMutation(res, await photos.save(store,actor(res),paramId(req),req.file,req.body,req.get('Idempotency-Key'),experimental));
    });
    route(experimental ? 'expPhoto' : 'photo', (req,res) => {
      res.set('Content-Disposition','inline; filename="demo-photo.webp"').type('image/webp').send(photos.read(store,actor(res),paramId(req),experimental));
    });
  }
  route('expTasks', (req,res) => { res.json(tasks(req,actor(res),true)); });
  route('expTask', (req,res) => { res.json({ data: present(experiment.experimentalTask(store,actor(res),paramId(req))),
    reports: store.all('SELECT * FROM experimental_reports WHERE task_id=? ORDER BY revision',paramId(req)).map(present) }); });
  route('expCreate', (req,res) => { const body = experiment.experimentalCreate.parse(req.body); write('expCreate',req,res,body,201,() => experiment.newExperimentalTask(store,actor(res),body)); });
  route('expTransition', (req,res) => { const body = experiment.experimentalTransition.parse(req.body); write('expTransition',req,res,body,200,() => experiment.transitionExperimentalTask(store,actor(res),paramId(req),body)); });
  route('expHistory', (req,res) => { experiment.experimentalTask(store,actor(res),paramId(req)); res.json({ data: experiment.readHistory(store,paramId(req),true) }); });
  route('expSubmit', (req,res) => { const body = experiment.experimentalSubmit.parse(req.body); write('expSubmit',req,res,body,201,() => experiment.submitExperimentalReport(store,actor(res),body)); });
  route('expReport', (req,res) => { res.json(readReport(store,actor(res),paramId(req),true)); });
  route('snapshot', (_req,res) => { requireCoordinator(actor(res)); res.json({ data: store.transaction(() => ai.buildSnapshot(store)) }); });
  route('aiPropose', async (req,res) => { sendMutation(res, await ai.propose(store,actor(res),ai.aiRequest.parse(req.body),req.get('Idempotency-Key'),options.aiAdapter ?? ai.mockAdapter)); });
  route('aiConfirm', (req,res) => { const body = ai.aiConfirm.parse(req.body); write('aiConfirm',req,res,body,200,() => ai.confirmProposal(store,actor(res),paramId(req),body)); });
  route('csvPreview', (req,res) => { requireCoordinator(actor(res)); res.json(previewCsv(store,csvRequest.parse(req.body).csv)); });
  if (registered.size !== Object.keys(routes).length) throw new Error('OpenAPI contains a route that was not registered');
  app.use((_req,_res,next) => next(new ApiError(404,'NOT_FOUND','Route not found')));
  const errors: ErrorRequestHandler = (error: unknown,_req,res,_next) => {
    let status = 500, code = 'INTERNAL_ERROR', message = 'Unexpected local server error'; let details: unknown;
    if (error instanceof ApiError) ({ status,code,message } = error);
    else if (error instanceof ZodError) {
      status = 400; code = 'VALIDATION_ERROR'; message = 'Invalid request'; details = error.issues.map(({path,message}) => ({path,message}));
    } else if (error instanceof multer.MulterError) {
      status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400; code = error.code; message = 'Multipart file or field limit exceeded';
    } else if (error instanceof Error && /multipart|boundary/i.test(error.message)) {
      status = 400; code = 'INVALID_MULTIPART'; message = 'Malformed multipart upload';
    } else if (typeof error === 'object' && error && 'type' in error) {
      if (error.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; message = 'Malformed JSON body'; }
      if (error.type === 'entity.too.large') { status = 413; code = 'BODY_TOO_LARGE'; message = 'JSON body exceeds 32 KiB'; }
      if (error.type === 'charset.unsupported' || error.type === 'encoding.unsupported') { status = 415; code = 'UNSUPPORTED_MEDIA_TYPE'; message = 'Unsupported body encoding'; }
    }
    if (status === 500) console.error('Local request failed',res.locals.requestId,error instanceof Error ? error.name : 'UnknownError');
    res.status(status).json({ error: { code,message,requestId: res.locals.requestId,...(details ? {details} : {}) } });
  };
  app.use(errors); return app;
}
