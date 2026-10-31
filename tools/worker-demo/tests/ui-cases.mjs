// Shipped regressions adapted from the UI owner's coordination/worker-ui.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerWorkflow, validatePhoto, SERVER_MAX_PHOTO_BYTES } from '../../../apps/web/src/features/worker/workflow.mjs';
import { MemoryDrafts } from '../../../apps/web/src/features/worker/drafts.mjs';
import { safePhotoURL, parsePositions } from '../../../apps/web/src/features/worker/field-values.mjs';
import { scheme, reportQuantities, assignmentPanel } from '../../../apps/web/src/features/worker/v2-views.mjs';
import { ru, dictionary } from '../../../apps/web/src/features/worker/strings.mjs';
import { navigation } from '../../../apps/web/src/features/worker/cabinet-layout.mjs';
import { displayText, taskLabels, localizedError, formatDateTime } from '../../../apps/web/src/features/worker/worker-display.mjs';

// Import the component without constructing DOM nodes; restore import-only globals.
const domDescriptors = new Map(['HTMLElement', 'customElements'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
globalThis.HTMLElement = class {};
globalThis.customElements = { define() {} };
let GreenWorker;
try { ({ GreenWorker } = await import('../../../apps/web/src/features/worker/worker.mjs')); }
finally {
  for (const [name, descriptor] of domDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}

const picture = () => new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=', 'base64')], 'fixture.png', { type: 'image/png' });
const task = () => ({
  id: 't', version: 7, visibleToCurrentUser: true, assignedWorkerIds: ['w', 'f'], minWorkers: 2,
  reportMode: 'final', actionCode: 'plant', permissions: { report: true, issue: true },
  approvedDesignId: 'd', approvedDesignVersion: 1,
  design: { id: 'd', revision: 1, status: 'approved', plantingItems: [{ id: 'i', catalogItemId: 'c', quantity: 1, geometry: { type: 'Point', coordinates: [76, 52] } }] },
  sharedDraft: { version: 0, contributions: [{ authorId: 'w', photoIds: ['p'] }] }, context: { features: [] }, catalog: [],
});
function setup(t = task()) {
  let sent;
  const gateway = {
    getTask: async () => t,
    submitReport: async payload => { sent = payload; return { id: 'r', saved: true }; },
    submitIssue: async payload => { sent = payload; return { id: 'i', saved: true }; },
    uploadPhoto: async () => ({ id: 'p' }),
  };
  const drafts = new MemoryDrafts();
  const workflow = new WorkerWorkflow({ gateway, drafts, userId: 'w', scope: 'qa', strictServer: true });
  return { workflow, gateway, drafts, t, get sent() { return sent; } };
}
async function finalDraft(env) {
  const draft = await env.workflow.draft('t');
  Object.assign(draft, { note: 'Посадка проверена', foremanChecked: true, actualWorkerIds: ['w', 'f'],
    actualPlantingItems: [{ plantingItemId: 'i', catalogItemId: 'c', quantity: 1 }],
    actualPositions: { i: '52, 76' }, baseVersion: 7, sharedBaseVersion: 0 });
  return draft;
}

test('real API workflow: final keeps task version 7 and draft version 0 and records actual coordinates', async () => {
  const env = setup();
  await env.workflow.send(await finalDraft(env));
  assert.equal(env.sent.expectedVersion, 7);
  assert.equal(env.sent.expectedDraftVersion, 0);
  assert.deepEqual(env.sent.actualPlantingItems[0].geometry, { type: 'Point', coordinates: [76, 52] });
});

test('real API workflow: draft version 0 detects a new contribution before freezing or upload', async () => {
  const env = setup(), draft = await finalDraft(env);
  let uploads = 0;
  env.gateway.uploadPhoto = async () => { uploads++; return { id: 'p' }; };
  draft.photo = picture();
  env.t.sharedDraft.version = 1;
  await assert.rejects(env.workflow.send(draft), /Данные изменились/);
  assert.equal(draft.delivery, 'conflict');
  assert.equal(draft.frozen, null);
  assert.equal(uploads, 0);
  assert.equal(env.sent, undefined);
});

test('real API workflow: group contribution needs no planting quantities', async () => {
  const env = setup(); env.t.reportMode = 'contribution';
  const draft = await env.workflow.draft('t');
  Object.assign(draft, { note: 'Материалы участника', photo: picture() });
  await env.workflow.send(draft);
  assert.deepEqual(env.sent.actualPlantingItems, []);
  assert.deepEqual(env.sent.actualWorkerIds, ['w']);
});

test('real API workflow: final rejects too few actual workers before freezing', async () => {
  const env = setup(), draft = await finalDraft(env);
  draft.actualWorkerIds = ['w'];
  await assert.rejects(env.workflow.send(draft), /минимума/);
  assert.equal(draft.frozen, null);
  assert.equal(env.sent, undefined);
});

test('real API workflow: issue bounds combined text and skips a photo the endpoint cannot attach', async () => {
  const env = setup(), draft = await env.workflow.draft('t', 'issue');
  draft.note = 'x'.repeat(4000);
  await assert.rejects(env.workflow.send(draft), /вместе/);
  assert.equal(draft.frozen, null);
  let uploads = 0;
  env.gateway.uploadPhoto = async () => { uploads++; return { id: 'p' }; };
  draft.note = 'Проход закрыт'; draft.photo = picture();
  await env.workflow.send(draft);
  assert.equal(uploads, 0);
  assert.equal(env.sent.photoId, null);
});

test('real API workflow: definitive report rejection permits rebase while network uncertainty preserves the action', async () => {
  const env = setup(), draft = await finalDraft(env);
  env.gateway.submitReport = async () => { throw Object.assign(new Error('bad data'), { status: 400 }); };
  await assert.rejects(env.workflow.send(draft));
  assert.equal(draft.delivery, 'rejected');
  assert.deepEqual(await env.workflow.synchronize(), []);
  const rejectedKey = draft.idempotencyKey;
  await env.workflow.rebase(draft);
  assert.notEqual(draft.idempotencyKey, rejectedKey);
  assert.equal(draft.frozen, null);
  env.gateway.submitReport = async () => { throw new Error('network'); };
  await assert.rejects(env.workflow.send(draft));
  assert.equal(draft.delivery, 'uncertain');
  const uncertainKey = draft.idempotencyKey;
  await assert.rejects(env.workflow.rebase(draft), /тем же ключом/);
  assert.equal(draft.idempotencyKey, uncertainKey);
  assert.ok(draft.frozen);
});

test('real API UI: positions reject incomplete, duplicate, wrong-count and out-of-range coordinates', () => {
  assert.throws(() => parsePositions('52,', 1));
  assert.throws(() => parsePositions('52, 76\n52, 76', 2));
  assert.throws(() => parsePositions('52, 76', 2));
  assert.throws(() => parsePositions('95, 76', 1));
});

test('real API workflow: upload size is capped at 5 MiB', async () => {
  await assert.rejects(validatePhoto(new File([new Uint8Array(SERVER_MAX_PHOTO_BYTES + 1)], 'large.png', { type: 'image/png' }), SERVER_MAX_PHOTO_BYTES), /больше 5/);
});

test('real API UI: contribution hides final quantities and a mismatched revision hides the scheme', () => {
  const current = task(); current.reportMode = 'contribution';
  assert.equal(reportQuantities(current, { kind: 'report' }, ru, false, false), '');
  current.design.revision = 2;
  assert.doesNotMatch(scheme(current, ru), /<svg/);
  assert.match(scheme(current, ru), new RegExp(ru.staleDesign.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('real API UI: assignment exposes worker selection without unsupported schedule/responsible controls', () => {
  const current = { ...task(), status: 'assigned', assignedCrewId: 'crew', requiredSkills: [] };
  const workspace = { crews: [{ id: 'crew' }], workers: [{ id: 'w', crewIds: ['crew'], displayName: 'W', profile: null }], resources: [] };
  const html = assignmentPanel(current, workspace, null, ru, false, false);
  assert.match(html, /data-assignment-worker/);
  assert.doesNotMatch(html, /assign-start|responsible/);
});

test('real API UI: authenticated contentUrl is allowed while protocol-relative and active URLs are rejected', () => {
  assert.equal(safePhotoURL('/api/v1/uploads/p'), '/api/v1/uploads/p');
  assert.equal(safePhotoURL('//outside.example/p'), '');
  assert.equal(safePhotoURL('javascript:alert(1)'), '');
});

function ui() {
  const component = Object.create(GreenWorker.prototype);
  Object.assign(component, { selected: { ...task(), assignedCrewId: 'crew' }, tasks: [], user: { id: 'w', role: 'worker' },
    workflow: { pending: async () => [] }, root: { querySelector: () => null }, contextVersion: 1, busy: false, t: ru,
    pendingStarts: new Map(), photoSelectionVersion: 0, render() {}, refresh: async () => {}, dispatchEvent() {} });
  return component;
}

test('worker UI: network timeout releases busy state, keeps the draft and uses the selected dictionary', async () => {
  for (const locale of ['ru', 'kk', 'kk-draft']) {
    const component = ui();
    const draft = { kind: 'report', note: 'Saved note', photo: picture(), idempotencyKey: 'same-operation' };
    component.t = dictionary(locale);
    component.draft = draft;
    component.writeChain = Promise.resolve();
    component.workflow = {
      send: async () => { throw Object.assign(new Error('TimeoutError: internal message'), { code: 'WORKER_REQUEST_TIMEOUT' }); },
      pending: async () => [draft],
    };
    await component.action('send');
    assert.equal(component.busy, false);
    assert.equal(component.draft, draft);
    assert.deepEqual(component.queue, [draft]);
    assert.equal(component.messageText(), component.t.requestTimeout);
    component.showError({ code: 'WORKER_REQUEST_ABORTED', message: 'AbortError: internal message' });
    assert.equal(component.messageText(), component.t.requestCancelled);
  }
});

test('worker navigation: native buttons expose exactly one active page to keyboard and assistive technology', () => {
  const pages = ['tasks', 'history', 'profile'];
  for (const page of pages) {
    const buttons = [...navigation({ t: ru, page }).matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    assert.equal(buttons.length, 3);
    assert.deepEqual(buttons.map(([, attributes]) => attributes.match(/data-id="([^"]+)"/)[1]), pages);
    for (const [, attributes, content] of buttons) {
      const current = attributes.includes(`data-id="${page}"`);
      assert.match(attributes, /type="button"/);
      assert.doesNotMatch(attributes, /disabled|tabindex="-1"/, 'navigation must remain natively keyboard operable');
      assert.equal(/aria-current="page"/.test(attributes), current);
      assert.equal(/class="active"/.test(attributes), current);
      assert.match(content, /Смена|Журнал|Профиль/);
    }
  }
});

function navigationUi() {
  const component = ui(), rendered = [], focused = [];
  Object.assign(component, { page: 'tasks', date: '2026-10-28', section: 'submitted', mobileDetail: true,
    queue: [], draft: { note: 'Несохранённая заметка', photo: picture() }, previewURL: 'blob:qa-photo',
    assignmentDraft: { taskId: 't', workerIds: ['w', 'f'] }, message: { text: 'Черновик на устройстве', tone: 'info' } });
  component.tasks = [component.selected];
  component.render = () => {
    rendered.push(component.page);
    // The desktop and mobile landmarks contain duplicate actions. Only the visible
    // matching button is a valid target after replacing the shadow-root markup.
    component.root.querySelectorAll = () => [
      { dataset: { id: component.page }, getClientRects: () => [], focus: () => assert.fail('focused hidden navigation') },
      ...['tasks', 'history', 'profile'].map(id => ({ dataset: { id }, getClientRects: () => [{}],
        focus: options => focused.push({ page: id, options }) })),
    ];
  };
  component.root.querySelectorAll = () => [];
  return { component, rendered, focused };
}

test('worker navigation: a round trip preserves an open photo report and lets an in-flight draft save finish', async () => {
  const { component, rendered, focused } = navigationUi(), env = setup();
  component.workflow = env.workflow;
  component.draft = await env.workflow.draft('t');
  Object.assign(component.draft, { note: 'Фото и пояснение ещё сохраняются', photo: picture() });
  const draft = component.draft, saving = deferred();
  component.writeChain = saving.promise.then(() => env.workflow.save(draft));
  const preserved = Object.fromEntries(['date', 'section', 'selected', 'tasks', 'mobileDetail', 'draft',
    'previewURL', 'assignmentDraft', 'message', 'writeChain', 'queue'].map(key => [key, component[key]]));
  const photo = draft.photo, key = draft.idempotencyKey;

  for (const page of ['history', 'profile', 'tasks']) {
    await component.action('nav', page);
    assert.equal(component.page, page);
    for (const [field, value] of Object.entries(preserved)) assert.equal(component[field], value, `navigation replaced ${field}`);
    assert.equal(component.draft.photo, photo);
    assert.equal(component.draft.idempotencyKey, key);
  }
  assert.deepEqual(rendered, ['history', 'profile', 'tasks']);
  assert.deepEqual(focused, ['history', 'profile', 'tasks'].map(page => ({ page, options: { preventScroll: true } })));
  assert.equal(await env.drafts.get(draft.storageKey), undefined, 'navigation must not pretend that a pending write has completed');
  saving.resolve();
  await component.writeChain;
  const saved = await env.workflow.draft('t');
  assert.equal(saved.note, draft.note);
  assert.equal(saved.idempotencyKey, key);
  assert.equal(saved.photo.name, photo.name);
  assert.deepEqual(await saved.photo.arrayBuffer(), await photo.arrayBuffer());
  assert.equal(component.mobileDetail, true, 'returning to the shift must retain the open task form');
});

test('worker navigation: same-page and unknown actions retain focus and do not discard the current form', async () => {
  const { component, rendered, focused } = navigationUi();
  const draft = component.draft, selected = component.selected;
  for (const page of ['tasks', 'unknown', '', undefined]) {
    await component.action('nav', page);
    assert.equal(component.page, 'tasks');
    assert.equal(component.draft, draft);
    assert.equal(component.selected, selected);
    assert.equal(component.mobileDetail, true);
  }
  assert.deepEqual(rendered, []);
  assert.deepEqual(focused, []);
});

test('worker navigation: an in-flight mutation blocks page and focus changes', async () => {
  const { component, rendered, focused } = navigationUi();
  const draft = component.draft;
  component.busy = true;
  await component.action('nav', 'history');
  assert.equal(component.page, 'tasks');
  assert.equal(component.draft, draft);
  assert.equal(component.mobileDetail, true);
  assert.deepEqual(rendered, []);
  assert.deepEqual(focused, []);
});

test('worker language: RU/KK round trip keeps the open photo draft and pending save without reconfiguring', async () => {
  const { component } = navigationUi(), env = setup(), saving = deferred();
  component.locale = 'ru';
  component.workflow = env.workflow;
  component.gateway = new Proxy({}, { get: () => { throw Error('Changing language must not contact the API'); } });
  component.configure = () => assert.fail('Changing language must not reset the cabinet');
  component.draft = await env.workflow.draft('t');
  Object.assign(component.draft, { note: 'Не потерять заметку', photo: picture() });
  component.selected = { ...component.selected, reportMode: 'single', approvedDesignId: null, design: null };
  const draft = component.draft, photo = draft.photo, key = draft.idempotencyKey;
  component.writeChain = saving.promise.then(() => env.workflow.save(draft));
  const preserved = Object.fromEntries(['page', 'date', 'section', 'selected', 'tasks', 'mobileDetail', 'draft',
    'previewURL', 'assignmentDraft', 'message', 'writeChain', 'queue', 'contextVersion', 'photoSelectionVersion',
    'workflow', 'gateway', 'busy'].map(field => [field, component[field]]));
  const renders = [];
  component.render = () => renders.push(component.form());
  component.setLocale('kk');
  assert.equal(component.t.start, 'Тапсырманы бастау');
  assert.match(renders[0], /Фото таңдау/);
  assert.match(renders[0], /Тексеруге жіберу/);
  assert.match(renders[0], /Не потерять заметку/);
  assert.notEqual(component.t.reportTitle, ru.reportTitle, 'the report form must use the complete Kazakh dictionary');
  component.setLocale('kk-draft');
  assert.equal(renders.length, 1, 'the legacy alias must not replace an already Kazakh form');
  component.setLocale('ru');
  assert.match(renders[1], /Отправить на проверку/);
  for (const [field, value] of Object.entries(preserved)) assert.equal(component[field], value, `language replaced ${field}`);
  assert.equal(draft.photo, photo); assert.equal(draft.idempotencyKey, key);
  assert.equal(await env.drafts.get(draft.storageKey), undefined);
  saving.resolve(); await component.writeChain;
  const saved = await env.drafts.get(draft.storageKey);
  assert.equal(saved.note, draft.note); assert.equal(saved.idempotencyKey, key);
  assert.deepEqual(await saved.photo.arrayBuffer(), await photo.arrayBuffer());
});

test('worker language: switching during send keeps the frozen action and busy guard until its result', async () => {
  const component = ui(), entered = deferred(), release = deferred();
  const frozen = { idempotencyKey: 'same-operation', note: 'Original payload' }, photo = picture();
  const draft = { kind: 'report', note: 'Original payload', photo, idempotencyKey: 'same-operation', frozen };
  Object.assign(component, { locale: 'ru', draft, previewURL: 'blob:photo', writeChain: Promise.resolve() });
  let sends = 0;
  component.workflow = { send: async value => {
    assert.equal(value, draft); sends++; entered.resolve(); await release.promise;
    throw Object.assign(new Error('timeout'), { code: 'WORKER_REQUEST_TIMEOUT' });
  }, pending: async () => [draft] };
  const workflow = component.workflow, version = component.contextVersion;
  const sending = component.action('send'); await entered.promise;
  component.setLocale('kk-draft');
  assert.equal(component.busy, true);
  assert.equal(component.draft, draft); assert.equal(component.draft.frozen, frozen);
  assert.equal(component.draft.photo, photo); assert.equal(component.previewURL, 'blob:photo');
  assert.equal(component.workflow, workflow); assert.equal(component.contextVersion, version);
  await component.action('send');
  assert.equal(sends, 1, 'language update must not unlock a duplicate mutation');
  release.resolve(); await sending;
  assert.equal(component.busy, false); assert.equal(component.draft, draft);
  assert.deepEqual(component.queue, [draft]);
  assert.equal(component.messageText(), dictionary('kk-draft').requestTimeout);
  assert.equal(draft.idempotencyKey, 'same-operation'); assert.equal(draft.frozen, frozen);
});

test('worker language: unconfirmed AI edits survive repaint and still require explicit acceptance', async () => {
  const component = ui();
  Object.assign(component, { locale: 'ru', user: { id: 'f', role: 'foreman' },
    draft: { note: 'Original note', analysis: null },
    suggestion: { category: 'other', facts: ['Original fact'], provenance: { originalText: 'Original note' } } });
  const suggestion = component.suggestion, original = structuredClone(suggestion);
  let fields = { '#ai-category': { value: 'damage' }, '#ai-facts': { value: '' } };
  component.root.querySelector = selector => fields[selector] ?? null;
  component.render = () => { fields = { '#ai-category': { value: 'other' }, '#ai-facts': { value: 'Original fact' } }; };
  let saves = 0;
  component.saveDraft = async () => { saves++; };
  component.setLocale('kk-draft');
  assert.equal(fields['#ai-category'].value, 'damage');
  assert.equal(fields['#ai-facts'].value, '', 'an intentional empty edit must not revert to AI text');
  assert.equal(component.t.myTasks, component.t.crewTasks);
  assert.equal(component.t.workerSpace, component.t.foremanSpace);
  assert.equal(component.draft.analysis, null); assert.equal(saves, 0);
  fields['#ai-facts'].value = 'Edited fact\nSecond fact';
  component.setLocale('ru');
  assert.equal(component.suggestion, suggestion); assert.deepEqual(suggestion, original);
  assert.equal(fields['#ai-facts'].value, 'Edited fact\nSecond fact');
  await component.action('accept-ai');
  assert.equal(component.draft.analysis.category, 'damage');
  assert.deepEqual(component.draft.analysis.facts, ['Edited fact', 'Second fact']);
  assert.equal(component.draft.analysis.decision, 'edited');
  assert.deepEqual(component.draft.analysis.provenance.suggestion, { category: 'other', facts: ['Original fact'] });
  assert.equal(saves, 1);
});

test('worker language: canonical kk and legacy alias configure the same locale and dictionary', async () => {
  const kk = dictionary('kk');
  assert.notEqual(kk.reportTitle, ru.reportTitle);
  assert.deepEqual(dictionary('kk-draft'), kk);
  for (const input of ['kk', 'kk-draft']) {
    const component = ui(), env = setup();
    component.toggleAttribute = () => {};
    await component.configure({ user: { id: 'w', role: 'worker', displayName: 'Worker' }, gateway: env.gateway,
      scope: 'locale-test', date: '2026-10-28', locale: input, drafts: env.drafts });
    assert.equal(component.locale, 'kk', input);
    assert.equal(component.t.reportTitle, kk.reportTitle, input);
    let renders = 0; component.render = () => { renders++; };
    component.setLocale('kk-draft'); component.setLocale('kk');
    assert.equal(renders, 0, 'equivalent locale notifications must not recreate form DOM');
    component.setLocale('ru');
    assert.equal(component.locale, 'ru'); assert.equal(component.t.reportTitle, ru.reportTitle);
  }
});

test('worker display: canonical task codes are translated without changing backend fields or authored values', () => {
  const source = Object.freeze({ ...task(), actionCode: 'inspect', action: 'Осмотреть объект',
    status: 'assigned', statusLabel: 'Назначено', revisionOf: 'previous-task', priority: 'high',
    dueAt: '2026-10-31T09:30:00Z', estimatedMinutes: 30, objectType: 'site',
    requiredWaterLiters: 25, address: 'ул. Тестовая, 7 — Сынақ көшесі', place: 'Авторское название',
    instruction: 'Начать задание', coordinatorComment: 'Вернуть исходную заметку' });
  const before = structuredClone(source), kk = dictionary('kk');
  const translated = taskLabels(source, kk);
  assert.equal(translated.action, 'Нысанды қарап тексеру');
  assert.equal(translated.status, 'Түзету қажет', 'a revision assigned for correction must not look like a new task');
  assert.equal(translated.priority, 'Жоғары');
  assert.equal(translated.object, kk.siteObject);
  assert.match(translated.due, /14:30/); assert.match(translated.duration, /30/); assert.match(translated.norm, /25/);
  assert.equal(translated.address, source.address);
  assert.deepEqual(source, before);
  assert.equal(taskLabels({ ...source, revisionOf: null, status: 'verified' }, kk).status, 'Жұмыс расталды');
  assert.equal(taskLabels({ ...source, revisionOf: null, status: 'in_progress' }, kk).status, 'Орындалуда');
  assert.equal(taskLabels(source, ru).action, source.action);
  assert.equal(displayText('Не хватает ресурсов', kk), 'Ресурстар жеткіліксіз');
  assert.equal(displayText('Незнакомое исходное название', kk), 'Незнакомое исходное название');
});

test('worker display: localized error preserves status/code and dynamic validation limits', () => {
  const kk = dictionary('kk');
  const error = Object.assign(new Error('Opaque backend text'), { code: 'CONTEXT_STALE', status: 409, requestId: 'test-request' });
  assert.equal(localizedError(error, kk), kk.errorConflict);
  assert.equal(localizedError(error, ru), ru.errorConflict);
  assert.equal(error.code, 'CONTEXT_STALE'); assert.equal(error.status, 409);
  assert.equal(error.message, 'Opaque backend text'); assert.equal(error.requestId, 'test-request');
  assert.equal(localizedError(new Error('Фотография больше 5 МБ. Выберите файл меньшего размера.'), kk),
    kk.errorPhotoTooLarge.replace('{mb}', '5'));
  assert.equal(localizedError(new Error('Можно отправить не больше 20 фотографий.'), kk),
    kk.errorPhotoCount.replace('{maximum}', '20'));
});

test('worker display: Kazakh dates retain UTC+5 across year boundary and handle absent timestamps', () => {
  const kk = dictionary('kk');
  assert.equal(formatDateTime('2026-12-31T19:30:00Z', kk), '1 қаңтар, 00:30');
  assert.equal(formatDateTime('2026-10-31T18:45:00Z', kk), '31 қазан, 23:45');
  assert.equal(formatDateTime(null, kk), kk.noData);
  assert.equal(formatDateTime('invalid', kk), kk.noData);
});

test('worker language: issue reason labels change while persisted and submitted canonical reason stays intact', async () => {
  const component = ui(), env = setup(), kk = dictionary('kk');
  Object.assign(component, { locale: 'ru', workflow: env.workflow, gateway: env.gateway, writeChain: Promise.resolve() });
  component.draft = await env.workflow.draft('t', 'issue');
  // Deliberately matches an application label: authored text must never be relocalized.
  Object.assign(component.draft, { reason: 'Не хватает ресурсов', note: 'Начать задание' });
  const draft = component.draft, key = draft.idempotencyKey;
  component.setLocale('kk');
  assert.match(component.form(), /<option value="Не хватает ресурсов" selected>Ресурстар жеткіліксіз<\/option>/);
  assert.match(component.form(), /<textarea[^>]*>Начать задание<\/textarea>/);
  assert.equal(draft.reason, 'Не хватает ресурсов'); assert.equal(draft.note, 'Начать задание');
  await env.workflow.save(draft);
  component.setLocale('ru'); component.setLocale('kk-draft');
  const stored = await env.drafts.get(draft.storageKey);
  assert.equal(stored.reason, draft.reason); assert.equal(stored.note, draft.note); assert.equal(stored.idempotencyKey, key);
  await env.workflow.send(draft);
  assert.equal(env.sent.reason, 'Не хватает ресурсов'); assert.equal(env.sent.note, 'Начать задание');
  assert.equal(env.sent.idempotencyKey, key);
  assert.ok(!JSON.stringify(env.sent).includes(kk.reasonNames['Не хватает ресурсов']));
});

test('worker language: already visible timeout and cancellation are translated without a new request', () => {
  for (const [code, key] of [['WORKER_REQUEST_TIMEOUT', 'requestTimeout'], ['WORKER_REQUEST_ABORTED', 'requestCancelled']]) {
    const component = ui(); component.locale = 'ru';
    component.gateway = new Proxy({}, { get: () => assert.fail('a locale change must not retry requests') });
    component.showError(Object.assign(new Error('Untranslated transport internals'), { code }));
    assert.equal(component.messageText(), ru[key]);
    component.setLocale('kk');
    assert.equal(component.messageText(), dictionary('kk')[key]);
    assert.equal(component.message.tone, 'error');
    component.setLocale('ru');
    assert.equal(component.messageText(), ru[key]);
  }
});

test('worker language: already visible refresh notice changes language but refresh runs only once', async () => {
  const component = ui(); component.locale = 'ru'; component.date = '2026-10-28'; component.section = 'current';
  component.selected = null; delete component.refresh;
  let requests = 0;
  component.gateway = { listTasks: async () => { requests++; return []; } };
  await component.refresh();
  assert.equal(component.messageText(), ru.stale);
  component.setLocale('kk');
  assert.equal(component.messageText(), dictionary('kk').stale);
  component.setLocale('ru');
  assert.equal(component.messageText(), ru.stale);
  assert.equal(requests, 1);
});

test('worker language: opaque errors use a localized fallback while preserving the original error', () => {
  const component = ui(); component.locale = 'ru';
  const error = new Error('Unrecognized provider diagnostic');
  component.showError(error);
  assert.equal(component.messageText(), ru.errorGeneric);
  component.setLocale('kk');
  assert.equal(component.messageText(), dictionary('kk').errorGeneric);
  assert.equal(component.message.error, error);
  assert.equal(error.message, 'Unrecognized provider diagnostic');
  component.setLocale('ru');
  assert.equal(component.messageText(), ru.errorGeneric);
});

test('worker language: arbitrary notification content is preserved instead of being translated as a label', () => {
  const component = ui(); component.locale = 'ru';
  const text = 'Учебный участок № 7 — түпнұсқа хабарлама';
  component.notify(text, 'info'); component.setLocale('kk');
  assert.equal(component.messageText(), text);
  component.setLocale('ru');
  assert.equal(component.messageText(), text);
});

test('worker language: a real validation error is relocalized without freezing or resubmitting the draft', async () => {
  const component = ui(), env = setup(); env.t.reportMode = 'contribution';
  Object.assign(component, { locale: 'ru', workflow: env.workflow, gateway: env.gateway, writeChain: Promise.resolve() });
  component.draft = await env.workflow.draft('t'); component.draft.note = 'Фото пока не выбрано';
  const draft = component.draft, key = draft.idempotencyKey;
  let reads = 0; env.gateway.getTask = async () => { reads++; return env.t; };
  await component.action('send');
  const source = 'Добавьте фотографию результата.';
  assert.equal(component.messageText(), source);
  component.setLocale('kk');
  assert.equal(component.messageText(), dictionary('kk').errorMessages[source]);
  assert.notEqual(component.messageText(), source);
  assert.equal(component.draft, draft); assert.equal(draft.frozen, null); assert.equal(draft.idempotencyKey, key);
  assert.equal(reads, 1); assert.equal(env.sent, undefined);
  component.setLocale('ru'); assert.equal(component.messageText(), source);
});

test('worker language: an already visible synchronization result retains counts and translates its error', async () => {
  const component = ui(); component.locale = 'ru';
  let synchronizations = 0;
  component.workflow = { synchronize: async () => {
    synchronizations++;
    return [{ taskId: 'saved', saved: true }, { taskId: 'uncertain', saved: false,
      errorCode: 'WORKER_REQUEST_TIMEOUT', error: 'Timeout internals' }];
  } };
  await component.action('sync');
  assert.ok(component.messageText().includes(`${ru.syncSuccess}: 1`));
  assert.ok(component.messageText().includes(`${ru.syncFailure}: 1`));
  assert.ok(component.messageText().includes(ru.requestTimeout));
  component.setLocale('kk');
  const kk = dictionary('kk'), message = component.messageText();
  assert.ok(message.includes(`${kk.syncSuccess}: 1`));
  assert.ok(message.includes(`${kk.syncFailure}: 1`));
  assert.ok(message.includes(kk.requestTimeout));
  assert.equal(component.message.tone, 'error');
  component.setLocale('ru');
  assert.ok(component.messageText().includes(ru.requestTimeout));
  assert.equal(synchronizations, 1, 'changing language is not synchronization');
});

test('worker language: existing history date follows the selected locale and retains authored content', () => {
  const component = ui(); component.locale = 'ru';
  const time = '2026-01-15T09:30:00Z';
  const history = [{ type: 'report', time, note: 'Исходная заметка / бастапқы жазба', reviewLabel: 'Review fixture' }];
  assert.match(component.historyCards(history, component.selected), /янв/u);
  component.setLocale('kk');
  const html = component.historyCards(history, component.selected);
  assert.match(html, /қаң/u); assert.doesNotMatch(html, /янв|M0?1/);
  assert.match(html, /14:30/, 'formatting must keep the UTC+5 time in either language');
  assert.ok(html.includes(history[0].note));
  assert.equal(history[0].time, time);
  component.setLocale('ru');
  assert.match(component.historyCards(history, component.selected), /янв/u);
});

test('worker language: upload then uncertain submit then manual retry retains photo, payload and operation identity', async () => {
  const { component } = navigationUi(), env = setup();
  env.t.reportMode = 'contribution';
  component.locale = 'ru'; component.workflow = env.workflow; component.gateway = env.gateway;
  component.selected = env.t; component.draft = await env.workflow.draft(env.t.id);
  Object.assign(component.draft, { note: 'Материалы участника — өзгеріссіз', photo: picture() });
  component.writeChain = Promise.resolve();
  const draft = component.draft, photo = draft.photo, key = draft.idempotencyKey;
  const selected = component.selected, page = component.page, version = component.contextVersion;
  const uploadEntered = deferred(), uploadRelease = deferred(), retryEntered = deferred(), retryRelease = deferred();
  const uploads = [], submissions = [];
  env.gateway.uploadPhoto = async payload => {
    uploads.push(payload); uploadEntered.resolve(); await uploadRelease.promise; return { id: 'uploaded-once' };
  };
  env.gateway.submitReport = async payload => {
    submissions.push(structuredClone(payload));
    if (submissions.length === 1) throw Object.assign(new Error('uncertain transport timeout'), { code: 'WORKER_REQUEST_TIMEOUT' });
    retryEntered.resolve(); await retryRelease.promise;
    return { id: 'saved-report', saved: true, submissionType: 'contribution' };
  };

  const first = component.action('send'); await uploadEntered.promise;
  const frozen = draft.frozen;
  assert.ok(frozen); assert.equal(component.busy, true);
  component.setLocale('kk');
  assert.equal(component.draft, draft); assert.equal(draft.photo, photo); assert.equal(draft.frozen, frozen);
  assert.equal(draft.idempotencyKey, key); assert.equal(component.page, page);
  assert.equal(component.selected, selected); assert.equal(component.contextVersion, version);
  await component.action('send');
  assert.equal(uploads.length, 1); assert.equal(submissions.length, 0);
  uploadRelease.resolve(); await first;
  assert.equal(component.busy, false); assert.equal(draft.delivery, 'uncertain');
  assert.equal(component.messageText(), dictionary('kk').requestTimeout);
  assert.equal(draft.upload.id, 'uploaded-once'); assert.equal(component.draft, draft);
  component.setLocale('ru');
  assert.equal(component.messageText(), ru.requestTimeout);
  assert.equal(submissions.length, 1, 'language change must not automatically retry a possibly saved report');
  const saved = await env.drafts.get(draft.storageKey);
  assert.equal(saved.idempotencyKey, key); assert.deepEqual(saved.frozen, frozen);
  assert.deepEqual(await saved.photo.arrayBuffer(), await photo.arrayBuffer());

  const retry = component.action('send'); await retryEntered.promise;
  component.setLocale('kk');
  assert.equal(component.busy, true); assert.equal(draft.frozen, frozen); assert.equal(draft.idempotencyKey, key);
  await component.action('send');
  assert.equal(submissions.length, 2); assert.equal(uploads.length, 1);
  retryRelease.resolve(); await retry;
  assert.deepEqual(submissions[0], submissions[1], 'manual retry must use the original frozen operation');
  assert.equal(uploads[0].idempotencyKey, `${key}:photo`);
  assert.equal(component.messageText(), dictionary('kk').materialsSaved);
  assert.equal(component.busy, false); assert.equal(component.draft, null);
  assert.equal(await env.drafts.get(draft.storageKey), undefined);
  component.setLocale('ru');
  assert.equal(component.messageText(), ru.materialsSaved, 'already visible success must also follow locale');
});

test('real API UI: assignment retries preserve body/key and switching task creates a separate action', async () => {
  const component = ui(), calls = [];
  component.gateway = { assignWorkers: async (id, body) => { calls.push({ id, body: structuredClone(body) }); throw new Error('network'); } };
  await component.action('assign-workers');
  await component.action('assign-workers');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  component.selected = { ...component.selected, id: 'other', version: 10, assignedWorkerIds: ['other-worker'] };
  await component.action('assign-workers');
  assert.equal(calls[2].id, 'other');
  assert.deepEqual(calls[2].body.workerIds, ['other-worker']);
  assert.equal(calls[2].body.expectedVersion, 10);
  assert.notEqual(calls[2].body.idempotencyKey, calls[0].body.idempotencyKey);
});

test('real API UI: refresh closes the previous task form and preserves its persisted draft', async () => {
  const component = ui(), env = setup();
  delete component.refresh;
  component.workflow = env.workflow;
  component.date = '2026-10-29'; component.section = 'current';
  const draft = await finalDraft(env);
  await env.workflow.save(draft);
  component.draft = draft;
  let cleared = false;
  component.setPreview = () => { cleared = true; };
  component.gateway = { listTasks: async () => [{ id: 'new', visibleToCurrentUser: true, section: 'current' }] };
  await component.refresh(false);
  assert.equal(component.selected.id, 'new');
  assert.equal(component.draft, null);
  assert.equal(cleared, true);
  assert.deepEqual(await env.drafts.get(draft.storageKey), draft);
});

test('real API UI: date change completes without an error toast when event target clears during refresh', async () => {
  const component = ui(), errors = [], refreshes = [], previews = [];
  component.date = '2026-10-29';
  component.draft = { taskId: 't' };
  component.mobileDetail = true;
  component.setPreview = value => previews.push(value);
  component.showError = error => errors.push(error);
  let releaseRefresh;
  const refreshed = new Promise(resolve => { releaseRefresh = resolve; });
  component.refresh = async showNotice => {
    refreshes.push({ date: component.date, showNotice, selected: component.selected, draft: component.draft });
    await refreshed;
  };
  const event = { target: { dataset: { field: 'date' }, value: '2026-10-28', type: 'date' } };
  const changingDate = component.onChange(event);
  // A dispatched/retargeted event need not retain its target after the async handler yields.
  event.target = null;
  releaseRefresh();
  await assert.doesNotReject(changingDate);
  assert.deepEqual(errors, [], 'the handler must not fall through into file handling after the date refresh');
  assert.deepEqual(refreshes, [{ date: '2026-10-28', showNotice: false, selected: null, draft: null }]);
  assert.deepEqual(previews, [null]);
  assert.equal(component.date, '2026-10-28');
  assert.equal(component.mobileDetail, false);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function withBitmapDecoder(decoder, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  globalThis.createImageBitmap = decoder;
  try { await run(); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'createImageBitmap', descriptor);
    else delete globalThis.createImageBitmap;
  }
}

test('worker language: photo decoding survives locale repaint and saves the selected file to the same draft', async () => {
  const component = ui(), env = setup(), entered = deferred(), release = deferred();
  const oldPhoto = picture(), newPhoto = new File([await picture().arrayBuffer()], 'selected-once.png', { type: 'image/png' });
  Object.assign(component, { locale: 'ru', workflow: env.workflow, writeChain: Promise.resolve() });
  component.draft = await env.workflow.draft('t');
  Object.assign(component.draft, { note: 'Сохранить исходный текст', photo: oldPhoto });
  const draft = component.draft, key = draft.idempotencyKey, version = component.contextVersion;
  let closes = 0;
  await withBitmapDecoder(async () => { entered.resolve(); await release.promise; return { close() { closes++; } }; }, async () => {
    const selecting = component.onChange({ target: { type: 'file', files: [newPhoto] } });
    await entered.promise;
    component.setLocale('kk'); component.setLocale('ru'); component.setLocale('kk-draft');
    assert.equal(component.draft, draft); assert.equal(draft.photo, oldPhoto);
    assert.equal(draft.idempotencyKey, key); assert.equal(component.contextVersion, version);
    release.resolve(); await selecting;
    assert.equal(draft.photo, newPhoto); assert.equal(draft.note, 'Сохранить исходный текст');
    assert.equal(draft.idempotencyKey, key); assert.equal(closes, 1);
    const saved = await env.drafts.get(draft.storageKey);
    assert.equal(saved.photo.name, 'selected-once.png');
    assert.deepEqual(await saved.photo.arrayBuffer(), await newPhoto.arrayBuffer());
    assert.equal(saved.idempotencyKey, key);
    assert.equal(component.saveState, 'saved');
  });
  component.setPreview(null);
});

test('real API UI: delayed photo decode preserves photo/upload after the draft becomes frozen or busy', async () => {
  for (const blockedBy of ['frozen', 'busy']) {
    const component = ui(), oldPhoto = picture(), upload = { id: 'saved-photo' };
    component.draft = { storageKey: 'draft', photo: oldPhoto, upload, frozen: null, idempotencyKey: 'same-action' };
    const entered = deferred(), release = deferred(), previews = [], errors = [];
    let saves = 0, closed = 0;
    component.setPreview = value => previews.push(value);
    component.saveDraft = async () => { saves++; };
    component.showError = error => errors.push(error);
    await withBitmapDecoder(async () => {
      entered.resolve(); await release.promise;
      return { close() { closed++; } };
    }, async () => {
      const changingPhoto = component.onChange({ target: { dataset: {}, type: 'file', files: [picture()] } });
      await entered.promise;
      if (blockedBy === 'frozen') component.draft.frozen = { idempotencyKey: 'same-action' };
      else component.busy = true;
      release.resolve();
      await changingPhoto;
      assert.equal(component.draft.photo, oldPhoto, blockedBy);
      assert.equal(component.draft.upload, upload, blockedBy);
      assert.equal(component.draft.idempotencyKey, 'same-action');
      assert.deepEqual(previews, []);
      assert.deepEqual(errors, []);
      assert.equal(saves, 0);
      assert.equal(closed, 1, 'decoded bitmap must be released even when its result is discarded');
    });
  }
});

test('real API UI: newer photo selection wins when an older decode finishes last', async () => {
  const component = ui(), oldPhoto = picture(), firstPhoto = picture(), newestPhoto = picture();
  component.draft = { storageKey: 'draft', photo: oldPhoto, upload: { id: 'previous-upload' }, frozen: null };
  const firstEntered = deferred(), latestEntered = deferred(), releaseFirst = deferred(), releaseLatest = deferred();
  const previews = [], savedPhotos = [], errors = [], closed = [];
  component.setPreview = value => { component.photoSelectionVersion++; previews.push(value); };
  component.saveDraft = async () => { savedPhotos.push(component.draft.photo); };
  component.showError = error => errors.push(error);
  await withBitmapDecoder(async file => {
    if (file === firstPhoto) { firstEntered.resolve(); await releaseFirst.promise; }
    else { assert.equal(file, newestPhoto); latestEntered.resolve(); await releaseLatest.promise; }
    return { close() { closed.push(file); } };
  }, async () => {
    const firstChange = component.onChange({ target: { dataset: {}, type: 'file', files: [firstPhoto] } });
    await firstEntered.promise;
    const latestChange = component.onChange({ target: { dataset: {}, type: 'file', files: [newestPhoto] } });
    await latestEntered.promise;
    releaseLatest.resolve();
    await latestChange;
    assert.equal(component.draft.photo, newestPhoto);
    assert.equal(component.draft.upload, null);
    releaseFirst.resolve();
    await firstChange;
    assert.equal(component.draft.photo, newestPhoto, 'late completion must not replace the newer selection');
    assert.equal(component.draft.upload, null);
    assert.deepEqual(previews, [newestPhoto]);
    assert.deepEqual(savedPhotos, [newestPhoto]);
    assert.deepEqual(errors, []);
    assert.deepEqual(closed, [newestPhoto, firstPhoto]);
  });
});
