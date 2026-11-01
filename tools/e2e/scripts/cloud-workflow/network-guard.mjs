import { createHash } from 'node:crypto';

export const ORIGIN = 'https://green-pavlodar-api.pages.dev';
const PREFIX = '/api/v1';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
const exactKeys = (body, keys) => body && typeof body === 'object' && !Array.isArray(body)
  && Object.keys(body).sort().join('|') === [...keys].sort().join('|');
const invariant = condition => { if (!condition) throw Error('SCOPED_CONTRACT_REJECTED'); };
const pick = (object, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(object ?? {}, key)).map(key => [key, object[key]]));

export function strictValidateInitialTask(data, state) {
  invariant(data?.id === state.taskId && data.objectId === state.siteId && data.objectType === 'candidate_site');
  invariant(data.action === 'inspect' && data.status === 'assigned' && data.version === 3 && data.minWorkers === 1);
  invariant(Array.isArray(data.assignedWorkerIds) && data.assignedWorkerIds.length === 1 && data.assignedWorkerIds[0] === state.workerId);
  invariant(data.isDemo === true);
  state.initialTaskVerified = true;
  state.taskVersion = 3;
  state.taskStatus = 'assigned';
  return true;
}
export { strictValidateInitialTask as strictvalidateInitialTask };

function jsonBody(request) {
  const value = request.postDataJSON();
  invariant(value && typeof value === 'object' && !Array.isArray(value));
  return value;
}

function uploadBody(request, state) {
  const type = request.headers()['content-type'] ?? '';
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(type);
  invariant(/^multipart\/form-data;/i.test(type) && boundaryMatch);
  const boundary = boundaryMatch[1] ?? boundaryMatch[2];
  const bytes = request.postDataBuffer();
  invariant(bytes && bytes.length > 0 && bytes.length < 5 * 1024 * 1024 + 16384);
  const raw = bytes.toString('latin1'), parts = raw.split('--' + boundary).slice(1, -1);
  invariant(parts.length === 2);
  let file, task;
  for (const part of parts) {
    const split = part.indexOf('\r\n\r\n');
    invariant(split > 0 && part.endsWith('\r\n'));
    const headers = part.slice(0, split), content = part.slice(split + 4, -2);
    if (/name="taskId"(?:;|\r\n|$)/.test(headers)) {
      invariant(task === undefined && !/filename=/i.test(headers)); task = content;
    } else if (/name="file";\s*filename="[^"\r\n]+"/i.test(headers)) {
      invariant(file === undefined && /Content-Type:\s*image\/webp\s*(?:\r\n|$)/i.test(headers));
      file = Buffer.from(content, 'latin1');
    } else throw Error('SCOPED_CONTRACT_REJECTED');
  }
  invariant(task === state.taskId && file && file.length > 0 && file.length <= 5 * 1024 * 1024);
  invariant(file.subarray(0, 4).toString('ascii') === 'RIFF' && file.subarray(8, 12).toString('ascii') === 'WEBP');
  return { taskId: task, fileSha256: digest(file), fileBytes: file.length };
}

function readonlyOptions(body) {
  invariant(exactKeys(body, ['options']) && body.options && typeof body.options === 'object' && !Array.isArray(body.options));
  const options = body.options;
  invariant(Object.keys(options).every(key => ['variant','purpose','careYears','excluded','locked','replacements','watering','improveSoil','maxSpeciesShare'].includes(key)));
  if (options.variant !== undefined) invariant(['econom','optimal','max'].includes(options.variant));
  if (options.careYears !== undefined) invariant([1,2,3].includes(options.careYears));
  if (options.watering !== undefined) invariant(['regular','rare','none'].includes(options.watering));
  for (const key of ['excluded','locked']) if (options[key] !== undefined) invariant(Array.isArray(options[key]) && options[key].every(x => typeof x === 'string'));
  if (options.improveSoil !== undefined) invariant(typeof options.improveSoil === 'boolean');
  if (options.maxSpeciesShare !== undefined) invariant(typeof options.maxSpeciesShare === 'number' && options.maxSpeciesShare >= 0 && options.maxSpeciesShare <= 1);
}

export async function installGuard(context, state, _record) {
  state.safe ??= {}; state.safe.network ??= []; state.safe.blockedRequests ??= []; state.safe.mutations ??= [];
  const pending = new Set(), requests = new WeakMap(), operations = new Map();
  const loginNames = { worker: 'release-738f96b2-worker', coordinator: 'coordinator', viewer: 'viewer' };
  const loginAttempts = new Map();
  const flush = async () => { while (pending.size) await Promise.allSettled([...pending]); };
  const blocked = (method, path, role, reason) => state.safe.blockedRequests.push({ method, path, role, reason });
  const track = promise => { pending.add(promise); promise.finally(() => pending.delete(promise)); };
  const settle = (meta, value) => { if (meta?.resolveOutcome) { meta.resolveOutcome(value); meta.resolveOutcome = null; } };

  context.on('response', response => {
    const request = response.request(), meta = requests.get(request);
    if (!meta) return;
    track((async () => {
      const status = response.status();
      state.safe.network.push({ method: meta.method, path: meta.path, role: meta.role, status });
      let body;
      if (status === 403 && meta.kind === 'business') {
        try { body = await response.json(); } catch { /* code remains unknown */ }
      }
      settle(meta, { status, code: body?.error?.code === 'CSRF_REQUIRED' ? 'CSRF_REQUIRED' : null });
      if (meta.kind !== 'business') return;
      state.safe.mutations.push({ operation: meta.operation, path: meta.path, role: meta.role, status, requestSha256: meta.signature });
      if (status < 200 || status >= 300) return;
      try {
        const data = (body ?? await response.json()).data;
        if (meta.operation === 'start') {
          invariant(status === 200 && data?.id === state.taskId && data.status === 'in_progress' && data.version === 4);
          state.taskVersion = data.version; state.taskStatus = data.status;
        } else if (meta.operation === 'upload') {
          invariant(status === 201 && uuid(data?.id) && data.taskId === state.taskId && data.ownerId === state.workerId && data.reportId === null);
          invariant(data.mediaType === 'image/webp' && /^[a-f0-9]{64}$/.test(data.sha256) && Number.isInteger(data.byteSize) && data.byteSize > 0 && data.byteSize <= 5 * 1024 * 1024);
          invariant(data.contentUrl === PREFIX + '/uploads/' + data.id);
          state.newPhoto = pick(data, ['id','taskId','ownerId','reportId','sha256','byteSize','mediaType','createdAt','contentUrl']);
        } else if (meta.operation === 'submit') {
          invariant(status === 201 && data?.task?.id === state.taskId && data.task.status === 'submitted' && data.task.version === 5);
          const report = data.report;
          invariant(uuid(report?.id) && report.taskId === state.taskId && report.authorId === state.workerId && report.reviewStatus === 'pending' && report.version === 1);
          invariant(report.note === state.note && report.photoIds?.length === 1 && report.photoIds[0] === state.newPhoto?.id);
          invariant(report.actualWorkerIds?.length === 1 && report.actualWorkerIds[0] === state.workerId && report.actualPlantingItems?.length === 0);
          state.taskVersion = data.task.version; state.taskStatus = data.task.status;
          state.newReport = { ...pick(report, ['id','taskId','authorId','photoIds','actualWorkerIds','version','reviewStatus','createdAt','reviewedAt','reviewerId']), dtoSha256: digest(report) };
          state.newPhoto.reportId = report.id;
        } else if (meta.operation === 'review') {
          invariant(status === 200 && data?.task?.id === state.taskId && data.task.status === 'verified' && data.task.version === 6);
          const report = data.report;
          invariant(report?.id === state.newReport?.id && report.taskId === state.taskId && report.reviewStatus === 'accepted' && report.version === 2);
          invariant(report.reviewComment === state.comment && report.photoIds?.length === 1 && report.photoIds[0] === state.newPhoto?.id);
          invariant(Array.isArray(data.plants) && !data.plants.length && Array.isArray(data.careTasks) && !data.careTasks.length);
          state.taskVersion = data.task.version; state.taskStatus = data.task.status;
          state.newReport = { ...pick(report, ['id','taskId','authorId','photoIds','actualWorkerIds','version','reviewStatus','createdAt','reviewedAt','reviewerId']), dtoSha256: digest(report) };
        }
      } catch { blocked(meta.method, meta.path, meta.role, 'RESPONSE_CONTRACT_MISMATCH'); }
    })().catch(() => { settle(meta, { status: null, code: null }); blocked(meta.method, meta.path, meta.role, 'RESPONSE_PROCESSING_FAILED'); }));
  });
  context.on('requestfailed', request => {
    const meta = requests.get(request); if (meta) settle(meta, { status: null, code: null });
  });

  await context.route('**/*', async route => {
    const request = route.request(), method = request.method(), role = state.currentRole;
    let url;
    try { url = new URL(request.url()); } catch { await route.abort('blockedbyclient'); return; }
    const path = url.pathname.startsWith(PREFIX + '/') ? url.pathname.slice(PREFIX.length) : url.pathname;
    const isApi = url.origin === ORIGIN && url.pathname.startsWith(PREFIX + '/');
    if (['GET','HEAD'].includes(method)) {
      if (isApi) requests.set(request, { method, path, role, kind: 'read' });
      await route.continue(); return;
    }
    let meta;
    try {
      invariant(isApi && !url.search && method === 'POST');
      await flush();
      if (path === '/auth/login') {
        const body = jsonBody(request);
        invariant(exactKeys(body, ['login','password']) && loginNames[role] === body.login && body.password === state.password);
        invariant(!loginAttempts.has(role)); loginAttempts.set(role, true);
        meta = { method, path, role, kind: 'auth' };
      } else if (path === '/auth/logout') {
        invariant(exactKeys(jsonBody(request), [])); meta = { method, path, role, kind: 'auth' };
      } else if (['coordinator','viewer'].includes(role) && [`/zones/${state.siteId}/analysis`,`/zones/${state.siteId}/variants`].includes(path)) {
        readonlyOptions(jsonBody(request)); meta = { method, path, role, kind: 'calculation' };
      } else {
        invariant(state.initialTaskVerified === true);
        let operation, payload;
        if (role === 'worker' && path === `/tasks/${state.taskId}/start`) {
          operation = 'start'; payload = jsonBody(request);
          invariant(exactKeys(payload, ['expectedVersion']) && payload.expectedVersion === 3 && state.taskVersion === 3 && state.taskStatus === 'assigned');
        } else if (role === 'worker' && path === '/uploads') {
          operation = 'upload'; invariant(state.taskVersion === 4 && state.taskStatus === 'in_progress' && !state.newPhoto);
          payload = uploadBody(request, state);
        } else if (role === 'worker' && path === `/tasks/${state.taskId}/reports`) {
          operation = 'submit'; payload = jsonBody(request);
          invariant(exactKeys(payload, ['expectedVersion','photoIds','note','location','confirmedObservation','actualWorkerIds','actualPlantingItems']));
          invariant(state.taskVersion === 4 && state.taskStatus === 'in_progress' && !state.newReport && payload.expectedVersion === 4);
          invariant(payload.note === state.note && payload.location === null && payload.confirmedObservation === null);
          invariant(payload.photoIds?.length === 1 && payload.photoIds[0] === state.newPhoto?.id);
          invariant(payload.actualWorkerIds?.length === 1 && payload.actualWorkerIds[0] === state.workerId && Array.isArray(payload.actualPlantingItems) && !payload.actualPlantingItems.length);
        } else if (role === 'coordinator' && path === `/reports/${state.newReport?.id}/review`) {
          operation = 'review'; payload = jsonBody(request);
          invariant(exactKeys(payload, ['expectedVersion','expectedReportVersion','decision','comment','acceptGeometryDeviation']));
          invariant(state.taskVersion === 5 && state.taskStatus === 'submitted' && state.newReport?.version === 1);
          invariant(payload.expectedVersion === 5 && payload.expectedReportVersion === 1 && payload.decision === 'accepted' && payload.comment === state.comment && payload.acceptGeometryDeviation === false);
        } else throw Error('SCOPED_CONTRACT_REJECTED');
        const key = request.headers()['idempotency-key']; invariant(typeof key === 'string' && key.length > 0 && key.length <= 200);
        const signature = digest(payload), previous = operations.get(operation);
        if (previous) {
          invariant(previous.key === key && previous.signature === signature && previous.attempts === 1);
          const outcome = await previous.lastOutcome;
          invariant(outcome.status === 403 && outcome.code === 'CSRF_REQUIRED'); previous.attempts += 1;
        } else operations.set(operation, { key, signature, originalBody: payload, attempts: 1, lastOutcome: null });
        const logical = operations.get(operation);
        let resolveOutcome;
        logical.lastOutcome = new Promise(resolve => { resolveOutcome = resolve; });
        meta = { method, path, role, kind: 'business', operation, signature, resolveOutcome };
      }
      requests.set(request, meta);
      await route.continue();
    } catch {
      if (meta) settle(meta, { status: null, code: null });
      blocked(method, path, role, 'REQUEST_SCOPE_REJECTED');
      try { await route.abort('blockedbyclient'); } catch { /* already ended */ }
    }
  });
  return { flush };
}
