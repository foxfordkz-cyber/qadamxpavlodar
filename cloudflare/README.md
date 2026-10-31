# Подготовка прокси Pages — не опубликованный Function

`api-proxy.mjs` — проверяемое транспортное ядро. Первоначальная сверка a0e827a обновлена до [контракта Stage A на 3e25d3dd49498afdf879c92770f74c0cdba06b03](https://github.com/foxfordkz-cyber/qadamxpavlodar/blob/3e25d3dd49498afdf879c92770f74c0cdba06b03/docs/cloud-api-contract.md); транспортные требования не изменились. Ядро пока **не подключено** к Pages Functions: публичного Render URL и принятого SHA развёрнутого сервера нет. Файл не импортируется клиентом и не попадает в mock build. Bindings/upstream не заданы; `.invalid` в тестах — только тестовые адреса.

Проверка: из корня `node --test cloudflare/api-proxy.test.mjs`.

Ядро принимает два фиксированных HTTPS origin из доверенной конфигурации, сохраняет метод/path/query/body/multipart/binary, Cookie, CSRF, Idempotency-Key, статусы и отдельные Set-Cookie. Оно не читает upstream из запроса и не следует редиректам. Любой upstream redirect (301/302/303/307/308), включая тот же origin или ответ без Location, возвращает 502 `PROXY_REDIRECT_REJECTED` без Location и Set-Cookie; запрос не повторяется. Статика возвращает `null` для передачи обычному обработчику Pages. Все проксируемые ответы имеют no-store; Cache API не используется. Ни тела, ни заголовки, ни исключения не логируются.

Host определяется адресом upstream; входной Origin сохраняется. Недоверенные Forwarded/X-Forwarded-* удаляются. Cookie не переписываются: контракт cloud-сервера задаёт `gp_v2_session`, Secure, HttpOnly, SameSite=Strict, Path=/api/v1 и отсутствие Domain. Реальные Host/Origin и обработку HTTPS ingress нужно подтвердить после развёртывания. Нельзя снять CSRF или расширить Origin/Host до wildcard.

Stage A поддерживает 31 операцию: auth/evidence/resources, persistent sites/context/catalog/rates/sources, существующие расчёты и immutable analysis snapshots. CI 4/4 и локальная PostgreSQL/HTTP-проверка подтверждены, но публичного backend-origin нет. Stage B задач/отчётов, C фото, D Outcomes и полный map/assistant workflow не реализованы. Unit-передача multipart/binary **не означает поддержку cloud-загрузок**; photos остаётся unsupported. Полный frontend #35 не подключён. Ошибки API и HTML502/503 от cold-start ingress передаются без подмены mock-данными.

Отдельный статический mock опубликован из принятой основной 98cf6c6: deployment `1079de0b-d78a-4350-8242-e718d2aad30e`, [production](https://green-pavlodar-mock.pages.dev/) и [immutable](https://1079de0b.green-pavlodar-mock.pages.dev/). [68/68 HTTP-сверок](../docs/cloudflare-evidence/2026-10-31-published-98cf6c6.json) подтверждают файлы; это не публикация proxy/API. Независимая QA #40 принятой основной (mock 272/2 skip, API 74, отдельный Docker 16) также не является Cloudflare Function/runtime acceptance. Публичный повтор владельца нового mock — **16/16 PASS**, 0 failed/skipped/flaky, не новый независимый прогон Айданы.

[Свидетельство публичного повтора владельца](../docs/cloudflare-evidence/2026-10-31-public-smoke-98cf6c6.json): **16/16 PASS**, RU/KK × 375/1280, 0 failed/skipped/flaky; неизменённые тесты из QA head `3995322943d1973942698e6fe4287b82423ded18`. Оба прежних E2E-09 на 375 проходят, как и desktop/обычный/презентационный режимы. Это проверка нового deployment 1079de0b, не новый независимый прогон Айданы и не полный облачный API.

До подключения runtime:

1. Зафиксировать фактические API/public origin, серверный SHA, readiness capabilities и имена bindings. Для полного UI отдельно дождаться реализации и проверки постоянства задач, отчётов и приватных фото; текущая проверка PostgreSQL среза этого не подтверждает.
2. Добавить адаптер Pages Functions только для `/api/*`, а в output — `_routes.json` с соответствующим include; проверить точный `/api` при необходимости. Учесть, что корневой `functions/` автоматически обнаруживается также при сборке mock-проекта той же ветки. Существующий mock deployment не обновлять этой конфигурацией без отдельной проверки независимости.
3. Проверить адаптер в Wrangler/Cloudflare runtime и настоящем браузере: unit-тесты Node не доказывают работу CDN, headers runtime или cookie.
4. Выполнить публичную матрицу из [инструкции](../docs/cloud-web-deployment.md), включая пять ролей, фото/повтор с тем же ключом и мобильный интернет без локального backend/туннеля.

Тайм-аут ядра ограничивает ожидание заголовков upstream (65 секунд по умолчанию), не является полным ограничением времени потокового скачивания. Клиент отдельно ограничивает ожидание операции. Автоматического повтора изменяющих запросов нет; timeout не означает, что сервер не сохранил операцию.

Уже отменённый запрос не передаётся upstream. В hop-by-hop заголовке Connection удаляются сам заголовок и корректные имена перечисленных служебных заголовков; некорректный токен не вызывает необработанное исключение. Оба случая покрыты отдельными регрессиями.

Реализация сверена с документацией Cloudflare: [ручная обработка redirect и cacheTtlByStatus](https://developers.cloudflare.com/workers/runtime-apis/request/), [Set-Cookie](https://developers.cloudflare.com/workers/runtime-apis/headers/), [ограничение маршрутов Functions](https://developers.cloudflare.com/pages/functions/routing/). Отрицательное значение запрещения cache задаётся именно в cacheTtlByStatus; cacheTtl принимает только неотрицательные значения.
