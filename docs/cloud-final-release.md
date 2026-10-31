# Финальный облачный кандидат — PR #39, 31 октября 2026

Рабочая ветка: `codex/cloud-api-persistence`. Coordinator `fdc6e756be99dc5ba3a7a48ca1df17c4bfbef5ef`
влит обычным merge `599a738f59e9b27b4da14f40eb1ecae6aed8047a`, без конфликтов, rebase и force push.
В coordinator здесь ничего не вливается. Изменения его переводов/QA приняты как upstream;
собственных изменений frontend, карты, worker или tools/e2e нет.

Точный проверенный SHA, CI и фактический deployed SHA публикуются в
[PR #39](https://github.com/foxfordkz-cyber/qadamxpavlodar/pull/39) после завершения проверок.
Не определять версию сервера по HEAD ветки: Auto-Deploy выключен. Прежняя реальная приёмка
`3b14927` остаётся отдельным историческим результатом в [журнале](cloud-deployment-readiness.md).

Geocode сохранён отдельно: `codex/bekzat-cloud-api-stage-e`,
`999f23a66ff27550a2cc54d5a4abb76cbc72c85e`. Он **не включён в этот кандидат**,
новый PR не открыт. Его локальные тесты не означают доступность поиска в текущем сервисе.
Новые экспериментальные миграции и изменения формул в релиз не добавлены; опубликованные
миграции 1–5 и checksum сохраняются. После фиксации кандидата — только критические исправления.

## Сценарий защиты и границы

Вход → существующий участок → `POST /zones/:id/analysis` (рекомендация/смета) →
проект (`/designs`, submit, admin review) → create-tasks → назначение бригады/работников →
start → multipart `/uploads` → `/tasks/:id/reports` → coordinator review `accepted` →
растения → сохранённый прогноз, партия, принятый осмотр и Outcomes summary.

Все пути, кроме health, имеют префикс `/api/v1`. Полные DTO, версии и права —
[cloud-api-contract.md](cloud-api-contract.md) и генерируемый `apps/server/openapi-cloud.json`.
Синтетические записи явно DEMO; принятый тестовый отчёт не является полевым наблюдением.
Непроверенное состояние остаётся `unknown`/`null`, не нулём.

| Функция | Точный маршрут / состояние кандидата | Влияние на выбранный сценарий | Следующий владелец |
| --- | --- | --- | --- |
| Поиск | GET `/geocode`: 503 `CLOUD_ENDPOINT_UNSUPPORTED` | Не требуется при выборе существующего участка | Backend: отдельно проверить/согласовать Stage E |
| Новые зоны | POST `/zones`: 503 | В сценарии используется существующая зона | Backend + владелец карты |
| Обновление контекста | GET `/zones/:id/context?radius=30/50/100/200`: сохранённый контекст; 409 `CONTEXT_STALE` после изменения версии участка. Регенерации нет | Для геометрии после редактирования нельзя обещать актуальный контекст; использовать принятый неизменённый участок | Backend + владелец GIS |
| V2-контекст | GET `/sites/:id/context`: сохранённый документ без регенерации | Это исторический снимок OSM, не новая геосъёмка; версия проверяется только radius-маршрутом выше | Backend: согласовать общий lifecycle контекста |
| GIS-импорт | POST `/imports/preview`, POST `/imports/:id/commit`, GET `/imports/:id`: 503 | Не требуется для seed-участков | Backend GIS; preview/CRS/privacy/rollback отдельно |
| Календарь ухода | POST `/zones/:id/care-schedule`: 503 | Ручные задания inspect/water/weed и их отчёты работают; автоматический календарь не показывать готовым | Backend; общий алгоритм SQLite сохранить |
| Ассистент/история | POST `/assistant`, GET `/assistant/history`: 503 | Численная рекомендация и смета идут через analysis, без LLM | Владелец LLM/капитан + backend persistence |
| Интерпретация заметок | POST `/observations/interpret`: 503 | Работник отправляет исходную заметку/фото без AI; реальные observations подтверждаются явно | Владелец LLM/капитан |
| Legacy ranking/selection | POST `/sites/rank-preview`, POST `/sites/:id/plant-selection`: 503 | Не подменять действующий analysis этими старыми методами | Backend + владелец frontend adapter |

503 выше проверяется после аутентификации и CSRF для POST. Аноним получает 401,
запрос без CSRF — 403. Это не пустые успешные ответы и не автоматический mock fallback.
LLM/RAG/живая погода/генерация изображений не интегрированы этим релизом.

## Доступы и конфигурация

Для backend отсутствующих значений нет: действуют разрешённые изолированные бесплатные
Render `green-pavlodar-api-demo` и Supabase `green-pavlodar-demo` (`dpkffzawhtbtlldckjhy`).
Настоящий origin: **https://green-pavlodar-api-demo.onrender.com**.
Страница Render: https://dashboard.render.com/web/srv-dbj0jaetlv9c73btp520 .

В Render настроены только серверные переменные (значения секретов не публикуются):
`DATABASE_URL`, `PG_CA_FILE`, `CLOUD_ALLOWED_HOSTS`, `ALLOWED_HOSTS`, `FRONTEND_ORIGINS`,
`CLOUD_TRUST_PROXY_HOPS`, `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET`,
`SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_ALLOWED_HOSTS`, `NODE_ENV`, `NODE_VERSION`.
Secret File: `supabase-ca.pem`. CA проверяется; TLS нельзя отключать.
На Render нет `DEMO_PASSWORD`, `CLOUD_DEMO_SEED` или `CLOUD_LOCAL_TEST`.

Private bucket `green-pavlodar-photos`: Public OFF, WebP, 5242880 bytes.
В cloud mode нет fallback на локальный диск. PostgreSQL через TLS session pooler,
приватная схема `gp_cloud`, не открытая PostgREST/anon-схема.

## Проверка кандидата без облачных секретов

Из `apps/server`, Node 24:

```sh
npm run typecheck
npm run build
npm run openapi:cloud
git diff --exit-code -- openapi-cloud.json
npm test
npm run test:postgres
```

`test:postgres` запускает отдельный native PostgreSQL со случайными учётными данными,
выполняет HTTP, миграции/rollback, SQLite parity, повторные запросы и restart/reseed.
Тестовый Storage в этих наборах — локальный HTTP-адаптер; **это не Supabase-приёмка**.
Проверки старого SHA не переносятся на новый: итог содержит SHA и свежие результаты.

## Настоящая HTTPS-приёмка и инструкции Айдане

Стенд выше — отдельный синтетический DEMO, не рабочая база и не публичный mock frontend.
Айдана использует его через принятый fixed-origin proxy либо HTTP-клиент. Доступы к ролям
выдаются владельцем приватно; пароли, cookies и CSRF не копировать в issue/PR/чат.
Существующие тестовые сценарии/фото не очищать. Новый сценарий получает отдельный manifest
и уникальный префикс; повторная проверка использует **тот же manifest**.

На разрешённой операторской машине `apps/server/.env.cloud-acceptance` уже хранит
`CLOUD_ACCEPTANCE_DEMO`, `CLOUD_ACCEPTANCE_ORIGIN`, `CLOUD_ACCEPTANCE_BROWSER_ORIGIN`,
`CLOUD_ACCEPTANCE_PASSWORD` (всё игнорируется Git). Не выводить файл в терминал.

```sh
# apps/server; readiness preflight только читает разрешённые DB/bucket:
npm run check:cloud-deployment -- --ready

# Только на отдельном DEMO. create один раз; файл не должен существовать:
node --env-file=.env.cloud-acceptance --import tsx scripts/cloud-https-acceptance.mjs create data/cloud-final-release.json

# После каждого restart/redeploy, на том же manifest:
node --env-file=.env.cloud-acceptance --import tsx scripts/cloud-https-acceptance.mjs verify data/cloud-final-release.json
```

Build из корня репозитория:
`npm ci --prefix apps/server --include=dev && npm run build --prefix apps/server`.
Start: `npm run start:cloud --prefix apps/server`.
Health Check Path: `/api/v1/ready`; `/health` — только liveness.

Оператор/captain открывает **только** указанный DEMO Render service:
Manual Deploy → Deploy a specific commit → принятый полный SHA.
После Live записывает deploy ID/SHA и запускает `verify`. Для restart —
Manual Deploy → Restart service; дождаться события Service restarted/готовности и `verify`.
Для redeploy снова выбрать **тот же SHA**, сохранить новый deploy ID и повторить `verify`.
План, регион, env, bucket policies, passwords и volumes при этом не менять.
Free instance может засыпать: первый запрос ждать до 90 секунд; ошибки записи не повторять
с новым Idempotency-Key. Forced idle-cycle/SLA не объявлены проверенными.

Повторный seed выполняется отдельно оператором по [runbook](cloud-provider-deployment.md),
с явным DEMO opt-in. Перед/после сравниваются постоянные таблицы, включая users/passwords,
историю/снимки/фото-метаданные; сами хеши паролей не выводятся. Затем `verify` с прежним
паролем. Seed не включается в start-команду Render.

Rollback при критическом дефекте: вручную вернуть проверенный `3b14927def04b35bf97782eae6b550da276c779f`
на этом DEMO-сервисе, оставить ту же БД/bucket/env, затем проверить health/ready и сохранённый
manifest. Схема остаётся v5, down migration/reset не нужен и не разрешён.

## Передача и окончательная фиксация

- Капитан: принять SHA/результаты, управлять merge в coordinator и доступом QA к DEMO.
- Тәңірберді: upstream HTTPS выше; `Host: green-pavlodar-api-demo.onrender.com`, исходный
  browser Origin, Cookie/Set-Cookie, CSRF/Idempotency-Key, multipart boundary и binary WebP
  сохраняются. Никакого cache или caller-selected upstream. Разрешены Render-origin и
  `https://green-pavlodar-mock.pages.dev`; другой точный frontend origin согласовать до включения.
  В доступном Cloudflare аккаунте нет командного Pages проекта; реальный proxy переключает его владелец.
- Айдана: принятый SHA + DEMO origin + отдельный сценарий/manifest; после согласованного restart
  проверять оба старый/новый сценария, фото/историю/unknown. Проверка другого устройства отдельно.
- Публичный mock сохранить независимым резервом. Части с 503 не скрывать за пустыми данными.
- Полный cloud UI не объявляется завершённым. PDF/font runtime, forced cold start, реальная
  Cloudflare browser-интеграция и новый legacy-key replacement не входят в доказанную приёмку.
- Зависимости: существующие 8 moderate advisories требуют отдельного проверенного исправления;
  без major/audit fix --force и расширения финального кандидата некритическими изменениями.

Итоговый отчёт PR разделяет local/native tests, имитацию Storage и настоящий HTTPS/Supabase,
с датами, точным SHA и FAIL/NOT RUN для непроведённых проверок. После freeze новая функциональность
в этот кандидат не добавляется.
