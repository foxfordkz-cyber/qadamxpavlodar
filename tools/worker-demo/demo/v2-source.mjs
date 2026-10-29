import { validatePhoto, REASONS } from '../../../apps/web/src/features/worker/workflow.mjs';
import { createContractGateway, shiftDate } from '../../../apps/web/src/features/worker/contract-v2.mjs';
import { accounts, DEMO_DATE, DEMO_SCOPE, seedV2 } from './v2-fixtures.mjs';
export { accounts, DEMO_DATE, DEMO_SCOPE };
export const seed = seedV2;
const copy=x=>structuredClone(x), now=()=>new Date().toISOString();
const fail=(code,message,status=409)=>{const error=new Error(message);Object.assign(error,{code,status});throw error;};
const overlaps=(a,b,c,d)=>new Date(a)<new Date(d)&&new Date(c)<new Date(b);
/** Test transport only. Not an authentication implementation or a production database. */
export function createDemoSource({storage=null,delayMs=80}={}) {
  let state; try{state=JSON.parse(storage?.getItem(DEMO_SCOPE)||'null')||seedV2();}catch{state=seedV2();}
  const controls={offline:false,loseResponse:false,failUpload:false,aiTimeout:false,failStart:false};
  const persist=()=>storage?.setItem(DEMO_SCOPE,JSON.stringify(state));
  const crewFor=(user,id)=>state.crews.some(c=>c.id===id&&c.foremanId===user.id&&c.active);
  const userFor=id=>{const u=state.users.find(u=>u.id===id&&u.active);if(!u)fail('UNAUTHENTICATED','Сессия недоступна.',401);return u;};
  const accessible=(t,u)=>u.role==='worker'?t.assignedWorkerIds.includes(u.id):u.role==='foreman'?crewFor(u,t.assignedCrewId):['admin','coordinator'].includes(u.role);
  const taskFor=(id,user)=>{const t=state.tasks.find(t=>t.id===id);if(!t||!accessible(t,user))fail('FORBIDDEN','Нет доступа к заданию.',403);return t;};
  const checkVersion=(entity,version)=>{if(version!==entity.version)fail('VERSION_CONFLICT','Данные изменились. Обновите задание и проверьте изменения перед повтором.');};
  function checkDesign(task){if(task.action==='plant'&&(state.design.id!==task.approvedDesignId||state.design.revision!==task.approvedDesignVersion||state.design.status!=='approved'))fail('DESIGN_NOT_APPROVED','Посадка требует согласованной версии проекта.');}
  function checkPeople(task,ids,start,end){
    if(new Set(ids).size!==ids.length||ids.length<task.minWorkers)fail('INSUFFICIENT_CREW',`Нужно минимум ${task.minWorkers} исполнителя.`);
    if(!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(start)>=Date.parse(end))fail('INVALID_INTERVAL','Укажите корректный интервал.');
    if(Date.parse(start)<Date.parse(task.scheduledStart)||Date.parse(end)>Date.parse(task.scheduledEnd))fail('OUTSIDE_ASSIGNMENT','Время выходит за согласованный интервал.');
    if((Date.parse(end)-Date.parse(start))/60000<task.estimatedMinutes)fail('SHORT_INTERVAL','Интервал короче календарной длительности работы.');
    for(const id of ids){
      const member=state.memberships.some(m=>m.userId===id&&m.crewId===task.assignedCrewId&&m.active&&Date.parse(m.validFrom)<=Date.parse(start)&&(!m.validUntil||Date.parse(m.validUntil)>=Date.parse(end)));
      const user=state.users.find(u=>u.id===id&&u.active),profile=state.profiles.find(p=>p.userId===id);
      if(!member||!user||!profile)fail('FOREIGN_MEMBER','Выбранный человек не входит в доступный состав бригады.',403);
      if(task.requiredSkills.some(skill=>!profile.skills.includes(skill)))fail('MISSING_SKILL','У исполнителя нет необходимого навыка.');
      if(Date.parse(start)<Date.parse(profile.shiftStart)||Date.parse(end)>Date.parse(profile.shiftEnd)||profile.unavailableIntervals.some(i=>overlaps(start,end,i.start,i.end)))fail('WORKER_UNAVAILABLE',`${user.displayName}: человек недоступен в выбранное время.`);
      if(state.tasks.some(other=>other.id!==task.id&&other.status!=='draft'&&other.assignedWorkerIds.includes(id)&&overlaps(start,end,other.scheduledStart,other.scheduledEnd)))fail('WORKER_BUSY',`${user.displayName}: пересечение с другим назначением.`);
    }
    for(const resourceId of task.resourceIds)if(state.tasks.some(other=>other.id!==task.id&&other.status!=='draft'&&other.resourceIds.includes(resourceId)&&overlaps(start,end,other.scheduledStart,other.scheduledEnd)))fail('RESOURCE_BUSY','Общая техника уже занята другой задачей.');
  }
  const draftFor=id=>state.reportDrafts[id]||{id:`shared-${id}`,taskId:id,version:1,contributions:[],actualPlantingItems:[],actualWorkerIds:[]};
  const mutateTask=t=>{t.version++;t.updatedAt=now();};
  // Interpretation provenance belongs to this test source, not to the strict write payload.
  function confirmedObservation(value,user,task,note=''){
    if(!value)return null;
    const interpreted=state.interpretations?.[`${user.id}:${task.id}`];
    const provenance=interpreted&&note.trim().endsWith(interpreted.originalText.trim())?{...interpreted,decision:value.category===interpreted.category&&JSON.stringify(value.extractedFacts)===JSON.stringify(interpreted.extractedFacts)?'accepted':'edited'}:value.provenance;
    return {...copy(value),...(provenance?{provenance:copy(provenance)}:{}),confirmedBy:user.id,confirmedAt:now(),origin:'human_confirmed'};
  }
  function reviewReport(user,reportId,{decision,comment,expectedVersion}){
    const report=state.reports.find(r=>r.id===reportId); if(!report)fail('NOT_FOUND','Отчёт не найден.',404);
    const task=taskFor(report.taskId,user);
    if(user.role!=='coordinator'||user.id===report.authorId)fail('FORBIDDEN','Итоговую приёмку выполняет координатор, кроме автора отчёта.',403);
    if(!['accepted','changes_requested'].includes(decision))fail('BAD_INPUT','Неизвестный результат проверки.',400);
    checkVersion(report,expectedVersion);
    if(task.status!=='submitted'||report.reviewStatus!=='pending')fail('INVALID_STATE','Отчёт уже рассмотрен.');
    if(decision==='changes_requested'&&!comment?.trim())fail('COMMENT_REQUIRED','Для возврата нужен комментарий.',400);
    if(decision==='accepted'&&task.action==='plant'){
      checkDesign(task);
      if(report.actualWorkerIds.length<task.minWorkers)fail('INCOMPLETE_CREW','Фактический состав меньше требуемого. Верните отчёт для уточнения.');
      for(const item of state.design.plantingItems){const actual=report.actualPlantingItems?.find(i=>i.plantingItemId===item.id);if(!actual||actual.quantity!==item.quantity)fail('INCOMPLETE_PLANTING','Фактические количества не совпадают с проектом. Верните отчёт на исправление или согласуйте изменение.');}
      for(const item of report.actualPlantingItems){if(!state.design.plantingItems.some(p=>p.id===item.plantingItemId&&p.catalogItemId===item.catalogItemId))fail('UNKNOWN_ITEM','Позиция отсутствует в согласованном проекте.');}
      for(const item of report.actualPlantingItems)for(let n=0;n<item.quantity;n++){
        const id=`actual-${task.id}-${item.plantingItemId}-${n}`;
        if(!state.registry.some(p=>p.id===id))state.registry.push({id,taskId:task.id,plantingItemId:item.plantingItemId,catalogItemId:item.catalogItemId,condition:'unknown',isDemo:true});
      }
      // No CarePolicy in this fixture: do not invent subsequent care norms.
    }
    report.reviewStatus=decision;report.reviewComment=comment;report.reviewerId=user.id;report.reviewedAt=now();report.version++;
    task.status=decision==='accepted'?'verified':'assigned';mutateTask(task);return copy(report);
  }
  async function requestFor(userId,method,path,{body,headers={},signal}={}){
    if(delayMs)await new Promise(r=>setTimeout(r,delayMs));
    if(controls.offline)fail('OFFLINE','Нет связи с тестовым источником. Черновик сохранён; попробуйте позже.',503);
    const user=userFor(userId),url=new URL(path,'http://fixture'),p=url.pathname;
    const idempotencyKey=headers['Idempotency-Key'];
    const key=idempotencyKey?`${user.id}:${method}:${p}:${idempotencyKey}`:null;
    let fingerprint=JSON.stringify(body||null);
    if(body instanceof FormData){const file=body.get('file');await validatePhoto(file);const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');fingerprint=JSON.stringify({taskId:body.get('taskId'),name:file.name,size:file.size,hash});}
    const taskMatch=p.match(/^\/tasks\/([^/]+)(?:\/(.*))?$/);const task=taskMatch?taskFor(decodeURIComponent(taskMatch[1]),user):null;const action=taskMatch?.[2];
    if(p==='/uploads'&&body instanceof FormData){const uploadTask=taskFor(body.get('taskId'),user);if(!uploadTask.assignedWorkerIds.includes(user.id)&&!(user.role==='foreman'&&crewFor(user,uploadTask.assignedCrewId)))fail('FORBIDDEN','Нет права добавлять фото.',403);}
    if(p.match(/^\/reports\/[^/]+\/review$/)){const reviewed=state.reports.find(r=>r.id===p.split('/')[2]);if(!reviewed||user.role!=='coordinator'||reviewed.authorId===user.id)fail('FORBIDDEN','Итоговую приёмку выполняет координатор, кроме автора отчёта.',403);taskFor(reviewed.taskId,user);}
    // Repeat permissions are checked before replay; the original result is replayed before version/state validation.
    if(key&&state.idempotency[key]){if(state.idempotency[key].fingerprint!==fingerprint)fail('IDEMPOTENCY_CONFLICT','Тот же ключ использован с другим содержимым.');return {data:copy(state.idempotency[key].result)};}
    let result;
    if(method==='GET'){
      if(p==='/auth/me')result=user;
      else if(p==='/tasks')result=state.tasks.filter(t=>accessible(t,user)&&(!url.searchParams.get('date')||shiftDate(t.scheduledStart||t.dueAt)===url.searchParams.get('date')));
      else if(task&&!action)result=task;
      else if(task&&action==='report-draft'){const draft=draftFor(task.id);result={...draft,contributions:draft.contributions.map(c=>({...c,photos:c.photoIds.map(id=>({id,name:state.uploads[id]?.name,url:state.uploads[id]?.url,contentUrl:state.uploads[id]?.contentUrl}))}))};}
      else if(task&&action==='issues')result=state.issues.filter(issue=>issue.taskId===task.id);
      else if(p==='/crews')result=state.crews.filter(c=>user.role==='foreman'?c.foremanId===user.id:user.role==='worker'?state.memberships.some(m=>m.userId===user.id&&m.crewId===c.id&&m.active):true);
      else if(/^\/crews\/[^/]+\/members$/.test(p)){const crewId=decodeURIComponent(p.split('/')[2]);if(user.role==='foreman'?!crewFor(user,crewId):user.role==='worker'?!state.memberships.some(m=>m.userId===user.id&&m.crewId===crewId&&m.active):!['admin','coordinator'].includes(user.role))fail('FORBIDDEN','Нет доступа к составу бригады.',403);result=state.memberships.filter(m=>m.crewId===crewId);}
      else if(p==='/workers')result=state.profiles.filter(profile=>user.role==='foreman'?state.memberships.some(m=>m.userId===profile.userId&&crewFor(user,m.crewId)&&m.active):profile.userId===user.id).map(profile=>({...state.users.find(u=>u.id===profile.userId),profile,crewIds:state.memberships.filter(m=>m.userId===profile.userId&&m.active).map(m=>m.crewId)}));
      else if(p==='/resources')result=state.resources;
      else if(p==='/reports'){const t=taskFor(url.searchParams.get('taskId'),user);result=state.reports.filter(r=>r.taskId===t.id);}
      else if(p.startsWith('/plants/')){const objectId=p.split('/')[2];if(!state.tasks.some(t=>t.objectId===objectId&&accessible(t,user)))fail('FORBIDDEN','Нет доступа к объекту.',403);result=state.plants.find(x=>x.id===objectId);}
      else if(p===`/sites/${state.site.id}`||p===`/sites/${state.site.id}/context`||p===`/designs/${state.design.id}`){if(!['admin','coordinator'].includes(user.role)&&!state.tasks.some(t=>t.objectId===state.site.id&&accessible(t,user)))fail('FORBIDDEN','Нет доступа к контексту проекта.',403);result=p.includes('/context')?state.context:p.startsWith('/designs')?state.design:state.site;}
      else if(p==='/plant-catalog')result=state.catalog;
      else fail('NOT_FOUND','Маршрут отсутствует в тестовом источнике.',404);
    }else if(method==='POST'&&task){
      if(action==='assign-workers'){
        if(user.role!=='foreman'||!crewFor(user,task.assignedCrewId))fail('FORBIDDEN','Распределять людей может бригадир этой бригады.',403);
        checkVersion(task,body.expectedVersion);if(task.status!=='assigned')fail('INVALID_STATE','Начатое или отправленное назначение нельзя тихо изменить.');checkDesign(task);
        const scheduledStart=body.scheduledStart??task.scheduledStart,scheduledEnd=body.scheduledEnd??task.scheduledEnd;
        const responsibleUserId=body.responsibleUserId??(body.workerIds.includes(task.responsibleUserId)?task.responsibleUserId:body.workerIds[0]);
        checkPeople(task,body.workerIds,scheduledStart,scheduledEnd);
        if(!body.workerIds.includes(responsibleUserId))fail('INVALID_RESPONSIBLE','Ответственный должен быть среди выбранных исполнителей.',400);
        state.assignments.push({taskId:task.id,crewId:task.assignedCrewId,workerIds:[...body.workerIds],previousWorkerIds:[...task.assignedWorkerIds],responsibleUserId,scheduledStart,scheduledEnd,resourceIds:[...task.resourceIds],changedBy:user.id,changedAt:now()});
        task.assignedWorkerIds=[...body.workerIds];task.scheduledStart=scheduledStart;task.scheduledEnd=scheduledEnd;task.responsibleUserId=responsibleUserId;mutateTask(task);result=task;
      }else if(action==='start'){
        if(!['foreman','worker'].includes(user.role))fail('FORBIDDEN','Начать может исполнитель или бригадир.',403);
        checkVersion(task,body.expectedVersion);if(task.status!=='assigned')fail('INVALID_STATE','Задание нельзя начать в текущем состоянии.');
        checkDesign(task);checkPeople(task,task.assignedWorkerIds,task.scheduledStart,task.scheduledEnd);
        if(controls.failStart)fail('TEST_FAILURE','Не удалось начать задание. Изменение не сохранено.',503);
        task.status='in_progress';task.startedAt=now();mutateTask(task);state.calls.starts++;result=task;
      }else if(action==='report-draft/contributions'){
        if(task.status!=='in_progress'||!task.assignedWorkerIds.includes(user.id))fail('FORBIDDEN','Добавлять материалы может назначенный исполнитель начатой работы.',403);
        const draft=draftFor(task.id);checkVersion(task,body.expectedVersion);checkVersion(draft,body.expectedDraftVersion);checkPhotoIds(body.photoIds,user,task,true);
        if(body.photoIds.length>10)fail('PHOTO_LIMIT','Не больше 10 фотографий во вкладе.',400);
        const contribution={note:body.note,photoIds:copy(body.photoIds),location:body.location??null,confirmedObservation:confirmedObservation(body.confirmedObservation,user,task,body.note),authorId:user.id,updatedAt:now()};
        draft.contributions=draft.contributions.filter(c=>c.authorId!==user.id);draft.contributions.push(contribution);draft.version++;state.reportDrafts[task.id]=draft;state.calls.contributions++;result=draft;
      }else if(action==='reports'){
        if(task.status!=='in_progress')fail('INVALID_STATE','Сначала начните задание или исправление.');checkVersion(task,body.expectedVersion);checkDesign(task);
        const latest=state.reports.find(r=>r.id===task.latestReportId),revisionOf=latest?.reviewStatus==='changes_requested'?latest.id:null;
        if(task.minWorkers>1){if(user.role!=='foreman'||!crewFor(user,task.assignedCrewId))fail('FORBIDDEN','Совместный итог отправляет только бригадир.',403);
          const draft=draftFor(task.id);checkVersion(draft,body.expectedDraftVersion);
          const allowedPhotos=draft.contributions.filter(c=>task.assignedWorkerIds.includes(c.authorId)).flatMap(c=>c.photoIds);if((body.photoIds||[]).some(id=>state.uploads[id]?.ownerId!==user.id&&!allowedPhotos.includes(id)))fail('FORBIDDEN','Фото отсутствует в общем черновике.',403);
        }else if(user.role!=='worker'&&user.role!=='foreman'||!task.assignedWorkerIds.includes(user.id))fail('FORBIDDEN','Итог отправляет назначенный исполнитель.',403);
        checkPhotoIds(body.photoIds,user,task,task.minWorkers===1);checkQuantities(task,body.actualPlantingItems);
        if(body.photoIds.length>20)fail('PHOTO_LIMIT','Не больше 20 фотографий в отчёте.',400);
        if(!body.actualWorkerIds?.length||body.actualWorkerIds.length<task.minWorkers||new Set(body.actualWorkerIds).size!==body.actualWorkerIds.length||body.actualWorkerIds.some(id=>!task.assignedWorkerIds.includes(id)))fail('INVALID_WORKERS','Проверьте фактических исполнителей.',400);
        const {expectedVersion,expectedDraftVersion,...content}=body;
        const report={...copy(content),id:`report-${crypto.randomUUID()}`,taskId:task.id,authorId:user.id,contributorIds:task.minWorkers>1?draftFor(task.id).contributions.filter(c=>task.assignedWorkerIds.includes(c.authorId)).map(c=>c.authorId):[user.id],createdAt:now(),reviewStatus:'pending',reviewComment:null,idempotencyKey,version:1,photoUrl:state.uploads[body.photoIds[0]]?.url,
          revisionOf,confirmedObservation:confirmedObservation(body.confirmedObservation,user,task,body.note),foremanCheckedAt:task.minWorkers>1?now():null,foremanCheckedBy:task.minWorkers>1?user.id:null};
        state.reports.push(report);task.latestReportId=report.id;task.status='submitted';mutateTask(task);state.calls.reports++;result={report,task};
      }else if(action==='issues'){
        checkVersion(task,body.expectedVersion);if(!['assigned','in_progress'].includes(task.status))fail('INVALID_STATE','Нельзя отправить проблему для этого задания.');
        // The legacy reason/note form is retained solely for direct demo callers.
        if(body.text===undefined&&!REASONS.includes(body.reason))fail('INVALID_STATE','Выберите причину проблемы.');
        const text=body.text??[body.reason,body.note].filter(Boolean).join('\n');
        if(typeof text!=='string'||!text.trim()||text.trim().length>4000)fail('BAD_INPUT','Опишите проблему: не больше 4000 символов.',400);
        if(body.photoIds?.length)checkPhotoIds(body.photoIds,user,task,true);
        const lines=text.trim().split('\n'),reason=body.reason??(REASONS.includes(lines[0])?lines.shift():'Проблема'),note=body.note??lines.join('\n');
        const issue={text:text.trim(),confirmedObservation:confirmedObservation(body.confirmedObservation,user,task,text),id:`issue-${crypto.randomUUID()}`,taskId:task.id,authorId:user.id,createdAt:now(),version:1};state.issues.push(issue);state.notifications.push({taskId:task.id,issueId:issue.id,userId:user.id,text:issue.text,reason,note});mutateTask(task);state.calls.issues++;result=issue;
      }else fail('NOT_IMPLEMENTED','Эта операция принадлежит другому модулю.',404);
    }else if(method==='POST'&&p==='/uploads'){
      const t=taskFor(body.get('taskId'),user),file=body.get('file');if(!t.assignedWorkerIds.includes(user.id)&&!(user.role==='foreman'&&crewFor(user,t.assignedCrewId)))fail('FORBIDDEN','Нет права добавлять фото.',403);
      if(controls.failUpload)fail('UPLOAD_FAILED','Ошибка загрузки фото. Файл и текст сохранены на устройстве.',503);await validatePhoto(file);
      let url=null;if(typeof FileReader!=='undefined'&&file.size<600000)url=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
      result={id:`photo-${crypto.randomUUID()}`,name:file.name,ownerId:user.id,taskId:t.id,url,contentUrl:url};state.uploads[result.id]=result;state.calls.uploads++;
    }else if(method==='POST'&&p==='/observations/interpret'){
      const t=taskFor(body.taskId,user);if(body.objectId!==undefined&&t.objectId!==body.objectId)fail('CONTEXT_MISMATCH','Контекст объекта изменился.',400);
      if(controls.aiTimeout)await new Promise((resolve,reject)=>{if(signal?.aborted)return reject(new Error('AI недоступен.'));signal?.addEventListener('abort',()=>reject(new Error('AI не ответил. Можно отправить обычную заметку.')),{once:true});});
      result={objectId:t.objectId,category:/не пройти|закрыт|доступ|огражден/i.test(body.text)?'access_problem':/поврежд|слом/i.test(body.text)?'visible_damage':/выполнен/i.test(body.text)?'care_completed':'other',extractedFacts:body.text.split(/[.!?\n]/).map(x=>x.trim()).filter(Boolean).slice(0,3),evidenceIds:['fixture-v2'],missingData:[],needsHumanReview:true,method:'rules'};
      state.interpretations??={};state.interpretations[`${user.id}:${t.id}`]={originalText:body.text,provider:'rules',category:result.category,extractedFacts:copy(result.extractedFacts),generatedAt:now()};
    }else if(method==='POST'&&p.match(/^\/reports\/[^/]+\/review$/))result=reviewReport(user,p.split('/')[2],body);
    else if(method==='POST'&&p.match(/^\/designs\/[^/]+\/review$/)){if(user.role!=='admin')fail('FORBIDDEN','Согласование проекта доступно руководителю.',403);fail('NOT_IMPLEMENTED','Экран согласования принадлежит участнику 2.',501);}
    else fail('NOT_IMPLEMENTED','Маршрут пока не реализован в локальном стенде.',404);
    if(result===undefined)fail('NOT_FOUND','Объект не найден.',404);
    if(method!=='GET'){
      if(key)state.idempotency[key]={fingerprint,result:copy(result)};persist();
      if(controls.loseResponse&&(action==='reports'||action==='issues'||action==='report-draft/contributions')){controls.loseResponse=false;fail('RESPONSE_LOST','Ответ потерян после сохранения. Повторите отправку с тем же ключом.',503);}
    }
    return {data:copy(result)};
  }
  function checkPhotoIds(ids,user,task,own){if(!ids?.length)fail('PHOTO_REQUIRED','Добавьте фотографию результата.',400);for(const id of ids){const p=state.uploads[id];if(!p||p.taskId!==task.id||(own&&p.ownerId!==user.id))fail('FORBIDDEN','Нет доступа к фотографии.',403);}}
  function checkQuantities(task,items){if(task.action!=='plant')return;for(const item of items||[]){const planned=state.design.plantingItems.find(p=>p.id===item.plantingItemId&&p.catalogItemId===item.catalogItemId);if(!planned||!Number.isInteger(item.quantity)||item.quantity<0)fail('BAD_QUANTITY','Проверьте фактические количества и позиции.',400);}}
  return {controls,snapshot:()=>copy(state),transportFor:userId=>(...args)=>requestFor(userId,...args),apiFor:userId=>createContractGateway({request:(...args)=>requestFor(userId,...args),user:userFor(userId),demo:true}),
    review(taskId,action,comment){const task=state.tasks.find(t=>t.id===taskId),report=state.reports.find(r=>r.id===task?.latestReportId);if(!report)throw new Error('Сначала отправьте отчёт на проверку.');const result=reviewReport(userFor('demo-coordinator'),report.id,{decision:action==='accept'?'accepted':'changes_requested',comment,expectedVersion:report.version});persist();return result;},
    reset(){state=seedV2();for(const key of Object.keys(controls))controls[key]=false;persist();}
  };
}
