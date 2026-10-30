# Подготовка прокси Pages — не опубликованный Function

`api-proxy.mjs` — проверяемое транспортное ядро. Оно пока **не подключено** к Pages Functions: нет согласованных `docs/cloud-api-contract.md`, Render URL и серверного SHA Бекзата. Файл не импортируется клиентом и не попадает в mock build. Имена deployment bindings и рабочие адреса не заданы. `.invalid` в тестах — только тестовые адреса.

Проверка: из корня `node --test cloudflare/api-proxy.test.mjs`.

Ядро принимает два фиксированных HTTPS origin из доверенной конфигурации, сохраняет метод/path/query/body/multipart/binary, Cookie, CSRF, Idempotency-Key, статусы и отдельные Set-Cookie. Оно не читает upstream из запроса и не следует редиректам. Редирект на API того же upstream переписывается на public origin; другой origin/HTTP/не-API путь отклоняется. Статика возвращает `null` для передачи обычному обработчику Pages. API и приватные фото имеют no-store; Cache API не используется. Ни тела, ни заголовки, ни исключения не логируются.

Host определяется адресом upstream; входной Origin сохраняется. Недоверенные Forwarded/X-Forwarded-* удаляются. **Это консервативная заготовка, а не согласование с сервером:** она не синтезирует forwarding-политику и не переписывает cookie. На a66d542 сервер ставит session cookie без Secure, а локальный nginx добавляет Secure при доверенном HTTPS. До подключения нужно согласовать с Бекзатом публичный Origin, Host/HTTPS, Secure/Domain/Path/SameSite, readiness, приватные photo URL и разрешённые редиректы. Нельзя снять CSRF или расширить Origin/Host до wildcard.

После передачи контракта:

1. Зафиксировать фактические API/public origin, серверный SHA и имена bindings из передачи, подтвердить постоянство БД и фото.
2. Добавить адаптер Pages Functions только для `/api/*`, а в output — `_routes.json` с соответствующим include; проверить точный `/api` при необходимости. Учесть, что корневой `functions/` автоматически обнаруживается также при сборке mock-проекта той же ветки. Существующий mock deployment не обновлять этой конфигурацией без отдельной проверки независимости.
3. Проверить адаптер в Wrangler/Cloudflare runtime и настоящем браузере: unit-тесты Node не доказывают работу CDN, headers runtime или cookie.
4. Выполнить публичную матрицу из [инструкции](../docs/cloud-web-deployment.md), включая пять ролей, фото/повтор с тем же ключом и мобильный интернет без локального backend/туннеля.

Тайм-аут ядра ограничивает ожидание заголовков upstream (65 секунд по умолчанию), не является полным ограничением времени потокового скачивания. Клиент отдельно ограничивает ожидание операции. Автоматического повтора изменяющих запросов нет; timeout не означает, что сервер не сохранил операцию.

Уже отменённый запрос не передаётся upstream. В hop-by-hop заголовке Connection удаляются сам заголовок и корректные имена перечисленных служебных заголовков; некорректный токен не вызывает необработанное исключение. Оба случая покрыты отдельными регрессиями.

Реализация сверена с документацией Cloudflare: [ручная обработка redirect и cacheTtlByStatus](https://developers.cloudflare.com/workers/runtime-apis/request/), [Set-Cookie](https://developers.cloudflare.com/workers/runtime-apis/headers/), [ограничение маршрутов Functions](https://developers.cloudflare.com/pages/functions/routing/). Отрицательное значение запрещения cache задаётся именно в cacheTtlByStatus; cacheTtl принимает только неотрицательные значения.
