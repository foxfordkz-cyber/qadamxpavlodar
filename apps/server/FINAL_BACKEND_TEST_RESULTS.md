# Final backend test results — 29.10.2026

Рабочая ветка `feature/backend-preparation`. Backend продолжен поверх существующего V2/municipal; исходный HEAD `9c3e73437d99996d03a6e1c27e985a56653cd678`. Commit/push/PR/merge/deploy в этом этапе не выполнялись. Это отчёт о локальном интеграционном этапе, не сертификат полного соответствия отсутствующему оригиналу нового ТЗ.

## Выполненные проверки

| Проверка | Результат | Доказательство / граница |
|---|---|---|
| `npm run typecheck` | PASS, exit 0 | Последняя проверка после изменений backend и добавления тестов |
| `npm run build` | PASS, exit 0 | TypeScript → dist; HTTP demo запускает именно dist/server.js |
| `npm test` | **41/41 PASS**, fail=0, skipped=0, cancelled=0 | 41060.8049 ms; все прежние 37 + 4 новых; `data/integration-readiness/backend-tests.txt` |
| Целевые readiness tests | 4/4 PASS | Затем включены в полный набор; тест worker write в полном наборе проверяет valid DTO →403 |
| OpenAPI | PASS, **90 операций** | Runtime router совпадает со спецификацией; обязательность ключа и новых query подтверждена |
| Реальный frontend API/transport | PASS, 24 запроса | Импортируются настоящие `apps/web/src/shared/api/api.ts` и `transport.ts`; mock-модуль не загружается |
| Пример team-client | PASS, ещё 7 запросов | login, чтение, CSRF POST, snapshot, pagination, logout, 401; всего 31 запрос в frontendRequests |
| JSON примеры handoff | PASS | Все 5 JSON blocks разбираются; 4 mutation DTO и login проверены фактическими runtime schemas, placeholder фото заменён допустимым ID |
| Несовместимые клиентские запросы | 15/15 ожидаемых отказов | Реальные 400/404 + код; отдельная проверка отсутствующего CSRF=403. Эти negative tests подтверждают блокеры, не полную готовность UI |
| Municipal process restart | PASS | Новый процесс с той же БД: cookie, import, rates, inputHash, сохранённый snapshot |
| Повторный import / seed | PASS | Replay того же commit с тем же и новым ключом; повторный файл invalid duplicate; ровно одна добавленная запись; повторный seed сохраняет legacy/V2 |
| Полный V2 workflow через HTTP | PASS | Design → submit → admin approval → tasks → crew → workers → start → private photo → contribution → final report → acceptance |
| V2 process restart | PASS | Сессия, verified task, **принятый report сравнивается полностью**, фото и replay review сохранены |
| Посадка без дублей | PASS | 2 новых растения, 2 care drafts, registry 32=30 прежних+2; planting receipts ровно 2 после replay/restart/reseed |
| SQLite | PASS | integrity_check=ok, foreign_key_check=[], legacy 30 plants/15 tasks сохранены |
| PDF/XLSX | PASS HTTP и автоматические тесты | Настоящие PDF/XLSX сохранены; municipal tests проверяют структуру/Unicode/provenance. Новый визуальный просмотр PDF в этом этапе не проводился |
| Локальный стенд 3110/5180 после обновления backend | PASS HTTP | health/database=ok; frontend HTTP 200; municipal zones=115; новый date/objectId filter=200; Swagger=90; logout=true |
| React-файлы | Без изменений этого этапа | SHA-256 baseline всех 79 файлов apps/web/src; прежние незакоммиченные изменения сохранены |
| Docker Compose | PASS | v5.0.1; `docker compose config --quiet` exit 0 |
| Docker Engine | **BLOCKED** | `docker info` не завершился за 20 s; завершён только собственный CLI probe. Не устанавливался, системные настройки не менялись |
| Container build/start/restart | **NOT RUN / BLOCKED** | Нельзя вывести работоспособность контейнеров и volumes из валидного YAML |
| Browser E2E всего приложения | **NOT RUN в этом этапе** | HTTP transport тест не равен браузерному E2E; чужие компоненты не изменялись |

`Local request failed ... Error` внутри общего test log — ожидаемые проверки rollback/error injection, не упавшие тесты. Node может выводить ExperimentalWarning для встроенного SQLite; итог runner — 0 failures.

## Покрытие и внесённые изменения

| Группа | Число | Что проверяется |
|---|---:|---|
| Прежняя подготовка | 24 | Старые API/данные, CSV, фото/декодирование, idempotency, миграция, UTC+5, CORS, изолированный experimental workflow и AI mock boundary |
| V2 | 8 | Настоящие сессии/CSRF/revocation, бригады, версии дизайна/admin approval, интервалы/люди/resources/scope, групповая посадка/возврат/приёмка/rollback, schematics, planning adapter boundary |
| Municipal | 5 | Роли, imports/форматы/hostile inputs/атомарность, расчёты/нормы/snapshots/история, настоящие PDF/XLSX |
| Новые integration readiness | 4 | objectId/date/scope; scoped worker catalog и immutable approved revision; effective roles/OpenAPI/503; фактические несовместимые клиентские DTO/пути |

Новые изменения production-кода ограничены четырьмя файлами `src/v2/`:

1. `tasks.ts`: фильтры objectId/date с границами UTC+5 и прежним scope.
2. `domain-routes.ts`: worker может читать только виды из approved revisions доступных назначенных задач; foreign/new draft catalog не раскрывается; запись запрещена. Query metadata для задач и справочников.
3. `intelligence.ts`: snapshot использует effective specialist/viewer roles; описание обязательного Idempotency-Key для двух существующих adapter endpoints.
4. `router.ts`: query-параметры публикуются в OpenAPI.

Дополнены `scripts/demo-municipal.mjs` (durable calculation snapshot + реальный team-client) и `scripts/demo-v2.mjs` (durable accepted report). Добавлены `tests/integration-readiness.test.ts`, `examples/team-client.mjs` и три итоговых документа. Прежние backend-тесты/DEMO записи не удалялись. Счётчик endpoint не увеличен искусственными alias.

## Артефакты и повторение

Локальные machine-readable результаты намеренно исключены из Git вместе с data/SQLite/фото:

- `data/integration-readiness/backend-tests.txt` — полный результат 41 теста.
- `data/integration-readiness/http-contract-probes.json` — 15 реальных несовместимых запросов, status и code.
- `data/municipal-demo/readiness-20261029/result.json` — restart/import/seed/calculation/frontend/helper результаты.
- `data/municipal-demo/readiness-20261029/openapi.json` — спецификация 90 операций.
- `data/municipal-demo/readiness-20261029/example-report.pdf`, `.xlsx` — новые реальные экспорты.
- `data/v2-demo/readiness-20261029/result.json` — accepted report, plant receipts, фото, replay/restart/seed.
- `data/integration-readiness/review-state.json` — финальные Git/scope/secret-pattern проверки.

Повторить из `apps/server` (Node 24; новое имя run, чтобы не использовать изменённую demo DB предыдущего прогона):

```powershell
npm run typecheck
npm run build
npm test
node --import ./scripts/local-network-guard.mjs --import tsx --test tests/integration-readiness.test.ts
$run = 'check-' + (Get-Date -Format 'yyyyMMddHHmmss')
node --import ./scripts/local-network-guard.mjs --import tsx scripts/demo-municipal.mjs $run
npm run demo:v2 -- $run
```

Оба demo runner запускают отдельный реальный процесс, останавливают/запускают его повторно и закрывают свой процесс в finally. Используют отдельные локальные data/uploads subdirectories; существующая пользовательская база не очищается. DEMO fixtures и синтетическое фото — тестовые входные данные, ответы API не подменяются. V2 adapter tests с test callback не доказывают подключение внешнего AI.

## Браузерная интеграция и границы заявлений

В предыдущем `MUNICIPAL_VERIFICATION.md` зафиксированы browser login specialist, реальные 114 OSM записей и commit одного DEMO CSV; затем браузерный доступ был отклонён. В этом этапе браузер не использовался повторно и ограничения не обходились. Из текущих исходников frontend проверен настоящий HTTP transport с cookie jar и CSRF. DOM, интерактивные роли/вкладки, worker bundle и скачивание из браузера целиком не проверены.

На локальном стенде backend 3110 перезапущен с последней сборкой и той же municipal-demo.sqlite, frontend 5180 отвечает. После перезапуска зон по-прежнему 115, login/filter/logout успешны. Это проверка сохранения текущей базы и доступности HTTP, не подтверждение несовместимых React workflow. Frontend build этого этапа не повторялся, исходники не менялись; прежний PASS относится к предыдущему отчёту.

## Оставшиеся блокеры и ответственные

| Блокер | Владелец | Следующий шаг |
|---|---|---|
| Coordinator UI использует projects/brigades и несовместимые поля задач/review | У2 | Применить точную matrix и запросы handoff в своей ветке; согласовать отсутствующие workflow |
| Worker gateway требует organizationId, смешивает task/draft versions, передаёт лишние поля | У4 | Исправить адаптер, selected approved revision, pagination, key reuse, private photo rendering |
| Municipal IDs не связаны с V2 design IDs и проверками участка | У1/У2/У3 | Согласовать явный mapping/provenance; не считать импорт землёй с разрешённой посадкой |
| LLM, RAG, live weather, generated images и настоящий planner/observation provider | У1, подключение У3 | Реализация провайдера/данных и согласованный adapter; сейчас honest 503 или явно rules/schematic |
| V2 rank-preview/compare/context refresh/recommend-plants и полный source-photo lifecycle | У1/У3 + UI У2 | Недостающий контракт/реализация отдельно; не выдавать municipal аналоги за эти функции |
| Полный browser E2E У2 + У4 | Владельцы UI / команда | После адаптации frontend и восстановления разрешённого browser-доступа пройти сценарии всех ролей |
| Docker Engine | Владелец компьютера/окружения | Восстановить доступный daemon; затем У3 проверяет compose build/start/restart и volumes. Без разрешения система не изменяется |
| Оригинал нового официального ТЗ | Капитан/организатор | Предоставить настоящий файл; доступные V2 contracts и team gap-analysis не подменяют документ |

Бизнес-сценарии backend, перечисленные в PASS, работают локально. Полная интеграция всех трёх участников и соответствие отсутствующему официальному документу **не объявлены завершёнными**.

## Git и сохранность

HEAD и ветка сохранены; staging пуст. На старте уже было **33 modified + 49 untracked файла** от предыдущего этапа. Итог: **35 modified, 54 untracked, 0 staged, 0 deleted** (`--untracked-files=all`). Полный текущий status сохранён в `data/integration-readiness/review-state.json`. Прежние React/fixture изменения присутствуют в git status, но не внесены этим этапом. Все 79 frontend source hashes совпадают с началом этого этапа.

`git diff --check` — PASS (exit 0); проверены 212 tracked + untracked non-ignored файлов: запрещённых `.env`/SQLite/uploads путей и высокоуверенных шаблонов секретов не найдено. Публичный DEMO пароль fixture намеренный. SHA-256 обеих копий contracts-source совпадает с предоставленными файлами 03/05 в Downloads. Pattern scan не является формальным security audit. Ничего не добавлено в index, не закоммичено и не опубликовано.
