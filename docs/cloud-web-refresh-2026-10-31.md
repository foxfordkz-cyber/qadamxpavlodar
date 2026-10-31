# Тәңірберді: публикации и приёмка — 31.10.2026

## Текущее состояние: публикации и непубликовавшийся кандидат

Действующий подробный журнал — [cloud-web-deployment.md](cloud-web-deployment.md). Ниже текущие публикации отделены от сохранённых исторических проверок.

| Область | Проверенный результат |
|---|---|
| Независимый публичный mock | Принятая coordinator `fdc6e756be99dc5ba3a7a48ca1df17c4bfbef5ef`, deployment `f816c350-5722-4b56-a180-4124da01c5ba`; [production](https://green-pavlodar-mock.pages.dev/), [immutable](https://f816c350.green-pavlodar-mock.pages.dev/). HTTP 68/68, исходный public suite 16/16 и отдельный E2E-10 RU/KK × 375/1280 — 4/4 PASS |
| Отдельный API frontend | Опубликован `aee7242ee899f1f596a704adba6e1279c37af9df`, deployment `ff01f45d-69ed-45a9-af1c-ad1d26b8983a`; [production](https://green-pavlodar-api.pages.dev/), [immutable assets](https://ff01f45d.green-pavlodar-api.pages.dev/). API на immutable намеренно закрыт 421 |
| API-архив | `green-pavlodar-api.zip`, 1 633 963 байта / 36 файлов; SHA256 `da8bc83dd448b114b78f100d933187f686099ddcdb01c012f8f61e19222ac1d9`. Чистая сборка aee7242, Node 24.22.1; compatibility date `2026-06-16`, flags `[]`, Fail closed. Позднейший HEAD документов не является новой опубликованной сборкой |
| Backend | Фактический Render `https://green-pavlodar-api-demo.onrender.com`, runtime SHA `3b14927def04b35bf97782eae6b550da276c779f`; redeploy `dep-dbj223h42hec73bqnttg` начат в 22:10:38 UTC+5, Live через 1 мин 25 с. Без latest/seed, применён сохранённый точный Pages Origin |
| API без credentials | 68/68 static-хешей; 4/4 RU/KK форм входа и protected worker route, четыре PNG просмотрены, 0 pageErrors. Первоначальный HTTP 6/7 сохранён; после Live affected Origin GET стал 401 `AUTH_REQUIRED`, readiness200 и OPTIONS204 — 2/2 PASS. Полный HTTP-набор заново не объявлен 7/7 |
| Реальная приёмка production Pages | У Бекзата: HTTP workflow пяти ролей, cookies/CSRF, multipart/private binary, идемпотентные повторы и Outcomes PASS; viewer login/reload/отчёт/фото/Outcomes/logout также browser PASS. [Отчёт 22:17](https://github.com/foxfordkz-cyber/qadamxpavlodar/pull/35#issuecomment-6546637443). Позднее worker/coordinator/viewer UI после API setup подтверждён; public KK worker дефект остаётся. Кандидат a7e2b96 исправляет bridge локально, но ещё не опубликован |

[API-сводка](cloudflare-evidence/2026-10-31-api-unauth-aee7242.json), [static evidence](cloudflare-evidence/2026-10-31-api-static-aee7242.json), [архив API-проверки](cloudflare-evidence/2026-10-31-api-unauth-aee7242.zip); [mock-публикация](cloudflare-evidence/2026-10-31-published-fdc6e75.json) и [public suite](cloudflare-evidence/2026-10-31-public-smoke-fdc6e75.json).

Локальный proxy/core+adapter: 15/15 Node PASS; готовый bundle aee7242 — 7/7 local workerd PASS на date 2026-06-16 без flags, без provider-запросов. [CI опубликованного aee7242](https://github.com/foxfordkz-cyber/qadamxpavlodar/actions/runs/41222309589) — Web/Server/Worker 3/3 SUCCESS. В Dashboard недоступен enable_request_signal: передачу отмены входящего соединения не обещаем; собственный 65-секундный header timeout и отсутствие автоматического повтора мутации сохранены.

В [актуальной передаче backend 05bc924](https://github.com/foxfordkz-cyber/qadamxpavlodar/blob/05bc92492f72cc909ee6ae94d18d5b9bf1a3d54b/docs/cloud-final-release.md) описаны уже доступные A/B/C/D, приватные фото и reusable DEMO-набор. Поиск, новая нарисованная зона, GIS import, автоматический календарь и LLM/история остаются явными ограничениями. Пароль и ключи в документы не включены; старые локальные пароли не подбирались.

Актуальная защита/офлайн-пакет описаны в [едином сценарии](defense/scenario.md). Runtime резерва fdc6e75 проверен отдельно (17/17 offline, 0 pageErrors, 39/39 файлов), медиа a66d542 сохраняют исходную маркировку. Свежий RU/KK Word care=3 сверяется отдельным evidence. Физический телефон, общая устная репетиция и начало planning UI остаются отдельными непроверенными пунктами. Новая основная932574e влита только в собственную ветку; публичные версии не менялись. [Свежий кандидат, проверки и блокер Direct Upload](cloud-web-deployment.md#кандидат-после-повторного-fetch--a7e2b96-ещё-не-deployment).

## Исторический журнал 98cf6c6 / 1916d19

Следующий текст сохраняет прежние результаты, версии и ограничения на момент тех прогонов. Формулировки «нет origin», Stage A, текущий 98cf6c6 и открытый #40 здесь исторические; они не описывают публикации из текущей сводки выше. Независимая QA принятой основной не переносится на новые изменения #35.

### Что уже сделано в других окружениях

Сверены GitHub PR и свежие remote refs после `git fetch origin`.

| Работа | Подтверждённое состояние |
|---|---|
| #20, E2E-06 | MERGED; повторно не реализовывался |
| #21/#23/#24, Outcomes | MERGED; новые формы и формулы не добавлялись |
| #3 / #30 | CLOSED, ветки не удалялись |
| #32 | MERGED; исторический независимый QA на 82b2246 сохраняется |
| #36 / #37 / #38 | MERGED; основная `98cf6c68d5370331d6f95aa9e749f82d504e5670` |
| #35 | Draft, продолжен в своём worktree обычным merge основной |
| #39 | Draft `3e25d3dd49498afdf879c92770f74c0cdba06b03`: Stage A, PostgreSQL planning/reference API, 31 операция; без публичного origin и полного photo/task/Outcomes процесса; CI 4/4 PASS |
| #40 | OPEN, не Draft, `3995322943d1973942698e6fe4287b82423ded18`: независимая QA принятой основной 98cf6c6, CI 3/3 PASS; не влит |

Капитанский прогон на `20e642b` — mock 244 PASS / 2 desktop-пропуска, API 74 PASS, Docker A/B PASS — записан в [его отчёте](release-api-acceptance-2026-10-31.md). Новый независимый итог Айданы в #40 описан отдельно ниже. Этот компьютер не повторял Docker и не менял пользовательские базы/тома.

Старый незакоммиченный локальный пакет `codex/defense-demo` на 8dfebc7 сохранён отдельно. Он не опубликован поверх более нового #37. Merge #35 с основной зафиксирован коммитом **`02814fdb21cbba5b0512e179541f66494618269d`**, без rebase, force push и изменений основной ветки.

### Независимая QA #40: принятая основная, не новые изменения #35

[Отчёт Айданы](https://github.com/foxfordkz-cyber/qadamxpavlodar/blob/3995322943d1973942698e6fe4287b82423ded18/tools/e2e/RUN-RESULTS.md) относится к чистому tested SHA **`b836605ed1ecb5eea3425f52bf2f47b178487de5`**. Последующие коммиты до head #40 добавляют отчёты и доказательства. Дерево `apps` **`16454d07e3b76df4bf7b0bc86933f52acd394ad0`** независимо сверено через Git и одинаково у основной **`98cf6c68d5370331d6f95aa9e749f82d504e5670`**, tested SHA и head #40. Все изменения QA находятся в `tools/e2e/**`. Это подтверждает принятую основную; новые состояния подключения и worker transport из #35 этим полным прогоном не проверялись.

| Среда | Независимый результат и условия |
|---|---|
| Полный локальный mock | **272 PASS, 0 failed, 2 skipped**, 0 fixme/flaky/notRun; 2 workers, retries=0. Два пропуска — мобильные сценарии в desktop-project, на mobile они выполнены |
| Полный изолированный API | **74 PASS**, без пропусков/ошибок; 1 worker, retries=0, временная SQLite, privacyScan=passed |
| Docker/nginx | **16 PASS**, отдельный составной сценарий, не полный API-набор; новый QA-проект/том, порт 18083. Фото, 16 таблиц, история, прогноз и сессия сохранились после restart/reseed/recreate |
| Исторический публичный mock до обновления | **14 PASS, 2 failed**: E2E-09 на RU/KK 375 px, normal/presentation. Это старая публикация; deployment ID и application SHA в независимом отчёте оставлены `null`. Новый deployment и его повтор 16/16 приведены ниже |

Окружение QA: Windows, Node 24.22.2, Playwright 1.64.1. `check:tools` 24/24, `check:report` 3/3 до и после упаковки, локальный gate exit 0. Архив [локальной приёмки](https://github.com/foxfordkz-cyber/qadamxpavlodar/blob/3995322943d1973942698e6fe4287b82423ded18/tools/e2e/evidence/2026-10-31-release-b836605.zip): **4 827 113 байт**, SHA256 **`e1198799cae1b34d1822d8d16a97a2725b661c25f6e72522b4cb2d61142cfab8`**. При повторном read-only аудите размер, SHA256, целостность ZIP и хеш Docker result совпали с manifest; в архиве 30 PNG. Публичные и Docker-кадры хранятся отдельно. Это не повтор запуска тестов на этом ПК и не приёмка Render/Supabase.

QA также записала небольшое **E2E-10**: подсказка «Три шага» RU/KK указывает помощника внизу справа, хотя рабочая кнопка находится в шапке. Это отдельное замечание к принятой 98cf6c6, не скрытый skip полного набора; статус исправления последующих веток этот отчёт не устанавливает. Нативный Word/видео QA #40 не проверяла; выполненные здесь проверки пакета #37 описаны ниже.

### Свежие проверки объединённого web/worker

Windows, Node **24.14.1**, зависимости из lockfile (`npm ci`). Production web собран с `VITE_DATA_SOURCE=mock`; явный query `source=api` проверялся отдельно. Во время этого прогона все web/worker исходники совпадали с merge `02814fd`; последующее изменение transport-прокси не входит в frontend bundle. Результаты не переносятся автоматически на будущие изменения #35.

| Проверка | Фактический результат |
|---|---|
| web `npm run typecheck`, `npm run build` | PASS / PASS; штатное предупреждение Vite о размере chunks |
| web `npm test` | **201 PASS**, 0 failed/skipped/cancelled |
| `check:i18n` | PASS, **1945/1945**, missing/extra/placeholders = 0 |
| `check:zones`, `check:care`, `check:survival` | PASS; survival относится к синтетическим данным |
| worker `npm test` | **90 PASS**, 0 failed/skipped/cancelled |
| Connection UI RU/KK × 375/1280 | **4/4 PASS**, 0 pageErrors |
| Исходный E2E-09: `defence-final.mock.spec.ts --grep "mobile assistant" --workers=1` | **4/4 PASS**, 56,2 с; retries=0, tests/config не изменялись |

Connection UI запускался на production preview `127.0.0.1:4181`, Playwright 1.64.1 / bundled Chromium. HTTP-сбой был **явно инъецированной тестовой ситуацией**, не имитацией выполненного cloud deploy: ожидание первого ответа → 503 → ограниченная проверка → отмена без следующего запроса → ручной повтор → настоящий UI входа после контрактного 401. Все запросы восстановления — GET. Режим остаётся `source=api`; отдельная ссылка mock не используется автоматически и сбрасывает приватный маршрут кабинета. На обеих ширинах нет горизонтального переполнения.

Worker-набор отдельно проверяет потерю ответа после сохранения upload/report: черновик, байты фото, замороженное тело и ключ сохраняются; ожидание не вызывает новый POST; явный повтор использует прежний ключ и оставляет по одной записи upload/report. Это fixture transport и локальные тесты, не повтор публичного облачного сценария.

E2E-09 использует исходный hit-test Айданы для home/lab/outcomes/priorities, RU/KK, 375×812, включая Alt+P и верх приоритетов. Он запущен в обоих исходных browser projects; все четыре целевых теста прошли. Полный mock/API-набор в этой работе не запускался. Собственных изменений в `tools/e2e` нет.

### Прокси и контракт Бекзата

[Контракт Stage A на 3e25d3d](https://github.com/foxfordkz-cyber/qadamxpavlodar/blob/3e25d3dd49498afdf879c92770f74c0cdba06b03/docs/cloud-api-contract.md) заменяет первоначальный срез a0e827a. Транспортные требования не изменились. При сверке с a0e827a было выявлено и исправлено одно расхождение: старый transport возвращал same-origin redirect браузеру, что могло инициировать повтор POST. Теперь 301/302/303/307/308 возвращают **502 PROXY_REDIRECT_REJECTED**, без Location/Set-Cookie; исходящий запрос выполняется один раз. Отказ не ждёт зависшего закрытия upstream body.

Финальный `node --test cloudflare/api-proxy.test.mjs`: **13/13 PASS**. Проверены фиксированные origin, Cookie/Set-Cookie/CSRF/idempotency, multipart/binary, no-store, отмена/тайм-аут, HTML 502/503 cold start и отсутствие повторной мутации. Это **Node transport tests**. Pages Function, Cloudflare headers/runtime и реальные HTTPS-cookie не проверены; binding/upstream не добавлялись.

Stage A расширил PostgreSQL API с 8 до **31 операции**: auth/evidence/resources, зоны и контекст, каталог/источники/расценки, существующие расчёты и неизменяемые analysis snapshots. `ready` сообщает миграцию 2 и capabilities `auth,evidence,resources,sites,context,analysis,rates,snapshots`, но `photos: unsupported`. [Приёмка Stage A](https://github.com/foxfordkz-cyber/qadamxpavlodar/blob/3e25d3dd49498afdf879c92770f74c0cdba06b03/docs/cloud-stage-a-acceptance.md) подтверждает локальный PostgreSQL/HTTP и равенство расчётов SQLite; она не является browser WebGL или native Word проверкой. CI на точном SHA — [4/4 PASS](https://github.com/foxfordkz-cyber/qadamxpavlodar/actions/runs/41192919855).

Полный frontend по-прежнему не подключён к #39. Stage B (бригады/задачи/назначения/отчёты/приёмка), C (авторизованные фото и storage) и D (Outcomes) не реализованы; map overlays tasks/plants/designs, рисование/изменение зон и assistant также не готовы. Planning snapshots не являются Outcomes forecasts. **Публичного Render-origin нет**, HTTPS/redeploy/другое устройство не приняты. Server-only ключи не добавлялись в frontend; работа #35 не меняла расчёты, модели или сервер.

### Повтор пакета защиты #37

Код записи и portable mock остаётся **a66d542c63c527d608400c84b34d49f982855369**. Не выдаём их за видео фикса E2E-09 или текущего #35.

- Девять слайдов PPTX и девять PDF-страниц повторно отрендерены и осмотрены. Хеши PPTX/PDF, двух MP4 и RU/KK документов совпали с исходными манифестами. Десять арифметических проверок PASS.
- Разница двух/трёх лет ухода сохранена: 9 970 478 → 10 825 628 ₸; дополнительный год 855 150 ₸. В Word точный итог 10 825 627,5 ₸. Outcomes только для деревьев не смешивается с общей сметой.
- Исправлены два локальных пути Word в `deck-manifest.json`. Реплики согласованы с существующими notes PPTX: Word — Бекзат, кабинет — Танирберди; четыре участника сохранены.
- Полный/короткий MP4 **300,263333 / 160,263333 с**: полный A/V decode PASS, browser playback/seek **2/2**, просмотрены 49 контрольных кадров. Отдельного человеческого прослушивания всей синтетической озвучки не было.
- Portable mock пересобран из точного a66d542 с официальным Node 24.22.1 (хеш проверен). Оригинальные offline scripts: **17/17 PASS**, все внешние запросы блокированы, 0 pageErrors; 39/39 файлов исходного пакета сверены. Подложка/внешние фото без сети не обещаются.
- Оба неизменённых DOCX открыты через UI в **Microsoft Word 2016**, по шесть страниц, без диалогов восстановления: open **2/2 PASS**. RU первые две страницы осмотрены; KK подтверждён доступным текстом. Полный постраничный Word QA **PARTIAL** из-за нестабильного захвата второго окна. Исторический LibreOffice QA не переписан.

Синтетическая модель, вымышленная история, неполный KK кабинета/экспорта, русские fallback-названия растений и отсутствие новых форм Outcomes явно перечислены в [едином сценарии](defense/scenario.md). Регламент организаторов и устная общая репетиция остаются внешними непроверенными пунктами.

### Публичные режимы и оставшиеся действия

Текущий mock: [green-pavlodar-mock.pages.dev](https://green-pavlodar-mock.pages.dev/). **Публикация 98cf6c6 выполнена** через Cloudflare Direct Upload; фактический deployment ID **`1079de0b-d78a-4350-8242-e718d2aad30e`**, [immutable URL](https://1079de0b.green-pavlodar-mock.pages.dev/). Production URL и QR не изменились. Это не автоматическая Git-сборка и не публикация изменений #35. Предыдущий deployment **`eb0cd70c-0f25-4930-820c-e57bf614c719`** на a66d542 сохранён как исторический резерв для rollback.

Первоначальная попытка 31.10.2026 на этом ПК: вкладка Cloudflare Dashboard показывала вход, CLI-авторизация отсутствовала. CUA остановил управление Windows-браузером по policy: инструмент не смог определить текущий browser URL (`unable to determine current browser URL`). На этом этапе загрузка ещё не была выполнена. Позже пользователь вошёл в Cloudflare; CUA открыл авторизованную главную страницу и управление восстановилось. Загрузка завершена и подтверждена в Cloudflare UI. Это исторический блокер, не текущее отсутствие доступа.

Подтверждённая публикация и отдельные проверки после неё:

| Поле нового deployment | Состояние на момент сводки |
|---|---|
| Deployment ID / immutable URL | Cloudflare UI: `1079de0b-d78a-4350-8242-e718d2aad30e`, `https://1079de0b.green-pavlodar-mock.pages.dev/` |
| Загруженная сборка | Чистый 98cf6c6; проверенный ZIP, 34/34 файлов загрузки |
| HTTP-хеши production и immutable URL | **68/68 PASS**: по 34 файла на каждом origin, HTTPS 200, точное совпадение байтов и SHA256 с опубликованным ZIP; проверка `2026-10-31T10:38:58.651Z` |
| Публичный повтор RU/KK × 375/1280 | **16/16 PASS**, 0 failed/skipped/flaky, exit 0, около 1,1 мин; неизменённые тесты QA #40, включая E2E-09 normal/presentation. Это повтор владельца, не новая независимая приёмка Айданы |
| Новый portable runtime 98cf6c6 | **17/17 PASS**, 86 внешних запросов заблокировано, 0 pageErrors, 39/39 хешей совпали; медиа защиты остаются a66d542 |

Публичный API отдельно заблокирован отсутствием Render-origin и завершённого backend workflow; восстановление доступа к static mock этого не меняет.

Опубликованный Direct Upload ZIP: `green-pavlodar-mock-98cf6c6.zip`, 1 605 704 байт, SHA256 `7660c181f3626f60b60a64fc8b2df4c488a7e1c288744a8edfb3fec6447904d2`. Node 24.14.1 / npm 11.11.0, чистый detached **`98cf6c68d5370331d6f95aa9e749f82d504e5670`**, `VITE_DATA_SOURCE=mock`, унаследованные VITE-переменные очищены, локальных .env нет. Все 34 ZIP-entry совпали с dist; `index.html` в корне. [Манифест сборки](cloudflare-evidence/2026-10-31-publication-candidate.json). Историческая HTTP-сверка production до обновления с immutable eb0cd70c — [34/34 совпадения](cloudflare-evidence/2026-10-31-public-existing.json); она не заменяет отдельную сверку нового deployment.

[HTTP-доказательство нового deployment 1079de0b](cloudflare-evidence/2026-10-31-published-98cf6c6.json) связывает фактический Cloudflare ID с проверенным ZIP и точным source SHA. Все 34 файла совпали на production и immutable URL. Это подтверждает опубликованные байты; браузерная функциональная приёмка фиксируется отдельно.

[Архив публичной проверки](cloudflare-evidence/2026-10-31-public-evidence-98cf6c6.zip): 1 967 358 байт, SHA256 `54b4f3a7a92ea5d98666465b4cca7805e07da69ca362cadf4fc7a60ad924df10`. Включены 20 просмотренных PNG, четыре hit-test JSON, безопасные summary/run-manifest и пояснение; CRC и все хеши проверены. Raw-отчёты/error-context оставлены локально. [Снимок опубликованной карты](cloudflare-evidence/2026-10-31-published-98cf6c6.jpg) показывает новый помощник в шапке и явную маркировку mock.

[Публичный повтор владельца](cloudflare-evidence/2026-10-31-public-smoke-98cf6c6.json) использует неизменённый набор из QA head `3995322943d1973942698e6fe4287b82423ded18`. Все 16 сценариев прошли, включая прежние E2E-09 RU/KK на 375 px и desktop в обычном/презентационном режимах. Это подтверждает новый deployment в указанной матрице, но не является независимым повтором Айданы или тестом полного облачного API.

Новый отдельный архив **`green-pavlodar-show-98cf6c6.zip`**: runtime 98cf6c6 и неизменённые медиа a66d542. Запуск через **корневой `start-mock.cmd`** нового пакета; старые `media/final-a66d542/offline` и `offline/start-mock.cmd` не заменены. SHA256 готового ZIP — в соседнем файле `.sha256`, состав — в manifest. Новый runtime отдельно прошёл указанные выше 17/17; это не переименование прежнего офлайн-прогона a66d542.

Дальше: передать Айдане новый deployment ID/SHA и результат повтора владельца для независимой публичной приёмки; капитану проверить #35. После полного контракта Бекзата подключить фиксированный same-origin `/api/*` proxy и отдельно проверить роли, CSRF/cookie, фото, Outcomes, холодный старт, восстановление, RU/KK и 375/1280. Телефон/другое устройство при остановленных backend и туннеле в этой работе **не проверены**.
