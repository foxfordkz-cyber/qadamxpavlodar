export const DEMO_DATE = '2026-10-28';
export const DEMO_SCOPE = 'green-pavlodar:worker-demo:v2';
const time = hour => `${DEMO_DATE}T${String(hour).padStart(2,'0')}:00:00+05:00`;
export const accounts = [
  { id:'demo-worker-1', displayName:'Алия С.', role:'worker' },
  { id:'demo-worker-2', displayName:'Данияр К.', role:'worker' },
  { id:'demo-worker-3', displayName:'Марат Т.', role:'worker' },
  { id:'demo-worker-4', displayName:'Айжан М.', role:'worker' },
  { id:'demo-foreman-1', displayName:'Ерлан Б.', role:'foreman' },
  { id:'demo-foreman-2', displayName:'Сауле Н.', role:'foreman' },
  { id:'demo-coordinator', displayName:'Координатор · демо', role:'coordinator' },
  { id:'demo-admin', displayName:'Руководитель · демо', role:'admin' },
  { id:'demo-empty', displayName:'Без заданий', role:'worker' },
].map(user => ({...user, name:user.displayName, active:true, version:1}));
export function seedV2() {
  const crews = [ { id:'crew-1', name:'Бригада «Иртыш»', foremanId:'demo-foreman-1', active:true, resourceIds:['equipment-1'], version:1 }, { id:'crew-2', name:'Бригада «Жастар»', foremanId:'demo-foreman-2', active:true, resourceIds:['equipment-1'], version:1 } ];
  const memberships = [['demo-worker-1','crew-1'],['demo-worker-3','crew-1'],['demo-foreman-1','crew-1'],['demo-worker-2','crew-2'],['demo-worker-4','crew-2'],['demo-foreman-2','crew-2']].map(([userId,crewId]) => ({userId,crewId,active:true,validFrom:'2026-10-01T00:00:00Z',validUntil:null}));
  const profiles = accounts.filter(u => ['worker','foreman'].includes(u.role)).map(u => ({userId:u.id,shiftStart:time(8),shiftEnd:time(u.id === 'demo-worker-3' ? 14 : 17),capacityMinutes:420,skills:['inspect','plant'],unavailableIntervals:u.id === 'demo-worker-3' ? [{start:time(9),end:time(10),reason:'Учебный инструктаж'}] : [],version:1}));
  const evidence = [{id:'fixture-v2',sourceType:'fixture',sourceLabel:'Синтетический набор для кабинетов участника 4',dataClass:'demo',note:'Не муниципальные сведения и не агрономическая рекомендация.'}];
  const polygon = (x,y,w=.00012,h=.00009) => ({type:'Polygon',coordinates:[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]});
  const site = {id:'site-demo',name:'Учебный перекрёсток · Павлодар',geometry:polygon(76.942,52.2867,.0007,.0006),areaM2:null,factors:{},checks:{landPermission:'cleared',utilities:'cleared',access:'cleared',siteSuitability:'cleared',trafficVisibility:'cleared'},contextId:'context-demo',currentDesignId:'design-demo',evidenceIds:['fixture-v2'],missingData:['Площадь не измерена. Все проверки учебные.'],isDemo:true,version:1};
  const context = {id:'context-demo',siteId:site.id,radiusM:80,version:1,sourceEvidenceIds:['fixture-v2'],fetchedAt:'2026-10-27T10:00:00Z',missingData:['Реальная геометрия зданий ещё не загружена участником 3.'],features:[
    {id:'building-demo',featureType:'building',name:'Учебный контур здания',geometry:polygon(76.942,52.28705,.00022,.00016),mappedUse:null,evidenceIds:['fixture-v2']},
    {id:'road-demo',featureType:'road',geometry:polygon(76.94235,52.2867,.00012,.0006),evidenceIds:['fixture-v2']},
    {id:'crossing-demo',featureType:'crossing',geometry:polygon(76.94235,52.28695,.00012,.00006),evidenceIds:['fixture-v2']}
  ]};
  const catalog = [{id:'catalog-tree',displayName:'Дерево A · учебная позиция',kind:'tree'},{id:'catalog-shrub',displayName:'Кустарник B · учебная позиция',kind:'shrub'}].map(x => ({...x,botanicalName:null,spacingM:null,carePolicyId:null,unitCost:null,climateSuitabilityNotes:null,evidenceIds:['fixture-v2'],isDemo:true,version:1}));
  const design = {id:'design-demo',siteId:site.id,revision:1,version:1,status:'approved',name:'Учебный проект перекрёстка',objective:'Проверка назначения и отчёта',contextVersion:1,plantingItems:[
    {id:'item-tree',catalogItemId:'catalog-tree',quantity:2,quantityMethod:'Ручной синтетический сценарий',geometry:{type:'MultiPoint',coordinates:[[76.94215,52.28685],[76.94215,52.28695]]},evidenceIds:['fixture-v2']},
    {id:'item-shrub',catalogItemId:'catalog-shrub',quantity:4,quantityMethod:'Ручной синтетический сценарий',geometry:polygon(76.94252,52.28684,.0001,.00012),evidenceIds:['fixture-v2']}
  ],exclusionZones:[polygon(76.94235,52.2867,.00012,.0006)],sourcePhotoIds:[],checkSnapshot:site.checks,evidenceIds:['fixture-v2'],createdBy:'demo-coordinator',approvedBy:'demo-admin',approvedAt:'2026-10-27T10:30:00Z',estimatedCost:null,costCompleteness:'unknown'};
  const base = (id, patch={}) => ({id,objectType:'plant',objectId:`plant-${id}`,action:'inspect',description:'Проведите визуальный осмотр. Запишите видимые изменения. Если доступа нет, сообщите о проблеме.',priority:'medium',priorityWeight:2,createdAt:'2026-10-27T10:00:00Z',updatedAt:'2026-10-27T10:00:00Z',dueAt:time(17),estimatedMinutes:20,requiredWaterLiters:null,minWorkers:1,requiredSkills:['inspect'],assignedCrewId:'crew-1',assignedWorkerIds:['demo-worker-1'],resourceIds:[],scheduledStart:time(10),scheduledEnd:time(11),planId:'plan-demo',approvedDesignId:null,approvedDesignVersion:null,latestReportId:null,status:'assigned',evidenceIds:['fixture-v2'],isDemo:true,version:1,...patch});
  const tasks = [
    base('GP-104',{priority:'high',priorityWeight:3,description:'Осмотрите учебные деревья и опоры. Норм ремонта нет: при повреждениях передайте наблюдение координатору.'}),
    base('GP-108',{scheduledStart:time(11),scheduledEnd:time(12),latestReportId:'demo-report-returned'}),
    base('GP-112',{scheduledStart:time(12),scheduledEnd:time(13),objectType:'candidate_site',objectId:site.id,description:'Осмотрите доступ к учебному участку. Отсутствие норм не заменяйте собственными советами.'}),
    base('GP-096',{status:'submitted',latestReportId:'demo-report-pending',scheduledStart:time(8),scheduledEnd:time(9)}),
    base('GP-091',{status:'verified',latestReportId:'demo-report-accepted',scheduledStart:time(7),scheduledEnd:time(8)}),
    base('GP-OTHER',{assignedCrewId:'crew-2',assignedWorkerIds:['demo-worker-2'],scheduledStart:time(10),scheduledEnd:time(11),description:'Осмотрите учебное ограждение. При закрытом проходе сообщите координатору.'}),
    base('GP-PLANT',{objectType:'candidate_site',objectId:site.id,action:'plant',description:'Выполните только согласованные позиции проекта. При расхождении условий сообщите координатору. Технологические нормы должен приложить специалист.',minWorkers:2,requiredSkills:['plant'],assignedWorkerIds:[],scheduledStart:time(14),scheduledEnd:time(15),estimatedMinutes:60,approvedDesignId:design.id,approvedDesignVersion:1,resourceIds:['equipment-1'],priority:'high'}),
    base('GP-BUSY',{assignedCrewId:'crew-2',assignedWorkerIds:['demo-worker-4'],scheduledStart:time(9),scheduledEnd:time(10),resourceIds:['equipment-1']})
  ];
  const names = {'GP-104':'Сквер у набережной','GP-108':'Аллея у библиотеки','GP-096':'Сквер «Жастар»','GP-091':'Аллея на улице Ломова','GP-OTHER':'Участок второй бригады','GP-BUSY':'Учебный участок техники'};
  const plants = tasks.filter(t=>t.objectType==='plant').map(t=>({id:t.objectId,name:names[t.id],kind:'tree',species:null,lat:52.2873,lng:76.9418,condition:'unknown',carePolicyId:null,evidenceIds:['fixture-v2'],isDemo:true,version:1}));
  const reports = [['GP-108','demo-report-returned','changes_requested','Добавьте общий снимок и укажите объект.'],['GP-096','demo-report-pending','pending',null],['GP-091','demo-report-accepted','accepted','Отчёт принят.']].map(([taskId,id,reviewStatus,reviewComment])=>({id,taskId,authorId:'demo-worker-1',contributorIds:['demo-worker-1'],actualWorkerIds:['demo-worker-1'],createdAt:'2026-10-28T03:00:00Z',photoIds:[],note:'Учебный отчёт для проверки состояний.',reviewStatus,reviewComment,idempotencyKey:id,version:1}));
  return {users:accounts,crews,memberships,profiles,evidence,site,context,design,catalog,tasks,plants,reports,
    resources:[{id:'equipment-1',label:'Общий комплект оборудования · демо',type:'equipment',ownerCrewId:null,capacity:1,unit:'комплект',availableIntervals:[{start:time(8),end:time(17)}],evidenceIds:['fixture-v2'],version:1}],
    reportDrafts:{},uploads:{},idempotency:{},issues:[],notifications:[],assignments:[],registry:[],careDrafts:[],calls:{uploads:0,reports:0,issues:0,starts:0,contributions:0},version:2};
}
