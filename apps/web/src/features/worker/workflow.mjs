import { approvedDesign, parsePositions, positionsText, geometryPoints } from './field-values.mjs';
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const SERVER_MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const REASONS = ['Нет доступа', 'Не хватает ресурсов', 'Объект не найден', 'Нужна проверка', 'Другая причина'];
export const storageKey = (scope, userId, taskId, kind) => JSON.stringify([scope, userId, taskId, kind]);
export async function validatePhoto(file, maxBytes = MAX_PHOTO_BYTES) {
  if (!file || !file.size) throw new Error('Выберите непустую фотографию.');
  if (file.size > maxBytes) throw new Error(`Фотография больше ${maxBytes / 1024 / 1024} МБ. Выберите файл меньшего размера.`);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Поддерживаются JPG, PNG и WebP. HEIC нужно преобразовать на устройстве.');
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = b[0] === 255 && b[1] === 216 && b[2] === 255;
  const png = [137,80,78,71,13,10,26,10].every((v,i) => b[i] === v);
  const webp = String.fromCharCode(...b.slice(0,4)) === 'RIFF' && String.fromCharCode(...b.slice(8,12)) === 'WEBP';
  if (!(file.type === 'image/jpeg' && jpeg || file.type === 'image/png' && png || file.type === 'image/webp' && webp)) throw new Error('Содержимое файла не соответствует фотографии. Выберите другой файл.');
}
export class WorkerWorkflow {
  constructor({ gateway, drafts, userId, scope, timeoutMs = 6000, strictServer = false }) {
    Object.assign(this, { gateway, drafts, userId, scope, timeoutMs, strictServer });
    this.inflight = new Map();
  }
  async draft(taskId, kind = 'report') {
    const key = storageKey(this.scope, this.userId, taskId, kind);
    const saved = await this.drafts.get(key);
    if (saved) return saved;
    return { storageKey: key, scope: this.scope, userId: this.userId, taskId, kind,
      idempotencyKey: crypto.randomUUID(), note: '', photo: null, reason: REASONS[0], analysis: null,
      geo: null, frozen: null, upload: null, actualPlantingItems:[], actualWorkerIds:[], foremanChecked:false, delivery: 'draft', updatedAt: new Date().toISOString() };
  }
  async save(draft) {
    if (draft.scope !== this.scope || draft.userId !== this.userId) throw new Error('Черновик принадлежит другой сессии.');
    draft.updatedAt = new Date().toISOString();
    await this.drafts.put(draft);
    return draft;
  }
  pending() { return this.drafts.list(this.scope, this.userId); }
  async rebase(draft) {
    if(!['conflict','rejected'].includes(draft.delivery))throw new Error('Неоднозначную отправку нужно повторить с тем же ключом.');
    const task=await this.gateway.getTask(draft.taskId);
    if(draft.kind==='report'&&!task.permissions.report)throw new Error('Сначала начните исправление или проверьте состояние задания.');
    draft.baseVersion=task.version;draft.sharedBaseVersion=task.sharedDraft?.version;draft.frozen=null;draft.delivery='draft';draft.idempotencyKey=crypto.randomUUID();await this.save(draft);
  }
  async analyze(text, context = {}) {
    if (!text.trim()) throw new Error('Сначала напишите заметку.');
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        this.gateway.analyzeNote({ text, ...context, signal: controller.signal }),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('AI не ответил вовремя. Заметку можно отправить без разбора.')); }, this.timeoutMs); })
      ]);
    } finally { clearTimeout(timer); }
  }
  send(draft) {
    if (this.inflight.has(draft.storageKey)) return this.inflight.get(draft.storageKey);
    const promise = this.performSend(draft).finally(() => this.inflight.delete(draft.storageKey));
    this.inflight.set(draft.storageKey, promise);
    return promise;
  }
  async performSend(draft) {
    if (draft.userId !== this.userId || draft.scope !== this.scope) throw new Error('Черновик принадлежит другой сессии.');
    if (draft.note.length > 4000) throw new Error('Заметка может содержать не больше 4000 символов.');
    if (!draft.frozen) {
      const task = await this.gateway.getTask(draft.taskId);
      if(draft.baseVersion != null && draft.baseVersion!==task.version || draft.sharedBaseVersion != null && draft.sharedBaseVersion!==task.sharedDraft?.version){
        draft.delivery='conflict';await this.save(draft);const error=new Error('Данные изменились. Обновите версию перед исправлением.');error.status=409;throw error;
      }
      if (!task.visibleToCurrentUser && task.assignedTo !== this.userId) throw new Error('Нет доступа к заданию.');
      if (draft.kind === 'report' && !task.permissions.report) throw new Error('Сначала начните задание или обновите его состояние.');
      if (draft.kind === 'issue' && !task.permissions.issue) throw new Error('Для этого задания нельзя отправить проблему.');
      if (draft.kind === 'report' && task.reportMode !== 'final' && !draft.photo) throw new Error('Добавьте фотографию результата.');
      const sharedPhotoIds = [...new Set((task.sharedDraft?.contributions || []).flatMap(c=>c.photoIds))];
      if (draft.kind === 'report' && task.reportMode === 'final' && sharedPhotoIds.length>20) throw new Error('В итоговом отчёте не может быть больше 20 фотографий. Уточните состав материалов бригады.');
      if (draft.kind === 'report' && task.reportMode === 'final' && (!draft.foremanChecked || !sharedPhotoIds.length)) throw new Error('Проверьте материалы участников и подтвердите полноту отчёта.');
      const actualWorkerIds = [...new Set(draft.actualWorkerIds?.length ? draft.actualWorkerIds : task.reportMode === 'contribution' ? [this.userId] : task.reportMode === 'final' ? [] : task.assignedWorkerIds?.length ? task.assignedWorkerIds : [this.userId])];
      if(draft.kind==='report'&&task.reportMode!=='contribution'&&(actualWorkerIds.length<Math.max(1,task.minWorkers||1)||actualWorkerIds.some(id=>!task.assignedWorkerIds?.includes(id))))throw new Error('Отметьте фактических исполнителей из назначенного состава: не меньше минимума задания.');
      const plantingReport = draft.kind === 'report' && task.reportMode !== 'contribution' && task.actionCode === 'plant';
      if (plantingReport && !approvedDesign(task)) throw new Error('Утверждённая версия проекта недоступна. Обновите задание.');
      if (plantingReport && task.design.plantingItems.some(item=>!draft.actualPlantingItems.some(actual=>actual.plantingItemId===item.id && Number.isInteger(actual.quantity) && actual.quantity>=0 && actual.quantity<=200))) throw new Error('Укажите фактическое количество для каждой позиции: целое число от 0 до 200. Ноль означает, что посадка не выполнена.');
      let actualPlantingItems = plantingReport ? structuredClone(draft.actualPlantingItems.filter(item=>item.quantity>0)) : [];
      if (this.strictServer && draft.kind === 'report' && !draft.note.trim()) throw new Error('Кратко опишите выполненную работу или добавленные материалы.');
      if (this.strictServer && plantingReport) {
        actualPlantingItems = actualPlantingItems.map(item=>({...item,geometry:parsePositions(draft.actualPositions?.[item.plantingItemId] ?? positionsText(item.geometry),item.quantity)}));
        const points=actualPlantingItems.flatMap(item=>geometryPoints(item.geometry)).map(point=>JSON.stringify(point));
        if(new Set(points).size!==points.length)throw new Error('Фактические точки разных позиций не должны повторяться.');
      }
      if (draft.kind === 'issue' && !REASONS.includes(draft.reason)) throw new Error('Выберите причину.');
      if (draft.kind === 'issue' && draft.reason === 'Другая причина' && !draft.note.trim()) throw new Error('Кратко поясните причину.');
      if (draft.kind === 'issue' && [draft.reason,draft.note].map(value=>value.trim()).filter(Boolean).join('\n').length>4000) throw new Error('Причина и пояснение вместе не должны превышать 4000 символов.');
      if (draft.photo && !(this.strictServer && draft.kind === 'issue')) await validatePhoto(draft.photo, this.strictServer ? SERVER_MAX_PHOTO_BYTES : MAX_PHOTO_BYTES);
      draft.frozen = { taskId: draft.taskId, idempotencyKey: draft.idempotencyKey, note: draft.note.trim(),
        analysis: draft.analysis?.decision ? structuredClone(draft.analysis) : null,
        geo: draft.geo, deviceTime: new Date().toISOString(), revisionOf: task.revisionOf || null,
        objectId:task.objectId, expectedVersion:task.version, expectedDraftVersion:task.sharedDraft?.version,
        submissionType:task.reportMode, actualPlantingItems,
        actualWorkerIds,
        sharedPhotoIds, contributorIds:task.sharedDraft?.contributions.map(c=>c.authorId)||[],
        ...(draft.kind === 'issue' ? { reason: draft.reason } : {}) };
      draft.delivery = 'queued';
      await this.save(draft);
    }
    try {
      if (draft.photo && !draft.upload && !(this.strictServer && draft.kind === 'issue')) {
        draft.upload = await this.gateway.uploadPhoto({ file: draft.photo, idempotencyKey: `${draft.idempotencyKey}:photo`, taskId: draft.taskId });
        await this.save(draft);
      }
      const payload = { ...draft.frozen, photoId: draft.upload?.id || null };
      const receipt = draft.kind === 'issue' ? await this.gateway.submitIssue(payload) : await this.gateway.submitReport(payload);
      // A positive receipt is mandatory; HTTP success alone must not mean acceptance.
      if (!receipt?.id || !receipt?.saved) throw new Error('Нет подтверждения сохранения. Повторите отправку с тем же ключом.');
      await this.drafts.remove(draft.storageKey);
      return receipt;
    } catch (error) {
      draft.delivery = error.status===409 ? 'conflict' : [400,413,415,422].includes(error.status) ? 'rejected' : 'uncertain';
      try { await this.save(draft); } catch { /* Original draft was persisted before any upload. */ }
      throw error;
    }
  }
  async synchronize() {
    const outcomes = [];
    for (const draft of await this.pending()) {
      if (!draft.frozen || ['conflict','rejected'].includes(draft.delivery)) continue; // Never silently send unfinished or explicitly rejected drafts.
      try { outcomes.push({ taskId: draft.taskId, saved: true, receipt: await this.send(draft) }); }
      catch (error) { outcomes.push({ taskId: draft.taskId, saved: false, error: error.message, errorCode: error.code }); }
    }
    return outcomes;
  }
}
