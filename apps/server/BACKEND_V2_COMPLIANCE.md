# Compliance matrix — контракт V2

28 октября 2026. Источники: неизменённые копии пользовательских документов
[03-BACKEND-AND-DATA.txt](contracts-source/03-BACKEND-AND-DATA.txt) и
[05-SHARED-CONTRACT.txt](contracts-source/05-SHARED-CONTRACT.txt), SHA-256 рядом.
Проверки и реализация относятся к текущему backend, не к ещё не собранному приложению всей команды.

Владельцы: **У1** — AI/планировщик, общий контракт и интеграция; **У2** — карта,
общая оболочка, координатор и согласование; **У3** — backend/данные (этот модуль);
**У4** — бригадир/работник, общий сценарий и защита. Назначение владельца ниже —
распределение по документам, а не отправленное ему поручение.

PASS означает проверенный реализованный объём строки. PARTIAL не означает приёмку всего требования.

| ID | Реализовано | Проверено | Статус, остаток и владелец |
|---|---|---|---|
| C01, P0 | Добавочная миграция 2→3; пользователи, доступность, бригады, ресурсы, V2-реестр/участки/каталог, версии проектов, задачи, планы/snapshot, отчёты, issues, источники, аудит, фото | Сохранность 15 старых таблиц; integrity/FK; транзакционные тесты | PARTIAL: часть связей JSON-документов проверяет сервис, не SQL FK; полноценные погодные сущности и общие типы ещё не соединены. У3 + У1 |
| C02, P0 | 30 V2-объектов, 6 участков, 8 аккаунтов, 2 бригады, 12 задач, 8 каталогов, контексты и 3 состояния проекта; неизвестные/blocked проверки, короткая смена | Повтор seed сохраняет изменённое членство; demo повторяется без дублей | PARTIAL: контексты синтетические; совместная визуальная проверка Павлодара и реальные источники не выполнены. У2 + У3 |
| C03, P0 | Пароли scrypt, серверные cookie-сессии, 4 роли, CSRF, expiry/logout/revocation, login throttling | Вход/ошибка пароля, X-Demo-User не даёт вход, CSRF, logout, отключение пользователя, сохранение сессии после restart | PASS для локального DEMO. Production auth/deployment не входят в выполненную работу. У3 |
| C04, P0 | Серверные права на списки, задачи, отчёты, приватные файлы; admin не принимает работы; запрет self-review | Чужие crew/task/report/photo; неправильная роль; смена роли автора; replay после потери прав | PASS по проверенным сценариям. У3; подключение экранов — У2/У4 |
| C05, P0 | `/api/v1`, строгие входы, единые ошибки, scoped filters, OpenAPI и схемы основных DTO | Router = OpenAPI; реальные JSON-ответы тестов проходят Ajv | PARTIAL: отсутствуют rank-preview, compare, context refresh и V2 import endpoints; часть вспомогательных response DTO описана как объект. У3 + У1 |
| C06, P0 | Полный workflow, назначение бригады/людей, версии, навыки, численность, интервалы/ресурсы; group/solo submit; return comment | Запрещённые переходы/роли, чужая бригада, пересечения, возвращение/приёмка, неизменность terminal task | PASS для реализованного ручного цикла. У3 |
| C07, P0 | Private multipart; signature+decode; лимиты; серверные имена; metadata stripping; cleanup; report binding | Невалидное/большое фото, чужое чтение, сохранение после restart; прежние тесты decode/traversal/rollback сохранены | PASS для локальных report photos. Фото участка ещё не поддержано. У3 |
| C08, P0 | Отчёт, actualWorkerIds/actualPlantingItems, location, confirmedObservation, server time, приёмка/возврат; receipts и care events | Неполная посадка отклонена; принятие 2 растений/2 care drafts; condition остаётся unknown; inspect не water; rollback | PASS основного сценария; изменение утверждённого объёма после выдачи требует ручной сверки, автоматической дельты нет. У3 + У2 |
| C09, P0 | Durable idempotency, повторная проверка прав, expectedVersion задачи/черновика/отчёта, атомарные изменения | Повтор/иной payload, конкурирующие review, replay после смены бригадира, SQL-trigger rollback | PASS по интеграционным сценариям. У3 |
| C10, P0 | Два чистых hook-интерфейса: interpretObservation/buildPlanPreview; immutable snapshot, schema validation, timeout, 503 без адаптера | Отсутствие провайдера не ломает ручные операции; план тестируется внедрённой функцией | PARTIAL/BLOCKED: реальные функции У1 не поставлены; recommendations/ranking/planting/visualization brief не подключены. У1 предоставляет, У3 подключает |
| C11, P0 | Persisted PlanSnapshot, inputVersion, constraints; atomic approve; предложения людей не равны назначениям | Конфликт одной задачи откатывает весь план; stale availability →409; worker не видит proposed task | PASS серверной транзакции, PARTIAL всей интеграции: реальный алгоритм/полнота планирования остаются У1; final wiring У3 |
| C12, P1 | EvidenceRef и явная DEMO-классификация; неизвестные значения null | Provenance присутствует в fixtures и DTO | PARTIAL: нет погодного адаптера/кеша, реальных источников, единиц/атрибуции. У1 + У3 |
| C13, P1 | Прежний CSV preview сохранён и тестируется | Legacy preview не пишет и не перезаписывает данные | PARTIAL: `/api/v1/imports/preview` и commit ещё нет; перенос контракта/подтверждение импорта — У3 |
| C14, P1 | `/dashboard` считает accepted reports по reviewedAt за [from,to), empty flag; план хранит метрики с определениями | DTO/даты валидируются; транзакция review проверена | PARTIAL: отдельного целевого теста dashboard и `/plans/compare` пока нет. Метрики алгоритма/compare — У1; endpoint — У3 |
| C15, P0/P1 | Issue отдельно от completion; исходный текст, человек/время и подтверждённая структура; issues входят в planning snapshot | Issue оставляет in_progress; версии/авторство сохраняются | PARTIAL: real AI interpretation и поведение следующего алгоритма при ограничениях — У1; UI подтверждения — У4 |
| C16, P0 | Config, миграция, seed, ограничение запросов, requestId, локальный запуск, persistence | Typecheck/build, smoke, process restart, session/photo persistence, repeat seed, SQLite checks | PASS локального запуска. Production backups/load/power-loss не проверены. У3 |
| C17, P0 | 24 старых + 8 новых осмысленных тестов; HTTP/Ajv; rollback, scope, races, file limits, plan atomicity | **32/32 PASS**, smoke PASS, отдельное V2 demo PASS | PASS выполненных сценариев; не исчерпывающая формальная верификация. У3; общий E2E — У4 |
| C18, P0 | V2 Swagger, endpoint list, login/CSRF/examples, retry, seed/demo, refetch карты | Примеры соответствуют работающим входам/ответам и тестам | PASS локальной документации. Файлы готовы к передаче; сообщения участникам не отправлялись. У3 → У2/У4 |
| C19, P2 | Хеши и integrity фото | Приватность/целостность проверяются | PARTIAL: нет UI флага повторного фото, экспорта, дорожного адаптера. Отложено; У3 |
| C20, P0 | HTTP-демо с 4 ролями и 2 бригадами; реальный admin UI, сохранение после обновления/restart | Browser: login, изменение бригады, reload; HTTP: проект→приёмка, изоляция, фото | PARTIAL: сквозной E2E через общий frontend всех ролей ещё невозможен — его здесь нет. У2 + У4 + У1, поддержка У3 |
| C21, P0 | API users/crew/profile/membership/audit; локальный экран создания/изменения/отключения; history сохраняет состав | Авторизация, членство, версии, отзыв сессий; browser crew edit/reload | PARTIAL: экран работает, но ещё не перенесён на общие React-компоненты участника 2. У3 + У2 |
| C22, P0 | 8 каталогов, nullable условия/цены/нормы, EvidenceRef, stored SiteContext | Каталог/site data используются в проектном workflow | PARTIAL/BLOCKED: контуры DEMO; нет реального provider refresh/cache/расстояний/атрибуции. Доступный источник и карта — У2/У1; адаптер/хранение — У3 |
| C23, P0 | DesignProposal + planting items, human checks, draft/submitted/changes_requested/approved; immutable approved revision; выпуск работ один раз | Unknown checks/неверная роль блокируют; edit approved → revision+1; старые tasks остаются revision1 | PASS основных правил. Дельта нового проекта к уже выданному объёму блокируется до сверки. У3 + У2 |
| C24, P0/P1 | Сохраняемая schematic FeatureCollection с контекстом/посадками, revision, season/growth labels, consistency review и stale flag | После revision change схема stale; review stale →409 | PARTIAL: не реализованы фото участка, отдельные image assets и pending/failed generation lifecycle; generated/recorded_demo →503. У1 + У2 + У3 |
| C25, P0 | Group contributions/summary; actual workers/positions; общий ресурс один раз; transactional planting receipts + care drafts | Работники/техника/water conflict, partial return, repeated submit/review, injected rollback, no duplicate plants | PASS проверенного P0-сценария; несколько водоисточников на задачу и расход материалов сложнее mutex пока не поддержаны. У3 + У1 |

## Что согласовать и подключить следующим

1. **У1:** сверить V2 с официальным заданием, выпустить общие типы и реальные чистые функции.
   Подключение тестового callback в тестах не считается AI-интеграцией.
2. **У2 + У4:** использовать только `/api/v1`, cookie+CSRF, expectedVersion и устойчивый
   ключ повтора; подключить согласование, назначения, групповой черновик и refetch реестра.
3. **У2 + У3:** заменить синтетический контекст разрешённым источником, проверить
   координаты/атрибуцию/геометрию; перенести admin UI в общую оболочку.
4. **У3:** завершить missing endpoints по приоритетам официального ТЗ; добавить source-photo
   storage, import commit и сохранение новых схем общих типов после согласования.
5. **У4:** прогнать весь сценарий через собранные экраны, включая возврат, offline retry
   и повтор после обновления страницы. HTTP-тесты не заменяют этот шаг.

**NO PUSH · NO COMMIT · NO PR · NO MERGE · NO DEPLOY · NO PRODUCTION DATA.**
