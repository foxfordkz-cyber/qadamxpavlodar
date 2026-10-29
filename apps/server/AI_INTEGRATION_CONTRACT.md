> Исторический документ PREPARATION 2. Актуальный Backend V2: [BACKEND_V2_HANDOFF.md](BACKEND_V2_HANDOFF.md), [compliance matrix](BACKEND_V2_COMPLIANCE.md).

# AI integration boundary — PROPOSED / DEMO

27 октября 2026. Модели и планировщик участника 1 не реализованы.
`src/ai-boundary.ts` содержит заменяемый детерминированный mock и проверяемую границу.
Платных AI calls, секретов и внешних сервисов нет.

## Вход

Координатор: `GET /experimental/ai/snapshot` → `{data:Snapshot}`.
Snapshot включает schemaVersion=`PROPOSED-v1`, mode=`DEMO`, timezone=`UTC+05:00`,
generatedAt в UTC, version и четыре массива:

- plants: id, name, latitude, longitude, condition;
- candidateSites: id, name, latitude, longitude;
- tasks / experimentalTasks: id, plantId, candidateSiteId, status, version.

Данные читаются одной транзакцией, сортируются по id. Ограничение — 500 записей
на массив. Version — SHA-256 канонического JSON этих данных и версии схемы;
generatedAt в хеш не входит. Текст отчётов, фотографии, учётные данные и
финансовые записи в снимок не включаются. Финансовой модели в прототипе вообще нет.

Программный интерфейс:

```ts
type AiAdapter = (snapshot: Readonly<Snapshot>) => Promise<unknown>;
```

Адаптер получает глубоко замороженный snapshot. Объект Store, SQL-соединение,
callback записи и пользовательские токены ему не передаются.
Адаптер — доверенный код приложения; это не песочница для исполнения чужого JavaScript.
Недоверенным считается результат модели: он не исполняется и не превращается в SQL.

## Выход и проверка

```json
{
  "label": "DEMO",
  "snapshotVersion": "<64 hex symbols from snapshot.version>",
  "reason": "DEMO first plant needing care",
  "suggestedTask": { "title": "DEMO AI: inspect demo-plant-12", "plantId": "demo-plant-12" }
}
```

Обязательны ровно эти поля: лишние поля отклоняются. Ограничены длины текста,
проверены формат version, совпадение снимка и наличие plantId в снимке.
Mock выбирает первую по строковому id запись needs_care, иначе первую запись.
При одинаковом содержимом снимка результат одинаков. Это правило для тестирования,
не агрономическая рекомендация и не настоящий AI-планировщик.

## HTTP-сценарий

1. Получить snapshot координатором.
2. `POST /experimental/ai/proposals`, JSON `{snapshotVersion}`, Idempotency-Key.
3. Backend вызывает mock с лимитом 1 секунда, проверяет результат и актуальность
   снимка. Записывает только `ai_proposals`: status=draft, version=1.
4. Координатор рассматривает proposal и отдельно вызывает
   `POST /experimental/ai/proposals/:id/confirm`, JSON `{version:1,snapshotVersion}`,
   с новым ключом действия.
5. В транзакции ещё раз проверяются текущие данные, версия и статус proposal.
   Создаётся **новое экспериментальное задание draft без исполнителя**, proposal
   становится confirmed/version=2. Ответ `{data:Proposal,task:ExperimentalTask}`.

AI самостоятельно не назначает работников, не подтверждает отчёты и не меняет
existing tasks, verified-результаты или иные подтверждённые записи. Подтверждение
координатора тоже не редактирует их — создаёт новый draft.

## Отказы и повторы

- Неправильный результат, исключение или таймаут → 503 AI_UNAVAILABLE.
- Чужой snapshotVersion/несуществующий plantId в выходе → 502 INVALID_AI_RESULT.
- Изменение данных до/во время генерации или до подтверждения → 409 SNAPSHOT_CONFLICT.
- Worker не имеет доступа к snapshot/proposal/confirm → 403.
- Ошибка не создаёт proposal/task/key и не ломает `/health`, `/tasks`, `/reports`.
- Успешные вызовы идемпотентны. Replay возвращает первоначальный ответ даже
  после подтверждения; для актуального задания использовать GET по task.id.
- Две draft-proposals могут иметь один snapshot. После подтверждения одной
  данные изменятся, вторая потребует нового снимка.

Тесты проверяют детерминизм, отказ/таймаут, неизвестный plantId, попытку передать
executeSql, неизменность legacy tasks, права и устаревший snapshot.
Стандартные команды сервера и тестов включают локальный Node-ограничитель сети:
внешние TCP/DNS и UDP блокируются, loopback и локальный IPC разрешены.
Это дополнительная проверка прототипа, а не защита от произвольного нативного кода.

## Замена mock завтра

BLOCKED до контракта: реальные input/output DTO, модель confidence/evidence,
политика персональных данных, список допустимых действий, SLA, retries,
подтверждение и сетевой доступ. Согласовать DTO с участником 1, сохранить строгую
валидацию и coordinator-only confirmation. Реальный adapter подключается через
`createApp(store,{aiAdapter})`; default остаётся mock. Сетевую интеграцию
и платные API не включать без нового явного разрешения пользователя.
