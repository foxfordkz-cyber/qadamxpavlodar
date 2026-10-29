// Shipped regressions adapted from the UI owner's coordination/worker-ui.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerWorkflow, validatePhoto, SERVER_MAX_PHOTO_BYTES } from '../../../apps/web/src/features/worker/workflow.mjs';
import { MemoryDrafts } from '../../../apps/web/src/features/worker/drafts.mjs';
import { safePhotoURL, parsePositions } from '../../../apps/web/src/features/worker/field-values.mjs';
import { scheme, reportQuantities, assignmentPanel } from '../../../apps/web/src/features/worker/v2-views.mjs';
import { ru } from '../../../apps/web/src/features/worker/strings.mjs';

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
