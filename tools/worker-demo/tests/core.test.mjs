import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerWorkflow, validatePhoto, MAX_PHOTO_BYTES } from '../../../apps/web/src/features/worker/workflow.mjs';
import { MemoryDrafts } from '../../../apps/web/src/features/worker/drafts.mjs';
import { createDemoSource, DEMO_SCOPE, DEMO_DATE } from '../demo/source.mjs';
import { createWorkerGateway, requestJSON } from '../../../apps/web/src/features/worker/gateway.mjs';
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=', 'base64');
const photo = () => new File([pngBytes], 'test.png', { type: 'image/png' });
function setup() {
  const source = createDemoSource({ delayMs: 0 }); const drafts = new MemoryDrafts();
  const gateway = createWorkerGateway(source.apiFor('demo-worker-1'));
  const workflow = new WorkerWorkflow({ gateway, drafts, userId: 'demo-worker-1', scope: DEMO_SCOPE, timeoutMs: 15 });
  return { source, drafts, gateway, workflow };
}
async function report(env, id = 'GP-104') {
  await env.gateway.startTask(id); const draft = await env.workflow.draft(id); draft.photo = photo(); draft.note = 'Работа выполнена. Нужна проверка опоры.'; await env.workflow.save(draft); return draft;
}
test('D01: only assigned tasks for chosen date; empty shift', async () => {
  const { gateway, source } = setup(); const tasks = await gateway.listTasks({ date: DEMO_DATE });
  assert.equal(tasks.length, 5); assert.ok(tasks.every(t => t.assignedTo === 'demo-worker-1'));
  assert.deepEqual(await gateway.listTasks({ date: '2026-10-29' }), []);
  assert.deepEqual(await source.apiFor('demo-empty').listTasks(), []);
});
test('D03: a failed start leaves source state unchanged', async () => {
  const { gateway, source } = setup(); source.controls.failStart = true;
  await assert.rejects(gateway.startTask('GP-104'), /не сохранено/);
  assert.equal((await gateway.getTask('GP-104')).permissions.start, true);
  assert.equal(source.snapshot().calls.starts, 0);
});
test('D03/D18: cross-user task access, start and accepted tasks are rejected', async () => {
  const { gateway } = setup(); await assert.rejects(gateway.getTask('GP-OTHER'), /Нет доступа/);
  await assert.rejects(gateway.startTask('GP-OTHER'), /Нет доступа/);
  await assert.rejects(gateway.startTask('GP-091'), /нельзя начать/);
});
test('D04/D10: saved report awaits review, return + revision + acceptance preserve history', async () => {
  const env = setup(); const draft = await report(env); const receipt = await env.workflow.send(draft);
  assert.equal(receipt.reviewLabel, 'Ожидает проверки'); assert.equal((await env.gateway.getTask('GP-104')).section, 'submitted');
  env.source.review('GP-104', 'return', 'Нужен общий снимок.');
  const returned = await env.gateway.getTask('GP-104'); assert.equal(returned.coordinatorComment, 'Нужен общий снимок.');
  const correction = await env.workflow.draft('GP-104'); correction.photo = photo(); correction.note = 'Добавлен общий снимок.';
  await env.gateway.startTask('GP-104');
  assert.notEqual(correction.idempotencyKey, draft.idempotencyKey);
  await env.workflow.send(correction); env.source.review('GP-104', 'accept', 'Принято.');
  const accepted = await env.gateway.getTask('GP-104'); assert.equal(accepted.section, 'confirmed'); assert.equal(accepted.history.length, 2);
  assert.equal(accepted.history[1].revisionOf, receipt.id); assert.equal(accepted.permissions.report, false);
});
test('D08: lost response after commit -> retry produces exactly one report and upload', async () => {
  const env = setup(); const draft = await report(env); env.source.controls.loseResponse = true;
  await assert.rejects(env.workflow.send(draft), /Ответ потерян/);
  const recovered = await env.workflow.draft('GP-104'); assert.equal(recovered.idempotencyKey, draft.idempotencyKey); assert.equal(recovered.delivery, 'uncertain');
  await env.workflow.send(recovered); assert.equal(env.source.snapshot().calls.reports, 1); assert.equal(env.source.snapshot().calls.uploads, 1);
  assert.equal((await env.workflow.pending()).length, 0);
});
test('D08: concurrent double tap shares one operation', async () => {
  const env = setup(); const draft = await report(env);
  const first = env.workflow.send(draft), second = env.workflow.send(draft); assert.equal(first, second);
  await Promise.all([first, second]); assert.equal(env.source.snapshot().calls.reports, 1); assert.equal(env.source.snapshot().calls.uploads, 1);
});
test('D08: a retry cannot silently replace frozen payload', async () => {
  const env = setup(); const draft = await report(env); const original = draft.note; env.source.controls.loseResponse = true;
  await assert.rejects(env.workflow.send(draft)); draft.note = 'Изменённый текст не должен заменить отправленный';
  await env.workflow.send(draft); assert.equal((await env.gateway.getTask('GP-104')).history[0].note, original);
});
test('D04/D09: upload failure and source outage preserve text, Blob and operation key', async () => {
  const env = setup(); const draft = await report(env); env.source.controls.failUpload = true;
  await assert.rejects(env.workflow.send(draft), /Ошибка загрузки/);
  const recovered = await env.workflow.draft('GP-104'); assert.equal(recovered.note, draft.note); assert.equal(recovered.photo.size, photo().size); assert.equal(recovered.idempotencyKey, draft.idempotencyKey);
  env.source.controls.failUpload = false; env.source.controls.offline = true; await assert.rejects(env.workflow.send(recovered), /Нет связи/);
  env.source.controls.offline = false; assert.equal((await env.workflow.synchronize())[0].saved, true);
});
test('D09: separate users and scopes cannot read or send each other’s drafts', async () => {
  const env = setup(); const draft = await report(env);
  const another = new WorkerWorkflow({ gateway: env.source.apiFor('demo-worker-2'), drafts: env.drafts, userId: 'demo-worker-2', scope: DEMO_SCOPE });
  assert.deepEqual(await another.pending(), []); await assert.rejects(another.send(draft), /другой сессии/);
  assert.deepEqual(await env.drafts.list('production', 'demo-worker-1'), []);
});
test('D04: spoofed, empty, unsupported and oversized files are rejected', async () => {
  await validatePhoto(photo()); await assert.rejects(validatePhoto(new File(['not image'], 'x.png', { type:'image/png' })), /не соответствует/);
  await assert.rejects(validatePhoto(new File([], 'x.png', { type:'image/png' })), /непустую/);
  await assert.rejects(validatePhoto(new File(['x'], 'x.exe', { type:'application/octet-stream' })), /Поддерживаются/);
  await assert.rejects(validatePhoto(new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], 'large.png', { type:'image/png' })), /больше 10/);
});
test('D06: AI timeout never blocks submitting an ordinary note', async () => {
  const env = setup(); const draft = await report(env); env.source.controls.aiTimeout = true;
  await assert.rejects(env.workflow.analyze(draft.note,{taskId:'GP-104',objectId:'plant-GP-104'}), /AI/); await env.workflow.send(draft);
  const saved = (await env.gateway.getTask('GP-104')).history[0]; assert.equal(saved.note, draft.note); assert.equal(saved.analysis, null);
});
test('D06: only confirmed interpretation is submitted, provenance retained', async () => {
  const env = setup(); const draft = await report(env); const proposal = await env.workflow.analyze(draft.note,{taskId:'GP-104',objectId:'plant-GP-104'});
  draft.analysis = { ...proposal, category: 'needs_inspection', decision: 'edited', confirmedBy: 'demo-worker-1' };
  await env.workflow.send(draft); const saved = env.source.snapshot().reports.find(r=>r.taskId==='GP-104').confirmedObservation;
  assert.equal(saved.category, 'needs_inspection'); assert.equal(saved.provenance.originalText, draft.note); assert.equal(saved.provenance.provider, 'rules');
});
test('D05: issue creates coordinator notification and does not complete task; retry deduplicates', async () => {
  const env = setup(); const d = await env.workflow.draft('GP-112', 'issue'); d.reason = 'Нет доступа'; d.note = 'Проход закрыт.'; await env.workflow.save(d);
  env.source.controls.loseResponse = true; await assert.rejects(env.workflow.send(d)); await env.workflow.send(d);
  assert.equal(env.source.snapshot().notifications.length, 1); assert.equal(env.source.snapshot().calls.issues, 1);
  const task = await env.gateway.getTask('GP-112'); assert.equal(task.section, 'current'); assert.equal(task.statusLabel, 'Назначено');
});
test('D09: unfinished drafts are never sent by queue sync', async () => {
  const env = setup(); const d = await env.workflow.draft('GP-112', 'issue'); d.note = 'Черновик'; await env.workflow.save(d);
  assert.deepEqual(await env.workflow.synchronize(), []); assert.equal(env.source.snapshot().calls.issues, 0);
});
test('D14: resetting demo restores only the namespaced fixture', async () => {
  const values = new Map([['unrelated-app', 'keep-me']]); const storage = { getItem: k => values.get(k), setItem: (k,v) => values.set(k,v) };
  const source = createDemoSource({ storage, delayMs: 0 }); await source.apiFor('demo-worker-1').startTask('GP-104'); source.reset();
  assert.equal(values.get('unrelated-app'), 'keep-me'); assert.equal(source.snapshot().calls.starts, 0);
  assert.equal((await source.apiFor('demo-worker-1').getTask('GP-104')).permissions.start, true);
});
test('integration: incomplete bindings fail closed, HTTP errors are never successes', async () => {
  assert.throws(() => createWorkerGateway({}), /Не подключена/);
  const fetchOriginal = globalThis.fetch;
  try { globalThis.fetch = async () => ({ ok: false, status: 403 }); await assert.rejects(requestJSON('/example'), /Нет доступа/); }
  finally { globalThis.fetch = fetchOriginal; }
});
