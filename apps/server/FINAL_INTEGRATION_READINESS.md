# Backend final integration — 29.10.2026

Этот отчёт содержит новые прогоны после integration с coordinator; прежние PR13_* отчёты относятся к более ранним SHA. **PR #13 остаётся Draft: incoming typecheck FAIL и Docker/browser BLOCKED.**

## Исходники и изменения

- Личная ветка: `feature/backend-municipal`, исходный HEAD `54ba7d552a2f3c74b2c1330a617bfd20188490b2`, рабочее дерево было чистым.
- Coordinator и ui/differentiators: `f6ad7950171f2b8005811f20ace877fdc20a936a`.
- Обычный merge в личную feature-ветку, без конфликтов. Shared branches не изменялись этой работой.
- V2/municipal/import/export/shared analytics/auth/CSRF/idempotency/migrations сохранены. `tz/llm.ts` и incoming tests получены из merge без ручных правок; их blobs совпали с incoming.
- Найден реальный contract drift: сохранённый `openapi-v2.json` не содержал `history`/`view` в assistant request, хотя runtime их принимает. Snapshot обновлён: +52 строки, без изменения handlers. Все 101 операции и 1263 request/response schemas скомпилированы AJV.

## Проверки этого этапа

| Проверка | Результат |
|---|---|
| Server typecheck | **FAIL**, exit 1: два TS18049 в incoming `tests/llm.test.ts:130` |
| Server build | PASS, exit 0 |
| Backend suite | **60 passed / 0 failed / 0 skipped**, 104.05 с |
| Frontend typecheck/build | PASS; предупреждение Vite о чанках >500 kB |
| Миграционные регрессии обеих v4 | PASS в общем наборе |
| Fresh coordinator → v5, реальные процессы | PASS, exit 0; 38 исходных таблиц сохранены, добавлены 6 municipal |
| Municipal HTTP / frontend transport / restart | PASS, 32 запроса transport + client example, PDF/XLSX, повторный import/seed без дублей |
| Assistant HTTP | PASS: history/view/address, user isolation, restart persistence, 114 зон |
| OpenAPI | 101 операция; 1263 schemas compiled; snapshot синхронизирован |
| Docker CLI/Compose/config | 29.1.5 / v5.0.1 / config exit 0 |
| Docker Engine/runtime | **BLOCKED**, info exit 1: pipe dockerDesktopLinuxEngine отсутствует |
| Browser acceptance | **BLOCKED**: Computer Use остановлен из-за невозможности надёжно определить текущий URL |

Assistant фактически **rules** в самостоятельном HTTP прогоне. `find_place` и provider boundary покрыты тестами с локальным управляемым provider; live LLM не заявляется. Invalid DTO → 400, worker assistant → 403, missing session → 401, missing CSRF → 403, missing snapshot idempotency key → 400; replay возвращает прежний snapshot. V2 tasks/reports/plants и полный workflow остаются в suite.

## Свежая миграция

Существующий `scripts/accept-migration-v4-v5.mjs` запущен с архивом именно f6ad795, не с прежней пользовательской базой. Старая версия создаёт настоящую TZ-v4; независимая SQLite backup-копия учитывает WAL. Старые пароли всех 9 аккаунтов и session проверяются новым сервером.

| Данные | До | После | После restart |
|---|---:|---:|---:|
| Schema | 4 | 5 | 5 |
| Зоны | 114 | 114 | 114 |
| V2 tasks / reports | 1 / 1 | 1 / 1 | 1 / 1 |
| Accounts / password hashes | 9 / 9 | 9 / 9 | 9 / 9 |
| TZ species / rates | 50 / 27 | 50 / 27 | 50 / 27 |
| V2 catalog | 58 | 58 | 58 |
| Rate version | 7 | 7 | 7 |
| integrity / foreign keys | ok / [] | ok / [] | ok / [] |

Все исходные SQL-строки совпали после миграции; новый snapshot сохраняется и повторно не создаётся. В этом свежем прогоне startup healthy: старая версия 2.450 с, мигрированная 6.413 с, повторная 3.897 с. Ранее наблюдавшиеся задержки запуска не заменяют этот результат и остаются поводом проверить cold start в Docker.

## Incoming typecheck: владельцу

`.find(c => c.centroid)!` не сужает тип свойства `centroid`. Ошибка остаётся в f6ad795; отключать typecheck или менять сигнатуры для обхода нельзя. Подготовлен [минимальный patch](patches/assistant-centroid-owner.patch), добавляющий `assert.ok(site.centroid)`; `git apply --check` проходит. Patch **не применён** к чужому тесту. Предыдущая временная проверка с таким assertion проходила; в текущей основной ветке зафиксирован честный FAIL. Владелец incoming tests должен внести исправление и повторить typecheck.

## Docker и browser

Docker Desktop executable установлен, процессов Desktop/backend при диагностике не было. Engine недоступен; config syntax не считается runtime acceptance. Volumes и настройки не менялись; приложение на 8080 не запускалось. PR #12 guard уже в истории; его файл сохранён, настоящий сервер с HOST=0.0.0.0 прошёл миграционный HTTP/restart сценарий. Никакие ограничения сети не отключались.

Computer Use нашёл Chrome, но остановил управление при выборе окна: не удалось надёжно определить текущий URL для enforcement policy. После остановки app-input не выполнялся, альтернативного обхода не было. Нет браузерных скриншотов, визуальной проверки карты или утверждения о frontend E2E. HTTP transport и сборка — отдельный проверенный объём.

## PR #14: доступная проверка

Просмотрены полный `docs/kk-glossary.md` и контекст переводов на `0a9503816b946e2e650ed4df4bbdbb91575aa777` в отдельной чистой checkout. Ветка и frontend source не редактировались.

- `check:i18n`: **1323/1323**, missing/extra/placeholders = 0.
- Web tests: **37/37**, 0 failed/skipped; typecheck/build PASS.
- [Новый комментарий](https://github.com/foxfordkz-cyber/qadamxpavlodar/pull/14#issuecomment-6500359070): кнопка подготовки care drafts не должна обещать сохранение tasks; surv.* — коэффициенты, не финансовые ставки. Предыдущие замечания не продублированы.
- Проверка шести экранов на `localhost:5174/?lang=kk` **не выполнена** из-за остановки Computer Use. Языковая проверка исходников не названа визуальной приёмкой.

## Дальнейшие действия до 31.10, 18:00 UTC+5

1. Владелец incoming tests: применить минимальное сужение centroid и получить зелёный общий typecheck.
2. Владелец среды: запустить Engine; отдельный Compose project/volume, временные credentials, health/nginx/cookie/CSRF/restart. Не использовать общий gp-data как disposable.
3. Владелец UI: реальный browser pass API режима и шести казахских экранов; применить согласованные языковые поправки.
4. Капитан: Ready только после всех обязательных gates; PR самостоятельно не сливается.

Локальные подробные результаты вне Git: `work/final-integration/backend-tests.txt`, `server-typecheck.txt`, `web-build.txt`, `migration-f6ad795/result.json`, `assistant-http-f6ad795/result.json`, `openapi-check.json`, `kk-i18n.txt`, `kk-tests.txt`, `kk-build.txt`. Municipal artifacts: ignored `apps/server/data/municipal-demo/final-integration-f6ad795/`.
