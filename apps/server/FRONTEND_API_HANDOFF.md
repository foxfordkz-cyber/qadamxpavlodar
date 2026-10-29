> Исторический документ PREPARATION 2. Актуальный Backend V2: [BACKEND_V2_HANDOFF.md](BACKEND_V2_HANDOFF.md), [compliance matrix](BACKEND_V2_COMPLIANCE.md).

# Frontend API handoff — DRAFT / DEMO

27 октября 2026. Общий контракт отсутствует. Описанные ниже маршруты **работают**;
экспериментальные правила помечены PROPOSED и требуют согласования.
Примеры JSON показывают формат; UUID и время в примерах условные. Живые ID берите из ответов API.

## Подключение

Backend: `http://127.0.0.1:3100`. Swagger: `/api-docs`. Машинный контракт: `/openapi.json`.
В Swagger нажать Authorize и указать `demo-coordinator-1` либо `demo-worker-1`.
Это симуляция личности, а не вход в аккаунт. Любой локальный клиент может
подставить DEMO-роль; настоящая auth — BLOCKED до общего контракта.

Для Vite на порту 5173 добавить в локальный `.env`:

```dotenv
FRONTEND_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Перезапустить backend. Существующий `.env` не перезаписывать.
Разрешены только указанные локальные HTTP origins; wildcard и внешние origins
не поддерживаются. Same-origin Swagger работает без этой настройки.
Preflight поддерживает GET/POST/PATCH и заголовки Content-Type, X-Demo-User, Idempotency-Key.
Cookie/credentials не нужны. Доступ к серверу ограничен loopback.

```js
const API = 'http://127.0.0.1:3100';
const identity = { 'X-Demo-User': 'demo-coordinator-1' };
const response = await fetch(`${API}/plants?limit=50&offset=0`, { headers: identity });
const result = await response.json();
if (!response.ok) throw result.error;
```

## Карта и фильтры

`GET /plants` поддерживает `condition=good|needs_care|unknown`, `limit` 1–100,
`offset` 0–100000. Значения по умолчанию: 50/0, сортировка по строковому id.
`GET /plants/:id` возвращает одну запись. Координаты — отдельные `latitude`, `longitude`.

```json
{
  "data": {
    "id": "demo-plant-1", "name": "DEMO Растение 1", "species": "DEMO Тополь",
    "latitude": 52.2702, "longitude": 76.9402, "condition": "good", "isDemo": true
  }
}
```

Для GeoJSON: `GET /plants/geojson?condition=needs_care&limit=100&offset=0`.
Порядок координат **[longitude, latitude]**. GeoJSON тоже пагинируется: карту
нужно наполнять всеми нужными страницами, пока `features.length < limit`.
Для обычных списков то же правило с `data.length`.

```json
{
  "type": "FeatureCollection",
  "pagination": { "limit": 1, "offset": 0 },
  "features": [{
    "type": "Feature", "id": "demo-plant-1",
    "geometry": { "type": "Point", "coordinates": [76.9402, 52.2702] },
    "properties": { "id": "demo-plant-1", "name": "DEMO Растение 1", "species": "DEMO Тополь", "condition": "good", "isDemo": true }
  }]
}
```

Участки: `GET /candidate-sites` — `{data: [...], pagination: {...}}`, координаты
в том же формате отдельных полей. **BLOCKED:** фильтр растения по участку:
в исходной схеме нет Plant.siteId. Он не придуман; `siteId` сейчас даёт 400.
Нет геопоиска, bbox или муниципального реестра.

## Существующий workflow

`GET /workers` — только координатор. `POST /tasks` создаёт сразу назначенное
задание: `{title, assignedToId, plantId}` или `{title, assignedToId, candidateSiteId}`.
Ответ 201: `{data: Task}`, статус pending, версия 1.
`PATCH /tasks/:id` с `{version:1,status:"in_progress"}` начинает работу.
Координатор может изменить title, переназначить pending или отменить задание.
`POST /reports` с `{taskId,version:2,notes}` завершает его, ответ `{data:Report,task:Task}`.
Координаторского подтверждения в этом варианте нет.

`GET /tasks` фильтрует чужие задания для worker. `GET /tasks/:id` возвращает
`{data:Task,reports:Report[]}`. `GET /tasks/:id/history` — `{data:History[]}`.
`GET /reports/:id` — `{data:Report,photos:Photo[]}`. Доступ проверяется на сервере.

## PROPOSED: назначение, ревизии и проверка отчёта

Все действия ниже — `/experimental`, отдельные таблицы. Для POST обязателен
уникальный ключ действия `Idempotency-Key`; JSON отправлять как application/json.

| Шаг | Маршрут и тело | Кто / результат |
|---|---|---|
| Создать | `POST /experimental/tasks` — `{"title":"DEMO Осмотр","plantId":"demo-plant-1"}` | Координатор → draft, v1 |
| Назначить | `POST /experimental/tasks/{id}/transitions` — `{"action":"assign","version":1,"assignedToId":"demo-worker-1"}` | Координатор → assigned, v2 |
| Начать | тот же transitions — `{"action":"start","version":2}` | Исполнитель → in_progress, v3 |
| Отправить отчёт | `POST /experimental/reports` — `{"taskId":"<id>","version":3,"notes":"DEMO Осмотр выполнен"}` | Исполнитель → submitted, v4; новая ревизия отчёта |
| Прикрепить фото | `POST /experimental/reports/{reportId}/photos`, multipart `file` и `version=4` | Автор-исполнитель → submitted, v5 |
| Вернуть | transitions — `{"action":"return","version":5,"comment":"DEMO Уточнить наблюдение"}` | Координатор → assigned, v6; отчёт returned |
| Доработать | start v6; затем новый POST reports v7 | Исполнитель → новая ревизия submitted, v8 |
| Прикрепить второе фото | multipart, version=8 | Версия задания 9 |
| Подтвердить | transitions — `{"action":"verify","version":9,"comment":"DEMO Принято"}` | Координатор → verified, v10 |

Версии в таблице действуют только для указанного последовательного примера.
В интерфейсе всегда читать актуальную версию из ответа/GET, не вычислять её вслепую.
Без возврата можно подтвердить первую ревизию сразу после фото с version=5.

Пример ответа на создание/переход:

```json
{
  "data": {
    "id": "11111111-1111-4111-8111-111111111111", "title": "DEMO Осмотр",
    "plantId": "demo-plant-1", "candidateSiteId": null, "assignedToId": null,
    "createdById": "demo-coordinator-1", "status": "draft", "version": 1,
    "createdAt": "2026-10-27T12:00:00.000Z", "updatedAt": "2026-10-27T12:00:00.000Z", "isDemo": true
  }
}
```

POST отчёта возвращает `{data:Report,task:Task}`. Пример Report:

```json
{
  "id": "22222222-2222-4222-8222-222222222222", "taskId": "11111111-1111-4111-8111-111111111111",
  "authorId": "demo-worker-1", "notes": "DEMO Осмотр выполнен", "revision": 1,
  "status": "submitted", "reviewComment": null, "reviewedById": null, "reviewedAt": null,
  "createdAt": "2026-10-27T12:05:00.000Z", "isDemo": true
}
```

Для проверки координатор читает `GET /experimental/tasks/:id`:
ответ `{data:Task,reports:Report[]}`; reports отсортированы по revision.
Затем `GET /experimental/reports/:id` получает ревизию и метаданные её фото.
`GET /experimental/tasks/:id/history` показывает action, comment, actorId,
fromStatus, toStatus, version, changedAt и snapshot. Возврат сохраняет прошлую
ревизию; новый отчёт её не перезаписывает.

## Фото

Один multipart `file`, максимум 5 MiB и 4096×4096 пикселей, JPEG/PNG/WebP,
один кадр; до пяти фото на отчёт. Файл декодируется и перекодируется в WebP,
метаданные удаляются, имя генерируется сервером. Имя/MIME клиента не доверенные.
Для legacy `/reports/:id/photos` поля version нет; версия legacy-задания не меняется.
Для experimental version обязательна, успешная загрузка её увеличивает.

```js
const key = crypto.randomUUID(); // сохранить для повторения именно этой загрузки
const form = new FormData();
form.set('file', file);
form.set('version', String(task.version));
const res = await fetch(`${API}/experimental/reports/${report.id}/photos`, {
  method: 'POST', headers: { 'X-Demo-User': 'demo-worker-1', 'Idempotency-Key': key }, body: form
}); // Content-Type с boundary браузер сформирует сам
```

Ответ 201: `{data:Photo,task:Task}` для эксперимента, `{data:Photo}` для legacy.
Photo содержит id, reportId, mediaType=`image/webp`, byteSize, sha256, isDemo,
contentUrl вида `/experimental/photos/<id>` или `/photos/<id>`.
**contentUrl требует заголовок идентичности.** Для изображения в UI:

```js
const res = await fetch(`${API}${photo.contentUrl}`, { headers: identity });
if (!res.ok) throw (await res.json()).error;
const objectUrl = URL.createObjectURL(await res.blob());
image.src = objectUrl;
// URL.revokeObjectURL(objectUrl) после удаления/замены изображения в UI
```

Папка uploads не раздаётся статически. Прямая вставка contentUrl в `<img>`
не передаёт X-Demo-User. Чужие отчёты и фото дают 404.

## Ошибки, повторения и обновление данных

```json
{"error":{"code":"VERSION_CONFLICT","message":"Read the latest task version and retry with a new key","requestId":"33333333-3333-4333-8333-333333333333"}}
```

```json
{"error":{"code":"NOT_FOUND","message":"Report not found","requestId":"44444444-4444-4444-8444-444444444444"}}
```

```json
{"error":{"code":"VALIDATION_ERROR","message":"Invalid request","requestId":"55555555-5555-4555-8555-555555555555","details":[{"path":["comment"],"message":"Too small: expected string to have >=1 characters"}]}}
```

Показывайте понятное сообщение по `error.code`, а requestId сохраняйте для диагностики.
400 — входные данные; 401 — DEMO identity; 403 — роль/origin; 404 — нет доступа/записи;
409 — конфликт версии/перехода/ключа/снимка; 413 — лимит; 415 — файл/тип тела;
422 — ссылка/исполнитель; 429 — декодирование занято; 500/502/503 — временный сбой.

После сетевого сбоя повторяйте **те же** тело, файл, пользователя, метод, путь и ключ.
Для фото хешируется исходный файл, имя файла не участвует. Другой payload с тем же
ключом даёт IDEMPOTENCY_CONFLICT. Успешный replay может содержать старую версию —
он воспроизводит исходный ответ. После ответа перечитайте деталь задания.
При VERSION_CONFLICT сначала GET, затем решение пользователя и новый ключ.
Не повторять все 4xx автоматически. Для 429/5xx — ограниченные повторы с задержкой.

После verify/return обновить `/experimental/tasks/:id`, `/experimental/reports/:id`,
`/experimental/tasks/:id/history` и список задач. Растение автоматически не меняется:
применение результатов отчёта к состоянию карты — BLOCKED до общего контракта.
WebSocket/SSE пока нет; используется явный refetch.

Даты ответа — UTC ISO 8601. `GET /tasks?date=2026-10-27` и аналогичный experimental
фильтруют **createdAt** по UTC+5: `[2026-10-26T19:00:00Z, 2026-10-27T19:00:00Z)`.
Это не фильтр срока выполнения — dueAt пока не существует.

## CSV preview — PROPOSED

`POST /imports/plants/preview` от координатора, JSON `{csv:"..."}`.
Колонки ровно `id,name,species,latitude,longitude,condition`; до 200 строк,
20 000 символов CSV и общий лимит JSON 32 KiB. Возвращаются rows с line, raw,
data, valid, errors, warnings и counts `{total,valid,invalid}`. Дубликаты ID,
существующие ID и неверные координаты отклоняются; совпавшее имя предупреждает.
`previewOnly:true`, `imported:0`. Ключ идемпотентности не нужен: записей нет.
Endpoint подтверждения импорта отсутствует; его нельзя показывать как готовую функцию.
