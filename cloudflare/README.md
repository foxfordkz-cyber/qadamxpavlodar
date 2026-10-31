# Отдельный API-проект Cloudflare Pages

На 31 октября 2026 подготовлен runtime adapter для `https://green-pavlodar-api.pages.dev`. Фиксированный upstream — `https://green-pavlodar-api-demo.onrender.com`, развёрнутый backend SHA `3b14927def04b35bf97782eae6b550da276c779f`. Основание: [контракт и реальные provider evidence на a72131df](https://github.com/foxfordkz-cyber/qadamxpavlodar/blob/a72131df86272804f95d8331d0f627e62272b3ea/docs/cloud-api-contract.md). Backend A/B/C/D уже развёрнут с PostgreSQL и приватным хранилищем фото. Это синтетическая DEMO; поддержка оставшихся UI-маршрутов определяется [матрицей покрытия на a72131df](https://github.com/foxfordkz-cyber/qadamxpavlodar/blob/a72131df86272804f95d8331d0f627e62272b3ea/docs/cloud-route-coverage.md), а не наличием proxy.

Этот каталог содержит исходник и локальные проверки. Он сам не публикует сайт и не меняет настройки Render. Фактический deployment и публичная приёмка фиксируются отдельно в [журнале публикации](../docs/cloud-web-deployment.md). Независимый `green-pavlodar-mock.pages.dev` остаётся резервом: обычная сборка `apps/web` не включает эти файлы, корневой `functions/` не добавлен.

## Сборка из принятого SHA

Нужны Node 24, Git и зависимости `apps/web` из lockfile (`npm ci --prefix apps/web`). Из корня репозитория:

```sh
node --test cloudflare/api-proxy.test.mjs cloudflare/pages-worker.test.mjs
node cloudflare/build-api.mjs --public-origin https://green-pavlodar-api.pages.dev --out ../../outputs/cloud-api-final
```

Выходной каталог должен быть новым или пустым. Скрипт не удаляет существующие файлы. Он выполняет TypeScript/Vite build с `VITE_DATA_SOURCE=api`, собирает ESM `_worker.js` через esbuild и добавляет `_routes.json` только для `/api` и `/api/*`. ZIP содержит файлы непосредственно в корне, без внешнего каталога `dist`. Рядом создаются `manifest.json` и `green-pavlodar-api.zip.sha256`: точный Git SHA, признак незакоммиченных изменений, origin, runtime requirements и SHA-256 каждого файла. Порядок ZIP и timestamps фиксированы; распакованные байты проверяются при сборке. Для публикации использовать только manifest с `sourceDirty: false`, из принятого commit. Сравнение повторных сборок возможно при одинаковом Node и lockfile.

Разработческие `apps/web/.env*` для production запрещены этой сборкой, унаследованные `VITE_*` очищаются. Пароль, Supabase keys и DB credentials не нужны ни скрипту, ни Pages. Архив не содержит build manifest с локальными путями или секретов. Public origin приходит только из доверенного аргумента сборки; upstream зафиксирован в исходнике. Скрипт запрещает подменить существующий mock-проект.

## Настройки перед публикацией

1. Владелец backend должен добавить точный `https://green-pavlodar-api.pages.dev` в разрешённые browser origins. В handoff a72131df указаны только прежний mock origin и Render origin. До изменения allowlist вход с нового сайта вернёт 403; proxy сохраняет настоящий `Origin` и не обходит проверку.
2. В отдельном Pages-проекте `green-pavlodar-api`, **Settings → Runtime**, задать compatibility date **`2026-07-30`** и compatibility flag **`enable_request_signal`**. Они записаны в manifest и использованы локальным runtime test. ZIP сам не применяет настройки Dashboard. Дата включает поддержку `Request.cache: no-store` (по умолчанию с 2024-11-11); flag включает передачу отмены клиентского запроса. [Compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/).
3. Там же выбрать **Fail closed** для Pages Functions, чтобы при исчерпании квоты API не превращался в статический ответ. [Routing и fail-open/closed](https://developers.cloudflare.com/pages/functions/routing/).
4. Загрузить `green-pavlodar-api.zip` в этот отдельный проект через Direct Upload. Dashboard поддерживает готовый `_worker.js`; компиляция каталога `functions/` при drag-and-drop не поддерживается. [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).
5. Проверять API на production origin выше. На непредусмотренном preview/immutable origin API намеренно отвечает 421 `PROXY_ORIGIN_MISMATCH`. Не расширять доверенные origins wildcard. Для другого frontend origin нужны отдельная принятая конфигурация, allowlist backend и новая сборка.

Адаптер использует [Pages advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/): ESM entrypoint, API передаётся proxy, остальные пути при вызове worker — `env.ASSETS.fetch(request)`. `_routes.json` оставляет обычную статику вне Function. В runtime нет Node imports, DB/storage bindings или credentials.

## Контракт транспорта

Сохраняются метод, path/query, тело и multipart boundary, binary response, Cookie, отдельные Set-Cookie, CSRF, Idempotency-Key и HTTP status. Host определяется фиксированным upstream; недоверенные Forwarded/X-Forwarded-* удаляются. Cookies не переписываются: сервер задаёт host-only `gp_v2_session`, Secure, HttpOnly, SameSite=Strict, Path=/api/v1.

Все API-ответы имеют no-store; Cache API не используется. HTML 502/503 и другие upstream ошибки не подменяются mock-данными или SPA. Любой 301/302/303/307/308, даже без Location, превращается в 502 `PROXY_REDIRECT_REJECTED`, без Location/Set-Cookie и без повторной отправки запроса. Тела, cookies, токены и исключения не логируются.

Тайм-аут ядра 65 секунд ограничивает ожидание заголовков upstream, не всё потоковое скачивание. Отмена клиента передаётся upstream до получения заголовков при включённом `enable_request_signal`. Клиент отдельно ограничивает время операции. Автоматического повтора изменяющих запросов нет; timeout не доказывает, что сервер ничего не сохранил. Пользовательский повтор должен сохранять прежний Idempotency-Key согласно контракту.

## Локальный runtime test

Проверка готового bundle выполняется в настоящем локальном workerd через Miniflare. Все outbound requests перехватываются синтетическим `outboundService`: запросов к Render/Cloudflare/Supabase нет, реальная приёмка публикации этим не заменяется. Miniflare устанавливается отдельно от приложения:

```sh
npm install --prefix ../../outputs/cloud-api-runtime --no-audit --no-fund miniflare@4.20260730.0
node cloudflare/test-runtime.mjs --deps ../../outputs/cloud-api-runtime --dist ../../outputs/cloud-api-final/dist --public-origin https://green-pavlodar-api.pages.dev
```

Локально на Node 24.22.1 проверены **15/15 Node-тестов** (13 прежних core + 2 adapter) и **7/7 runtime checks**: ASSETS, origin guard, отдельные cookies, multipart/CSRF/idem/Origin, binary photo, все пять redirect statuses без повторов, HTML 503/no-store. Выход runtime test — 0. Windows workerd дополнительно вывел диагностическое `WSARecv #64` при закрытии соединения; проверки прошли, публичную сетевую работу это не подтверждает. Сведения об инструменте: [Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/), [outboundService API](https://github.com/cloudflare/workers-sdk/blob/main/packages/miniflare/README.md).

После настройки и загрузки обязательна отдельная HTTPS/browser проверка: readiness, пять ролей, logout, CSRF/403, multipart фото и приватное чтение, повтор с тем же ключом, reload и ошибки без mock fallback. Приёмка отчёта принадлежит coordinator; foreman проверяет вклад и отправляет итог группы. Полная публичная матрица и обнаруженные ограничения записываются в журнал публикации, без пароля и ключей.
