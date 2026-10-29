> Исторический отчёт до merge (checkpoint 9be77df). Актуальное объединённое состояние: [BACKEND_MERGE_VERIFICATION.md](BACKEND_MERGE_VERIFICATION.md).

# Передача backend участникам 1, 2 и 4

Дата: 29.10.2026. Ветка `feature/backend-preparation`; изменения локальные. Swagger: **90 операций**, `GET /api/v1/openapi.json`, UI `/api/v1/docs`. Все пути далее относительно `/api/v1`. Реальные HTTP-сессии, SQLite и загрузка файлов работают; весь frontend ещё не совместим. Подробный аудит каждого вызова: [FINAL_BACKEND_INTEGRATION_MATRIX.md](FINAL_BACKEND_INTEGRATION_MATRIX.md). Проверки и ограничения: [FINAL_BACKEND_TEST_RESULTS.md](FINAL_BACKEND_TEST_RESULTS.md).

## Запуск и границы данных

Из `apps/server`: `npm run typecheck`, `npm run build`, `npm start`. Node 24; используйте существующие DB_PATH/UPLOADS_PATH, не удаляйте базу ради запуска. Настройки перечислены в `.env.example`. Повторный seed сохраняет прежние записи, но не нужен при каждом старте.

Для общего origin используйте существующий Vite proxy: frontend `http://127.0.0.1:5180/?source=api`, backend `http://127.0.0.1:3110`. Это адреса локального стенда, не публичный сервис. При иных портах согласуйте proxy и FRONTEND_ORIGINS. `?source=api` обязателен для проверки реального сервера; mock-режим не является интеграцией.

Есть два набора объектов: **V2** `/sites`, `/plant-catalog`, `/evidence` и **municipal** `/municipal/sites`, `/species`, `/municipal/evidence`. Municipal OSM/import ID и `sp-*` species ID не являются V2 site/catalog ID. Автоматическое преобразование отсутствует; не соединять наборы по названию и не заменять URL без преобразования модели. GeoJSON — `[longitude, latitude]`; Report.location — объект `{lat,lng,accuracyM,capturedAt}`.

## Авторизация, CSRF и общий клиент

Готовый модуль: [examples/team-client.mjs](examples/team-client.mjs). Его login, GET, POST с CSRF, пагинация, logout и ошибка 401 проверены через настоящий HTTP. Это пример для внедрения владельцами UI, он не подключён самовольно к чужим React-компонентам. В браузере cookie ведёт браузер; Node fetch требует cookie jar (тестовый runner использует настоящий cookie из Set-Cookie).

```js
import { createBackendClient } from './team-client.mjs'; // путь после подключения владельцем UI
const api = createBackendClient({ base: '/api/v1' });
const session = await api.login('coordinator', 'DEMO-only-2026!');
console.log(session.user.role); // coordinator — серверная роль
await api.session();             // GET /auth/me; после перезагрузки восстановить CSRF
const tasks = await api.listAll('/tasks?date=2026-10-28');
await api.logout();              // POST /auth/logout; сервер отзывает сессию
```

Указанный пароль — публичный **DEMO** пароль fixture, не production secret. Доступные DEMO логины: `admin`, `coordinator`, `foreman1`, `worker1`, `worker2`, `worker3`; municipal seed добавляет `specialist` и `viewer`. Не публиковать реальные пароли, cookie или CSRF в логах/скриншотах.

Raw HTTP login:

```http
POST /api/v1/auth/login
Content-Type: application/json

{"login":"coordinator","password":"DEMO-only-2026!"}
```

Ответ 200: `{ "data": { "user": { "id": "demo-coordinator-1", "role": "coordinator", "...": "остальные поля User" }, "csrfToken": "<token>", "expiresAt": "<ISO timestamp>", "mode": "DEMO" } }`. Многоточие здесь обозначает сокращённый ответ, не буквальное поле сервера. Cookie `gp_v2_session`: HttpOnly, SameSite=Strict, Path=/api/v1, срок 8 часов. Локальный режим использует Secure=false. `/auth/me` возвращает `data.user` и `data.csrfToken`. Не ожидать плоского User и `organizationId`.

После login отправляйте cookie (`credentials:'include'`) и **X-CSRF-Token на каждый non-GET**, включая read-like POST analysis/export. Login — исключение. Роли и автор задаются сессией, X-Role/X-User-Id не дают полномочий. На каждую write-операцию нужен `Idempotency-Key`; конкретная обязательность отражена в Swagger. Для одного намерения храните один key и неизменный body до результата; сетевой retry использует их повторно. После изменения формы/версии создавайте новый key. Нельзя генерировать новый UUID на каждый retry.

Роли: admin управляет людьми/бригадами/ресурсами и утверждает дизайн; coordinator создаёт/назначает задачи и принимает отчёты; foreman подтверждает людей своей бригады и итог группы; worker работает только с назначенными задачами. Specialist получает coordinator-полномочия V2 и сохраняет raw role=`specialist`; viewer читает municipal, но не редактирует. Администратор не подменяет координатора при приёмке отчёта.

Все JSON success ответы — `{data,meta?}`. У коллекций V2 `meta={total,limit,offset}`; читать все страницы (`limit` максимум 200). Municipal `/municipal/sites` возвращает полный массив без такой meta. `listAll` из примера предназначен только для пагинируемых коллекций.

## Участник 2: coordinator/admin и municipal UI

Обязательные доработки владельца frontend:

1. Разделить municipal и V2 API/ID. Исправить transport rewrite: сейчас он перенаправляет также PATCH `/sites/:id` и POST `/sites/rank-preview` в несуществующий municipal route.
2. Перевести `/projects` → модель `/designs`, `/brigades` → `/crews` **с адаптацией DTO**, не только переименованием URL. Таблица полей находится в matrix. Не реализовывать withdraw через чужой admin review.
3. Задачи: assignedCrewId/assignedWorkerIds/minWorkers/approvedDesignId/approvedDesignVersion; фильтр workerId вместо assigneeId. `objectId` и `date` теперь поддержаны backend. Дата: UTC+5, scheduledStart при наличии, иначе dueAt; без обеих дат задача не входит в date-filter.
4. Версии task/report/design/draft хранить отдельно. Review отчёта отправляет expectedVersion задачи и expectedReportVersion отчёта. Картинки и PDF/XLSX получать как binary/blob, не JSON.
5. Показывать 422 для неизвестной площади/норм, excluded в priorities, 503 для неподключённого AI. Не считать rules assistant настоящим LLM.

### Дизайн → задача → бригада

Получить V2 `/sites/:id/context`, `/plant-catalog`, `/evidence`. Все human checks участка (landPermission, utilities, access, siteSuitability, trafficVisibility) должны быть рассмотрены человеком; PATCH `/sites/:id` принимает `expectedVersion`, `checks:{<name>:{status,comment}}`, status=`unknown|cleared|blocked|not_applicable`. Для submit требуются cleared/not_applicable с объяснением; на перекрёстке trafficVisibility должен быть cleared. reviewedBy/At назначает сервер. DEMO участок в V2 seed уже содержит явно синтетические проверки.

Пример создания для V2 DEMO данных; перед исполнением следует прочитать актуальный context.version:

```js
const {data: context} = await api.request('GET', '/sites/demo-site-1/context');
const {data: design} = await api.request('POST', '/designs', {
  key: crypto.randomUUID(),
  body: {
    siteId: 'demo-site-1', name: 'DEMO planting', objective: 'Проверка командного workflow',
    contextVersion: context.version,
    plantingItems: [{ id:'item-1', catalogItemId:'demo-catalog-1',
      geometry:{type:'MultiPoint',coordinates:[[76.951,52.281],[76.9511,52.2811]]},
      quantity:2, quantityMethod:'Количество подтверждено специалистом',
      carePolicyId:'demo-care-policy', evidenceIds:['demo-v2-evidence'] }],
    evidenceIds:['demo-v2-evidence']
  }
}); // 201, data DesignProposal с version/revision/status
const {data: submitted} = await api.request('POST', `/designs/${design.id}/submit`, {
  key:crypto.randomUUID(), body:{expectedVersion:design.version}
});
```

Далее **в отдельной admin сессии** POST `/designs/:id/review`:

```json
{"expectedVersion":2,"decision":"approved","comment":"Проверки и схема рассмотрены"}
```

Здесь 2 — пример версии, читать фактическую перед операцией. Другой decision — `changes_requested`. Ответ 200 — обновлённый DesignProposal. Утверждённая revision неизменна; `version` — optimistic lock всей записи, не номер revision. Editing approved дизайна создаёт новую ревизию, старые выпущенные задачи продолжают ссылаться на утверждённую.

После одобрения coordinator вызывает POST `/designs/:id/create-tasks`, key, body `{expectedVersion:<design.version>,revision:<approved revision>,estimatedMinutes:30,minWorkers:2}` → **201 `data:Task[]`**. Повторный выпуск revision не создаёт дубли. POST `/tasks` используется для ручных inspect/water/weed; plant требует approved design.

POST `/tasks/:taskId/assign`, key:

```json
{"expectedVersion":1,"crewId":"demo-crew-1","scheduledStart":"2026-10-28T05:00:00Z","scheduledEnd":"2026-10-28T05:30:00Z","resourceIds":[]}
```

Ответ 200 `data:Task`, version увеличивается. Даты выше соответствуют синтетической смене fixture; в рабочем UI брать реальные профили и интервалы, не сегодняшнюю дату автоматически. `/workers` возвращает смены/skills внутри `profile`; `/crews` — foremanId/resourceIds/members, `/resources` — ресурсы. Проверяются длительность, навыки, minWorkers и пересечения. Назначение бригады ещё не даёт её работникам доступ: конкретных людей подтверждает foreman.

### Municipal запросы и сохранение расчёта

```js
const {data: zones} = await api.request('GET','/municipal/sites');
const zone = zones.find(z => z.areaM2 > 0);
if (!zone) throw Error('Нужен участок с измеренной площадью');
const {data: analysis} = await api.request('POST',`/zones/${zone.id}/analysis`, {
  body:{options:{variant:'optimal',careYears:2,watering:'regular'}}
}); // 200: схема, смета, эффекты и provenance; расчёт ещё не сохранён
const {data: saved} = await api.request('POST',`/zones/${zone.id}/snapshots`, {
  key:crypto.randomUUID(), body:{options:{variant:'optimal',careYears:2,watering:'regular'}}
}); // 201: {id,...ZoneAnalysis}; сохранить saved.id
const {data: restored} = await api.request('GET',`/analysis-snapshots/${saved.id}`);
// GET отдаёт сохранённый ZoneAnalysis без внешнего id, не пересчитывает по новым нормам.
const pdf = await api.request('POST',`/zones/${zone.id}/export`, {
  body:{format:'pdf',options:{variant:'optimal',careYears:2}}, binary:true
}); // Blob; xlsx аналогично. Export рассчитывает по текущим входам, не по snapshot ID.
```

Импорт CSV/GeoJSON/KML/shapefile ZIP проходит preview и отдельный commit; не выдавать preview за сохранение:

```js
const {data: preview} = await api.request('POST','/imports/preview',{body:{
  format:'csv', content:'name,lat,lng\nIntegration DEMO,52.283719,76.945721',
  source:'Синтетический пример для интеграции',dataClass:'demo'
}}); // 200: id, valid/invalid, ошибки и предупреждения
if (preview.invalid) throw Error('Сначала исправьте ошибки preview');
// Только после явного подтверждения предупреждений пользователем:
const {data: imported} = await api.request('POST',`/imports/${preview.id}/commit`,{
  key:crypto.randomUUID(),body:{acknowledgeWarnings:true}
}); // 200, committed:true. ID принадлежит автору preview.
```

Одинаковый commit (в том числе с новым ключом) не дублирует данные; повторный файл определяется как duplicate. `/rates` редактирует admin через PATCH с `{key,value,source,expectedVersion,dataClass}` и Idempotency-Key. Отсутствующие нормы/площадь возвращают 422, а не выдуманные значения.

## Участник 4: worker/foreman

В существующем gateway сначала исправить session guard без organizationId, payload contribution/final/issue и выбор утверждённой revision. Рабочий эталон полного процесса — [scripts/demo-v2.mjs](scripts/demo-v2.mjs); он уже прошёл против запущенного dist/server.js с перезапуском.

`GET /tasks?date=2026-10-28&limit=100&offset=0`, `GET /tasks/:id`, `GET /tasks/:id/report-draft`, `GET /reports?taskId=:id`. Worker видит только назначенные задачи/объекты, foreman — свою бригаду. У `/designs/:id` для исполнителя **`data:{id,revisions:[...]}`**; выбрать revision по task.approvedDesignVersion, top-level status отсутствует. Worker `/plant-catalog` теперь возвращает только каталог approved revisions его доступных задач; пустой массив корректен.

После входа foreman1:

```js
let {data: task} = await api.request('GET', `/tasks/${taskId}`);
({data:task} = await api.request('POST',`/tasks/${taskId}/assign-workers`, {
  key:crypto.randomUUID(),body:{expectedVersion:task.version,workerIds:['demo-worker-1','demo-worker-2']}
})); // 200 Task; responsibleUserId и интервалы здесь не принимаются
```

Worker1/собственный foreman: POST `/tasks/:id/start` `{expectedVersion:task.version}` + key →200 Task. После каждого успешного изменения перечитать задачу, при конфликте не продолжать со старой версией.

```js
// file — выбранный пользователем File, taskId — доступная задача в работе.
const form = new FormData(); form.set('taskId',taskId); form.set('file',file);
const {data: photo} = await api.request('POST','/uploads',{
  key:crypto.randomUUID(),body:form
}); // 201 metadata {id,contentUrl,mediaType,byteSize,...}
// Content-Type для FormData устанавливает браузер вместе с boundary.
const imageBlob = await api.request('GET',`/uploads/${photo.id}`,{binary:true});

const {data: currentTask} = await api.request('GET',`/tasks/${taskId}`);
const {data: draft} = await api.request('GET',`/tasks/${taskId}/report-draft`);
const {data: updatedDraft} = await api.request('POST',`/tasks/${taskId}/report-draft/contributions`,{
  key:crypto.randomUUID(),body:{expectedVersion:currentTask.version,
    expectedDraftVersion:draft.version,note:'Фактические материалы работ',photoIds:[photo.id]}
}); // 200 ReportDraft: taskId/version/contributions/summary; не report.id
```

Для contribution нельзя отправлять actualWorkerIds, actualPlantingItems, deviceTime, revisionOf. Подтверждённое наблюдение (необязательно): `confirmedObservation:{category,extractedFacts,proposedAction,evidenceIds,missingData,confirmed:true}`. Категории: access_problem/visible_damage/care_completed/needs_inspection/other. Автор/время подтверждения назначаются сервером; поля objectId, provenance, needsHumanReview сюда не копировать из AI draft.

Foreman перечитывает task и draft; может PUT `/tasks/:id/report-draft` с final report content и обеими версиями, затем снова получает актуальную draft.version. Для финальной отправки группы POST `/tasks/:id/reports`, key:

```json
{
  "expectedVersion":4,"expectedDraftVersion":1,
  "note":"Бригадир проверил фактическую посадку",
  "actualWorkerIds":["demo-worker-1","demo-worker-2"],
  "photoIds":["<uploaded photo id>"],
  "actualPlantingItems":[{"plantingItemId":"item-1","catalogItemId":"demo-catalog-1",
    "quantity":2,"geometry":{"type":"MultiPoint","coordinates":[[76.951,52.281],[76.9511,52.2811]]}}]
}
```

Версии 4/1 — из DEMO последовательности, заменить текущими. Для обычной care/inspect задачи actualPlantingItems пуст; actualWorkerIds обязателен. Solo assigned worker использует тот же final endpoint без expectedDraftVersion, если задача допускает одиночный отчёт. Group final выполняет свой foreman. `foremanChecked`/`contributorIds` не отправлять: полномочия и происхождение материалов сервер определяет сам.

Ответ **201 `{data:{report,task}}`**, читать report.id и task.version; не result.id. Новый отчёт имеет reviewStatus=`pending`, задача — `submitted`, но растения ещё не зарегистрированы. Coordinator принимает через POST `/reports/:reportId/review`, key:

```json
{"expectedVersion":5,"expectedReportVersion":1,"decision":"accepted","comment":"Количество и фактические позиции проверены"}
```

Ответ 200 `{data:{report,task,plants,careTasks,warnings}}`. Только после принятия task=`verified`, report.reviewStatus=`accepted`, создаются растения и care drafts. Для существенного отклонения геометрии нужно явное acceptGeometryDeviation=true после review человеком. `changes_requested` возвращает задачу в `assigned`; получить свежие версии, снова вызвать start и отправить исправленный отчёт. Atomic transaction + receipt + idempotency защищают от повторной регистрации растений.

Issue: POST `/tasks/:id/issues` с `{expectedVersion:task.version,text:'Описание препятствия',confirmedObservation?}` и key. GET `/tasks/:id/issues`. Не отправлять reason/note/photoIds; issue не закрывает задачу. Для AI draft POST `/observations/interpret` только `{taskId,text}` + key; корректный запрос сейчас получает 503 (У1 не подключён), ручная работа доступна.

Статусы: task `draft → assigned → in_progress → submitted → verified`; review с decision=`changes_requested` возвращает task в `assigned`. Report `pending|accepted|changes_requested`; Design `draft|submitted|approved|changes_requested`; Plan `draft|approved`. Не вводить `returned`, `done`, `published` или `failed` как статусы этих четырёх сущностей (у отдельной visualization есть свой enum).

## Ошибки и конкуренция

```json
{"error":{"code":"CSRF_REQUIRED","message":"Supply the session X-CSRF-Token","requestId":"<uuid>"}}
```

При валидации также есть details. Модуль примера бросает Error с `status`, `code`, `requestId`, `details`:

```js
try { await api.request('POST',path,{body,key:savedIntentKey}); }
catch (error) {
  if (error.status===401) { /* очистить UI-сессию, предложить login */ }
  else if (error.status===409) { /* перечитать объект, показать конфликт; без авто-overwrite */ }
  else if (error.status===503) { /* показать недоступность AI, оставить ручной workflow */ }
  else { /* показать message/details; requestId для диагностики */ }
}
```

| HTTP | Действие клиента |
|---|---|
| 400 VALIDATION_ERROR / INVALID_IDEMPOTENCY_KEY | Исправить DTO/обязательный key; неизвестные поля запрещены |
| 401 AUTH_REQUIRED / INVALID_CREDENTIALS | Восстановить сессию или повторить login; не подменять роль |
| 403 CSRF_REQUIRED / FORBIDDEN | Обновить CSRF через me либо показать отсутствие полномочий |
| 404 NOT_FOUND | Неверный route/ID либо объект вне scope; не пытаться обходить доступ |
| 409 VERSION_CONFLICT / другие domain conflicts | Refetch; различать task.version, draft.version, report.version, design.version/revision |
| 422 MISSING_AREA / MISSING_RATES | Запросить достоверные входные данные, не подставлять 0 |
| 429 LOGIN_RATE_LIMIT | Не повторять login циклом; серверное окно 15 минут |
| 503 INTEGRATION_UNAVAILABLE / INTEGRATION_FAILED | Нет адаптера либо неверный/просроченный ответ; это не успешный mock |

## Участник 1: реальные зависимости

Backend предоставляет **границу адаптеров**, а не готовое соединение с LLM. `src/v2/intelligence.ts` экспортирует V2Adapters:

```ts
interpretObservation(input: Readonly<Record<string, unknown>>,
                     context: Readonly<Record<string, unknown>>): unknown | Promise<unknown>
buildPlanPreview(snapshot: Readonly<Record<string, unknown>>,
                 constraints: Readonly<Record<string, unknown>>): unknown | Promise<unknown>
// Передача при создании приложения: createApp(store, {v2Adapters: adapters})
```

Текущий `src/server.ts` не устанавливает эти функции. У1 предоставляет реализацию/конфигурацию, У3 подключает после согласования. Timeout границы сейчас 1000 ms; длительный внешний вызов потребует согласованного изменения timeout/job API. Snapshot frozen/read-only, без паролей и сессий, ограничен 500 строками на коллекцию. У1 не должен писать SQL/назначения напрямую. Локальный network guard не является готовой конфигурацией внешнего провайдера.

| Задача У1 | Точный interface / ожидание backend | Что осталось |
|---|---|---|
| Интерпретация наблюдения | POST `/observations/interpret` `{taskId,text}`; адаптер получает `{text}` и `{task}`; результат `{objectId,category,extractedFacts,proposedAction?,evidenceIds,missingData,needsHumanReview:true}` | Реальный NLP/LLM, источники только из разрешённого task context; UI подтверждает draft, автоматически факты не записываются |
| Распределение/план | GET `/integration/snapshot`; POST `/plans/preview` `{constraints:{shiftDate,crewIds,notes?}}` | buildPlanPreview → proposedAssignments/unassignedTasks/warnings/metrics/method; schema экспортирована как planResult. В назначении taskId/crewId/expectedTaskVersion/scheduledStart/End/resourceIds/proposedWorkerIds. Сейчас 503 |
| Применение плана | GET `/plans/:id`; POST `/plans/:id/approve` `{expectedVersion}` | Backend уже проверяет snapshot, интервалы, ресурсы и атомарность. Предложенные люди не получают доступ до assign-workers foreman |
| Ранжирование и подбор растений V2 | `/sites/rank-preview`, `/designs/:id/recommend-plants` пока отсутствуют | У1 + У3 согласовать DTO/источники/endpoint, У2 форму. Municipal `/priorities` и `/zones/:id/analysis` не эквивалентны этим V2 контрактам |
| LLM/RAG помощник | `/assistant` сейчас local expert rules + private history | У1: retrieval corpus, источники/цитаты, provider, prompts, evaluation; У3: отдельное согласованное подключение. Нельзя назвать текущий rules ответ RAG |
| Погода | Живого weather adapter/API нет | У1: поставщик, координаты/период, freshness, ошибки/лимиты; У3 согласованное хранение/интеграция |
| Изображения дизайна | POST `/designs/:id/visualizations` `{expectedVersion,designRevision,method,seasonLabel,growthStageLabel}` + key; method=schematic →201, generated/recorded_demo →503. GET `/visualizations/:id`; POST `/visualizations/:id/review` `{expectedVersion,consistencyStatus:'accepted'|'needs_changes',comment}` + key | У1: image provider/model и provenance; У3 wiring. Фотоотчёт/схема не доказывают image generation; source-photo lifecycle отсутствует |

Схемы результатов проверяются строго; неправильные ссылки, timeout или неверный DTO дают 503 без изменения задач. Tests с внедрёнными адаптерами проверяют эту границу, но не являются тестом настоящего поставщика.

## Что считать готовностью команды

У3: текущие backend исправления, 41 тест, HTTP/restart проверки и этот handoff готовы локально. У2 и У4: внедрить перечисленные адаптации в собственных ветках, затем совместный browser E2E по ролям, включая возврат и повторную приёмку отчёта. У1: предоставить реальные адаптеры/источники. Капитан/организатор: предоставить оригинал нового ТЗ и подтвердить спорные границы; имеющийся gap-analysis — командная расшифровка.

Docker Compose v5.0.1 и config проверены; Engine не отвечает. Контейнерная проверка BLOCKED у владельца окружения. Не устанавливать Docker и не менять системные настройки без разрешения. После восстановления Engine нужен отдельный локальный compose build/start/restart с проверкой named volumes; сейчас такие действия не объявлены выполненными.
