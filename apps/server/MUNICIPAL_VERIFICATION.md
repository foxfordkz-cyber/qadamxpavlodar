> Исторический отчёт до merge (checkpoint 9be77df). Актуальное объединённое состояние: [BACKEND_MERGE_VERIFICATION.md](BACKEND_MERGE_VERIFICATION.md).

# Итог локальной проверки — 29 октября 2026, UTC+5

Рабочая ветка `feature/backend-preparation`, исходный HEAD `9c3e73437d99996d03a6e1c27e985a56653cd678`. Работа продолжена поверх V2. Новые изменения не закоммичены и не опубликованы. Push, PR, merge и deploy не выполнялись.

## Фактические результаты после последних изменений

| Проверка | Результат и границы |
|---|---|
| Backend `npm run typecheck` | PASS |
| Backend `npm run build` | PASS |
| Backend `npm test` | **37/37 PASS**, fail=0, skipped=0, 22.62 секунды; последний полный запуск после исправления площади |
| Состав набора | 24 прежних + 8 V2 + 5 municipal; существующие тесты сохранены, в старой проверке миграции ожидается schemaVersion=4 |
| Целевые municipal-тесты | 5/5 PASS; затем включены в полный набор |
| Frontend `npm run build` | PASS, включает `tsc -b`; Vite предупреждает о чанках >500 kB |
| Реальный frontend transport | PASS, 24 HTTP-запроса через исходные `createApi`/`createHttpTransport`, cookie/CSRF, без загрузки mock-модуля |
| Backend process restart | PASS: cookie-сессия, расценки, импорт и hash расчёта сохраняются |
| Повтор импорта | PASS: тот же commit с тем же/новым ключом не вставляет записи, повторный файл получает duplicate error |
| Повтор seed | PASS: пользовательская расценка, импорт, legacy и V2 таблицы сохранены |
| SQLite | schemaVersion=4, integrity_check=ok, foreign_key_check=[] |
| Полный прежний V2 HTTP-сценарий | PASS: проект → согласование → бригада → исполнители → фото → отчёт → приёмка; 2 новых растения и 2 care drafts; restart, приватное фото и replay |
| Swagger | 90 операций = фактический router; 66 прежних V2 + 24 municipal; response/error контракты и обязательность ключей проверены |
| Экспорт PDF | Настоящий PDF, 2 A4 страницы; обе отрендерены Poppler и просмотрены, кириллица читаема, наложений/обрезки не обнаружено |
| Экспорт XLSX | Настоящий ZIP/XLSX, ExcelJS повторно открывает файл; 8 листов, числовые ячейки, источники |
| npm audit backend production dependencies | 0 известных уязвимостей на момент проверки |
| Docker Compose | **PASS**: v5.0.1; `docker compose config --quiet` exit 0 |
| Docker Engine | **BLOCKED**: установлен, `docker info` не отвечает за 20 секунд; собственный CLI-процесс проверки остановлен |
| Container build/start/restart | **NOT RUN / BLOCKED** из-за Engine. Наличие compose.yml не считается успешным запуском |
| Git | Ветка сохранена, staging пуст; `git diff --check` PASS, только уведомления LF/CRLF |
| Файлы/секреты | В tracked + untracked non-ignored нет `.env`, SQLite, uploads или найденных высокоуверенных шаблонов private keys/API tokens. Публичные DEMO credentials остаются в fixtures; сканирование не является формальным аудитом секретов |

Машинные доказательства (локальные, намеренно исключены из Git вместе с data):

- `data/municipal-demo/verified-client-20261029/result.json` — restart, import replay, seed, integrity, список запросов frontend.
- `data/municipal-demo/verified-client-20261029/openapi.json` — спецификация текущего router.
- `data/municipal-demo/verified-client-20261029/example-report.pdf` и `.xlsx` — реальные экспорты.
- `data/v2-demo/final-v2-20261029/result.json` — полный прежний workflow после последних изменений.
- `LOCAL_REVIEW_STATE.json` — итог Git и проверки файлов. Команда финального повторного сканирования не меняет исходный код.

## Браузерная интеграция

Использован `http://127.0.0.1:5180/?source=api`, прокси к backend 3110. В браузере подтверждены:

1. Вход DEMO specialist через настоящий пароль и серверную сессию.
2. Интерфейс показывает «Сервер /api/v1», получает 114 кандидатов OSM и сводку из SQLite/API.
3. Выбор синтетического CSV, источник и явная маркировка demo; preview показывает 1 объект, 1 без ошибок.
4. Явное подтверждение импорта; кнопка становится «Слой сохранён». Новая запись сохранена в отдельной municipal-demo.sqlite.

После обновления сборки текущий backend на 3110 действительно остановлен и запущен снова. Контроль через HTTP: health=ok, frontend=200, зон=115, запись браузерного импорта=1, dataClass=demo. Исходная база предыдущей подготовки не сбрасывалась.

Следующий запрос скриншота был отклонён системой разрешений браузера. После отказа браузер больше не использовался. Скриншот и оставшиеся браузерные сценарии (все вкладки/экспорт/все роли) **не подтверждены**. Проверка frontend transport через настоящий HTTP дополняет этот результат, но не выдаётся за полный браузерный E2E.

## Исправления, найденные проверками

- CSRF не сохранялся в клиенте; исправлены login/me и отправка cookie/CSRF для реальных операций.
- UI импорта ещё разбирал файл только локально; API-режим отправляет оригинальное содержимое на сервер, затем делает отдельный commit.
- Импорт автоматически помечался real; теперь пользователь выбирает происхождение, значение по умолчанию demo.
- Смена specialist/viewer должна обновлять отдельное отображение роли и отзывать прежнюю сессию; добавлена проверка. Specialist учитывается также в старых object-level правах V2.
- Импортированные почвы использовались не во всех расчётах; подключены к анализу, проблемам, приоритетам и помощнику.
- Неизвестные обязательные коэффициенты блокируют вычисления. Точка без измеренной площади раньше получала нулевую смету и могла попасть в roadmap при бюджете 0. После отдельного прогона frontend-клиента исправлены 422, excluded и бюджетная проверка; весь набор повторно прошёл 37/37.
- Уточнён Swagger: Idempotency-Key обязателен у write-операций, не объявлен обязательным у read-like POST. Экспорт описан бинарными MIME.
- ExcelJS dependency override устранил выявленные audit notices; итог audit=0.

Первый запуск новых HTTP-тестов без разрешения loopback завершался EACCES; повтор в разрешённом окружении прошёл. `Local request failed ... Error` в успешных тестах ожидаем: тест намеренно вызывает SQL rollback. Ошибка первоначального demo-клиента с бюджетом 0 была реальной, исправлена; финальный сценарий exit 0.

## Матрица V2: 03-BACKEND-AND-DATA и 05-SHARED-CONTRACT

PASS относится к проверенному объёму, а не ко всему приложению команды. У1 — AI/алгоритмы/общий контракт; У2 — основной frontend/карта; У3 — backend; У4 — работник/бригадир/общий E2E. Владельцы указаны по распределению задач, сообщения им не отправлялись.

| ID | Реализовано / протестировано | Статус, остаток и владелец |
|---|---|---|
| C01 | Аддитивные миграции до 4, версии, связи, SQLite integrity/FK, rollback | PARTIAL: часть JSON-связей проверяет сервис; общие типы/погодные сущности — У1/У3 |
| C02 | Старый DEMO сохранён; повтор seed не дублирует; 114 OSM зон и 50 видов добавлены отдельным модулем | PARTIAL: данные организатора и совместная проверка геометрии — организатор/У2/У3 |
| C03 | 4 исходных роли + specialist/viewer, scrypt, sessions, CSRF, revoke, restart | PASS локального прототипа; production не проверен — У3 |
| C04 | Object/list/file права, чужие IDs, запрет self-review, replay после потери прав | PASS проверенных сценариев — У3; подключение экранов У2/У4 |
| C05 | 90 реальных routes, строгие входы, ошибки, inventory=Swagger | PARTIAL: V2 rank-preview/compare/context-refresh отсутствуют; часть вспомогательных response schemas общая — У1/У3 |
| C06 | Полная машина состояний, состав/skills/интервалы/ресурсы, возврат | PASS ручного backend workflow — У3 |
| C07 | Приватные отчётные фото, decode, limits, cleanup, rollback, restart | PASS report photos; фото участка остаются У3 |
| C08 | Actual planting, единая приёмка, receipts/care events, без дублей | PASS основного сценария; изменение уже выданного объёма требует ручной сверки — У3/У2 |
| C09 | Durable idempotency, expectedVersion, atomic writes, конкуренция | PASS, включая municipal import/rates — У3 |
| C10 | Чистые hook-интерфейсы V2; муниципальные экспертные функции выполняются сервером | PARTIAL: реальные AI callbacks/LLM/RAG не подключены; 503 не скрывается — У1, wiring У3 |
| C11 | Immutable plan snapshots, stale-input conflict, atomic approval | PASS транзакций; реальный планировщик и полная алгоритмика — У1/У3 |
| C12 | OSM/каталог/импорт с provenance; коэффициенты/источники сохранены | PARTIAL: погода и реальный cache/provider не подключены — У1/У3 |
| C13 | Preview + atomic commit GeoJSON/CSV/KML/SHP, catalog и soils, дедупликация | PASS в документированных лимитах; данные организатора ожидаются |
| C14 | Municipal dashboard и приоритеты, расчёты/версии, dashboard test | PARTIAL: V2 `/plans/compare` и его алгоритм — У1/У3 |
| C15 | Issues не завершают работу; автор/время/подтверждения сохраняются | PARTIAL: реальная AI-интерпретация и UI подтверждения — У1/У4 |
| C16 | Config, migration, repeat seed, restart, SQLite, session/photo persistence | PASS локально; Docker execution BLOCKED; production backups/power-loss не проверены |
| C17 | **37/37**, frontend adapter, process-restart demo, V2 demo | PASS проверенных сценариев; общий browser E2E — У4/У2 |
| C18 | Handoff, актуальный Swagger, API/запуск/лимиты/ошибки | PASS локальных материалов — У3 |
| C19 | Хеши фото, настоящий PDF/XLSX | PARTIAL: UI повтора фото и дорожный адаптер — У3/У1 |
| C20 | Полный HTTP V2 сценарий + municipal browser login/import | PARTIAL: общий frontend всех четырёх ролей не интегрирован полностью — У2/У4/У3 |
| C21 | Users/crews/profiles/membership/audit, рабочий отдельный admin UI, новые роли | PARTIAL: перенос в общую React-оболочку — У2/У3 |
| C22 | Каталог, OSM context с радиусами/cache/атрибуцией, import catalog | PARTIAL: отдельный municipal namespace не заменяет V2 context; provider refresh/MultiPolygon context — У2/У3 |
| C23 | DesignProposal, immutable approved revision, admin approval, tasks once | PASS backend; OSM municipal zones ещё не связаны автоматически с V2 sites/designs — У2/У3 |
| C24 | Сохранённая schematic FeatureCollection, version/stale checks | PARTIAL: site photos, generated image assets и lifecycle — У1/У2/У3 |
| C25 | Group report, фактический состав/посадка, ресурс один раз, receipts | PASS проверенного P0; сложные несколько водоисточников/расход материалов — У1/У3 |

## Матрица нового задания по командной расшифровке

Оригинал официального документа не предоставлен; источник и commit зафиксированы в handoff. Полную приёмку официального ТЗ этот отчёт не утверждает.

| Пункт | Backend / доказательство | Остаток / владелец |
|---|---|---|
| 3.1.1, 3.1.5 | 4 формата, preview/commit, CRS/geometry/duplicates, malicious ZIP/XML tests | Ограничения размеров, KML MultiGeometry и топологической дедупликации описаны; У3 |
| 3.1.2 | Персистентные слои zones/soils/greenery/city/catalog | Реальные файлы организатора отсутствуют — организатор |
| 3.1.3–3.1.4 | Layers/context/sites API, frontend transport; импортированные почвы участвуют в расчёте | Рисование полигона/адресный поиск, полный UI layers E2E — У2 |
| 3.2 | Серверные правила проблем, источники/ограничения | Деградация не выявляется без реестра состояния — организатор/У1 |
| 3.3 | Серверный подбор/схема/опции, неизвестные species отклоняются | Экспертная валидация и агрономическая полнота — У1 |
| 3.4, 5.3 | 5 статей, persistent editable rates, 3 варианта, version/audit | Официальные нормы и цены — организатор/У1 |
| 3.5–3.6 | Приживаемость 1/2/3 и календарь, оценки и ограничения | Калибровка/данные наблюдений — У1/организатор |
| 3.7 | Приоритеты + budget roadmap, missing-area exclusion, budget=0 test | Эвристика, не доказанный оптимум; неизвестные факторы/прокси — У1 |
| 3.8 | Эффект 5/10/20, источники/coefficients/unknown rates | Реальные измерения/население/пыль — организатор/У1 |
| 3.9, пример отчёта | Dashboard/history/snapshots, реальные PDF/XLSX | Расширенный browser E2E заблокирован разрешением; У2/У4 |
| 3.10 | Rule-based helper и private history | **LLM + RAG не готовы** — У1, серверное подключение У3 |
| 4, роли | admin/specialist/viewer + сохранённые V2 роли; real auth tests | Общий frontend workflow — У2/У4 |
| 4, Docker | Compose, nginx proxy, healthcheck, data/uploads volumes, config PASS | **Engine BLOCKED**, build/start/persistence containers не проверены — владелец среды + У3/У4 |

## Оставшиеся ошибки и ограничения

1. Полный старый React workflow ещё несовместим с V2 DTO: `/projects`, `/brigades`, `/issues` могут давать 404, формы назначений/приёмки — 400. Эти проблемы не скрыты mock-ответами. V2 backend и отдельный admin UI сохранены; муниципальные аналитические методы отдельно проверены.
2. Настоящих LLM/RAG, погодного провайдера, сгенерированных изображений и данных организатора нет. Необходимо подключение поставщиков/алгоритмов, а не смена маркировки DEMO.
3. Расчётные функции — командная экспертная модель; качество предсказаний не валидировано. Часть факторов использует явно документированные синтетические/прокси данные. Полной точности реального ТЗ не заявляем.
4. Docker build/start и контейнерный restart заблокированы отсутствием ответа Engine. Локальный restart не заменяет эту проверку.
5. Browser E2E и скриншот после импорта не закончены из-за отклонения доступа. Нельзя считать все экраны и роли проверенными.
6. Большие JS-чанки frontend остаются предупреждением сборки. Production security/load, аварийное выключение и резервное копирование не проверялись.

Git status и список файлов приложены в `LOCAL_REVIEW_STATE.json` и `LOCAL_GIT_STATUS.txt`. Все изменения остаются локально; текущий HEAD не изменён.

Итог: **33 modified tracked файла, 49 untracked файлов, 0 staged**. В числе изменений есть файлы frontend/docs/fixtures, перенесённые из командной ветки; они не приписываются новой самостоятельной реализации backend. `.env`, SQLite и uploads подтверждённо игнорируются Git.
