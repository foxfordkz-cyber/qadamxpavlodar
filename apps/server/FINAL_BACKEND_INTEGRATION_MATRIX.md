> Исторический отчёт до merge (checkpoint 9be77df). Актуальное объединённое состояние: [BACKEND_MERGE_VERIFICATION.md](BACKEND_MERGE_VERIFICATION.md).

# Final backend integration matrix — 29.10.2026

Ветка: `feature/backend-preparation`, базовый HEAD `9c3e73437d99996d03a6e1c27e985a56653cd678`. Backend продолжен, React не редактировался в этом этапе. Все пути ниже относительно `/api/v1`, если не указано иное.

## Источники и значение статусов

- Backend: текущие `src/v2`, `src/municipal`, runtime `/openapi.json` — 90 операций. Наличие route не означает готовность внешнего провайдера.
- У2: существующие `apps/web/src/shared/api/api.ts`, `transport.ts`, `types.ts` и вызывающие React-компоненты текущей рабочей копии. Transport действительно меняет некоторые URL; таблица учитывает URL **после** его преобразования.
- У4: read-only Git snapshot `origin/codex/worker-and-demo`, commit `052d9ab1f3995f1baf5837946797cac676afccf9`: `contract-v2.mjs`, `gateway.mjs`, `docs/worker/integration-example.mjs`. Это проверенный локальный remote-tracking snapshot, не утверждение о последней версии чужой ветки. Файлы не копировались поверх рабочей React-реализации.
- Подлинные пользовательские файлы V2 `03-BACKEND-AND-DATA.txt`, `05-SHARED-CONTRACT.txt` доступны в `contracts-source/` и Downloads. Они задают общий командный V2-контракт. Оригинал **нового официального ТЗ акимата** среди доступных файлов проекта/проверенных названий в Downloads не найден. `docs/tz-gap-analysis.md` — командная расшифровка; официальным документом она не считается.

`OK` — совместим проверенный API-вызов; `DTO` — route существует, но модель/поля расходятся; `404` — такого маршрута нет; `400` — текущий клиентский payload/фильтр не проходит валидацию; `503` — нет адаптера; `FIXED` — ограниченное исправление backend этого этапа. У1 — алгоритмы/AI/общий контракт, У2 — frontend координатора/карта, У3 — backend, У4 — кабинеты работника/бригадира.

## У2: точное сопоставление существующих запросов

| Клиентский метод / текущий HTTP | Реальный backend | Поля, ответ, статус; действие и владелец |
|---|---|---|
| `login`, `me`: POST `/auth/login`, GET `/auth/me` | Те же routes | OK: raw `data={user,csrfToken,...}`; текущий transport сохраняет CSRF, разворачивает user и отображает specialist как coordinator только в UI. Не отправлять эту UI-роль как полномочие. У2 |
| `logout`: POST `/auth/logout` | `{}` → `data:{loggedOut:true}` | OK по выполнению, TS ожидает null — уточнить тип. Cookie отзывается сервером. У2 |
| `sites`, `site`: GET `/municipal/sites[/id]` | Municipal OSM/импорт | OK для municipal модели с `checks.*.state`. Это не V2 `/sites` с `checks.*.status`, contextId и trafficVisibility. Не смешивать ID между этими наборами. У2 |
| `patchSite`: PATCH `/municipal/sites/:id` после rewrite | PATCH `/sites/:id` для **V2 ID** | Текущий запрос 404. Даже после исправления URL `checks.*.state` → `status`, убрать неподдерживаемое `waterAvailability`; нужен comment. OSM ID не становится V2 ID после смены URL. Дизайн переноса данных согласовать У1/У2/У3; transport/форма — У2 |
| `rankPreview`: POST `/municipal/sites/rank-preview` после rewrite | V2 `/sites/rank-preview` ещё нет | 404. Rewrite ошибочно применяется к non-GET. Municipal `/priorities` — другой алгоритм/DTO, не прозрачная замена. У2 + функция У1/backend У3 |
| `plantSelection`: POST `/sites/:id/plant-selection` | Route отсутствует | 404. `/zones/:id/analysis` доступен для municipal данных, но возвращает ZoneAnalysis, а не PlantSelection. V2 `/designs/:id/recommend-plants` также не реализован. У1/У3; экран У2 |
| `species`: GET `/species` | Municipal Species[] | OK. `sp-*` ID, nameRu/latin/form/pricePerUnitKzt. Не использовать speciesId вместо V2 catalogItemId. У2 |
| `evidence`: GET `/municipal/evidence?ids=a,b` | Все municipal источники | 200; `ids` не фильтрует ответ. В V2 `/evidence` пагинация limit/offset, источники отдельные. Фильтровать полученный municipal список либо согласовать query, не считать его scoped V2 lookup. У2/У3 |
| `workers`: GET `/workers` | User[] + `profile` | 200/DTO: shiftStart/shiftEnd/capacityMinutes/skills/startLocation внутри profile, не в корне. profile может быть null; не подменять неизвестную доступность нулём. У2 |
| `tasks`: GET `/tasks` | Task[], meta pagination | OK для чтения; отображение DTO требует исправлений: brigadeId→assignedCrewId, crewIds→assignedWorkerIds, minCrew→minWorkers, projectId→approvedDesignId, projectDesignVersion→approvedDesignVersion. Единственного assigneeId нет. У2 |
| `tasks({objectId})` | Теперь GET `/tasks?objectId=...` | **FIXED У3**: фильтр добавлен, scope сохраняется. Тест: фильтрация + чужой workerId не расширяет доступ |
| `tasks({assigneeId})` | GET `/tasks?workerId=...` | Старый assigneeId →400. workerId означает вхождение в assignedWorkerIds; не назначение единственного исполнителя. status совпадает. У2 |
| `createTask`: POST `/tasks` | Manual inspect/water/weed draft | Базовый body совместим при реальных V2 objectId/evidenceIds. `projectId`/`projectDesignVersion` лишние →400. action=plant без approved design →409 APPROVED_DESIGN_REQUIRED; использовать POST `/designs/:id/create-tasks`. У2 |
| `assignTask`: POST `/tasks/:id/assign` | `{expectedVersion,crewId,scheduledStart,scheduledEnd,resourceIds?}` | Текущие brigadeId/minCrew/nullable scheduledStart →400; отсутствует scheduledEnd. Численность задаётся при создании задачи; людей выбирает foreman отдельным вызовом. У2 |
| `reports`: GET `/reports?reviewStatus&taskId` | Report[], meta | OK; нужны server version/revision и actualWorkerIds/actualPlantingItems для review. Обходить все страницы. У2 |
| `reviewReport`: POST `/reports/:id/review` | `{expectedVersion,expectedReportVersion,decision,comment,acceptGeometryDeviation?}` | `expectedTaskVersion` →400. expectedVersion — версия **задачи**, expectedReportVersion — отчёта. Ответ `{report,task,plants,careTasks,warnings}`. Приёмка — coordinator/specialist, admin не заменяет координатора. У2 |
| `upload`: GET `/uploads/:id` через JSON transport | Бинарный `image/webp` | JSON parse/bad_envelope при 200. Метаданные приходят из POST `/uploads`; GET только байты и проверка доступа. Использовать authenticated blob или same-origin `<img>`; report.photoUrl нет. У2 |
| `issues`: GET `/issues?objectId` | GET `/tasks/:id/issues` | 404 у текущего URL. Сначала отобрать доступные task IDs, затем прочитать issues; не вводить глобальный обход scope. У2 |
| `dashboard`: GET `/municipal/dashboard` | DashboardMetric[] | OK для municipal UI. V2 `/dashboard?from&to` возвращает объект acceptedReports/empty за [from,to), не массив. У2 |
| `siteContext`: GET `/municipal/sites/:id/context?radius=...` | OSM buildings/roads/entrances/crossings | OK для Point/Polygon, 30/50/100/200. MultiPolygon →422. V2 `/sites/:id/context` имеет features/sourceEvidenceIds и version, другой DTO. У2 |
| `plants`: GET `/plants` | V2 Plant[], meta | Базовые поля совместимы; получать все страницы. Координаты [lng,lat] в GeoJSON; plant.projectId/speciesId не гарантированы. У2 |
| `brigades`: GET `/brigades` | GET `/crews` | 404. Crew: id/name/foremanId/active/resourceIds/version/members. memberIds выводить из активных memberships, смены/skills — из WorkerProfile, ресурсы — из `/resources`; не придумывать общую capacity. У2 |
| `projects`, `project`: GET `/projects[/id]` | GET `/designs[/id]` | 404. title→name, designVersion→revision, items→plantingItems; season/reviews/approved/implementedAt не прямые серверные поля. Для manager GET detail включает revisions. У2 |
| `createProject`: POST `/projects` `{siteId,title,season}` | POST `/designs` | 404; даже переименование URL недостаточно: name,objective,contextVersion,plantingItems,evidenceIds обязательны. Нужны V2 site/catalog/evidence IDs. У2 |
| `saveProject`: PATCH `/projects/:id` | PATCH `/designs/:id` | items требуют catalogItemId, quantity/quantityMethod, geometry и evidenceIds; speciesId/kind/origin/conflicts не входят в PlantingItem. expectedVersion ≠ revision. У2 |
| `submitProject`: POST `/projects/:id/submit` | POST `/designs/:id/submit` | Body expectedVersion совместим после адаптации ресурса; подтверждение immutable revision не выполняется простым rename DTO. У2 |
| `withdrawProject`: POST `/projects/:id/withdraw` | Нет withdraw endpoint | 404. Не заменять на admin review с чужими правами. Изменение workflow требует согласования У1/У2/У3 |
| `reviewProject`: POST `/projects/:id/review` | POST `/designs/:id/review` | `returned`→`changes_requested`; решение admin, comment обязателен. approved сохраняется как утверждённая revision; UI-история строится из данных сервера. У2 |
| `dayPlan`: GET `/plans?date=...` | POST `/plans/preview`, GET `/plans/:id` | Старый GET →404. Нет daily wrapper `{plan,preview}`; план сохраняется по ID и точному snapshot. Реальный алгоритм не подключён →503 у корректного preview. У1/У3, UI У2 |
| `approveDayPlan`: POST `/plans/:date/approve` | POST `/plans/:planId/approve` | date вместо существующего planId →404; expectedVersion:null →400. Ответ `{plan,assignments}`, не голый DayPlan. У2 |
| `zoneAnalysis`, `zoneVariants` | POST `/zones/:id/analysis`, `/variants` | OK, `{options:{...}}`; 422 MISSING_AREA/MISSING_RATES не скрывать. Формулы — rules, не LLM. У2 |
| `problems`, `priorities` | GET `/problems`, POST `/priorities` | OK. `priorities.excluded` с причиной отсутствия площади не представлен текущим TS/UI — показать пользователю. Бюджет 0 не выделяет бесплатные проекты. У2 |
| `rates`, `patchRate` | GET/PATCH `/rates` | OK; admin-only write, expectedVersion + key. Не путать null с 0; source обязателен. У2 |
| `soilsLayer`, `greeneryLayer` | GET `/layers/soils`, `/layers/greenery` | OK; пустой soils — отсутствие импорта, не успешная загрузка реальных почв. Есть также city/zones. У2 |
| `ask`, `assistantHistory` | POST `/assistant`, GET `/assistant/history` | OK rules + private history; не маркировать LLM/RAG. При отсутствии измеренной площади/обязательных норм —422. У2/У1 |
| `importPreview`, `importFile`, `commitImport` | POST `/imports/preview`, `/imports/:id/commit` | OK, preview ID и собственный owner; explicit warning acknowledgement, key. Повторный файл duplicate; commit атомарен. У2 |
| `ReportPage.serverExport` прямой fetch | POST `/zones/:id/export` | OK, CSRF из `/auth/me`, `format:pdf|xlsx`; bytes/blob, не JSON. HTTP подтверждён, browser-download E2E в этом этапе не выполнялся. У2 |

## У4: read-only аудит существующего contract gateway

| Gateway / HTTP | Несовместимость | Требуемое действие |
|---|---|---|
| `mountWorker` требует `session.organizationId` | Auth V2 возвращает user/CSRF, organizationId отсутствует; guard не даст mount | У4: не вводить вымышленную организацию; выбрать local/user scope для черновиков, очищать UI на logout |
| `createV2Transport`, `headersFor` | JSON envelopes подходят; credentials=`same-origin` | У4/У2: общий origin через proxy, актуальный CSRF после login/me. Для прямого cross-origin нужна согласованная credentials/CORS настройка |
| `listTasks({date})` →GET `/tasks?date` | **FIXED У3**: ранее 400; сейчас date по scheduledStart, иначе dueAt, UTC+5 | У4: учитывать pagination meta и пустую дату/не назначенный срок; показанные 100 записей не весь реестр |
| `hydrate` →GET `/tasks/:id`, `/plants/:id` или `/sites/:id`, `/reports?taskId`, `/tasks/:id/report-draft` | Routes совместимы | У4: сохранять task.version и draft.version отдельно; нужен V2 объект, а не municipal site |
| `hydrate` →GET `/plant-catalog` для worker | **FIXED У3**: был 403, теперь только catalog IDs назначенной approved revision | У4: использовать displayName/botanicalName/kind, не municipal nameRu/latin/form; pagination |
| `hydrate` →GET `/designs/:id`, `designCurrent` | Для исполнителя ответ `{id,revisions:[...]}`, без top-level status/revision. Текущий `designCurrent` всегда false | У4: выбрать `revisions.find(r=>r.revision===task.approvedDesignVersion)` и проверить approved. Не требовать текущий managerial draft; backend не раскрывает его работнику |
| `hydrate` history фото/наблюдений | Нет report.photoUrl; server confirmedObservation содержит confirmedBy/At/origin, не произвольный provenance. revisionOf не хранится | У4: фото по photoIds→private bytes; серверные подтверждения показывать отдельно от клиентской AI provenance; историю строить по report.revision/id |
| `startTask` | Body `{expectedVersion}` совместим, но каждый retry генерирует новый UUID | У4: сохранить key+body для одного намерения, повторять без изменения; после успеха refetch |
| `uploadPhoto` | FormData file/taskId и key совместимы | OK. Ответ metadata id/contentUrl/mediaType/byteSize; FormData Content-Type не задавать вручную |
| `submitReport` solo | Лишние revisionOf/deviceTime →400 даже если остальное заполнено | У4: только note/photoIds/location/actualWorkerIds/actualPlantingItems/confirmedObservation + expectedVersion |
| `submitReport` contribution | Перезаписывает expectedVersion значением draftVersion; нет отдельного expectedDraftVersion; добавляет actual* и другие лишние поля | У4: `{expectedVersion:task.version,expectedDraftVersion:draft.version,note,photoIds,location?,confirmedObservation?}`. Ответ — draft с taskId/version/contributions/summary, не result.id |
| `submitReport` final | foremanChecked/contributorIds/revisionOf/deviceTime запрещены; сервер выводит автора/состав материалов сам | У4: убрать поля; actualWorkerIds обязательны; expectedDraftVersion текущий. Для посадки actualPlantingItems с Point/MultiPoint и фактическим количеством |
| Все `submitReport` ответы | Gateway читает result.id/reviewStatus, backend возвращает `data:{report,task}` | У4: брать result.report.id/reviewStatus; обновить task и его version |
| `observation(payload)` | objectId/needsHumanReview/provenance не входят в confirmedObservation; нет required `confirmed:true` | У4: после явного подтверждения человека отправить category/extractedFacts/proposedAction?/evidenceIds/missingData/confirmed:true. confirmedBy/At ставит сервер |
| `submitIssue` | reason/note/photoIds вместо text →400 | У4: `{expectedVersion,text,confirmedObservation?}`. Фото issue отдельным контрактом не поддержаны; не выдавать их за сохранённые |
| `analyzeNote` | Отправляет лишний objectId и не передаёт key →400 | У4: `{taskId,text}`, stable key. После исправления без адаптера У1 →503 INTEGRATION_UNAVAILABLE; отправка исходной заметки остаётся ручной |
| `getCrewWorkspace` | GET `/crews`, `/workers`, `/resources` доступны foreman | OK routes; profile вложенный, members — memberships, resources capacity/unit/intervals, а не UI equipment[] |
| `assignWorkers` | responsibleUserId/scheduledStart/scheduledEnd лишние →400 | У4: `{expectedVersion,workerIds}` + key. Интервал назначает coordinator через `/assign`; нет отдельного ответственного человека в P0 |

## Статусы и версии: не смешивать

| Сущность | Реальные статусы / поля | Расхождение UI |
|---|---|---|
| Task | draft → assigned → in_progress → submitted → verified; return submitted→assigned | TaskStatus совпадает; «возвращён» выводить из report.reviewStatus, не новый task status |
| Report | pending / accepted / changes_requested; report.version + revision | При review expectedVersion — task.version, expectedReportVersion — report.version |
| DesignProposal | draft / submitted / changes_requested / approved; version и revision | ProjectStatus returned отсутствует; designVersion соответствует revision, не concurrency version |
| Plan | draft / approved; id, version, inputVersion, inputSnapshot | date не является ID; утверждение не выбирает людей вместо foreman |
| Group draft | собственный version, initially 0; taskId/contributions/summary | Его version не заменяет task.version; после возврата надо перечитать оба |
| Visualization | pending/ready/failed в контракте; реализован только ready schematic + consistency unreviewed/accepted/needs_changes | generated/recorded_demo возвращают 503; 3D UI не является принятым выполнением работы |

## Исправления только backend этого этапа

1. `/tasks`: objectId и date, строгая валидация, границы UTC+5, scoped pagination; query опубликован в OpenAPI.
2. `/plant-catalog`: worker read только для назначенных approved revisions; чужие/новые черновые виды не раскрываются, изменение каталога запрещено.
3. `/integration/snapshot`: учитывает effective specialist/viewer, не выдаёт их за coordinator из внутреннего compatibility storage.
4. OpenAPI: Idempotency-Key обязателен и задокументирован у `/observations/interpret` и `/plans/preview`; обе операции и раньше требовали его в runtime. Добавлены query-параметры задач и справочников.

Новые псевдонимы `/projects`, `/brigades` и глобальный `/issues` не добавлялись: простое переименование скрыло бы отличающиеся права и DTO. Строгая валидация лишних авторских/рольных полей не ослаблялась. React и worker gateway не изменены; готовые запросы и безопасный HTTP helper — в [TEAM_BACKEND_HANDOFF.md](TEAM_BACKEND_HANDOFF.md).

## Что остаётся у У1 / backend

| Функция | Фактическое подключение | Владелец/следующий шаг |
|---|---|---|
| interpretObservation | Hook есть, провайдера нет, корректный запрос →503 | У1 передаёт чистую функцию; У3 подключает и проверяет output/reference/timeout |
| buildPlanPreview | Hook + snapshot/atomic approve есть, реального алгоритма нет →503 | У1 предоставляет функции; UI сохраняет planId; people assignment остаётся foreman |
| LLM + RAG | `/assistant` работает по правилам, не LLM | У1: retrieval/corpus/model/provenance и интерфейс; У3: server adapter и конфигурация секретов |
| Погода | Живой provider/cache/unit/expiry отсутствуют | У1/У3 согласуют источник, единицы, кеш, unknown; не подменять random/DEMO |
| Изображения | Схема сохранена, generator/source-photo lifecycle не подключены | У1: brief/provider; У3: assets/private storage/lifecycle; У2: отображение stale/source/review |
| rank-preview / compare / context refresh / recommend-plants | Не реализованы в V2 | У1/У3: недостающие функции/источник и точные DTO; не заменять municipal результатом другого формата |
| Перенос municipal zone/species в V2 design | Нет явного reviewed mapping | У1/У2/У3: определить происхождение, ID mapping и human checks; нельзя автоматом считать землю разрешённой |

Фактические результаты: [FINAL_BACKEND_TEST_RESULTS.md](FINAL_BACKEND_TEST_RESULTS.md). HTTP-probes намеренно ожидают 400/404 у несовместимых запросов; это доказательство остатка интеграции, а не успешного бизнес-сценария.
