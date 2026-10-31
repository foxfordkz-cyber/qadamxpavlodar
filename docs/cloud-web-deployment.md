# Cloudflare Pages: публикации и облачный кандидат

Обновлено 31.10.2026, UTC+5. Ветка `codex/cloud-web-and-demo`, PR #35. Coordinator объединяет капитан; в этой работе выполнен только обычный merge `origin/codex/coordinator`, без rebase/force push.

## Публичный mock: принят и проверен владельцем

| Поле | Фактическое значение |
|---|---|
| Production | https://green-pavlodar-mock.pages.dev/ |
| Неизменяемый URL | https://f816c350.green-pavlodar-mock.pages.dev/ |
| Deployment ID | `f816c350-5722-4b56-a180-4124da01c5ba` |
| Исходники | `fdc6e756be99dc5ba3a7a48ca1df17c4bfbef5ef` — чистая принятая coordinator |
| Способ | Cloudflare Pages Direct Upload, автоматическое обновление Git не настроено |
| Архив | `green-pavlodar-mock-fdc6e75.zip`, 1 586 756 байт |
| SHA256 архива | `c89772c72d44590acf79f980be27a452bad696439bad2cacc8b5d948179ff804` |

Mock собран в отдельном чистом detached worktree из основной. Непринятые изменения #35 в него не включены. E2E-10 исправлен в исходной основной: RU/KK подсказка указывает на ассистента в верхней панели. Загрузка 34/34 файлов завершилась успешно в Cloudflare Dashboard.

[Манифест сборки](cloudflare-evidence/2026-10-31-publication-fdc6e75-candidate.json), [HTTP-сверка](cloudflare-evidence/2026-10-31-published-fdc6e75.json), [публичный прогон](cloudflare-evidence/2026-10-31-public-smoke-fdc6e75.json), [безопасный архив свидетельств](cloudflare-evidence/2026-10-31-public-evidence-fdc6e75.zip).

Результаты: 68/68 HTTP200 и совпадений размера/байтов/SHA256 (34 файла × production/immutable); исходные 16 public-тестов QA #40 без изменений — 16 PASS, 0 failed/skipped/flaky; дополнительный E2E-10 RU/KK × 375/1280 — 4/4 PASS. Все 24 PNG просмотрены. Это повтор владельца публикации, а не новая независимая приёмка Айданы и не проверка общего облачного workflow. Исходный public suite использует care=2; презентационный care=3 проверен отдельно свежим экспортом Word.

Предыдущие deployments сохранены для отката: `1079de0b-d78a-4350-8242-e718d2aad30e` (98cf6c6) и `eb0cd70c-0f25-4930-820c-e57bf614c719` (a66d542). Их свидетельства не перезаписаны. Production QR сохраняет тот же адрес. Mock не имеет общей серверной БД и приватного облачного хранения фото; внешняя карта может требовать сеть.

## Backend: тот же SHA, новый origin применён

- Фиксированный origin: https://green-pavlodar-api-demo.onrender.com.
- Развёрнутый application SHA: `3b14927def04b35bf97782eae6b550da276c779f`.
- Render deployment `dep-dbj223h42hec73bqnttg`: начат **31.10.2026 в 22:10:38 UTC+5**, завершён за **1 мин 25 с**, статус **Live** подтверждён в Dashboard. Это redeploy именно того же SHA с сохранёнными env; latest commit, seed и новый merge не запускались.
- Последняя прочитанная передача #39 — документация `235615a0fd2ddfae8b0ce9a7fa0f106cbf566902`. Это не SHA работающего сервера. [Контракт](https://github.com/foxfordkz-cyber/qadamxpavlodar/blob/235615a0fd2ddfae8b0ce9a7fa0f106cbf566902/docs/cloud-api-contract.md), [границы релиза и готовый QA-набор](https://github.com/foxfordkz-cyber/qadamxpavlodar/blob/235615a0fd2ddfae8b0ce9a7fa0f106cbf566902/docs/cloud-final-release.md), [покрытие маршрутов](https://github.com/foxfordkz-cyber/qadamxpavlodar/blob/235615a0fd2ddfae8b0ce9a7fa0f106cbf566902/docs/cloud-route-coverage.md).

Бекзат ранее подтвердил Render + Supabase PostgreSQL/TLS/private Storage, стадии A/B/C/D, роли, фото, отчёты, Outcomes и сохранность после restart/redeploy/reseed. Его отчёт содержит 956 строк / 31 таблицу и 87 OpenAPI операций; это свидетельство backend-команды, не повтор этих проверок Тәңірберді через браузер.

Дополнительный `https://green-pavlodar-api.pages.dev` был сохранён в Render через **Save only**, поэтому начальная публичная проверка с этим Origin вернула 403 `LOCAL_ONLY`. После согласованного redeploy в **22:13:08 UTC+5** affected-проверка `/api/v1/auth/me` без cookie вернула **401 `AUTH_REQUIRED`** с точным Allow-Origin и credentials=true; `/api/v1/ready` — **200**, preflight `OPTIONS /api/v1/tasks` — **204**. Readiness: schemaVersion=5, `photos=private-storage-configured`, no-store. Первоначальный отказ сохранён в свидетельствах, а не заменён новым PASS. [Результаты](cloudflare-evidence/2026-10-31-api-unauth-aee7242.json).

`ALLOWED_HOSTS` проверяет hostname Render; `FRONTEND_ORIGINS` — точный browser origin; `CLOUD_ALLOWED_HOSTS` относится к PostgreSQL, не к frontend. Обычный Render Restart сохраняет прежние user env; Save only применяется следующим deployment. Поэтому использован redeploy принятого SHA. [Поведение Render](https://render.com/docs/deploys).

Поиск/geocode, новые/нарисованные зоны, GIS import, календарь ухода, ассистент/история и интерпретация заметки остаются ограниченными в cloud mode. Их 503 не превращается в успешный mock-ответ. Модель использует синтетическое обучение; прогноз не гарантирует приживаемость.

## Отдельный API frontend: опубликован, полная приёмка ещё не выполнена

| Поле | Фактическое значение |
|---|---|
| Production API | https://green-pavlodar-api.pages.dev/ |
| Неизменяемые статические файлы | https://ff01f45d.green-pavlodar-api.pages.dev/ |
| Cloudflare deployment ID | `ff01f45d-69ed-45a9-af1c-ad1d26b8983a` |
| Опубликованные frontend/proxy исходники | `aee7242ee899f1f596a704adba6e1279c37af9df` |
| Чистая сборка | Node 24.22.1, `VITE_DATA_SOURCE=api`, `sourceDirty=false`, отдельный detached worktree |
| ZIP | `green-pavlodar-api.zip`, 1 633 963 байта, 36 файлов |
| SHA256 ZIP | `da8bc83dd448b114b78f100d933187f686099ddcdb01c012f8f61e19222ac1d9` |
| SHA256 manifest | `5371062af0acd8befac3e08e549025284a06e3a3b930bf4d0ff550d099b87eba` |
| Подтверждённые настройки Pages | compatibility date `2026-06-16`, flags `[]`, **Fail closed** |

API-проект отделён от mock. Commit `aee7242` включает обычный merge основной `760506090b7007cb8628a5cedf499a70760bff71`. Последующие commits документов и свидетельств меняют HEAD PR, но не SHA этой публикации. Финальный ZIP побайтово совпал с ранее загруженным пакетом `f2004e7` (проверка `fc.exe /b`); новый manifest относится к чистому `aee7242` и фактическим runtime settings.

[Снимок Dashboard](cloudflare-evidence/2026-10-31-api-published-dashboard.png) подтверждает успешный deployment ff01f45d; боковая панель аккаунта скрыта.

**Реальная transport/API приёмка production Pages — PASS у Бекзата, 22:17 UTC+5.** После redeploy он сравнил прежний baseline: все 956 строк / 31 таблица сохранены. Проверены пять ролей и cookies/CSRF, приватное фото, задания/отчёты/приёмка и повторы с тем же ключом, Outcomes. Новый синтетический inspect-сценарий: 10 проверок / 35 HTTP-запросов. В настоящем браузере выполнены viewer login/reload, Outcomes, принятый отчёт, приватное фото и logout. [Отчёт оператора](https://github.com/foxfordkz-cyber/qadamxpavlodar/pull/35#issuecomment-6546637443), [зафиксированная сводка](cloudflare-evidence/2026-10-31-api-operator-acceptance.json).

Бекзат подтвердил реальную HTTP-приёмку production Pages в 22:17, затем **браузерный цикл в 22:23–22:36 UTC+5** на публичной **aee7242**: работник → старт → фото/отчёт → coordinator acceptance → viewer → Outcomes. Задание создано и назначено через API перед этим проходом; создание задания через UI не заявляется. Viewer: отчёт и Outcomes × RU/KK × 375/1280 — **8/8 PASS**, приватное фото читается, alive 1 / unknown 3 / процент всей партии null сохранены. Это один ролевой цикл, не четыре полных E2E. [Свидетельство оператора](https://github.com/foxfordkz-cyber/qadamxpavlodar/blob/235615a0fd2ddfae8b0ce9a7fa0f106cbf566902/docs/cloud-browser-acceptance.md), [точная сводка](cloudflare-evidence/2026-10-31-api-browser-operator.json). Публичный дефект **UI-KK-WORKER** подтверждён: оболочка KK, кабинет RU. Синтетическое фото не является полевым доказательством.

В **22:42–22:49 UTC+5** Бекзат отдельно проверил через UI той же публикации: coordinator login → существующий участок `site-osm-1568405606` → смета **388 587 ₸** (2 года, оптимальный вариант) → создание задания на обследование → назначение через «План работ» — **PASS**. [Отчёт оператора](https://github.com/foxfordkz-cyber/qadamxpavlodar/pull/35#issuecomment-6546995249), [точная сводка](cloudflare-evidence/2026-10-31-api-planning-ui-operator.json). Это другое DEMO-задание: бригада назначена, состав работников ещё не назначен; единый сквозной цикл от этой сметы до принятого отчёта не заявляется. Общий контекст участка не изменялся. Первая попытка browser fill не обновила React-state даты; штатное изменение клавиатурой позволило назначить тот же черновик без дубля и API-обхода, поэтому дефект приложения по дате не подтверждён. Ограничения CONTEXT_STALE и KK кабинета в публичной версии сохраняются.

Кандидат **a7e2b96** после обычного merge основной **932574e** исправляет передачу языка без сброса черновика, фото, ключа и текущей отправки. Локально worker/foreman × 375/1280: **4/4** смены языка с фото и **4/4** KK после reload PASS, 16 PNG просмотрены; [проверка кандидата](cloudflare-evidence/2026-10-31-worker-kk-candidate-a7e2b96.json). Используются существующие частичные переводы kk-draft, полный перевод не заявляется. **Кандидат не опубликован**: управление локальным браузером выключено в Work settings; новый Direct Upload не выполнен. Рабочие публикации по-прежнему API aee7242 и mock fdc6e75. Физический телефон, единый цикл на одном задании и реальная проверка неоднозначного сетевого сбоя остаются отдельными непроверенными пунктами.

### Транспорт и воспроизводимость

`cloudflare/pages-worker.mjs` + `build-api.mjs` создают готовый ESM `_worker.js` и `_routes.json` только для `/api` и `/api/*`. Статика обслуживается Pages, fallback worker — `env.ASSETS.fetch`. Upstream зафиксирован в исходнике, не берётся из query/header; фиксируется также доверенный frontend origin. На immutable/preview API намеренно возвращает 421, потому что такой origin не принят. Пользовательский сценарий проверяется на production URL.

Прокси сохраняет method/path/query/body, multipart boundary, binary response, Cookie/отдельные Set-Cookie, CSRF, Idempotency-Key и status. Host следует upstream URL, Origin браузера сохраняется; Forwarded/X-Forwarded-* не доверяются. Host-only Secure/HttpOnly/SameSite=Strict cookie с Path=/api/v1 не переписывается. API/private photos имеют no-store. Ошибки/HTML502/503 не подменяются SPA/mock. Все upstream 301/302/303/307/308 отклоняются без повторного запроса и без передачи Location/cookies.

Нет автоматического повтора мутации после неопределённой сетевой ошибки. Worker сохраняет исходный черновик/фото/ключ для явного повтора; timeout не означает отсутствие сохранения на сервере. Разрешённый контрактом повтор после явного CSRF-отказа сохраняет ключ и тело. Proxy timeout 65 с ограничивает получение заголовков, не полное скачивание.

[Инструкция сборки/runtime](../cloudflare/README.md), [исходный build manifest](cloudflare-evidence/2026-10-31-api-build-aee7242.json), [локальная QA](cloudflare-evidence/2026-10-31-api-local-qa-aee7242.json). Manifest и local QA фиксируют состояние до публикации; фактические deployment и приёмка приведены выше. Pages требует compatibility date `2026-06-16`, flags `[]`, fail closed. Флаг передачи отмены входящего клиентского запроса в списке Dashboard недоступен; эту возможность не заявляем. Собственный proxy timeout работает. Эти настройки подтверждены в Dashboard отдельно от ZIP. Сборка из чистого SHA, Node 24 / lockfile; VITE_DATA_SOURCE=api, прочие VITE_* очищены, разработческие apps/web/.env* запрещены. Серверные секреты в Pages передавать не требуется.

### Что проверено локально

- После merge: web 201/201, worker 90/90; typecheck и check:i18n/zones/care/survival PASS, RU/KK 1945/1945 без missing/extra/placeholders.
- Proxy/core+adapter: 15/15 Node PASS.
- Настоящий локальный workerd через Miniflare 4.20260730.0: 7/7 PASS, все outbound синтетические, providerRequests=0. Separate cookies, multipart/CSRF/idem/Origin, binary, redirects, no-store/503, static/origin guard. Windows diagnostic WSARecv #64 при закрытии соединения сохранён в журнале, exit 0.

**Локальный workerd и Node-тесты не заменяют приёмку публикации.** Финальный bundle из чистого `aee7242` прошёл 7/7 workerd checks на date `2026-06-16`, flags `[]`; TypeScript/Vite build PASS. [CI опубликованного `aee7242`](https://github.com/foxfordkz-cyber/qadamxpavlodar/actions/runs/41222309589): Web, Server, Worker — 3/3 SUCCESS. Это CI приложения; последующий HEAD документов имеет отдельную историю проверок.

### Публичная матрица приёмки

[Сводка без credentials](cloudflare-evidence/2026-10-31-api-unauth-aee7242.json), [статические хеши](cloudflare-evidence/2026-10-31-api-static-aee7242.json), [архив с четырьмя просмотренными PNG и исходными попытками](cloudflare-evidence/2026-10-31-api-unauth-aee7242.zip). Архив: 112 749 байт, SHA256 `2c4dd1623b3c0727aee50093d2a3146ce87ddcec5b2ba32334d3aa6528d8f670`.

| Проверка | Фактический результат / граница |
|---|---|
| Статические файлы | **68/68 PASS**: 34 файла × production/immutable, HTTP200, размер/байты/SHA256. `_worker.js` и `_routes.json` — служебные файлы, не публичные static endpoints |
| HTTP без credentials | Начальный прогон **6 PASS / 1 failed**: correct-Origin получил 403. После Render Live повторён именно affected GET: **401 PASS**; дополнительно readiness200 + OPTIONS204 — **2/2 PASS**. Это не новый полный прогон 7/7 |
| Immutable API | **421 `PROXY_ORIGIN_MISMATCH` PASS**, no-store; вход выполняется через production |
| RU/KK × 375/1280 | **4/4 PASS**, 0 pageErrors, без горизонтального overflow: пустая форма входа и защита `#/worker`. Пароль не вводился, login не отправлялся; четыре PNG просмотрены |
| Login/logout, cookie/CSRF, пять ролей | **HTTP PASS у Бекзата** через production Pages; viewer login/reload/logout подтверждён браузером |
| Участок → смета → создание задания → назначение бригаде | **Browser PASS у Бекзата**, 22:42–22:49, aee7242; отдельное DEMO-задание, состав работников ещё не назначен |
| Worker → photo/report → coordinator acceptance → viewer | **Browser PASS у Бекзата** на aee7242, один цикл, задание подготовлено API; это другое задание, чем в проходе создания через UI |
| Multipart/private binary, повтор с тем же ключом, Viewer/Outcomes | **HTTP PASS у Бекзата**; worker photo/report и coordinator/viewer browser PASS; viewer report/Outcomes RU/KK × 375/1280 — 8/8 |
| Другое физическое устройство | **NOT RUN**; мобильные проверки выше — эмуляция на этом компьютере |

## Защита и резерв

Единый [сценарий](defense/scenario.md) определяет живой показ и запасной ход. Новый локальный runtime fdc6e75 прошёл 17/17 offline checks, 0 pageErrors, 86 внешних запросов заблокированы; 39/39 файлов сверены. Видео 2:40/5:00 и 9 слайдов сохранены на исходной версии a66d542 с честными подписями; это не запись нового API.

Свежие RU/KK Word выгружены из immutable f816c350 (optimal / care 3 / Tolstogo). Числовая сверка 2/2: 12 видов, 1345 растений, 3782 м²; итог 10 825 627,5 ₸ в Word, округлённый экран 10 825 628 ₸. Оба исходных DOCX открыты в Word 2016, все 12 страниц PDF просмотрены; найден дефект символа ₂ в CO₂/O₂. Отдельные копии для печати подготовлены, их проверка в Word 2016 / Microsoft Print to PDF — все 12 страниц PASS; исходники сохранены. [Точный статус Word](defense/README.md). Демо-цены и синтетические оценки требуют проверки специалистом.

Исторический статус до публикации API передан в [комментарии #35 от 21:46](https://github.com/foxfordkz-cyber/qadamxpavlodar/pull/35#issuecomment-6546269519). Контрольное время 20:00 уже прошло к началу текущего продолжения; время отчёта не подменяется. После 23:00 только критические исправления. Финальный release SHA и merge coordinator утверждает капитан.

## Кандидат после повторного fetch — a7e2b96, ещё не deployment

Принятая основная обновилась до `932574e` (#42). В собственную ветку выполнен обычный merge `acdb335de61e32f8d77362726b84bc681cf768d7`; coordinator не изменялся. Затем commit `a7e2b968437ad82834f4164f3cf09aafe4b64383` исправил только связь языка кабинета и добавил регрессии. [Проверки кандидата](cloudflare-evidence/2026-10-31-candidate-checks-a7e2b96.json): typecheck/build, четыре check:*, web 201/201, worker 93/93, proxy 15/15, local workerd 7/7; [CI 3/3](https://github.com/foxfordkz-cyber/qadamxpavlodar/actions/runs/41225579568). Runtime тесты синтетические, providerRequests=0.

Готовый архив кандидата: `green-pavlodar-api.zip`, **1 634 900 байт**, SHA256 **02bd9aa868b8a2564a03afa153d2b565a78a9b4c81c8ce1f9bbdc022b0c2b399**; [чистый sourceDirty=false manifest](cloudflare-evidence/2026-10-31-api-candidate-a7e2b96.json). Deployment ID отсутствует, так как загрузки не было. Не присваивать ему ff01f45d или результаты публичной aee7242. Настройки существующего API-проекта остаются date2026-06-16 / flags[] / fail closed; новый origin или server secrets не нужны.

Свежий read-only повтор в 22:35: **9/9 PASS**, [JSON](cloudflare-evidence/2026-10-31-public-readonly-followup.json). API origin отдаёт JSON readiness/auth/OpenAPI; правильный Origin/OPTIONS и no-store подтверждены. Mock `/api/v1/ready` отдаёт HTML index: это независимая статика, не API readiness. Mock сохраняется по умолчанию на своём адресе; явный облачный вход — **https://green-pavlodar-api.pages.dev/?source=api**. Этот другой точный origin уже согласован и применён Бекзатом; на mock `?source=api` сервер не подключён. Публичный mock fdc6e75 уже содержит E2E-10; свежая основная932574e не выдаётся за его опубликованный SHA.

Воспроизводимый блокер нового Direct Upload: CUA возвращает `Local browser use is disabled in Work settings`. На этом компьютере не найден настроенный Wrangler CLI; браузерные cookies/токены не извлекались. Существующие публикации не менялись и продолжают работать. Реальную потерю ответа при мутации или outage/reconnect на публичном frontend отдельным PASS не объявляем: отсутствие auto-retry и сохранение ключа подтверждены локальными регрессиями, успешные реальные повторы — отчётом backend-оператора.
