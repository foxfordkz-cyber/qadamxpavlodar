# Публикация перед сдачей 1 ноября: передача владельца

**Обе публикации подтверждены Cloudflare и сверены по файлам.** API опубликован **1 ноября 2026 в 00:00**, mock — **в 00:01 UTC+5**; время Dashboard имеет точность до минуты. **С 00:04 UTC+5 оба frontend зафиксированы до завершения приёмки Айданы.** Новые функции и редизайн не добавлялись.

[Передача Айдане и капитану](https://github.com/foxfordkz-cyber/qadamxpavlodar/pull/35#issuecomment-6547845219), [единый манифест публикации](cloudflare-evidence/final-2026-11-01/publication-manifest.json), [папка доказательств](cloudflare-evidence/final-2026-11-01/). Публикация и файловая сверка завершены; независимая QA и новый авторизованный облачный UI-прогон **не объявляются завершёнными**.

## Версия и окно

`git fetch origin` и обычный `git merge origin/codex/coordinator` завершены. Принятая основная и локальная ветка после merge: **`84d009e3b72c4fe637ef30607e29701054b6c621`**. [CI принятой версии](https://github.com/foxfordkz-cyber/qadamxpavlodar/actions/runs/41229641487): **3/3 PASS**. Rebase, force push и самостоятельное вливание в coordinator не выполнялись.

Для API используется ранее проверенный архив **c970264**. Сравнение Git подтверждает идентичность каталогов `apps/web`, `tools/worker-demo`, `cloudflare` между c970264 и принятой 84d009e. Исходный SHA архива сохраняется; HEAD документации не называется опубликованной версией.

[Окно публикации согласовано с Айданой через владельца](https://github.com/foxfordkz-cyber/qadamxpavlodar/pull/35#issuecomment-6547696482): **1 ноября 00:00–00:20 UTC+5** (31 октября 19:00–19:20 UTC). Обе загрузки выполнены внутри окна, затем Айдане переданы точные версии. Во время обновления публичная/cloud QA приостанавливалась; локальные проверки могли продолжаться. **После передачи не обновлять production до завершения приёмки; критическое изменение или откат согласовать отдельно.**

## Две разные сборки

| Поле | API frontend | Независимый mock |
|---|---|---|
| Production | https://green-pavlodar-api.pages.dev/?source=api | https://green-pavlodar-mock.pages.dev/ |
| Неизменяемый URL | https://a26bd214.green-pavlodar-api.pages.dev/ | https://d0e985d1.green-pavlodar-mock.pages.dev/ |
| Source SHA опубликованного архива | `c970264919de2f7a62d0e1ea8a28cc70c95a3864` | `84d009e3b72c4fe637ef30607e29701054b6c621` |
| Конфигурация | `VITE_DATA_SOURCE=api`, фиксированный same-origin proxy | `VITE_DATA_SOURCE=mock`, без Pages Function и backend |
| Архив | `api-c970264/green-pavlodar-api.zip` | `mock-84d009e/green-pavlodar-mock-84d009e.zip` |
| Размер | 1 644 189 байт | 1 589 722 байта |
| SHA256 ZIP | `24118f721ba6becab51c5728ea87fb0154e85db76c9007db831979b66c36edc0` | `c7e466ea13355bdd5b0a6506cb7412de0ca44dc54c6272059f5bb85d49b4903d` |
| Подтверждённый deployment ID | `a26bd214-1c78-4a83-9536-74a35c85b49f` | `d0e985d1-bbd0-4f8c-b1c1-31d20d164ef7` |
| Cloudflare Status | **Success** | **Success** |
| Время Dashboard, 1 ноября UTC+5 | **00:00**, точность до минуты | **00:01**, точность до минуты |

Исходные пакеты находятся в локальном `outputs/final-publication-2026-11-01/`, рядом с каждым ZIP есть `manifest.json` и SHA256. Этот каталог не включается в публичные файлы сайта. API и mock загружены в разные существующие проекты: mock не содержит `_worker.js`/`_routes.json`, а API включает фиксированный proxy. Cloudflare подтверждает UUID и immutable URL; связь с source SHA доказана манифестом загруженного ZIP и совпадением публичных байтов, а не Git SHA, возвращаемым Direct Upload.

[API Success в Dashboard](cloudflare-evidence/final-2026-11-01/api-cloudflare-success.jpg), [mock Success в Dashboard](cloudflare-evidence/final-2026-11-01/mock-cloudflare-success.jpg). Снимки просмотрены; аккаунт, пароли и ключи не показаны.

Backend остаётся **`3b14927def04b35bf97782eae6b550da276c779f`**, origin **https://green-pavlodar-api-demo.onrender.com**. [Подтверждение Бекзата и границы реального сценария](https://github.com/foxfordkz-cyber/qadamxpavlodar/pull/35#issuecomment-6546828382). Render Dashboard также показывал тот же Live SHA, deployment `dep-dbj223h42hec73bqnttg`. PR #39 HEAD и frontend HEAD не заменяют runtime SHA backend. При этой публикации Render не перезапускался; БД, пароли и Supabase не изменялись.

## Что уже проверено

- **Новый публичный API:** 34 статических файла × production/immutable — **68/68** совпадений размера и SHA256, **1 ноября 00:01:54–00:02:13 UTC+5**. Production `/api/v1/ready` — **200 JSON**, `/api/v1/auth/me` без сессии — **401 JSON**; оба `Cache-Control: no-store, private`. [Результат](cloudflare-evidence/final-2026-11-01/published-api-a26bd214-static.json).
- **Новый публичный mock:** 34 статических файла × production/immutable — **68/68**, **1 ноября 00:02:49–00:03:12 UTC+5**. [Результат](cloudflare-evidence/final-2026-11-01/published-mock-d0e985d1-static.json). Итого **136/136** файловых проверок и **2/2** анонимных API-probes. Это не авторизованная браузерная приёмка.
- API ZIP: **36/36** записей совпали с манифестом; CRC PASS; копия архива побайтно совпала. Ограниченная проверка имён файлов и известных форматов секретов не выявила совпадений; это не математическое доказательство отсутствия любых секретов.
- Mock: чистый detached worktree84d009e; Node24.14.1/npm11.11.0; typecheck/build PASS. **34/34** файлов совпали после ZIP roundtrip, повторная упаковка детерминирована. Остальные `VITE_*` очищены, локальных `.env` нет.
- Точная mock-сборка локально: **4/4** RU/KK ×375/1280, новая сессия без входа и без `source` query. Главная и114участков доступны, DEMO обозначен, E2E-10 исправлен; API-запросов, pageErrors и горизонтального переполнения нет. Внешняя сеть заблокирована; показана схема вместо тайлов. Это **локальный**, не новый публичный прогон.
- До публикации, **31 октября 23:47 UTC+5**, index/mainJS/WorkerPage старых API и mock дали **6/6** совпадений. Это сохранённый baseline предыдущих версий, а не результаты нового deploy.
- В Cloudflare Dashboard подтверждены новые UUID/Success и сохранены предыдущие IDs для отката. API Runtime: compatibility date `2026-06-16`, flags `[]`, **Fail closed**; переменные/секреты и storage bindings в Pages отсутствуют.

Отдельный [безопасный local mock QA summary](cloudflare-evidence/final-2026-11-01/mock-local-qa-summary.json) и [архив доказательств](cloudflare-evidence/final-2026-11-01/mock-84d009e-local-qa.zip) содержат локальные main/worker/foreman/участок+Word проверки, по **4/4** на RU/KK × 375/1280. Это **predeployment mock**, не новая публичная или независимая приёмка. Сохранение раздела/текста/фото/ключа проверялось при переключении языка; отправка бригадиром в этом локальном наборе не выполнялась. Четыре DOCX скачаны через UI и проверены по OOXML/числам; новое открытие в Microsoft Word не заявляется. Остальные ограничения сохранены в summary.

**Поведение mock после полного reload:** новая демонстрационная сессия использует роль координатора; выбранный язык сохраняется. В локальных worker/foreman-тестах reload выполнялся **до входа соответствующей ролью**, затем роль выбиралась заново. Этот результат не доказывает сохранение worker-сессии после reload и не заменяет проверку облачных cookies.

Новый authenticated cloud UI **NOT RUN**: согласованного приватного DEMO-доступа на frontend-компьютере нет. По backend runbook `DEMO_PASSWORD` удаляется из Render после bootstrap; рабочий пароль остаётся в приватном operator environment. Значения не передавать в чат/PR/архивы/скриншоты. Прежние результаты Бекзата на aee7242 не переименовываются в проверки c970264.

## Передача и дальнейшая приёмка

В Cloudflare использован путь **существующий проект → Create deployment → Production → file → Save and deploy**, отдельно для двух разных ZIP. После Success зафиксированы UUID/immutable/time и выполнена полная файловая сверка. Повторная загрузка этих пакетов сейчас не требуется.

[Айдана и капитан получили точные версии, результаты и freeze](https://github.com/foxfordkz-cyber/qadamxpavlodar/pull/35#issuecomment-6547845219). Для воспроизводимой проверки использовать production и immutable из таблицы; `_worker.js`/`_routes.json` не являются публичной статикой. На immutable API намеренно отвечает **421**; вход проверять через API production.

[Публичный UI smoke и свежие Word](cloudflare-evidence/final-2026-11-01/public-ui/README.md) зафиксированы отдельно: worker/foreman RU/KK и все три раздела на 375/1280; учебный worker-отчёт с изображением, сохранение текста/фото/раздела при переключении языка; API-экран входа RU/KK; публичный экспорт Word RU/KK и открытие обеих записок в Microsoft Word. В Word визуально просмотрены только первые экраны. Публичные ключи отправки, сетевые сбои и авторизованный cloud-цикл не проверялись. Айдане остаётся независимая приёмка, а после получения согласованных DEMO-доступов — login/logout и worker/foreman/photo/report/acceptance/viewer. Секреты передаются только согласованным приватным способом, не через этот документ или PR.

## Предыдущие публикации и откат

| Проект | Подтверждённый предыдущий deployment | Source SHA | Immutable |
|---|---|---|---|
| API | `ff01f45d-69ed-45a9-af1c-ad1d26b8983a` | `aee7242ee899f1f596a704adba6e1279c37af9df` | https://ff01f45d.green-pavlodar-api.pages.dev/ |
| Mock | `f816c350-5722-4b56-a180-4124da01c5ba` | `fdc6e756be99dc5ba3a7a48ca1df17c4bfbef5ef` | https://f816c350.green-pavlodar-mock.pages.dev/ |

Оба сохранены в истории провайдера; не удалять. При критической ошибке согласовать откат к соответствующему предыдущему deployment и сообщить новый статус QA. Более старые mock1079de0b/eb0cd70c также сохранены.

## Защита

[Короткая инструкция и QR](defense/release-handoff.md), [единый сценарий](defense/scenario.md). Медиаa66d542 и проверенный offline runtimefdc6e75 подписаны своими версиями. Облачные поиск/рисование/GIS/import/assistant, возвращающие503, не показываются как готовые. Учебный mock назван отдельным резервом; синтетические оценки не являются гарантией приживаемости.

**Публикация и передача завершены:** оба deployment подтверждены провайдером, файлы совпали с точными сборками, версии переданы Айдане и зафиксированы с 00:04 UTC+5. **Независимая QA ещё не завершена; новый авторизованный облачный UI-прогон владельца — NOT RUN.** Эта граница сохраняется до новых фактических результатов.
