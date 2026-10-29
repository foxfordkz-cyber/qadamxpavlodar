# Проверка подготовки 2 — 27 октября 2026

Все результаты ниже получены запуском команд. Предыдущие результаты не принимались
за новый прогон. Изменения локальны, ветка `feature/backend-preparation`, коммитов нет.

## Исходное состояние и сохранность

До изменений повторены typecheck, build, исходные 11 тестов (11/11) и legacy smoke
с перезапуском. Код и согласованная SQLite-копия сохранены через `node:sqlite.backup`
в `../../work/prep2-baseline-2026-10-27T12-34-07-900Z`.
Исходный репозиторий `C:\Users\user\qadamxpavlodar` не изменялся.

После миграции и повторного seed все записи в **10 исходных таблицах** сравнены
с резервной копией: users, plants, candidate_sites, tasks, reports, observations,
photos, evidence_refs, task_history, idempotency_keys. Совпадение полное.
Основная база сохранила 16 задач, включая прежний DEMO API example.
`PRAGMA user_version = 2`, `integrity_check = ok`, `foreign_key_check = []`.
Удалённых исходных файлов нет. Схема расширена добавочной миграцией.

## Окончательные команды и результаты

| Проверка | Фактический результат |
|---|---|
| `npm run typecheck` | PASS, exit 0 |
| `npm run build` | PASS, exit 0 |
| `npm test` | **24 tests, 24 pass, 0 fail, 0 skipped**, последний прогон ~9.2 s |
| `npm run smoke` | PASS: собранный legacy API, SQLite, seed, process restart, durable idempotency |
| `npm run demo:integration -- -RunName verification-prep2` | PASS |
| Та же demo-команда повторно на той же базе | PASS, те же IDs и количества, без дублей |
| `npm run seed` на основной базе после миграции | PASS: 30 растений, 6 участков, 4 пользователя, 16 задач |
| Основной `npm start` | Финальная сборка запущена на 127.0.0.1:3100 |
| Swagger в браузере | Операции и схемы отрисованы, Try it out → GET /health → HTTP 200 и database=ok |
| Сравнение старых данных с backup | PASS, все 10 исходных таблиц совпали |
| SQLite integrity / FK | `ok` / ошибок нет |

Скриншот фактического browser-запроса: [swagger-health.png](../swagger-health.png).
Swagger UI использует локальные JS/CSS; validatorUrl=null, CDN не используется.

## Что проверяют 24 теста

Исходные 11 сценариев сохранены: health, справочники/identity, пагинация/JSON/лимиты,
роли/чужие task и report IDs, создание/идемпотентность, статусы/версии/история,
конкурирующие изменения, откат report-транзакции, повтор seed, ограничения SQLite,
Host/Origin/непредусмотренные uploads, локальная конфигурация.

Добавлены 13 адресных сценариев:

1. Фактический Express router равен OpenAPI inventory; HTTP JSON-ответы соответствуют
   опубликованным схемам. Документировано 30 операций; статические assets и
   автоматически обслуживаемые HEAD/OPTIONS не являются отдельными JSON API.
2. Experimental return/rework/verify: все переходы и обязательный комментарий,
   сохранение обеих ревизий, чтение их через детали задания, legacy-таблицы не меняются.
3. Два конкурирующих review с одной version: один 200, второй 409; replay и конфликт payload.
4. JPEG/PNG/WebP фактически декодируются, EXIF удаляется, имена с ../ игнорируются,
   приватное чтение, отказ чужому worker/анониму, replay фото и запрет фото после review.
5. SVG, повреждённый PNG, файл >5 MiB и ширина >4096 отвергаются, файлов/метаданных нет.
6. Ошибка history trigger при photo upload откатывает запись, version и ключ,
   staged-файлы удаляются. Orphan cleanup сохраняет ссылки и посторонние файлы;
   повреждение сохранённого файла обнаруживается и даёт 503.
7. CORS preflight локального frontend и same-origin Swagger разрешены;
   внешний Origin запрещён.
8. CSV: колонки, координаты, дубликаты, сохранение исходных данных, запрет worker.
9. GeoJSON [longitude,latitude] и точные границы суток UTC+5, включая високосную дату.
10. Детерминированные AI draft-proposals; только координатор создаёт новый
    experimental draft после confirmation; stale snapshot отклоняется.
11. Исключение/таймаут AI, extra executeSql и неизвестная цель не меняют задачи
    и не ломают health/обычный API.
12. Миграция v1 → v2, повтор открытия/seed и сохранение локальной пользовательской записи.
13. В сценариях приложения нет внешних сетевых попыток. Затем намеренные внешние
    TCP/DNS-попытки блокируются Node guard до установления соединения.

Проверка response schemas использует Ajv для типов, структуры, обязательных полей,
ограничений и pattern; отдельные timezone-тесты проверяют временные границы.
Настоящая production-auth, нагрузка, отключение питания и отказ диска не тестировались.

## Результат полного PowerShell-демо

`data/demo-flow/verification-prep2/result.json`:

```json
{
  "mode": "DEMO",
  "contract": "PROPOSED",
  "taskId": "8811e0bf-2e4d-414a-8d0b-caa34d5d3b1f",
  "status": "verified",
  "version": 10,
  "historyEntries": 10,
  "reportRevisions": 2,
  "privatePhotos": 2,
  "legacyTasks": 15,
  "restart": "PASS",
  "repeatSeed": "PASS",
  "photoReplay": "PASS"
}
```

Сценарий: draft → assign → start → report1 → photo1 → return с комментарием →
start → report2 → photo2 → verify → чтение истории → остановка процесса →
новый процесс → чтение task/report/history/photo → SHA-256 скачанного фото →
повтор загрузки с прежним ключом → повтор seed. Чужому worker фото недоступно.
Повтор полного сценария на той же базе дал те же результаты; новая история/фото
не добавились. Скрипт завершил свои серверные процессы, оставив базу, фото и логи.

## Встреченные ошибки и исправления

- Промежуточный typecheck выявил тип SQL id и типов входа CSV; исправлены.
- При уточнении JSON Schema oneOf потребовалось сохранить типизированную основу
  объекта Zod; окончательный typecheck/build прошёл.
- Первый network audit ошибочно относил IPC tsx к внешней сети. По установленному
  коду tsx выяснен локальный Windows pipe-префикс `\\?\pipe\`; он и `\\.\pipe\`
  разрешены. Внешние TCP/DNS и UDP остаются запрещёнными. Финальный audit прошёл.
- Строки `Local request failed ... Error` в успешных тестах ожидаемы: это искусственные
  SQLite-trigger ошибки для проверки rollback. Клиенту SQL не раскрывается.
- `.env not found. Continuing without it.` — информационное сообщение:
  используются безопасные значения конфигурации по умолчанию.

Неразрешённых ошибок выполненных проверок нет. Решения команды, которые ещё
не приняты, явно отмечены BLOCKED/PROPOSED в HACKATHON_BACKEND_READY.md.

## Файлы и зависимости

Изменены: `.env.example`, `.gitignore`, `package.json`, `package-lock.json`, README,
BACKEND_PREPARATION (отмечен историческим), BACKEND_HANDOFF, VERIFICATION,
`scripts/smoke.mjs`, `src/app.ts`, `config.ts`, `db.ts`, `schema.ts`, `server.ts`,
`service.ts`, `validation.ts`.

Добавлены документы: HACKATHON_BACKEND_READY, FRONTEND_API_HANDOFF,
AI_INTEGRATION_CONTRACT, OFFICIAL_TASK_ADAPTATION_CHECKLIST, WORKFLOW_COMPATIBILITY.
Добавлены модули: `contracts.ts`, `migrations.ts`, `experimental-workflow.ts`,
`photos.ts`, `ai-boundary.ts`, `csv-preview.ts`, `time.ts`.
Добавлены `tests/helpers.ts`, `tests/integration.test.ts`,
`scripts/demo-integration.ps1`, `make-demo-image.mjs`, `local-network-guard.mjs`
и его декларация типов.

Публичные npm-зависимости установлены с `--save-exact --ignore-scripts`, версии
зафиксированы в lockfile: multer 2.5.0, sharp 0.35.5, swagger-ui-dist 5.34.0,
csv-parse 7.0.3. Для тестов: @types/multer 2.3.0, Ajv 8.20.0, ajv-formats 3.0.1.
Базовые Node 24.21.0 / Express 5.3.0 / TypeScript 7.0.2 / SQLite 3.53.4 сохранены.
Установка публичных пакетов и чтение официальной документации происходили при
разработке; работа самого backend/demo/test не требует внешних сервисов.

## Итоговый Git

Ветка `feature/backend-preparation`, remote отсутствует, коммитов нет.
Все исходники остаются untracked, поэтому `git diff` не показывает изменения;
перечень изменений получен сравнением с локальным baseline manifest.
SQLite, uploads, dist и node_modules исключены из Git.

```text
## No commits yet on feature/backend-preparation
?? .env.example
?? .gitignore
?? AI_INTEGRATION_CONTRACT.md
?? BACKEND_HANDOFF.md
?? BACKEND_PREPARATION.md
?? FRONTEND_API_HANDOFF.md
?? HACKATHON_BACKEND_READY.md
?? OFFICIAL_TASK_ADAPTATION_CHECKLIST.md
?? README.md
?? VERIFICATION.md
?? WORKFLOW_COMPATIBILITY.md
?? package-lock.json
?? package.json
?? scripts/
?? src/
?? tests/
?? tsconfig.build.json
?? tsconfig.json
```

**NO PUSH · NO PR · NO MERGE · NO REBASE · NO DEPLOY · NO PRODUCTION DATA.**
Секреты во внешние сервисы не отправлялись. Commit не выполнялся.
