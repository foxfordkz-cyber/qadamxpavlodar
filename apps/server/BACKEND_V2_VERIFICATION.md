# Backend V2 — фактические проверки

28 октября 2026. Ветка `feature/backend-preparation`, коммитов и remote нет.
Это продолжение существующего проекта; прежний этап PREPARATION 2 не пересоздавался.

## Результаты

| Проверка | Результат |
|---|---|
| Целевой этап сессий/бригад | 2/2 PASS |
| Этап проектов/назначений | 4/4 PASS |
| Этап отчётов/посадки | 6/6 PASS |
| V2 + OpenAPI + планы | 8/8 PASS |
| Полный регрессионный набор | **32/32 PASS**, 0 fail, 0 skip; ~12.7 s |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run smoke` | PASS: прежний собранный API, seed/restart/idempotency |
| `npm run demo:v2` | PASS; два заключительных запуска exit 0 на той же базе |
| HTTP после окончательного запуска | health=ok, database=ok; OpenAPI 3.1.0, **66 операций V2** |
| Browser admin UI | PASS: server login, изменение названия бригады, reload, восстановление исходного имени |
| Browser после перезапуска backend | Сессия подтверждена; исходное имя бригады сохранено, version=3 |
| Сохранность старых данных | Все строки **15 старых таблиц** совпали с backup перед V2 |
| SQLite | schemaVersion=3, integrity=ok, foreign_key_check=[] |

Из прежних тестов изменено только ожидаемое значение `PRAGMA user_version` с 2 на 3
в тесте миграции. Остальные проверки и сценарии сохранены. `tests/backend.test.ts`
и legacy PowerShell-демо не изменялись. Проверка отсутствия внешних сетевых попыток
сохранилась; новые start/test/demo-команды также используют local-network-guard.

## Новые рискованные сценарии

1. Реальный вход, неверный пароль, отказ X-Demo-User, HttpOnly/SameSite, CSRF,
   logout, отключение аккаунта/отзыв сессии, отсутствие auth-полей в users.
2. Чужая бригада, scoped workers, запрет двух активных членств, expectedVersion,
   аудит и сохранение изменённого состава при повторном seed.
3. Unknown site checks не позволяют approve; coordinator не может заменить admin;
   draft не выпускает planting task; approved revision сохраняется после edit;
   повторное создание задач блокируется, обычный replay возвращает прежний результат.
4. Работник не получает все задачи бригады; чужие IDs и фильтры не расширяют scope;
   minWorkers/skills/чужой состав блокируют назначение; пересечения людей/техники и
   общий запас воды проверяются; начатая задача не переназначается.
5. Group report: worker добавляет свой материал, foreman отправляет единый отчёт;
   чужое фото и неподходящий/слишком большой файл отвергаются; неполная посадка
   возвращается; полная создаёт 2 Plant и 2 care drafts без смены condition на здоровое.
   Искусственная SQL-trigger ошибка откатывает все связанные записи.
   Две конкурирующие приёмки дают один успех и один 409. Replay не дублирует реестр.
6. Повтор после смены бригадира заново проверяет права. Issue не завершает задачу.
   Бывший worker, ставший coordinator, не может принять собственный отчёт.
   Принятый inspect остаётся inspect, состояние растения автоматически не улучшается.
7. Фактический V2 router равен OpenAPI inventory. Ответы всех вызовов тестового
   helper валидируются Ajv по опубликованным схемам. Устаревшая схема не проходит review.
   Отсутствующий AI/планировщик возвращает 503, ручное создание работает.
8. Plan boundary с **тестовой внедрённой функцией**, не готовым AI: конфликт второй
   задачи откатывает первую; proposedWorkerIds не дают доступа; изменение доступности
   делает snapshot устаревшим. Секреты не входят в snapshot.

## Воспроизводимое V2-демо

Сохранённый `data/v2-demo/verification-v2/result.json`:

```json
{
  "mode": "DEMO",
  "contract": "V2",
  "taskId": "f794352a-7279-4e3e-a600-3c61d3718c11",
  "reportId": "fccd92c7-8049-4635-bb2b-12374e7ea465",
  "status": "verified",
  "newPlants": 2,
  "careDrafts": 2,
  "storedPlants": 32,
  "legacyPlants": 30,
  "legacyTasks": 15,
  "restart": "PASS",
  "persistentSession": "PASS",
  "privatePhoto": "PASS",
  "idempotentReview": "PASS",
  "repeatSeed": "PASS",
  "integrity": "ok"
}
```

Основная база в этом сценарии не участвует: она сохранила **16** legacy-задач.
15 в JSON — исходный seed отдельной базы демо. Новые растения здесь синтетические,
никакие реальные пользовательские/муниципальные данные не загружались.

## Файлы и сохранность

Backup перед V2: `../../work/prep2-baseline-2026-10-28T01-02-19-522Z`.
Подробный машинный результат сравнения: [V2_VERIFICATION_STATE.json](V2_VERIFICATION_STATE.json).
Старые таблицы: users, plants, candidate_sites, tasks, reports, observations, photos,
evidence_refs, task_history, idempotency_keys, experimental_tasks, experimental_reports,
experimental_task_history, experimental_photos, ai_proposals. Удалений исходников нет.

Изменены `src/app.ts` (mount V2/CORS), `src/db.ts` (миграция 3), `package.json` (команды),
одна проверка версии миграции в `tests/integration.test.ts`, README и указатели старых handoff.
Добавлены `src/v2/*`, `src/v2-seed-cli.ts`, `tests/v2.test.ts`, `scripts/demo-v2.mjs`,
V2 handoff/compliance/verification, копии контрактов и snapshot `openapi-v2.json`.
Версии зависимостей и lockfile не менялись.

В браузерной проверке имя новой V2 DEMO-бригады было изменено и восстановлено;
две записи аудита и увеличение её version сохранены. Legacy-данные не затронуты.
Скриншот: [backend-v2-admin.png](docs/screenshots/backend-v2-admin.png).

## Исправленные ошибки и ограничения проверки

- Первый запуск целевых HTTP-тестов встретил EACCES loopback в песочнице; повтор
  с разрешением локального запуска прошёл. Несколько запросов автоматической
  проверки разрешений истекли по времени до запуска; успешные повторы выполнены.
- Исправлены TypeScript-типы и применение partial к Zod-схеме с refinements.
- Два прежних теста заметили лишнюю пустую папку v2: исправлено ленивое создание storage,
  затем полный набор прошёл 32/32 без ослабления этих assertions.
- Первый demo-flow выполнил все проверки, но завершился с unsettled await при повторной
  остановке уже завершённого процесса. Исправлен lifecycle; следующие два запуска exit 0.
- Сообщения `Local request failed ... Error` в тестах ожидаемы: это введённые ошибки
  SQLite для проверки rollback. Клиент получает sanitized error с requestId.

Не проверялись общий frontend всех ролей, production-инфраструктура, отказ диска/питания,
реальные AI/погода/карта, полный каталог агрономических правил и нагрузка.
Схема сверху — сохранённая FeatureCollection на DEMO-контексте, не готовая 3D/AI-визуализация.
Подробные остатки с владельцами: [BACKEND_V2_COMPLIANCE.md](BACKEND_V2_COMPLIANCE.md).

**NO PUSH · NO COMMIT · NO PR · NO MERGE · NO REBASE · NO DEPLOY · NO PRODUCTION DATA.**
