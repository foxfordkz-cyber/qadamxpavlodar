# Municipal + coordinator backend merge — 29.10.2026

Ветка `feature/backend-municipal`; сохранённый checkpoint `9be77df` объединён обычным merge с `origin/codex/coordinator` на `32fbe0d` (включая Дамиров `server/srv-03-06` на `1fa8e2f`). Перед публикацией remote обновился: вторым обычным merge включён `dc182fd696c0fb612234ef1896e980c42b8fa0e2` с survival model, care calendar и исправлением Docker listen. PR предназначен для review в `codex/coordinator`; автоматический merge PR и deploy не выполняются.

Этот документ описывает **состояние после объединения**. Предыдущие MUNICIPAL_* и FINAL_BACKEND_* отчёты описывают сохранённый этап до merge: 41 тест и 90 операций. Сейчас — **57 тестов и 100 операций API**.

## Что сохранено и объединено

- Legacy, experimental и V2 workflow, реальные сессии/CSRF, object scope, бригады/исполнители, версии дизайна, приёмка отчётов, planting receipts и replay.
- Municipal CSV/GeoJSON/KML/Shapefile ZIP с sourced preview и отдельным atomic commit; повторный импорт не создаёт дубли.
- Сохранённые calculation snapshots, импортированные почвы/каталог, история и расценки, настоящие Unicode PDF/XLSX.
- Дамировы TZ seed/геокодирование/рисование зон/справочники/отзыв submitted дизайна, V2 compatibility transport и последняя карта.
- Дамиров LLM/RAG adapter, provider fallback и ограничитель внешних hostnames. Live provider с настоящими ключами в этом этапе не вызывался.
- Docker Compose/nginx/Alpine layout/storage volume Дамира; добавлены municipal fixtures и Unicode font для экспорта.

## Разрешение конфликтов

Первый merge: 29 конфликтующих файлов. Полный список и исходные conflict-файлы сохранены в приватном backup/inventory до разрешения. Второй merge: 2 конфликта, в ReportPage сохранены серверный binary export и новая панель survival/compare, в shared plan сохранены imported soil override и новое описание синтетической модели.

| Область | Решение |
|---|---|
| db.ts и две разные migration 4 | Единая schema 5. Для существующей v4 определяется наличие TZ/municipal таблиц и транзакционно добавляется недостающая ветка. Rebuild users сохраняет FK; foreign_key_check до COMMIT. Ни одна база не reset-ится |
| Роли/auth/core/domain | Сохранены admin/coordinator/viewer/foreman/worker и specialist compatibility. Viewer читает разрешённые справочники/участки/дизайны без записи; worker catalog scoped к approved assigned revision |
| Router/OpenAPI | Явный владелец каждого общего URL: durable municipal analysis/import/rates + TZ assistant и дополнительные маршруты. Duplicate operation registration вызывает ошибку; 101 уникальная операция, статический openapi-v2.json обновлён |
| Расчёты | Runtime использует `apps/web/src/shared/analytics` через tz/shared. Soil override и запрет бесплатных проектов при нулевом бюджете перенесены в общий модуль. Старый vendor snapshot оставлен для сохранности, активные расчёты не используют его копии функций |
| Расценки/история | Сохраняются ранее записанные municipal_state либо tz_rates; общие writes обновляют canonical state и TZ history. По умолчанию новая цена estimate, real требует явного dataClass |
| Zones/import | Committed municipal зоны получают V2 mapping с сохранением неизвестных human checks. Seed по id/login не заменяет существующий viewer и его пароль. Неподтверждённый импорт не создаёт V2 объекты |
| Assistant | Сохранён TZ provider/fallback. История текущего пользователя объединяет прежние municipal и TZ записи; неизвестные обязательные расчётные входы остаются ошибкой |
| Frontend | Последняя карта, поиск, панели и адаптеры Дамира сохранены. Узкие отличия от incoming: существующая серверная загрузка/commit в ImportPage и binary экспорт в ReportPage; методы API импорта; specialist→coordinator UI mapping; два общих файла analytics |
| Docker/config | Сохранены incoming compose, nginx, production/STORAGE_ROOT/allowedHosts/network guard. Dockerfile дополнен только fixtures и font-dejavu; PDF lookup поддерживает Alpine path |
| README/gitignore | Incoming README дополнен ссылкой на этот отчёт; исключены локальные status-файлы и build cache. Файлы пользовательских данных не удалялись |

## Проверки

| Проверка | Итог |
|---|---|
| Server typecheck + build | PASS |
| Backend test suite | **58/58 PASS**, 0 skipped/failed; 41 прежний + 9 TZ + 6 LLM boundary + 2 новых merge migration; последний прогон после второго merge — 95.47 с |
| Целевые municipal/TZ/readiness | 17/17 PASS перед общим прогоном |
| Обе исходные schema v4 | 2/2 PASS: исходные rows, sessions, reports, idempotency, rates/version, viewer identity/password сохранены, reopen idempotent |
| Копия фактической пользовательской SQLite | **40 таблиц: все исходные строки неизменны**, v4→v5, integrity=ok, foreign_key_check=[]; исходный файл не изменён этой проверкой |
| Frontend typecheck + build | PASS; Vite предупреждает о чанках >500 kB |
| Frontend survival/care/zones checks | PASS: synthetic survival n=12000/holdout=2400; care calendar, validation, roles/replay; 7 drawn-zone checks. Метрики синтетической модели не являются полевой валидацией |
| Реальный frontend HTTP | PASS: текущие createApi + createV2CompatTransport + createHttpTransport, без mock-response; вместе с team-client 32 запроса |
| Municipal restart/import/snapshot | PASS: persisted cookie/rates/import/snapshot/hash, repeat seed/repeated import, SQLite integrity |
| V2 HTTP + restart | PASS: design approval → crew → workers → private photo → contribution → report → acceptance; report/session/photo/replay сохранены; 2 растения + 2 care drafts, registry=32 (30 прежних) |
| Swagger | 101 операция; runtime inventory и схемы проверены; OpenAPI snapshot обновлён |
| Docker Compose | v5.0.1, config --quiet PASS |
| Docker Engine | **BLOCKED**, docker info не ответил за 20 секунд; только собственный probe завершён |
| Container build/start/restart | NOT RUN; Compose syntax не считается доказательством контейнерного запуска |
| Реальный LLM provider | NOT RUN; 6 тестов используют управляемый локальный HTTP provider для boundary/fallback. Наличие адаптера не означает проверку настоящего ключа/поставщика |
| Browser E2E | Не выполнялся в этом этапе; HTTP API и TS build не подменяют DOM/E2E |

Прогоны сохраняются локально под ignored `data/`:

- `integration-readiness/merge-tests-final.txt` — последний полный набор.
- `integration-readiness/merge-targeted.txt` — 17 целевых тестов.
- `integration-readiness/recovered-database-check.json` — реальная backup copy migration.
- `municipal-demo/merged-latest-20261029/result.json` и PDF/XLSX — текущий frontend + restart после второго merge.
- `v2-demo/merged-latest-20261029/result.json` — V2 acceptance/restart после второго merge.

Повторный `seed:tz` на отдельной базе также проверен: первый запуск создал 114 зон, 49 evidence, 50 species и 27 rates; второй — 0 новых записей. Публикационный scan проверяет индекс, env/database/uploads/build paths и известные форматы секретов; это не формальный security audit.

Ожидаемые error-injection logs в тестах проверяют rollback. Первоначальные ошибки после merge были исправлены: версия schema/число операций в assertions, добавленные provenance поля в общем расчёте, тип dataClass в UI и пароль в demo-runner. Старые тесты не удалялись; сравнение всех численных результатов с общей функцией сохранено.

## Использование объединённого backend

Из apps/server: `npm run typecheck`, `npm run build`, `npm test`. `npm run seed:tz` досеивает оба модуля без перезаписи существующих аккаунтов/данных; затем `npm start`. Пароль новых DEMO аккаунтов берётся из DEMO_PASSWORD либо генерируется seed; уже сохранённые пароли не меняются. `.env` в Git не добавляется.

Повторные изолированные проверки: `npm run demo:municipal -- <новое-имя>` и `npm run demo:v2 -- <новое-имя>`. HTTP demo использует отдельные data/uploads; не направляйте его на рабочую БД.

Frontend в API режиме: текущая цепочка DataProvider → V2CompatTransport → HttpTransport. Прямой старый createApi(HttpTransport) не выполняет преобразования V2 DTO. Для Docker сохранён upstream default mock; для реальной интеграции явно `?source=api`.

Старый запрос imports/preview с `{format,features}` без source остаётся совместимым validation-only preview. Для сохранения — sourced file payload с dataClass, затем `/imports/:id/commit` с CSRF/key. ImportPage в API режиме использует именно durable путь.

Новый `POST /api/v1/zones/:id/care-schedule` возвращает `{data:{tasks,warnings,method:'rules'}}` и не сохраняет задания автоматически. Вход: `months` (1–12), необязательные `crewVisitsPerMonth` и `budgetKzt`. Зарегистрированные растения получают уход, зона без растений — inspection drafts. Для сохранения выбранного draft нужен обычный V2 `POST /api/v1/tasks` с CSRF и Idempotency-Key; перед отправкой убрать display-поля `id`, `objectName`, `dataClass`, `estimatedCostKzt`. Проверены роли viewer/coordinator/worker, неверный ввод, неизвестная зона, общий расчёт и создание задания без дубля.

Прогноз приживаемости первого года теперь использует общую синтетическую logistic model, последующие годы — экспертное затухание. Provenance и экспорт явно указывают отсутствие полевой калибровки. Это не результат обучения на муниципальных посадках Павлодара.

## Что остаётся до общей готовности

- Владелец среды: восстановить Docker Engine; затем проверить build/start/restart и volume. Автоустановка/системные изменения не выполнялись.
- Участники 2/4: совместный браузерный прогон после review; полная совместимость worker gateway ещё не объявлена проверенной.
- Участник AI: проверить разрешённые реальные provider credentials и качество ответов. Планирование/interpretation V2 adapters, live weather и generated images остаются отдельными зависимостями, не заменены assistant endpoint.
- Капитан/организатор: оригинал официального ТЗ по-прежнему нужен для формальной проверки соответствия; командные docs не названы оригиналом.
- Перед слиянием Draft PR: review migration strategy, shared calculations и API ownership. Общую ветку/PR автоматически не сливать.
