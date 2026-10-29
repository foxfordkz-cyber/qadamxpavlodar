> Исторический отчёт до merge (checkpoint 9be77df). Актуальное объединённое состояние: [BACKEND_MERGE_VERIFICATION.md](BACKEND_MERGE_VERIFICATION.md).

# Backend municipal extension — 29.10.2026

Продолжение V2 в `feature/backend-preparation`. Backend не пересоздавался. Миграция 4 добавляет таблицы к существующей схеме; прежние API, тесты, DEMO и experimental mock сохранены. Новые изменения локальные: без commit, push, PR, merge и deploy.

## Основание и границы соответствия

V2 сверяется по сохранённым `contracts-source/03-BACKEND-AND-DATA.txt` и `05-SHARED-CONTRACT.txt`. Новое задание взято из `docs/tz-gap-analysis.md` ветки `codex/coordinator`, commit `84565293b33b57cf3648d0745327e5cc5f3f52e4`. Этот документ ссылается на официальное ТЗ версии 1.0 от 22.10.2026, но оригинал нового официального документа в доступном репозитории отсутствует. Поэтому ниже — проверка по командной расшифровке, а не подтверждение полной приёмки оригинального ТЗ.

Обновлённые frontend, fixtures и документы перенесены из указанного коммита без merge. Чистые экспертные функции команды скопированы в `src/municipal/vendor` с атрибуцией и небольшими серверными исправлениями. Это правила, не LLM, не RAG и не калиброванный ML. Существующий V2 AI adapter без поставленного провайдера по-прежнему возвращает 503.

## Реализовано

- Реальные persistent cookie sessions: исходные admin/coordinator/foreman/worker и дополнительные specialist/viewer. Specialist получает полномочия coordinator; viewer только читает municipal-модуль. Пароли scrypt, HttpOnly/SameSite, CSRF, отзыв сессий после изменения пользователя. Административный экран `/api/v1/admin` поддерживает новые роли.
- SQLite: хранение слоёв, импорта, расценок, версий, приватной истории помощника и неизменяемых расчётов с точными входами и SHA-256. Seed дополняет отсутствующие записи и сохраняет пользовательские изменения.
- Импорт GeoJSON, CSV, KML и ZIP SHP: разбор на сервере, preview, подтверждение, предупреждения, контроль доступа, транзакционный commit и защита от дублей. Слои: зоны, почвы, насаждения, город, каталог растений.
- 114 кандидатов OSM, снимок окружающих объектов и насаждений; 50 видов команды с источниками/маркировками. Данные организатора не подменяются этими наборами. Импортированные почвы пространственно присоединяются к зонам для анализа, проблем и приоритетов.
- Серверный подбор и три варианта, смета пяти статей, приживаемость, календарь ухода, экологический эффект, проблемные зоны, приоритеты и бюджетная дорожная карта. Все расчёты — экспертные оценки. Неизвестный обязательный коэффициент или площадь блокируют расчёт с 422, а не превращаются в ноль.
- Администратор меняет расценки с expectedVersion, Idempotency-Key и аудитом. Новые запросы используют текущие значения; сохранённые snapshots не переписываются.
- Настоящие PDF и XLSX: восемь разделов/листов, Unicode, источники, ограничения и hash входа. Для PDF нужен Unicode TTF; Dockerfile включает DejaVu Sans.
- HTTP-клиент frontend использует cookie/CSRF, обрабатывает реальные ошибки и не переключается на mock при недоступности сервера. Импорт выполняет preview и commit. Выбор `demo/estimate/real` явный; real означает заявленный пользователем источник, не независимую верификацию.

## Локальный запуск

Node.js 24. В двух терминалах из корня репозитория:

```powershell
cd apps/server
npm ci
npm run build
$env:DB_PATH='./data/municipal-demo.sqlite'
$env:PORT='3110'
npm run seed:v2
npm start
```

```powershell
cd apps/web
npm ci
$env:VITE_DATA_SOURCE='api'
$env:VITE_API_PROXY='http://127.0.0.1:3110'
npm run dev -- --host 127.0.0.1 --port 5180
```

Frontend: `http://127.0.0.1:5180/?source=api`. Swagger: `http://127.0.0.1:3110/api/v1/docs`. Администратор: `/api/v1/admin`.

DEMO логины `admin`, `coordinator`, `specialist`, `viewer`, `foreman1`, `foreman2`, `worker1`–`worker4`; общий **публичный тестовый**, не production пароль `DEMO-only-2026!`. Смена ролей через UI-переключатель доступна только в явно выбранном старом mock-режиме. Приложение остаётся локальным прототипом, не production-сервисом.

## API

`/api/v1/openapi.json` строится из фактического router: **90 операций**, из них 24 добавлены municipal-модулем. Старый `openapi-v2.json` — исторический snapshot; актуальная спецификация доступна с работающего сервера. CSRF обязателен на всех защищённых non-GET. Idempotency-Key обязателен у транзакционных write-операций и отмечен в Swagger; read-like POST анализа и экспорта его не требует.

| Метод / путь относительно `/api/v1` | Доступ / поведение |
|---|---|
| GET `/municipal/sites`, `/municipal/sites/:id` | admin, coordinator/specialist, viewer; кандидаты OSM и импорт |
| GET `/municipal/sites/:id/context?radius=100` | Снимок OSM, радиусы 30/50/100/200, bounded cache; Point/Polygon |
| GET `/municipal/dashboard`, `/municipal/evidence`, `/species` | Сводка и источники; импортированный каталог добавляется к видам |
| GET / PATCH `/rates` | Чтение всем municipal-ролям; изменение только admin, version + key |
| POST `/zones/:id/analysis`, `/zones/:id/variants` | `{options:{...}}`, текущие источники и coefficients |
| POST `/zones/:id/snapshots`, GET `/analysis-snapshots/:id` | Immutable input/output; сохраняет specialist/admin |
| GET `/problems`, POST `/priorities` | `{weights,budget}`; excluded содержит зоны без измеренной площади |
| GET `/layers/soils`, `/layers/greenery`, `/layers/city`, `/layers/zones` | FeatureCollection; отсутствие данных — пустой слой и пояснение |
| POST `/imports/preview` | specialist/admin; format, layer, content или features, source, dataClass |
| GET `/imports/:id`, POST `/imports/:id/commit` | Только владелец preview; acknowledgeWarnings, commit с key |
| POST `/assistant`, GET `/assistant/history` | Детерминированные правила, история только текущего пользователя |
| POST `/zones/:id/export` | `{options:{},format:"pdf"|"xlsx"}`; бинарный файл |

Оригинальные V2 routes не переименованы. В transport только чтение municipal sites/evidence/dashboard отображается на отдельный namespace. DTO старых mock-экранов `/projects`, `/brigades`, `/issues`, назначения и приёмки **ещё не совпадают** с V2 `/designs`, `/crews`, task-scoped issues и версиями отчётов. Это остаётся задачей интеграции У2/У4/У3; полный frontend workflow всех ролей готовым не объявляется.

## Импорт: ограничения, которые нужно учитывать

- 1–1000 объектов, файл UI до 5 MiB, JSON transport до 8 MB. Preview живёт час, максимум 10 незавершённых previews на аккаунт.
- GeoJSON/CSV/KML — WGS84 `[lng,lat]`; GeoJSON с иной CRS отклоняется. SHP ZIP требует один набор `.shp/.dbf/.prj`, преобразуется по PRJ, до 20 записей и 20 MiB распакованных данных. Пути с traversal, XML DTD/entities отклоняются.
- KML поддерживает Point, LineString, Polygon и отверстия; MultiGeometry/прочие расширения не реализованы. Zones: Point/Polygon/MultiPolygon; soils: Polygon/MultiPolygon, pH 0..14, salinity none/low/medium/high. Контекст MultiPolygon пока возвращает 422.
- До 500 вершин на геометрию, 10000 на пакет. Самопересечения проверяются; точная попарная проверка касаний/пересечений ограничена 150 объектами. Для большего пакета выдаётся явное предупреждение.
- Дедупликация геослоёв — по точному geometry hash в пределах слоя; это не топологическое сравнение эквивалентных контуров с другим порядком вершин. Повторный commit безопасен. Catalog — по species ID, без перезаписи существующего вида.
- Для каталога нужны id/nameRu/latin/form, evergreen/native/invasiveRisk/allergenic, frostHardiness/droughtTolerance/saltTolerance, minAreaM2; логические CSV значения true/false. Поля каталога валидируются, неизвестные поля не распространяются в расчёт.
- Точка без площади отображается на карте, но не получает фиктивную смету или бесплатное место в дорожной карте. Для расчёта импортируйте измеренный полигон.

## Проверки и воспроизведение

```powershell
cd apps/server
npm run typecheck
npm run build
npm test
node --import ./scripts/local-network-guard.mjs --import tsx scripts/demo-municipal.mjs
npm run demo:v2 -- final-v2-check
```

Муниципальное демо использует отдельную базу `data/municipal-demo/<run>/demo.sqlite`, перезапускает настоящий дочерний сервер, проверяет cookie/rates/import/hash, повтор commit/seed и integrity. Затем вызывает **реальные** `createApi` и `createHttpTransport` из frontend через HTTP, без загрузки mock-модуля. Node-обвязка только хранит cookie как браузер; это проверка клиентского адаптера, не браузерный E2E. Для независимого повтора используйте новое имя или имя по умолчанию (timestamp).

Фактические результаты текущего запуска и compliance: [MUNICIPAL_VERIFICATION.md](MUNICIPAL_VERIFICATION.md). Старые V2 отчёты относятся к 28 октября; их заявления о 32 тестах/66 операциях и отсутствии remote исторические.

## Docker

`docker compose up --build` описывает server + nginx/web, healthcheck и постоянные volumes `backend-data` / `backend-uploads`. Порт опубликован только на `127.0.0.1:8080`. Node backend запускается non-root, Compose выбирает `DATA_SOURCE=api`. Seed выполняется при старте и не сбрасывает volume.

На 29.10.2026: Compose **v5.0.1**, `docker compose config --quiet` PASS; установленный Engine не ответил на `docker info` за 20 секунд — **BLOCKED**. Сборка/запуск контейнеров и сохранность volume после контейнерного restart не проверены. Docker не устанавливался. Не удалять volumes для повторного запуска.
