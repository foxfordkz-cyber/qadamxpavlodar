import { requestJSON } from './gateway.mjs';
export const TASK_STATUSES = ['draft','assigned','in_progress','submitted','verified'];
export const OBSERVATION_CATEGORIES = {access_problem:'Проблема доступа',visible_damage:'Видимое повреждение',care_completed:'Сообщение о выполнении ухода',needs_inspection:'Нужна проверка',other:'Другое наблюдение'};
const labels = {draft:'Черновик',assigned:'Назначено',in_progress:'В работе',submitted:'Ожидает проверки',verified:'Работа подтверждена'};
const actions = {inspect:'Осмотреть объект',water:'Выполнить полив',weed:'Удалить сорную растительность',plant:'Выполнить посадку по проекту'};
const priorities = {low:'Низкий',medium:'Обычный',high:'Высокий',critical:'Критический'};
export const ROLE_LABELS = {worker:'Работник',foreman:'Бригадир',coordinator:'Координатор',admin:'Руководитель',viewer:'Просмотр'};
export const shiftDate = iso => iso && Number.isFinite(Date.parse(iso)) ? new Date(Date.parse(iso)+5*60*60*1000).toISOString().slice(0,10) : null;
export const clockTime = iso => iso ? new Intl.DateTimeFormat('ru',{timeZone:'Asia/Qyzylorda',hour:'2-digit',minute:'2-digit'}).format(new Date(iso)) : 'Не указано';
export function createV2Transport({base='/api/v1',headersFor=()=>({}),csrfToken,onSessionRefreshed}={}) {
  let token=csrfToken, lastProvidedToken, refreshing;
  const acceptSession = response => {
    if (response?.data?.csrfToken) {
      token=response.data.csrfToken;
      onSessionRefreshed?.(response.data);
    }
    return response;
  };
  const makeHeaders = (headers={},mutation=false) => {
    const merged={...headersFor(),...headers};
    const csrfHeaders=Object.keys(merged).filter(key=>key.toLowerCase()==='x-csrf-token');
    const provided=csrfHeaders.length?merged[csrfHeaders.at(-1)]:undefined;
    // A stale host callback must not replace the token just refreshed here.
    if (provided && provided!==lastProvidedToken) { token=provided; lastProvidedToken=provided; }
    if (mutation && token) { for (const key of csrfHeaders) delete merged[key]; merged['X-CSRF-Token']=token; }
    return merged;
  };
  const refresh = signal => {
    if (!refreshing) refreshing=requestJSON(base+'/auth/me',{headers:makeHeaders(),signal}).then(response=>{
      if (!response?.data?.csrfToken) throw new Error('Сессия не содержит CSRF-токен. Войдите снова.');
      return acceptSession(response);
    }).finally(()=>{refreshing=null;});
    return refreshing;
  };
  return async (method,path,{body,headers={},signal}={}) => {
    method=method.toUpperCase();
    const mutation=!['GET','HEAD','OPTIONS'].includes(method) && path!=='/auth/login';
    let outgoing=makeHeaders(headers,mutation);
    if (mutation && !token) { await refresh(signal); outgoing=makeHeaders(headers,true); }
    const send = () => requestJSON(base+path,{method,body,headers:outgoing,signal});
    try {
      const response=await send();
      return ['/auth/login','/auth/me'].includes(path)?acceptSession(response):response;
    } catch(error) {
      if (!mutation || error.status!==403 || error.code!=='CSRF_REQUIRED') throw error;
      await refresh(signal);
      outgoing=makeHeaders(headers,true);
      // Deliberately outside the catch: at most one replay, preserving body and key.
      return send();
    }
  };
}
export function createContractGateway({request,user,uploadBase='/api/v1',demo=false}) {
  const envelope = async (method,path,options) => { const response = await request(method,path,options); if (!response || !Object.hasOwn(response,'data')) throw new Error('Ответ не соответствует контракту V2: отсутствует data.'); return response; };
  const data = async (method,path,options) => (await envelope(method,path,options)).data;
  const get = path => data('GET',path);
  const post = (path,body,key,signal) => data('POST',path,{body,headers:key?{'Idempotency-Key':key}:{},signal});
  async function list(path) {
    const rows=[]; let offset=0;
    for (;;) {
      const query=new URL(path,'http://worker.local');
      query.searchParams.set('limit','200'); query.searchParams.set('offset',String(offset));
      const response=await envelope('GET',query.pathname+query.search);
      if (!Array.isArray(response.data)) throw new Error('Ответ списка не соответствует контракту V2.');
      rows.push(...response.data);
      if (!response.meta || !Object.hasOwn(response.meta,'total')) return rows; // Local demo collections.
      const {total,offset:pageOffset,limit}=response.meta;
      if (!Number.isInteger(total) || total<0 || pageOffset!==offset || !Number.isInteger(limit) || limit<1 || limit>200 || response.data.length>limit) throw new Error('Неверные параметры страницы API.');
      offset+=response.data.length;
      if (offset>=total) return rows;
      if (!response.data.length) throw new Error('API вернул пустую страницу до конца списка.');
    }
  }
  const myCrews = async () => (await list('/crews')).filter(c=>c.foremanId===user.id && c.active);
  const photoUrl = id => `${uploadBase.replace(/\/$/,'')}/uploads/${encodeURIComponent(id)}`;
  const pendingStarts=new Map(),pendingAnalyses=new Map();
  async function rawTask(id) { const task=await get(`/tasks/${encodeURIComponent(id)}`); if (!TASK_STATUSES.includes(task.status)) throw new Error('Неизвестный TaskStatus из API.'); return task; }
  async function hydrate(task) {
    const ownCrew = user.role==='foreman' && (await myCrews()).some(c=>c.id===task.assignedCrewId);
    const assigned = task.assignedWorkerIds.includes(user.id);
    const canAccess = user.role==='worker' ? assigned : user.role==='foreman' ? ownCrew : false;
    if (!canAccess) throw new Error('Нет доступа к заданию.');
    const object = await get(`/${task.objectType==='plant'?'plants':'sites'}/${encodeURIComponent(task.objectId)}`);
    const reports = await list(`/reports?taskId=${encodeURIComponent(task.id)}`);
    const latest = reports.find(r=>r.id===task.latestReportId);
    const sharedDraft = task.minWorkers>1 ? await get(`/tasks/${encodeURIComponent(task.id)}/report-draft`) : null;
    if (sharedDraft) sharedDraft.contributions=(sharedDraft.contributions||[]).map(c=>({...c,photos:(c.photoIds||[]).map(id=>{
      const existing=c.photos?.find(p=>p.id===id);
      return {...existing,id,url:existing?.contentUrl||existing?.url||photoUrl(id)};
    })}));
    let design=null,context=null,catalog=[];
    if (task.approvedDesignId) {
      const document=await get(`/designs/${encodeURIComponent(task.approvedDesignId)}`);
      const revisions=Array.isArray(document.revisions)?document.revisions:[document];
      design=revisions.find(r=>r.id===task.approvedDesignId && r.revision===task.approvedDesignVersion && r.status==='approved')||null;
      if (design) {
        context=await get(`/sites/${encodeURIComponent(task.objectId)}/context`);
        // The worker role cannot enumerate the server catalog. Its authorized revision carries the item IDs.
        if (user.role!=='worker') {
          const ids=new Set(design.plantingItems.map(item=>item.catalogItemId));
          catalog=(await list('/plant-catalog')).filter(item=>ids.has(item.id));
        }
      }
    }
    const designCurrent = task.approvedDesignId ? !!design : task.action!=='plant';
    const coordinates = task.objectType==='plant' ? {latitude:object.lat,longitude:object.lng} : object.geometry?.type==='Polygon' ? {latitude:object.geometry.coordinates[0][0][1],longitude:object.geometry.coordinates[0][0][0]} : null;
    const history=reports.map(r=>({id:r.id,type:'report',note:r.note,time:r.createdAt,reviewLabel:{pending:'Ожидает проверки',accepted:'Принят координатором',changes_requested:'Возвращён на исправление'}[r.reviewStatus],coordinatorComment:r.reviewComment,
      photoName:r.photoIds.length?`${r.photoIds.length} файл(а)` : null,photoUrl:r.photoUrl||(r.photoIds[0]?photoUrl(r.photoIds[0]):null),analysis:r.confirmedObservation?{category:OBSERVATION_CATEGORIES[r.confirmedObservation.category],facts:r.confirmedObservation.extractedFacts,provenance:r.confirmedObservation.provenance||{provider:r.confirmedObservation.origin||'human_confirmed'},decision:r.confirmedObservation.provenance?.decision||'confirmed'}:null,
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
    const analysis=payload.analysis;
    if (!analysis || !['accepted','edited'].includes(analysis.decision) && analysis.confirmed!==true) return null;
    return {category:analysis.category,extractedFacts:analysis.facts,proposedAction:analysis.proposedAction??analysis.provenance?.proposedAction??null,
      evidenceIds:analysis.provenance?.evidenceIds||[],missingData:analysis.provenance?.missingData||[],confirmed:true};
  }
  function photos(ids,maximum) {
    if (!Array.isArray(ids) || ids.length>maximum) throw new Error(`Можно отправить не больше ${maximum} фотографий.`);
    if (new Set(ids).size!==ids.length) throw new Error('Фотографии в отчёте не должны повторяться.');
    return [...ids];
  }
  const gateway = {
    async listTasks({date}={}) { const tasks=await list('/tasks'); return Promise.all(tasks.filter(t=>(user.role==='foreman'||t.assignedWorkerIds.includes(user.id))&&(!date||shiftDate(t.scheduledStart)===date)).map(hydrate)); },
    async getTask(id) { return hydrate(await rawTask(id)); },
    async startTask(id,{expectedVersion,idempotencyKey}={}) {
      let action=pendingStarts.get(id);
      if (!action || idempotencyKey && action.key!==idempotencyKey) {
        // Reserve the operation before reading the version, so concurrent callers share it.
        action={body:expectedVersion===undefined?null:{expectedVersion},key:idempotencyKey||crypto.randomUUID(),inflight:null};
        pendingStarts.set(id,action);
      }
      if (!action.inflight) action.inflight=(async()=>{
        try {
          action.body??={expectedVersion:(await rawTask(id)).version};
          await post(`/tasks/${encodeURIComponent(id)}/start`,action.body,action.key);
          const task=await gateway.getTask(id);
          if (pendingStarts.get(id)===action) pendingStarts.delete(id);
          return task;
        } catch(error) {
          if (error.status>=400 && error.status<500 && ![408,429].includes(error.status) && pendingStarts.get(id)===action) pendingStarts.delete(id);
          throw error;
        }
      })().finally(()=>{action.inflight=null;});
      return action.inflight;
    },
    async uploadPhoto({file,idempotencyKey,taskId}) {
      const form=new FormData(); form.append('file',file,file.name||'photo.jpg'); form.append('taskId',taskId);
      const upload=await post('/uploads',form,idempotencyKey);
      return {...upload,url:upload.contentUrl||upload.url||photoUrl(upload.id)};
    },
    async submitReport(payload) {
      const contribution=payload.submissionType==='contribution',final=payload.submissionType==='final';
      const body={expectedVersion:payload.expectedVersion,photoIds:photos(final?(payload.sharedPhotoIds||[]):(payload.photoIds??(payload.photoId?[payload.photoId]:[])),contribution?10:20),note:payload.note,
        location:payload.geo?{lat:payload.geo.latitude,lng:payload.geo.longitude,accuracyM:payload.geo.accuracy,capturedAt:payload.geo.deviceTime}:null,confirmedObservation:observation(payload)};
      if(payload.submissionType==='contribution') {
        body.expectedDraftVersion=payload.expectedDraftVersion;
        const result=await post(`/tasks/${encodeURIComponent(payload.taskId)}/report-draft/contributions`,body,payload.idempotencyKey);
        const id=result.id||(result.taskId===payload.taskId && Number.isInteger(result.version)?`draft:${result.taskId}:${result.version}`:null);
        return {id,saved:!!id,reviewLabel:'Материалы добавлены',submissionType:'contribution',draftVersion:result.version};
      }
      if (!Array.isArray(payload.actualWorkerIds) || !payload.actualWorkerIds.length) throw new Error('Укажите минимум одного фактического исполнителя.');
      body.actualWorkerIds=[...payload.actualWorkerIds];
      body.actualPlantingItems=(payload.actualPlantingItems||[]).map(item=>({plantingItemId:item.plantingItemId,catalogItemId:item.catalogItemId,quantity:item.quantity,
        geometry:item.geometry?{type:item.geometry.type,coordinates:item.geometry.coordinates}:item.geometry,...(item.note!==undefined?{note:item.note}:{})}));
      if(final) body.expectedDraftVersion=payload.expectedDraftVersion;
      const result=await post(`/tasks/${encodeURIComponent(payload.taskId)}/reports`,body,payload.idempotencyKey);
      const report=result.report||result;
      return {id:report.id,saved:!!report.id,reviewLabel:{pending:'Ожидает проверки',accepted:'Принят координатором',changes_requested:'Возвращён на исправление'}[report.reviewStatus]};
    },
    async submitIssue(payload) {
      const text=[payload.reason,payload.note].map(value=>value?.trim()).filter(Boolean).join('\n');
      if (!text || text.length>4000) throw new Error('Описание проблемы должно содержать от 1 до 4000 символов.');
      const result=await post(`/tasks/${encodeURIComponent(payload.taskId)}/issues`,{expectedVersion:payload.expectedVersion,text,confirmedObservation:observation(payload)},payload.idempotencyKey);
      return {id:result.id,saved:!!result.id,reviewLabel:'Проблема передана координатору'};
    },
    async analyzeNote({text,taskId,signal,idempotencyKey}) {
      const identity=JSON.stringify([taskId,text]);
      const key=idempotencyKey||pendingAnalyses.get(identity)||crypto.randomUUID(); pendingAnalyses.set(identity,key);
      let draft;
      try { draft=await post('/observations/interpret',{taskId,text},key,signal); }
      catch(error) { if (error.status>=400 && error.status<500 && ![408,429].includes(error.status)) pendingAnalyses.delete(identity); throw error; }
      if(!Object.hasOwn(OBSERVATION_CATEGORIES,draft.category)||!Array.isArray(draft.extractedFacts))throw new Error('Неверный формат ObservationDraft. Можно отправить исходную заметку.');
      pendingAnalyses.delete(identity);
      return {category:draft.category,facts:draft.extractedFacts,proposedAction:draft.proposedAction??null,provenance:{provider:draft.method||'model',originalText:text,generatedAt:new Date().toISOString(),evidenceIds:draft.evidenceIds,missingData:draft.missingData,objectId:draft.objectId,proposedAction:draft.proposedAction??null}};
    },
    async getCrewWorkspace() {
      const crews=await myCrews(),workers=await list('/workers'),resources=await list('/resources');
      return {crews,workers:workers.map(worker=>({...worker,crewIds:crews.filter(crew=>crew.foremanId===worker.id || (Array.isArray(crew.members)
        ?crew.members.some(member=>member.userId===worker.id && member.active)
        :worker.crewIds?.includes(crew.id))).map(crew=>crew.id)})),resources};
    },
    async assignWorkers(id,{workerIds,responsibleUserId,scheduledStart,scheduledEnd,expectedVersion,idempotencyKey}) {
      const body={expectedVersion,workerIds};
      if (demo) Object.assign(body,{responsibleUserId,scheduledStart,scheduledEnd});
      await post(`/tasks/${encodeURIComponent(id)}/assign-workers`,body,idempotencyKey); return gateway.getTask(id);
    }
  };
  return gateway;
}
