# Green Pavlodar — Backend V2

28 октября 2026. Реальная локальная реализация в существующем Express/SQLite проекте.
Контракт команды V2 от 27 октября является проектным предложением, а не официальным ТЗ организаторов.
Полное соответствие всему приложению команды **не заявляется**: [матрица C01–C25](BACKEND_V2_COMPLIANCE.md).

## Запуск

Node.js 24.x. Зависимости существующего проекта сохранены; новых npm-пакетов в V2 нет.

```powershell
cd 'C:\Users\user\Documents\Codex\2026-10-27\files-pasted-by-the-user-green\outputs\green-pavlodar-backend'
npm run build
npm run seed:v2
npm start
```

- Backend: http://127.0.0.1:3100
- Администрирование: http://127.0.0.1:3100/api/v1/admin
- Swagger V2: http://127.0.0.1:3100/api/v1/docs
- Спецификация V2: http://127.0.0.1:3100/api/v1/openapi.json
- Диагностика: http://127.0.0.1:3100/health
- Прежние 30 операций и документация `/api-docs` сохранены как legacy/preparation API.

Если сервер уже работает на порту 3100, не запускайте второй. `Ctrl+C` останавливает собственный запуск.
Сервер привязан к loopback; production-конфигурация отклоняется.

## Данные и совместимость

Миграция SQLite 2 → 3 добавляет таблицы `v2_*` в ту же базу. Старые 15 таблиц не переписываются.
V2 seed один раз переносит представление 30 DEMO-растений и 6 участков в новый контракт
(`lat/lng`, новые состояния, версии). Дальнейшие V2-операции работают с этим представлением.
**Legacy и V2 — отдельные API-контракты; двусторонней синхронизации записей нет.**
Новый frontend должен целиком использовать `/api/v1`, включая чтение карты после приёмки.
Старый `X-Demo-User` не даёт доступа к V2 и не изменяет его данные.

`seed:v2` сохраняет существующие данные, правки профилей/бригад и пароли; сброса базы нет.
На основной базе сохранены прежние 16 задач. В V2 добавлены 12 отдельных задач сценария,
8 аккаунтов, 2 бригады, 8 позиций каталога, 6 синтетических контекстов и 3 проекта
в состояниях draft/submitted/approved. Это явно подписанные fixtures, не реальные согласования.
Смена сценария фиксирована на **28.10.2026, UTC+5**, включая короткую смену worker4.

## Вход и сессии

Только DEMO-логины: `admin`, `coordinator`, `foreman1`, `foreman2`, `worker1`–`worker4`.
Начальный пароль каждого: **`DEMO-only-2026!`**. Это публичные локальные тестовые реквизиты.
Публиковать такой сервис нельзя. Публичной регистрации и восстановления паролей нет.

```http
POST /api/v1/auth/login
Content-Type: application/json

{"login":"coordinator","password":"DEMO-only-2026!"}
```

Ответ содержит `{data:{user,csrfToken,expiresAt,mode:"DEMO"}}` и HttpOnly cookie
`gp_v2_session`. Пароли хешируются scrypt с индивидуальной солью; в БД хранится хеш
случайного session token. Срок сессии 8 часов. Cookie имеет SameSite=Strict,
Path=/api/v1; Secure=false допустим здесь только из-за обязательного локального HTTP.
Есть ограничения попыток входа. Logout удаляет сессию; изменение пользователя
отзывает его сессии. В обычных ответах отсутствуют пароли и их хеши.

Для браузера используйте `credentials: "include"`. Все изменяющие запросы, кроме login,
требуют `X-CSRF-Token` из login/me. Для повторяемых изменений нужен `Idempotency-Key`.
Не сохраняйте cookie/token вручную в localStorage. Используйте один hostname
для frontend и backend: например `127.0.0.1` на обоих портах.

```javascript
const base = 'http://127.0.0.1:3100/api/v1';
const signed = await fetch(base + '/auth/login', {
  method: 'POST', credentials: 'include',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({login:'coordinator', password:'DEMO-only-2026!'})
}).then(r => r.json());
const csrfToken = signed.data.csrfToken;
// Сохранить ключ одной операции до успешного ответа; не генерировать заново при сетевом повторе.
const operationKey = crypto.randomUUID();
```

Локальный frontend origin перечислите в `FRONTEND_ORIGINS` `.env` и перезапустите сервер.
Например: `FRONTEND_ORIGINS=http://127.0.0.1:5173`. Wildcard origin не поддерживается.
В Swagger выполните login, скопируйте `csrfToken` в Authorize → CsrfToken;
cookie браузер отправит сам. Во внешнем браузере используйте тот же hostname.

## Рабочие API

Все пути ниже имеют префикс `/api/v1`. Успех `{data,meta?}`, ошибка
`{error:{code,message,requestId,details?}}`. Полные JSON-схемы основных DTO и входов — в Swagger.

| Область | Реализованные операции |
|---|---|
| Сессии | POST `/auth/login`, POST `/auth/logout`, GET `/auth/me` |
| Пользователи | GET/POST `/users`, PATCH `/users/:id`, GET `/users/:id/history`, GET `/workers` |
| Бригады | GET/POST `/crews`, PATCH `/crews/:id`, POST `/crews/:id/members` |
| Реестр | GET/POST `/plants`, GET/PATCH `/plants/:id`, GET `/plants/geojson`, GET `/plants/:id/care-history` |
| Участки | GET `/sites`, GET/PATCH `/sites/:id`, GET `/sites/:id/context` |
| Справочники | GET/POST `/plant-catalog`, PATCH `/plant-catalog/:id`; GET/POST `/resources`, PATCH `/resources/:id`; GET/POST `/evidence`, `/care-policies` |
| Проекты | GET/POST `/designs`, GET/PATCH `/designs/:id`, POST `/designs/:id/submit`, `/review`, `/create-tasks` |
| Назначения | GET/POST `/tasks`, GET `/tasks/:id`, GET `/tasks/:id/history`, POST `/tasks/:id/assign`, `/assign-workers`, `/start` |
| Материалы | POST `/uploads`, GET `/uploads/:id`; GET/PUT `/tasks/:id/report-draft`, POST `/tasks/:id/report-draft/contributions` |
| Отчёты | POST `/tasks/:id/reports`, GET `/reports`, GET `/reports/:id`, POST `/reports/:id/review` |
| Проблемы | GET/POST `/tasks/:id/issues` |
| Планирование | GET `/integration/snapshot`, POST `/plans/preview`, GET `/plans/:id`, POST `/plans/:id/approve` |
| Интерпретация | POST `/observations/interpret` |
| Схемы | POST `/designs/:id/visualizations`, GET `/visualizations/:id`, POST `/visualizations/:id/review` |
| Сводка | GET `/dashboard?from=<ISO>&to=<ISO>` |

`plans/preview` и `observations/interpret` по умолчанию возвращают **503 INTEGRATION_UNAVAILABLE**:
функции участника 1 не подключены. `visualizations` реализует только `method: schematic`;
generated/recorded_demo возвращают 503. Наличие маршрута не означает наличие внешнего сервиса.

Списки растений поддерживают `condition`, `limit`, `offset`; задачи — `status`, `crewId`,
`workerId`, `limit`, `offset`; отчёты — `reviewStatus`, `taskId`, `limit`, `offset`.
Максимальный limit 200. Фильтр никогда не расширяет область доступа пользователя.
Бригадир видит свои бригады; работник — только конкретно назначенные ему задачи.
Связь Plant → участок для фильтрации реестра ещё не определена общим контрактом.

## Сквозной ручной цикл

1. Координатор создаёт проект с siteId, contextVersion, plantingItems и evidenceIds.
   Неизвестное количество допустимо в draft; перед одобрением оно должно быть задано с методом.
2. Координатор отправляет `/designs/:id/submit` с expectedVersion.
3. Администратор отправляет `/review` с decision=approved/changes_requested и комментарием.
   Unknown/blocked проверки участка не позволяют одобрить посадку. Для перекрёстка
   trafficVisibility должен быть cleared. Сервер записывает проверяющего и время.
4. Координатор вызывает `/create-tasks`: expectedVersion, revision, estimatedMinutes,
   minWorkers, requiredSkills. Создаётся одна задача на весь объём проекта, без копий на каждого человека.
5. `/tasks/:id/assign`: координатор задаёт crewId, scheduledStart, scheduledEnd, resourceIds.
   assignedWorkerIds пока пуст. `/assign-workers`: свой бригадир задаёт workerIds.
6. `/start`: назначенный исполнитель или свой бригадир; повторно проверяются состав,
   навыки, смены, недоступность, занятость, общая техника и известная вода.
7. `/uploads`: multipart `file` + `taskId`. Фото не публично. Форматы JPEG/PNG/WebP,
   5 MiB, до 4096×4096, один кадр; нормализация в WebP без исходных метаданных.
8. Участник отправляет свои материалы в `/report-draft/contributions`:
   expectedVersion задачи, expectedDraftVersion черновика, note, photoIds.
   Бригадир может сохранить summary через PUT `/report-draft`.
9. Для minWorkers>1 итог `/tasks/:id/reports` отправляет свой бригадир;
   для minWorkers=1 — назначенный исполнитель. Указать актуальные версии,
   actualWorkerIds, note, photoIds и actualPlantingItems для посадки.
10. Координатор принимает `/reports/:id/review` с expectedVersion задачи,
    expectedReportVersion, decision и непустым comment. Автор не принимает свой отчёт,
    даже если после отправки его роль стала coordinator.

Пример подтверждения состава:

```json
{"expectedVersion":2,"workerIds":["demo-worker-1","demo-worker-2"]}
```

Пример фактических позиций в отчёте:

```json
{"plantingItemId":"item-1","catalogItemId":"demo-catalog-1","quantity":2,
 "geometry":{"type":"MultiPoint","coordinates":[[76.951,52.281],[76.9511,52.2811]]}}
```

Количество должно совпадать с числом явных позиций. Повторяющиеся позиции в одном отчёте
отклоняются. Полный объём сопоставляется с утверждённой revision. Неполный/избыточный
объём нельзя принять: вернуть changes_requested → assigned с комментарием.
Отклонение геометрии требует отдельного `acceptGeometryDeviation:true` и комментария.
Это решение координатора, а не автоматическое доказательство безопасности посадки.

При полной приёмке одна транзакция сохраняет report/task/history, уникальные receipts,
новые V2 Plant и черновики ухода по доступной CarePolicy. Без нормы частота не придумывается.
15 минут в создаваемом DEMO-черновике — явно предварительная оценка длительности,
не агрономическая норма. Состояние растения остаётся unknown; осмотр записывается как
inspect и не выдаётся за полив. Новая revision проекта не переписывает старые задания.
Повторная выдача работ новой revision при уже выданной старой блокируется до явной
сверки объёма; автоматическая дельта и отмена старых работ пока не реализованы.

После принятия frontend заново читает task/report, `/plants` или `/plants/geojson`
и историю ухода. Старый `/plants` не содержит V2-посадку.

## Повторы и ошибки

При потере ответа повторять **тот же путь, тело и Idempotency-Key**. Успешный replay имеет
`Idempotency-Replayed: true`. Новый payload с прежним ключом → 409. Права проверяются
заново перед replay. Для исправления после 409 перечитать объект и использовать новую
expectedVersion и новый ключ. Версии задачи и группового черновика независимы.

```json
{"error":{"code":"VERSION_CONFLICT","message":"Read the latest version and retry with a new key","requestId":"<server UUID>"}}
```

Основные коды: AUTH_REQUIRED 401, FORBIDDEN/CSRF_REQUIRED 403, NOT_FOUND 404,
VERSION_CONFLICT/IDEMPOTENCY_CONFLICT/INCOMPLETE_PLANTING/RESOURCE_OVERLAP/SNAPSHOT_STALE 409,
ошибки ввода 400, слишком большой файл 413, неподдерживаемое изображение 415,
LOGIN_RATE_LIMIT 429, неподключённая интеграция 503. Стек и SQL клиенту не выдаются.

## Подключение участника 1

`createApp(store,{v2Adapters:{interpretObservation,buildPlanPreview}})` — чистые функции
из `src/v2/intelligence.ts`. Они получают замороженные plain snapshots без SQL, сессий
и паролей. Выход проверяется Zod; timeout 1 секунда. Таймаут ограничивает ожидание,
но не прерывает произвольный доверенный JS-код адаптера: его внутренние запросы тоже
должны иметь отмену. Это граница модулей, не sandbox для злонамеренного JavaScript.

Plan preview хранит exact inputSnapshot, inputVersion, constraints, assignments,
unassignedTasks, warnings и определения metrics. Утверждение проверяет неизменность
задач, профилей, состава и ресурсов; все назначения применяются транзакционно.
proposedWorkerIds не дают доступа и не становятся assignedWorkerIds до действия бригадира.
buildRecommendations, rankSites, recommendPlanting, comparePlans и генератор изображений
пока не подключены. Прежний experimental AI mock остаётся только подготовительным mock.

## Проверки, демонстрация и восстановление

```powershell
npm run typecheck
npm run build
npm test
npm run smoke
npm run demo:v2
```

Полное V2-демо запускает собственный скрытый Node-процесс на свободном loopback-порту,
входит четырьмя ролями, проходит проект → одобрение → бригада → исполнители → фото →
отчёт → приёмка, перезапускает сервер, проверяет сохранённую сессию, фото и replay.
Оно использует `data/v2-demo/verification-v2/demo.sqlite` и отдельную папку uploads.
Результат — `data/v2-demo/verification-v2/result.json`; сервер демо останавливается.
Повтор команды не создаёт дубли. Для новой независимой демонстрации:

```powershell
npm run demo:v2 -- another-demo
```

Ничего не удалять для восстановления: проверить /health, перезапустить собственный
сервер, снова выполнить ту же demo-команду. Для новой сценарной базы выбрать новый
RunName. SQLite и фото должны восстанавливаться согласованно; при повреждении файлов
возвращается 503. Отказ питания/диска и production-нагрузка не моделировались.
Схема БД старше/младше поддерживаемой отклоняется без автоматического сброса.

Фактический отчёт: [BACKEND_V2_VERIFICATION.md](BACKEND_V2_VERIFICATION.md).
Не требуется сеть: старт/тесты/демо включают прежний local-network-guard.

**NO PUSH · NO COMMIT · NO PR · NO MERGE · NO DEPLOY · NO PRODUCTION DATA.**
