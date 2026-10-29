import { z } from 'zod';
import * as input from './validation.js';
import { experimentalCreate, experimentalSubmit, experimentalTransition } from './experimental-workflow.js';
import { aiRequest, aiConfirm, aiOutput } from './ai-boundary.js';
import { csvRequest } from './csv-preview.js';

const text = z.string();
const integer = z.number().int();
const version = integer.positive();
const timestamp = z.iso.datetime();
const nullableId = input.id.nullable();
const page = z.object({ limit: integer.min(1).max(100), offset: integer.min(0).max(100000) }).strict();
const plant = z.object({ id: input.id, name: text, species: text, latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180), condition: z.enum(['good','needs_care','unknown']), isDemo: z.boolean() }).strict();
const site = z.object({ id: input.id, name: text, latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), notes: text, isDemo: z.boolean() }).strict();
const taskFields = { id: input.id, title: text, plantId: nullableId, candidateSiteId: nullableId,
  assignedToId: input.id, createdById: input.id, version, createdAt: timestamp, updatedAt: timestamp, isDemo: z.boolean() };
const task = z.object({ ...taskFields, status: z.enum(['pending','in_progress','completed','cancelled']) }).strict();
const expTask = z.object({ ...taskFields, assignedToId: nullableId, status: z.enum(['draft','assigned','in_progress','submitted','verified']) }).strict();
const reportFields = { id: input.id, taskId: input.id, authorId: input.id, notes: text, createdAt: timestamp, isDemo: z.boolean() };
const report = z.object(reportFields).strict();
const expReport = z.object({ ...reportFields, revision: version, status: z.enum(['submitted','verified','returned']),
  reviewComment: text.nullable(), reviewedById: nullableId, reviewedAt: timestamp.nullable() }).strict();
const photo = z.object({ id: input.id, reportId: input.id, mediaType: z.literal('image/webp'), byteSize: integer.min(1).max(5242880),
  sha256: text.regex(/^[0-9a-f]{64}$/), isDemo: z.boolean(), contentUrl: text }).strict();
const historyFields = { id: input.id, taskId: input.id, actorId: input.id, fromStatus: text.nullable(), toStatus: text, version, changedAt: timestamp };
const data = (schema: z.ZodType) => z.object({ data: schema }).strict();
const list = (schema: z.ZodType) => z.object({ data: z.array(schema), pagination: page }).strict();
const snapshot = z.object({ schemaVersion: z.literal('PROPOSED-v1'), mode: z.literal('DEMO'), timezone: z.literal('UTC+05:00'),
  version: text.regex(/^[0-9a-f]{64}$/), generatedAt: timestamp,
  plants: z.array(plant.pick({ id: true, name: true, latitude: true, longitude: true, condition: true })),
  candidateSites: z.array(site.pick({ id: true, name: true, latitude: true, longitude: true })),
  tasks: z.array(task.pick({ id: true, plantId: true, candidateSiteId: true, status: true, version: true })),
  experimentalTasks: z.array(expTask.pick({ id: true, plantId: true, candidateSiteId: true, status: true, version: true })) }).strict();
const proposal = z.object({ id: input.id, snapshotVersion: text, status: z.enum(['draft','confirmed']), version,
  createdById: input.id, createdAt: timestamp, confirmedTaskId: nullableId, confirmedAt: timestamp.nullable(),
  proposal: aiOutput, mode: z.literal('DEMO'), contract: z.literal('PROPOSED') }).strict();
const importedPlant = plant.omit({ isDemo: true });
export const schemas = {
  Error: z.object({ error: z.object({ code: text, message: text, requestId: text,
    details: z.array(z.object({ path: z.array(z.union([text, z.number()])), message: text })).optional() }).strict() }).strict(),
  Health: z.object({ status: z.literal('ok'), database: z.literal('ok'), mode: z.literal('DEMO'), contract: z.literal('draft') }).strict(),
  Plant: plant, PlantResult: data(plant), Plants: list(plant), CandidateSites: list(site),
  Workers: list(z.object({ id: input.id, displayName: text, role: z.literal('worker'), isDemo: z.boolean() }).strict()),
  Task: task, TaskResult: data(task), Tasks: list(task), TaskDetail: z.object({data:task,reports:z.array(report)}).strict(),
  CreateTask: input.createTask, PatchTask: input.patchTask, CreateReport: input.createReport,
  SubmittedReport: z.object({ data: report, task }).strict(),
  ReportResult: z.object({ data: report, photos: z.array(photo) }).strict(),
  History: data(z.array(z.object({ ...historyFields, snapshot: task }).strict())),
  PhotoResult: data(photo),
  ExperimentalTask: expTask, ExperimentalTaskResult: data(expTask), ExperimentalTasks: list(expTask),
  ExperimentalTaskDetail: z.object({data:expTask,reports:z.array(expReport)}).strict(),
  ExperimentalCreate: experimentalCreate, ExperimentalTransition: experimentalTransition, ExperimentalSubmit: experimentalSubmit,
  ExperimentalSubmittedReport: z.object({ data: expReport, task: expTask }).strict(),
  ExperimentalReportResult: z.object({ data: expReport, photos: z.array(photo) }).strict(),
  ExperimentalHistory: data(z.array(z.object({ ...historyFields, action: z.enum(['create','assign','start','submit','verify','return','attach_photo']),
    comment: text.nullable(), snapshot: expTask }).strict())),
  ExperimentalPhotoResult: z.object({ data: photo, task: expTask }).strict(),
  Snapshot: data(snapshot), AiRequest: aiRequest, AiConfirm: aiConfirm, AiProposal: data(proposal),
  AiConfirmed: z.object({ data: proposal, task: expTask }).strict(),
  CsvRequest: csvRequest,
  CsvPreview: z.object({ mode: z.literal('DEMO'), contract: z.literal('PROPOSED'), previewOnly: z.literal(true), imported: z.literal(0),
    counts: z.object({ total: integer, valid: integer, invalid: integer }).strict(),
    rows: z.array(z.object({ line: integer, raw: z.record(text,text), data: importedPlant.nullable(), errors: z.array(text), warnings: z.array(text), valid: z.boolean() }).strict()) }).strict(),
  GeoJson: z.object({ type: z.literal('FeatureCollection'), pagination: page, features: z.array(z.object({ type: z.literal('Feature'), id: input.id,
    geometry: z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]) }).strict(),
    properties: plant.pick({ id: true, name: true, species: true, condition: true, isDemo: true }) }).strict()) }).strict()
};

type SchemaName = keyof typeof schemas;
export type RouteSpec = { method: 'get' | 'post' | 'patch'; path: string; summary: string; response?: SchemaName;
  request?: SchemaName; query?: 'list' | 'plants' | 'tasks'; errors?: number[]; public?: boolean; status?: number;
  multipart?: 'legacy' | 'experimental'; contentType?: 'text/html' | 'image/webp'; description?: string };
export const routes = {
  health: { method: 'get', path: '/health', summary: 'DEMO health and SQLite probe', response: 'Health', public: true, errors: [503] },
  docs: { method: 'get', path: '/api-docs', summary: 'Local Swagger UI (no CDN or remote validator)', contentType: 'text/html', public: true },
  openapi: { method: 'get', path: '/openapi.json', summary: 'DRAFT OpenAPI document', public: true },
  plants: { method: 'get', path: '/plants', summary: 'List synthetic plants; condition filter', response: 'Plants', query: 'plants' },
  geojson: { method: 'get', path: '/plants/geojson', summary: 'Map features with [longitude, latitude]', response: 'GeoJson', query: 'plants' },
  plant: { method: 'get', path: '/plants/:id', summary: 'Read a plant', response: 'PlantResult', errors: [404] },
  sites: { method: 'get', path: '/candidate-sites', summary: 'List synthetic candidate sites', response: 'CandidateSites', query: 'list' },
  workers: { method: 'get', path: '/workers', summary: 'Coordinator: list DEMO workers', response: 'Workers', query: 'list' },
  tasks: { method: 'get', path: '/tasks', summary: 'List legacy tasks; workers only see their own', response: 'Tasks', query: 'tasks' },
  task: { method: 'get', path: '/tasks/:id', summary: 'Read an accessible legacy task and its reports', response: 'TaskDetail', errors: [404] },
  history: { method: 'get', path: '/tasks/:id/history', summary: 'Read legacy task history by version', response: 'History', errors: [404] },
  createTask: { method: 'post', path: '/tasks', summary: 'Coordinator: create pending task with assignee', request: 'CreateTask', response: 'TaskResult', status: 201, errors: [422], description: 'Exactly one of plantId or candidateSiteId is required.' },
  patchTask: { method: 'patch', path: '/tasks/:id', summary: 'Change legacy task with current version', request: 'PatchTask', response: 'TaskResult', errors: [404,422], description: 'Worker may only start own pending task. Coordinator may edit title, reassign pending task, start or cancel. completed requires POST /reports. No terminal edits or no-op changes.' },
  submitReport: { method: 'post', path: '/reports', summary: 'Assigned worker: complete legacy task with report', request: 'CreateReport', response: 'SubmittedReport', status: 201, errors: [404] },
  report: { method: 'get', path: '/reports/:id', summary: 'Read accessible legacy report and private photo metadata', response: 'ReportResult', errors: [404] },
  uploadPhoto: { method: 'post', path: '/reports/:id/photos', summary: 'Report author: attach private photo', multipart: 'legacy', response: 'PhotoResult', status: 201, errors: [404,429] },
  photo: { method: 'get', path: '/photos/:id', summary: 'Authenticated private legacy photo bytes', contentType: 'image/webp', errors: [404,503] },
  expTasks: { method: 'get', path: '/experimental/tasks', summary: 'PROPOSED: list isolated experimental tasks', query: 'tasks', response: 'ExperimentalTasks' },
  expTask: { method: 'get', path: '/experimental/tasks/:id', summary: 'PROPOSED: read isolated task and report revisions', response: 'ExperimentalTaskDetail', errors: [404] },
  expCreate: { method: 'post', path: '/experimental/tasks', summary: 'PROPOSED coordinator: create unassigned draft', request: 'ExperimentalCreate', response: 'ExperimentalTaskResult', status: 201, errors: [422], description: 'Exactly one plantId or candidateSiteId. Legacy tables are not modified.' },
  expTransition: { method: 'post', path: '/experimental/tasks/:id/transitions', summary: 'PROPOSED: assign / start / verify / return', request: 'ExperimentalTransition', response: 'ExperimentalTaskResult', errors: [404,422], description: 'Coordinator assigns, verifies or returns. Worker starts own assigned task. return requires a nonblank comment. version is the current experimental task version.' },
  expHistory: { method: 'get', path: '/experimental/tasks/:id/history', summary: 'PROPOSED: all transitions, comments and snapshots', response: 'ExperimentalHistory', errors: [404] },
  expSubmit: { method: 'post', path: '/experimental/reports', summary: 'PROPOSED worker: submit a report revision', request: 'ExperimentalSubmit', response: 'ExperimentalSubmittedReport', status: 201, errors: [404] },
  expReport: { method: 'get', path: '/experimental/reports/:id', summary: 'PROPOSED: read report review state and photo metadata', response: 'ExperimentalReportResult', errors: [404] },
  expUpload: { method: 'post', path: '/experimental/reports/:id/photos', summary: 'PROPOSED: attach photo before review; increment task version', multipart: 'experimental', response: 'ExperimentalPhotoResult', status: 201, errors: [404,429] },
  expPhoto: { method: 'get', path: '/experimental/photos/:id', summary: 'Authenticated private experimental photo bytes', contentType: 'image/webp', errors: [404,503] },
  snapshot: { method: 'get', path: '/experimental/ai/snapshot', summary: 'PROPOSED coordinator: versioned read-only AI input', response: 'Snapshot', errors: [409] },
  aiPropose: { method: 'post', path: '/experimental/ai/proposals', summary: 'PROPOSED: deterministic mock proposal; no task writes', request: 'AiRequest', response: 'AiProposal', status: 201, errors: [502,503] },
  aiConfirm: { method: 'post', path: '/experimental/ai/proposals/:id/confirm', summary: 'PROPOSED coordinator: confirm into a new experimental draft', request: 'AiConfirm', response: 'AiConfirmed', errors: [404,422] },
  csvPreview: { method: 'post', path: '/imports/plants/preview', summary: 'PROPOSED coordinator: CSV preview only; never imports', request: 'CsvRequest', response: 'CsvPreview', description: 'Exactly id,name,species,latitude,longitude,condition. At most 200 rows / 20,000 characters. No Idempotency-Key required: this endpoint never writes.' }
} as const satisfies Record<string, RouteSpec>;
export type RouteName = keyof typeof routes;
export const openapiPath = (path: string) => path.replace(/:([a-zA-Z]+)/g, '{$1}');
export function buildOpenApi() {
  const components = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => {
    const { $schema, ...json } = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' });
    return [name, json];
  }));
  for (const name of ['CreateTask','ExperimentalCreate']) {
    const base = components[name]!;
    const properties = base.properties!;
    const branches = ['plantId','candidateSiteId'].map(target => ({
      type: 'object' as const, additionalProperties: false,
      properties: Object.fromEntries(Object.entries(properties).filter(([field]) => !['plantId','candidateSiteId'].includes(field) || field===target)),
      required: [...(base.required ?? []),target]
    }));
    delete base.type;
    delete base.properties;
    delete base.required;
    delete base.additionalProperties;
    Object.assign(base, { oneOf: branches });
  }
  Object.assign(components.PatchTask!, { minProperties: 2 });
  const ref = (name: SchemaName) => ({ $ref: `#/components/schemas/${name}` });
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [operationId, route] of Object.entries(routes) as [RouteName, RouteSpec][]) {
    const writing = route.method !== 'get' && operationId !== 'csvPreview';
    const parameters: unknown[] = [...route.path.matchAll(/:([a-zA-Z]+)/g)].map(m => ({ name: m[1], in: 'path', required: true, schema: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' } }));
    if (writing) parameters.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$' },
      description: 'Persisted per user/method/path. Same key and payload replays the original response; different payload = 409. Keep the key after a network failure.' });
    if (route.query) {
      const query = route.query === 'plants' ? input.plantQuery : route.query === 'tasks' ? input.taskQuery : input.listQuery;
      const { properties } = z.toJSONSchema(query, { io: 'input' });
      for (const [name, schema] of Object.entries(properties ?? {})) parameters.push({ name, in: 'query', required: false, schema,
        ...(name === 'date' ? { description: 'created_at on this calendar day in UTC+5, start inclusive / next day exclusive. YYYY-MM-DD, years 2000–2100.' } : {}) });
    }
    const media = route.contentType ?? 'application/json';
    const responseSchema = route.response ? ref(route.response) : route.contentType ? { type: 'string', ...(media === 'image/webp' ? { format: 'binary' } : {}) } : { type: 'object' };
    const responses: Record<string, unknown> = { [route.status ?? 200]: {
      description: 'Successful local DEMO response', content: { [media]: { schema: responseSchema } },
      headers: { 'X-Request-Id': { schema: { type: 'string' } }, ...(writing ? { 'Idempotency-Replayed': { schema: { type: 'string', enum: ['true','false'] } } } : {}) }
    } };
    const errors = new Set([403,500, ...(route.public ? [] : [400,401]), ...(writing ? [409,413,415] : []), ...(operationId === 'csvPreview' ? [413,415] : []), ...(route.errors ?? [])]);
    const errorDescriptions: Record<number,string> = { 400:'Invalid input/JSON/key/date/CSV',401:'Missing or unknown DEMO identity',403:'Role, origin or Host forbidden',404:'Missing or inaccessible resource',409:'Version, status, idempotency, snapshot or photo quota conflict',413:'Payload/file/dimensions/CSV limit',415:'Unsupported or undecodable content',422:'Invalid target or assignee',429:'Image processing busy',500:'Unexpected server error',502:'AI result references invalid data',503:'SQLite/photo/AI temporarily unavailable' };
    for (const status of errors) responses[status] = { description: errorDescriptions[status], content: { 'application/json': { schema: ref('Error') } } };
    let requestBody: unknown;
    if (route.request) requestBody = { required: true, content: { 'application/json': { schema: ref(route.request) } } };
    if (route.multipart) requestBody = { required: true, content: { 'multipart/form-data': { schema: {
      type: 'object', additionalProperties: false, required: route.multipart === 'experimental' ? ['file','version'] : ['file'],
      properties: { file: { type: 'string', format: 'binary', description: 'One JPEG/PNG/WebP, <=5 MiB, <=4096x4096, single frame. Real bytes decoded, stripped of metadata and re-encoded to WebP. Max five photos per report. Filename and MIME are untrusted.' },
        ...(route.multipart === 'experimental' ? { version: { type: 'integer', minimum: 1, description: 'Current experimental task version. Successful attachment increments it.' } } : {}) }
    } } } };
    const path = openapiPath(route.path);
    paths[path] ??= {};
    paths[path]![route.method] = { operationId, summary: route.summary, description: route.description ?? 'DRAFT / DEMO. Not an approved team contract.',
      tags: [route.path.startsWith('/experimental') ? 'PROPOSED experiment' : 'DRAFT local API'],
      security: route.public ? [] : [{ DemoIdentity: [] }], parameters, responses, ...(requestBody ? { requestBody } : {}) };
  }
  return { openapi: '3.1.0', info: { title: 'Green Pavlodar — DRAFT / DEMO', version: '0.2.0-local',
    description: 'All data is synthetic. X-Demo-User is a local simulation, not authentication: a local client can impersonate a demo role. No production access. /experimental is PROPOSED. Same-origin Swagger is supported; optional frontend origins must be explicitly configured local HTTP origins. All timestamps are UTC; date filters use UTC+5. This service makes no external network calls.' },
    servers: [{ url: '/' }], paths, components: { securitySchemes: { DemoIdentity: { type: 'apiKey', in: 'header', name: 'X-Demo-User',
      description: 'demo-coordinator-1 or demo-worker-1 / demo-worker-2 / demo-worker-3. Demo role simulation only.' } }, schemas: components } };
}
