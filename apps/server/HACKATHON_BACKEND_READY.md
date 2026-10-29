> Исторический документ PREPARATION 2. Актуальный Backend V2: [BACKEND_V2_HANDOFF.md](BACKEND_V2_HANDOFF.md), [compliance matrix](BACKEND_V2_COMPLIANCE.md).

# Green Pavlodar — backend ready for local integration

**27 октября 2026 · DRAFT / DEMO · только локально.** Официальное задание ожидается
28 октября. Общего утверждённого контракта нет; решения PROPOSED не являются
решениями всей команды. Исходный проект продолжен, прежние API сохранены.

## Быстрый старт

Из корня `green-pavlodar-backend`, Node.js 24.x, npm; для полного демо нужен PowerShell 7.
На этом компьютере зависимости установлены. Для чистой копии: `npm ci`.

```powershell
npm run build
npm run seed
npm start
```

Адрес: `http://127.0.0.1:3100`. Swagger: `http://127.0.0.1:3100/api-docs`.
OpenAPI: `/openapi.json`, health: `/health`. Если сервер уже запущен, используйте его;
не запускайте второй процесс на том же порту. Остановка собственного терминального
запуска — Ctrl+C. `.env` необязателен; `.env.example` без секретов.

Полный сценарий с отдельной базой, возвратом отчёта, фото и перезапуском:

```powershell
npm run build
npm run demo:integration -- -RunName my-local-demo
```

Скрипт сам выбирает свободный loopback-порт, делает seed, запускает скрытый локальный
Node-процесс, выполняет сценарий и перезапуск, затем останавливает только свой процесс.
База и результат сохраняются в `data/demo-flow/my-local-demo/`, фото — в
`uploads/demo-flow/my-local-demo/`. Повтор с тем же RunName использует прежние
Idempotency-Key и должен дать те же две ревизии/два фото/10 записей истории.
Основная `data/green-pavlodar-demo.sqlite` не участвует в этом сценарии.

## Что действительно работает

- Существующие Plant/CandidateSite/User/Task/Report, SQLite, FK/CHECK, транзакции,
  история, версии и durable idempotency. Исходный seed 30 растений / 6 участков /
  3 работника + 1 координатор / 15 задач; в основной базе сохранены прежние 16 задач.
- Swagger UI с локальными JS/CSS, без CDN и внешнего validator. Реестр маршрутов
  используется при регистрации Express и генерации OpenAPI; тест сравнивает его
  с настоящим router и валидирует HTTP-ответы по опубликованным JSON-схемам.
- Чтение детали задания с перечнем отчётов, чтение отчёта/фото/истории с проверкой доступа.
- Изолированный workflow draft → assigned → in_progress → submitted → verified,
  возврат submitted → assigned с обязательным комментарием, новые ревизии отчёта.
- Multipart JPEG/PNG/WebP, проверка сигнатуры и декодирования, предел 5 MiB,
  4096×4096 и один кадр. Перекодирование в WebP удаляет метаданные. До пяти фото
  на отчёт, случайные серверные имена, закрытое чтение, хеш-проверка сохранённых байтов.
- Отказ при неверном/слишком большом файле, очистка после ошибки транзакции;
  уборка оставшихся после crash управляемых временных/orphan-файлов старше 24 часов.
  Ссылочные и посторонние файлы уборка сохраняет. Папка uploads не раздаётся публично.
- Фильтр растений по condition и GeoJSON с [longitude, latitude]. Фильтр задач
  по createdAt за календарный день UTC+5 с исключённой верхней границей.
- Локальный CORS allowlist для frontend, same-origin Swagger и обязательный
  X-Demo-User на прикладных API.
- CSV preview: колонки, координаты, дубликаты, построчные ошибки/предупреждения;
  imported=0. Записи и совпавшие имена не перезаписываются.
- Версионированный AI snapshot, проверяемая draft-proposal, coordinator-only
  confirmation в новое экспериментальное draft-задание. Отказы AI изолированы.

Observation и EvidenceRef остаются предварительными сущностями без новых CRUD API.
Не строились UI карты, планировщик, настоящие модели или инфраструктура развёртывания.

## Что является mock

Все данные синтетические и помечены DEMO; это не городской реестр.
X-Demo-User — симуляция личности: любой локальный клиент может выбрать DEMO-роль.
AI — детерминированное правило для тестирования интерфейса, а не модель.
Модуль получает только snapshot; его результат не исполняется и не даёт прямого
доступа к SQL, назначению задач или подтверждению записей.

## Работающие endpoints

| Группа | Маршруты |
|---|---|
| Диагностика/документация | GET `/health`, `/api-docs`, `/openapi.json` |
| Карта/справочники | GET `/plants`, `/plants/geojson`, `/plants/:id`, `/candidate-sites`, `/workers` |
| Существующие задачи | GET/POST `/tasks`; GET/PATCH `/tasks/:id`; GET `/tasks/:id/history` |
| Существующие отчёты/фото | POST `/reports`; GET `/reports/:id`; POST `/reports/:id/photos`; GET `/photos/:id` |
| PROPOSED задачи | GET/POST `/experimental/tasks`; GET `/experimental/tasks/:id`; POST `/experimental/tasks/:id/transitions`; GET `/experimental/tasks/:id/history` |
| PROPOSED отчёты/фото | POST `/experimental/reports`; GET `/experimental/reports/:id`; POST `/experimental/reports/:id/photos`; GET `/experimental/photos/:id` |
| PROPOSED AI | GET `/experimental/ai/snapshot`; POST `/experimental/ai/proposals`; POST `/experimental/ai/proposals/:id/confirm` |
| PROPOSED CSV | POST `/imports/plants/preview` |

Итого 30 операций. Все записи, кроме read-only CSV preview, требуют Idempotency-Key;
конкурирующие изменения используют текущую version. CSV preview вообще не записывает данные.
Полные DTO, коды ошибок, форматы multipart и права — в работающем Swagger.

## Проверки

```powershell
npm run typecheck
npm run build
npm test
npm run smoke
npm run demo:integration -- -RunName verification-prep2
```

Исходные 11 тестов повторно проверены до изменений. Расширенный набор содержит
24 адресных теста: чужие IDs, workflow, повторения, версии, фото, rollback,
миграцию, seed, AI, CSV, GeoJSON, UTC+5, CORS, синхронизацию OpenAPI и отсутствие
внешних сетевых попыток. Фактические последние результаты: [VERIFICATION.md](VERIFICATION.md).

Стандартные команды dev/start/test/smoke включают `scripts/local-network-guard.mjs`:
внешние Node TCP/DNS и UDP блокируются, loopback и локальный IPC разрешены.
Это ограничитель Node API для подготовки, не OS sandbox и не production-защита.

## Как подключить frontend и AI

Frontend: [FRONTEND_API_HANDOFF.md](FRONTEND_API_HANDOFF.md). В `.env` указать
FRONTEND_ORIGINS для локального frontend, перезапустить сервер. Включить DEMO-выбор
координатора/работника; отдавать роли серверу через X-Demo-User. Для проверки
координатор читает детали задания, выбирает последнюю ревизию отчёта и её фото.
После действия делать refetch task/report/history. Автообновления Plant по отчёту нет.

AI: [AI_INTEGRATION_CONTRACT.md](AI_INTEGRATION_CONTRACT.md). Передавать snapshot
с его version, принимать только валидированный результат; подтверждение координатора
остаётся отдельным действием. Адаптер можно заменить через createApp options,
но реальные/платные вызовы и сетевой доступ пока не разрешены.

## BLOCKED до согласования команды

1. Официальное задание, `00-START-HERE.txt`, `05-SHARED-CONTRACT.txt` и документ участника 3.
2. Окончательные DTO/URL/statuses и миграция legacy completed; детали анализа:
   [WORKFLOW_COMPATIBILITY.md](WORKFLOW_COMPATIBILITY.md).
3. Настоящая auth, модель ролей и источник пользователей; текущая DEMO identity
   недостаточна для общего сервера.
4. Связь Plant ↔ участок и фильтрация по участку: соответствующего поля пока нет.
5. Применение verified-отчёта к состоянию растения/карте, обязательность фото,
   повторное открытие, отмена, сроки, хранение/удаление данных и аудит.
6. Реальный AI/планировщик, допустимые источники, бюджет, DTO и поведение отказов.
7. Подтверждение CSV-импорта: write endpoint отсутствует; preview ничего не импортирует.
8. Общая база, миграции следующих версий, бэкапы, восстановление и нагрузочные критерии.

SQLite-транзакции и файловая система не имеют общей атомарной фиксации: ошибки
компенсируются удалением staged-файлов, после crash возможен orphan до уборки,
а отсутствие/повреждение сохранённого фото возвращает 503. Для локального demo
проверен перезапуск процесса; отказ диска и отключение питания не моделировались.

## Сразу после получения задания

Пройти [OFFICIAL_TASK_ADAPTATION_CHECKLIST.md](OFFICIAL_TASK_ADAPTATION_CHECKLIST.md),
сопоставить требования с работающими модулями, согласовать один workflow и API,
потом адаптировать код локально с сохранением данных. До нового разрешения
пользователя сохраняются запреты публикации, общих БД и платных AI-вызовов.

**NO PUSH · NO PR · NO MERGE · NO REBASE · NO DEPLOY · NO PRODUCTION DATA.**
