# Подготовка прокси Pages — не опубликованный Function

`api-proxy.mjs` — проверяемое транспортное ядро. Оно сверено с [контрактом PostgreSQL API на a0e827a](https://github.com/foxfordkz-cyber/qadamxpavlodar/blob/a0e827abe2d2a873c4609b311ce041095dc21819/docs/cloud-api-contract.md), но пока **не подключено** к Pages Functions: публичного Render URL и принятого SHA развёрнутого сервера нет. Файл не импортируется клиентом и не попадает в mock build. Имена deployment bindings и рабочие адреса не заданы. `.invalid` в тестах — только тестовые адреса.

Проверка: из корня `node --test cloudflare/api-proxy.test.mjs`.

Ядро принимает два фиксированных HTTPS origin из доверенной конфигурации, сохраняет метод/path/query/body/multipart/binary, Cookie, CSRF, Idempotency-Key, статусы и отдельные Set-Cookie. Оно не читает upstream из запроса и не следует редиректам. Любой upstream redirect (301/302/303/307/308), включая тот же origin или ответ без Location, возвращает 502 `PROXY_REDIRECT_REJECTED` без Location и Set-Cookie; запрос не повторяется. Статика возвращает `null` для передачи обычному обработчику Pages. Все проксируемые ответы имеют no-store; Cache API не используется. Ни тела, ни заголовки, ни исключения не логируются.

Host определяется адресом upstream; входной Origin сохраняется. Недоверенные Forwarded/X-Forwarded-* удаляются. Cookie не переписываются: контракт cloud-сервера задаёт `gp_v2_session`, Secure, HttpOnly, SameSite=Strict, Path=/api/v1 и отсутствие Domain. Реальные Host/Origin и обработку HTTPS ingress нужно подтвердить после развёртывания. Нельзя снять CSRF или расширить Origin/Host до wildcard.

Срез a0e827a поддерживает только auth, evidence и resources. Он явно возвращает 503 для остальных cloud-доменов; задачи, отчёты, фото, карта и Outcomes ещё не перенесены. Unit-проверка прозрачной передачи multipart/binary в ядре **не означает поддержку загрузок облачным API**. Полный frontend #35 не подключён к этому ограниченному срезу. Ошибки API и HTML 502/503 от cold-start ingress передаются без подмены mock-данными.

До подключения runtime:

1. Зафиксировать фактические API/public origin, серверный SHA, readiness capabilities и имена bindings. Для полного UI отдельно дождаться реализации и проверки постоянства задач, отчётов и приватных фото; текущая проверка PostgreSQL среза этого не подтверждает.
2. Добавить адаптер Pages Functions только для `/api/*`, а в output — `_routes.json` с соответствующим include; проверить точный `/api` при необходимости. Учесть, что корневой `functions/` автоматически обнаруживается также при сборке mock-проекта той же ветки. Существующий mock deployment не обновлять этой конфигурацией без отдельной проверки независимости.
3. Проверить адаптер в Wrangler/Cloudflare runtime и настоящем браузере: unit-тесты Node не доказывают работу CDN, headers runtime или cookie.
4. Выполнить публичную матрицу из [инструкции](../docs/cloud-web-deployment.md), включая пять ролей, фото/повтор с тем же ключом и мобильный интернет без локального backend/туннеля.

Тайм-аут ядра ограничивает ожидание заголовков upstream (65 секунд по умолчанию), не является полным ограничением времени потокового скачивания. Клиент отдельно ограничивает ожидание операции. Автоматического повтора изменяющих запросов нет; timeout не означает, что сервер не сохранил операцию.

Уже отменённый запрос не передаётся upstream. В hop-by-hop заголовке Connection удаляются сам заголовок и корректные имена перечисленных служебных заголовков; некорректный токен не вызывает необработанное исключение. Оба случая покрыты отдельными регрессиями.

Реализация сверена с документацией Cloudflare: [ручная обработка redirect и cacheTtlByStatus](https://developers.cloudflare.com/workers/runtime-apis/request/), [Set-Cookie](https://developers.cloudflare.com/workers/runtime-apis/headers/), [ограничение маршрутов Functions](https://developers.cloudflare.com/pages/functions/routing/). Отрицательное значение запрещения cache задаётся именно в cacheTtlByStatus; cacheTtl принимает только неотрицательные значения.
