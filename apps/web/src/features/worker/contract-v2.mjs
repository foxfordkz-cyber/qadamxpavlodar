import { requestJSON } from './gateway.mjs';
export const TASK_STATUSES = ['draft','assigned','in_progress','submitted','verified'];
export const OBSERVATION_CATEGORIES = {access_problem:'Проблема доступа',visible_damage:'Видимое повреждение',care_completed:'Сообщение о выполнении ухода',needs_inspection:'Нужна проверка',other:'Другое наблюдение'};
const labels = {draft:'Черновик',assigned:'Назначено',in_progress:'В работе',submitted:'Ожидает проверки',verified:'Работа подтверждена'};
const actions = {inspect:'Осмотреть объект',water:'Выполнить полив',weed:'Удалить сорную растительность',plant:'Выполнить посадку по проекту'};
const priorities = {low:'Низкий',medium:'Обычный',high:'Высокий',critical:'Критический'};
export const ROLE_LABELS = {worker:'Работник',foreman:'Бригадир',coordinator:'Координатор',admin:'Руководитель'};
export const shiftDate = iso => iso ? new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso)) : null;
export const clockTime = iso => iso ? new Intl.DateTimeFormat('ru',{timeZone:'Asia/Qyzylorda',hour:'2-digit',minute:'2-digit'}).format(new Date(iso)) : 'Не указано';
export function createV2Transport({base='/api/v1',headersFor=()=>({})}={}) {
  return async (method,path,{body,headers={},signal}={}) => {
    try { return await requestJSON(base+path,{method,body,headers:{...headersFor(),...headers},signal}); }
    catch(error) { throw error; }
  };
}
export function createContractGateway({request,user}) {
  const data = async (method,path,options) => { const response = await request(method,path,options); if (!response || !Object.hasOwn(response,'data')) throw new Error('Ответ не соответствует контракту V2: отсутствует data.'); return response.data; };
  const get = path => data('GET',path);
  const post = (path,body,key,signal) => data('POST',path,{body,headers:key?{'Idempotency-Key':key}:{},signal});
  const myCrews = async () => (await get('/crews')).filter(c=>c.foremanId===user.id && c.active);
  async function rawTask(id) { const task=await get(`/tasks/${encodeURIComponent(id)}`); if (!TASK_STATUSES.includes(task.status)) throw new Error('Неизвестный TaskStatus из API.'); return task; }
  async function hydrate(task) {
    const ownCrew = user.role==='foreman' && (await myCrews()).some(c=>c.id===task.assignedCrewId);
    const assigned = task.assignedWorkerIds.includes(user.id);
    const canAccess = user.role==='worker' ? assigned : user.role==='foreman' ? ownCrew : false;
    if (!canAccess) throw new Error('Нет доступа к заданию.');
    const object = await get(`/${task.objectType==='plant'?'plants':'sites'}/${encodeURIComponent(task.objectId)}`);
    const reports = await get(`/reports?taskId=${encodeURIComponent(task.id)}`);
    const latest = reports.find(r=>r.id===task.latestReportId);
    const sharedDraft = task.minWorkers>1 ? await get(`/tasks/${task.id}/report-draft`) : null;
    let design=null,context=null,catalog=[];
    if (task.approvedDesignId) { design=await get(`/designs/${task.approvedDesignId}`); context=await get(`/sites/${task.objectId}/context`); catalog=await get('/plant-catalog'); }
    const designCurrent = !design || design.status==='approved' && design.revision===task.approvedDesignVersion;
    const coordinates = task.objectType==='plant' ? {latitude:object.lat,longitude:object.lng} : object.geometry?.type==='Polygon' ? {latitude:object.geometry.coordinates[0][0][1],longitude:object.geometry.coordinates[0][0][0]} : null;
    const history=reports.map(r=>({id:r.id,type:'report',note:r.note,time:r.createdAt,reviewLabel:{pending:'Ожидает проверки',accepted:'Принят координатором',changes_requested:'Возвращён на исправление'}[r.reviewStatus],coordinatorComment:r.reviewComment,
      photoName:r.photoIds.length?`${r.photoIds.length} файл(а)` : null,photoUrl:r.photoUrl,analysis:r.confirmedObservation?{category:OBSERVATION_CATEGORIES[r.confirmedObservation.category],facts:r.confirmedObservation.extractedFacts,provenance:r.confirmedObservation.provenance,decision:r.confirmedObservation.provenance?.decision}:null,
      actualPlantingItems:r.actualPlantingItems,actualWorkerIds:r.actualWorkerIds,revisionOf:r.revisionOf,
      geo:r.location?{latitude:r.location.lat,longitude:r.location.lng,accuracy:r.location.accuracyM}:null}));
    return {...task, visibleToCurrentUser:true, assignedTo:assigned?user.id:null, date:shiftDate(task.scheduledStart || task.dueAt),place:object.name,address:object.isDemo?'Павлодар · учебная точка':'Павлодар',action:actions[task.action],actionCode:task.action,objectLabel:task.objectType==='plant'?'Объект озеленения':'Участок озеленения',instruction:task.description,
      norm:task.requiredWaterLiters===null?null:`${task.requiredWaterLiters} л на задачу`,normSource:task.isDemo?'Синтетическая норма учебного сценария. Не использовать для реального ухода.':'Норма из утверждённого плана, см. evidenceIds.',duration:`${task.estimatedMinutes} минут`,coordinates,
      due:task.dueAt?`До ${clockTime(task.dueAt)} · UTC+5`:'Срок не указан',priority:priorities[task.priority],priorityTone:['high','critical'].includes(task.priority)?'high':'normal',statusLabel:latest?.reviewStatus==='changes_requested'&&task.status==='assigned'?'Нужно исправить':labels[task.status],
      section:task.status==='verified'?'confirmed':task.status==='submitted'?'submitted':'current',
      permissions:{start:task.status==='assigned'&&(assigned||ownCrew)&&task.assignedWorkerIds.length>=task.minWorkers&&designCurrent,report:task.status==='in_progress'&&(task.minWorkers>1?(assigned||ownCrew):assigned)&&designCurrent,issue:['assigned','in_progress'].includes(task.status)},
      reportMode:task.minWorkers>1?(user.role==='foreman'?'final':'contribution'):'single',sharedDraft,design,designCurrent,context,catalog,
      coordinatorComment:latest?.reviewStatus==='changes_requested'?latest.reviewComment:null,revisionOf:latest?.reviewStatus==='changes_requested'?latest.id:null,history};
  }
  function observation(payload) {
    return payload.analysis ? {objectId:payload.objectId,category:payload.analysis.category,extractedFacts:payload.analysis.facts,evidenceIds:payload.analysis.provenance.evidenceIds||[],missingData:payload.analysis.provenance.missingData||[],needsHumanReview:true,
      provenance:{...payload.analysis.provenance,decision:payload.analysis.decision,confirmedBy:payload.analysis.confirmedBy,confirmedAt:payload.analysis.confirmedAt}} : null;
  }
  const gateway = {
    async listTasks({date}={}) { const tasks=await get(`/tasks${date?`?date=${encodeURIComponent(date)}`:''}`); return Promise.all(tasks.filter(t=>user.role==='foreman'||t.assignedWorkerIds.includes(user.id)).map(hydrate)); },
    async getTask(id) { return hydrate(await rawTask(id)); },
    async startTask(id) { const task=await rawTask(id); await post(`/tasks/${id}/start`,{expectedVersion:task.version},crypto.randomUUID()); return gateway.getTask(id); },
    async uploadPhoto({file,idempotencyKey,taskId}) { const form=new FormData(); form.append('file',file,file.name||'photo.jpg'); form.append('taskId',taskId); return post('/uploads',form,idempotencyKey); },
    async submitReport(payload) {
      const body={expectedVersion:payload.expectedVersion,photoIds:payload.photoId?[payload.photoId]:[],note:payload.note,location:payload.geo?{lat:payload.geo.latitude,lng:payload.geo.longitude,accuracyM:payload.geo.accuracy,capturedAt:payload.geo.deviceTime}:null,
        confirmedObservation:observation(payload),actualPlantingItems:payload.actualPlantingItems||[],actualWorkerIds:payload.actualWorkerIds||[],revisionOf:payload.revisionOf,deviceTime:payload.deviceTime};
      if(payload.submissionType==='contribution') {
        const result=await post(`/tasks/${payload.taskId}/report-draft/contributions`,{...body,expectedVersion:payload.expectedDraftVersion},payload.idempotencyKey);
        return {id:result.id,saved:true,reviewLabel:'Материалы добавлены',submissionType:'contribution'};
      }
      if(payload.submissionType==='final') {
        body.expectedDraftVersion=payload.expectedDraftVersion; body.foremanChecked=true;
        body.photoIds=payload.sharedPhotoIds||[]; body.contributorIds=payload.contributorIds||[];
      }
      const result=await post(`/tasks/${payload.taskId}/reports`,body,payload.idempotencyKey);
      return {id:result.id,saved:true,reviewLabel:{pending:'Ожидает проверки',accepted:'Принят координатором',changes_requested:'Возвращён на исправление'}[result.reviewStatus]};
    },
    async submitIssue(payload) { const result=await post(`/tasks/${payload.taskId}/issues`,{expectedVersion:payload.expectedVersion,reason:payload.reason,note:payload.note,photoIds:payload.photoId?[payload.photoId]:[],confirmedObservation:observation(payload)},payload.idempotencyKey); return {id:result.id,saved:true,reviewLabel:'Проблема передана координатору'}; },
    async analyzeNote({text,objectId,taskId,signal}) { const draft=await post('/observations/interpret',{text,objectId,taskId},null,signal); if(!Object.hasOwn(OBSERVATION_CATEGORIES,draft.category)||!Array.isArray(draft.extractedFacts))throw new Error('Неверный формат ObservationDraft. Можно отправить исходную заметку.'); return {category:draft.category,facts:draft.extractedFacts,provenance:{provider:draft.method||'model',originalText:text,generatedAt:new Date().toISOString(),evidenceIds:draft.evidenceIds,missingData:draft.missingData,objectId:draft.objectId}}; },
    async getCrewWorkspace() { return {crews:await myCrews(),workers:await get('/workers'),resources:await get('/resources')}; },
    async assignWorkers(id,{workerIds,responsibleUserId,scheduledStart,scheduledEnd,expectedVersion,idempotencyKey}) { await post(`/tasks/${id}/assign-workers`,{workerIds,responsibleUserId,scheduledStart,scheduledEnd,expectedVersion},idempotencyKey); return gateway.getTask(id); }
  };
  return gateway;
}
