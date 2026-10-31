# Render + Supabase: запуск владельцем и воспроизводимая приёмка

31 октября 2026. **Настоящий deployment BLOCKED; provider HTTPS, restart и redeploy NOT RUN.**
Доступный браузер показывает страницы входа Render, Supabase и Cloudflare. В окружении нет
разрешённых credentials или локального cloud env; владелец подтвердил отсутствие доступов.
Названия ниже — желаемые имена ресурсов, а не утверждение об их существовании.

Согласованный application SHA: **3b14927def04b35bf97782eae6b550da276c779f**.
Подготовка продолжается в существующей ветке `codex/cloud-api-persistence`, Draft PR #39.
Новые команды приёмки находятся в HEAD этого PR; не подменяют SHA сервера.
Поведение приложения, опубликованные миграции 1–5, frontend, worker, map и tools/e2e не меняются.
Новая общая база `fdc6e756be99dc5ba3a7a48ca1df17c4bfbef5ef` получена fetch, но сюда не влита.
Результат на этой общей версии отдельно не заявляется.

## 1. Действия, которые требуют владельца аккаунтов

1. Войти с MFA в [Supabase Dashboard](https://supabase.com/dashboard), [Render Dashboard](https://dashboard.render.com)
   и, для последующего подключения proxy, [Cloudflare Dashboard](https://dash.cloudflare.com).
   Не отправлять пароль, токен, connection string или service key в чат.
2. Открыть существующий **разрешённый отдельный DEMO** Supabase project. Если его нет:
   **New project → green-pavlodar-demo**, бесплатная организация/доступная квота, регион рядом
   с Render. Пароль БД владелец задаёт в UI и сохраняет в менеджере паролей.
   Не создавать дубликат и не использовать рабочую БД команды. При требовании оплаты остановиться.
3. Открыть существующий разрешённый Render service либо создать **New → Web Service →
   green-pavlodar-api-demo**. Владелец разрешает Render GitHub App доступ **только** к
   `foxfordkz-cyber/qadamxpavlodar`. Не расширять доступ на остальные репозитории.
4. Настройки ниже может выполнить владелец в своём аккаунте. Если делегирует: выдать доступ
   к выбранному demo project/service с правом настройки env, bucket и deployment через штатное
   приглашение в UI. Если тариф не позволяет ограничить доступ проектом, настройку выполняет
   владелец; не предоставлять лишние организационные права ради этого задания.
5. Сообщить только несекретные project/service identifiers и путь к заполненному локальному
   игнорируемому файлу, либо оставить авторизованную сессию Dashboard. Секреты вводятся в
   **Render → service → Environment** и локально владельцем; не в GitHub issue/PR.

## 2. Supabase: БД и private Storage до первого запуска

- **Connect → Session pooler**: скопировать показанный host, port и username. Для постоянного
  Node pool используется session mode (обычно порт 5432), не transaction mode 6543.
  Не вычислять hostname по региону. Доступ по IPv4 не требует покупки IPv4 add-on.
- `DATABASE_URL` — PostgreSQL URL с URL-encoded паролем, **без query/hash**, включая
  `sslmode`: приложение задаёт TLS отдельно и проверяет сертификат. Нельзя отключать проверку TLS.
- При необходимости скачать CA через **Database settings → SSL Configuration**.
  Локально задать `PG_CA_FILE` с путём к PEM. В Render добавить **Environment → Secret Files**
  с именем `supabase-ca.pem`, задать `PG_CA_FILE=/etc/secrets/supabase-ca.pem`.
- Не добавлять приватную схему `gp_cloud` в exposed schemas Data API; не выдавать
  `anon`/`authenticated` доступ к ней. Миграции создают её и отзывают PUBLIC grants.
- **Storage → New bucket**: `green-pavlodar-photos`, **Public OFF**,
  file size limit **5 MiB / 5242880 bytes**, allowed MIME types **только image/webp**.
  Не создавать anonymous/public policies. Входной JPEG/PNG преобразует сервер.
- **Settings → API Keys**: для согласованного SHA нужен существующий legacy
  **service_role JWT** из отдельного DEMO-проекта. Его использует серверный adapter в
  `apikey` и `Authorization: Bearer`; это не пользовательский login.
  Современный `sb_secret_...` этим SHA не проверен: если legacy key недоступен,
  остановить provider-приёмку и подготовить отдельно проверенное изменение adapter.
  Не подменять его anon/publishable key.

Проверено по [PostgreSQL connections/TLS](https://supabase.com/docs/guides/database/connecting-to-postgres),
[bucket settings](https://supabase.com/docs/guides/storage/buckets/creating-buckets) и
[API keys](https://supabase.com/docs/guides/getting-started/api-keys).
Legacy keys устаревают; переход на новые ключи требует отдельной совместимости, а не отключения защиты.

## 3. Точные Render настройки

| Поле | Значение |
| --- | --- |
| Repository / branch | foxfordkz-cyber/qadamxpavlodar / codex/cloud-api-persistence |
| Runtime / instance | Node / Free; без disks, paid add-ons и платной БД Render |
| Root Directory | Пусто: нужны общие analytics из apps/web и корневые fixtures |
| Build Command | `npm ci --prefix apps/server --include=dev && npm run build --prefix apps/server` |
| Start Command | `npm run start:cloud --prefix apps/server` |
| Health Check Path | `/api/v1/ready` |
| Auto-Deploy | Off до подключения секретов |
| Blueprint | `render.cloud.yaml`, если используется Blueprint UI с этим custom path |
| Deployment commit | Manual Deploy → Deploy a specific commit → согласованный полный SHA |

Новый Web Service может начать первичную сборку при создании. **Не добавлять DB/Storage secrets,
пока не выключен Auto-Deploy и не выбран принятый commit**; первую несогласованную попытку отменить
на Deploys → Cancel deploy. Пустая конфигурация намеренно не запускает cloud server.
Затем Environment → **Save only**, после этого Deploys → Manual Deploy → **Deploy a specific commit**
с `3b14927def04b35bf97782eae6b550da276c779f`. Не выбирать Deploy latest commit.
Записать фактический SHA и deployment ID из Dashboard; health не содержит аттестацию SHA.
Более новый HEAD с инструментами требует явного принятия владельцем как новой версии приложения.

Проверка Blueprint по официальной схеме не создаёт сервис. Node build/start проверяются локально.
Существующий `apps/server/Dockerfile` и Compose запускают отдельный **SQLite** release.
Они не являются cloud-entrypoint: не выбирать этот Dockerfile в Render вместо Node Blueprint.
Compose CLI/config проверены отдельно; Engine в текущем окружении недоступен, container build/run
**BLOCKED**. Docker/системные службы и пользовательские volumes не менялись.

[Render env settings](https://render.com/docs/configure-environment-variables),
[specific commit / restart](https://render.com/docs/deploys),
[Free restrictions](https://render.com/docs/free).
Free не предоставляет Shell/SSH/one-off jobs и persistent disk; bootstrap выполняется ниже локально.
При исчерпании квот или запросе оплаты не включать платный ресурс без решения владельца.

## 4. Полный checklist переменных

Все значения секретов вводит владелец в **Render service → Environment → Add Environment Variable**.
Никакие ключи Supabase/БД не добавляются в Cloudflare frontend/build.

| Переменная | Где нужна / содержание |
| --- | --- |
| NODE_VERSION | Render: `24.21.0` |
| NODE_ENV | Render: `production` |
| PORT | Render задаёт сам; сервер слушает 0.0.0.0 и этот порт |
| DATABASE_URL | Secret: URL отдельной DEMO PostgreSQL, без query/hash |
| CLOUD_ALLOWED_HOSTS | Точное DNS-имя DB из URL, без схемы/порта/wildcards |
| PG_CA_FILE | Опционально: путь к доверенному CA, не текст сертификата |
| ALLOWED_HOSTS | Фактическое Render hostname из UI, без https:// и порта; только разрешённые host |
| FRONTEND_ORIGINS | Точный HTTPS-origin будущего API frontend, без завершающего /; список через запятую |
| CLOUD_TRUST_PROXY_HOPS | `1` только за непосредственным Render ingress |
| SUPABASE_URL | Точный HTTPS project origin, без завершающего / |
| SUPABASE_STORAGE_BUCKET | `green-pavlodar-photos` |
| SUPABASE_SERVICE_ROLE_KEY | Secret: server-only legacy service_role JWT согласованного adapter |
| STORAGE_ALLOWED_HOSTS | Точное hostname из SUPABASE_URL |
| CLOUD_DEMO_SEED | Только bootstrap: `1`; убрать из долгоживущего service |
| DEMO_PASSWORD | Только bootstrap: новый случайный пароль DEMO, заполнить privately |
| CLOUD_LOCAL_TEST | **Отсутствует в production**; запрещён для удалённой БД |
| CLOUD_ACCEPTANCE_ORIGIN | Только локальный runner: реально выданный Render HTTPS-origin |
| CLOUD_ACCEPTANCE_BROWSER_ORIGIN | Только runner: точный origin, разрешённый FRONTEND_ORIGINS |
| CLOUD_ACCEPTANCE_PASSWORD | Только runner: существующий пароль DEMO-аккаунтов |
| CLOUD_ACCEPTANCE_DEMO | Только runner: `1`, подтверждает изолированную synthetic БД |

SESSION_SECRET/JWT_SECRET здесь нет: серверные случайные sessions и CSRF сохраняются в PostgreSQL,
хеш session token — в БД; cookie не подписывается выдуманным env secret. Не добавлять SQLite paths,
STORAGE_ROOT/UPLOADS_DIR или фиктивные ключи для обхода отсутствующей конфигурации.

## 5. Первый bootstrap: только отдельная DEMO БД

Владелец работает из HEAD этой ветки с новыми operator tools. Приложение и миграции соответствуют
согласованному SHA; все команды ниже выполняются из `apps/server` в PowerShell 7/Node 24.
Не перезаписывать уже существующий env. Шаблон production не включает local-test defaults.

```powershell
npm ci --include=dev
if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
if (Test-Path .env.cloud) { throw 'Review existing private configuration; do not overwrite it' }
Copy-Item cloud.production.env.example .env.cloud
git check-ignore .env.cloud
```

Владелец заполняет `.env.cloud` в локальном редакторе. Не печатать файл/переменные/connection string.
До создания Render host для локального CLI допускается `ALLOWED_HOSTS=localhost`; после получения
реального URL поставить фактический host в Render. FRONTEND_ORIGINS — согласованный origin,
а не wildcard. Удалить наследованный CLOUD_LOCAL_TEST из процесса. Seed opt-in/password — только локально.

```powershell
npm run check:cloud-deployment -- --config-only
if ($LASTEXITCODE -ne 0) { throw 'Fix configuration first' }
npm run check:cloud-deployment -- --before-migrations
if ($LASTEXITCODE -ne 0) { throw 'DB / checksum / private bucket check failed' }
# Set CLOUD_DEMO_SEED=1 and a new random DEMO_PASSWORD privately in .env.cloud.
npm run seed:cloud
if ($LASTEXITCODE -ne 0) { throw 'Seed failed; do not reset database' }
npm run check:cloud-deployment -- --ready
if ($LASTEXITCODE -ne 0) { throw 'Deployment is not ready' }
```

Preflight использует READ ONLY transaction и только GET к bucket; не мигрирует и не исправляет данные.
`--config-only` не устанавливает сеть; его PASS не означает DB/Storage PASS. `--before-migrations`
разрешает пустую схему или корректный префикс checksum; `--ready` требует все пять.
Проверяет UTF8, checksum, отсутствие schema access у anon/authenticated, private bucket restrictions.
FAIL сообщает только этап; provider error/credentials не логируются.

Seed применяет последовательные миграции и вставляет только отсутствующие аккаунты
admin/coordinator/foreman/worker/viewer и DEMO planning fixtures. Не обновляет пароли, версии,
человеческие правки или принятые отчёты. Startup повторно проверяет checksum и применяет только
недостающие миграции; seed при старте не запускается. **Не править schema_migrations вручную.**
Убрать DEMO_PASSWORD и seed opt-in из Render; сохранить пароль privately для HTTP-приёмки.

## 6. Команды настоящей HTTPS-приёмки

После успешного Render Deploy записать **реальные** URL, commit SHA, deployment ID и время.
Нельзя подставлять желаемое имя сервиса как доказательство выданного URL.
Из `apps/server` создать приватный файл для runner:

```powershell
if (Test-Path .env.cloud-acceptance) { throw 'Review existing acceptance configuration' }
Copy-Item cloud.acceptance.env.example .env.cloud-acceptance
git check-ignore .env.cloud .env.cloud-acceptance
New-Item -ItemType Directory -Force data | Out-Null
# Populate the four CLOUD_ACCEPTANCE_* values privately before the next command.
node --env-file=.env.cloud-acceptance --import tsx scripts/cloud-https-acceptance.mjs create data/cloud-release-acceptance.json
if ($LASTEXITCODE -ne 0) { throw 'Acceptance failed; inspect manifest trace, no blind rerun' }
```

Runner требует HTTPS, exact origin, DEMO opt-in, отвергает redirects. Он реально выполняет health/ready,
login, чтение зоны/тарифов/species, analysis/recommendation/estimate, snapshot, admin approval дизайна,
создание и назначение задания, worker start, multipart фото и его replay, отчёт/acceptance, cohort,
принятый inspect report и связанный осмотр, viewer read-only, CSRF и ограничения worker/foreman.
Никаких mock-ответов. Синтетический PNG и все созданные данные помечены DEMO.
В manifest — IDs, публичные DTO request/replay и канонические SHA-256, HTTP statuses;
**нет** cookies, CSRF, паролей, connection strings, service keys или password hashes.
Сессии runner отзываются после прогона. Trace сохраняется без request bodies с паролями.
Существующий manifest не перезаписывается командой create; после частичного отказа нужна
диагностика его последнего status. Нет автоматического повтора write с новым ключом.

Затем выполнить **по одному**:

1. Render → Deploys → Manual Deploy → **Restart service**; дождаться ready и выполнить verify.
2. Render → Manual Deploy → **Deploy a specific commit** с тем же согласованным SHA;
   записать новый deployment ID, дождаться ready и снова verify.
3. Из приватного локального bootstrap env повторить `npm run seed:cloud` и `--ready`.
   Для доказательства сохранности паролей можно задать **другой** случайный DEMO_PASSWORD
   только bootstrap; `.env.cloud-acceptance` оставить с исходным. Затем verify со старым паролем.

```powershell
node --env-file=.env.cloud-acceptance --import tsx scripts/cloud-https-acceptance.mjs verify data/cloud-release-acceptance.json
if ($LASTEXITCODE -ne 0) { throw 'Persistence / permissions / replay check failed' }
```

Verify заново входит, сравнивает immutable cohort/forecast/inspection, отчёты, history,
версии и photo SHA-256/bytes, повторяет сохранённые ключи acceptance/Outcomes, проверяет 403 viewer
и CSRF, 404 чужого worker и 401 anonymous photo. `asOf` может меняться: проверяются сохранённые
осмотры и summary counts; unknown остаётся unknown, whole-cohort survival остаётся null.
Он **не управляет Render**: повтор verify без реального Dashboard restart/redeploy этого не доказывает.
Манипуляции provider failure/response-loss/rollback проверены локальными изолированными тестами;
разрушительные fault injection в Supabase не выполняются.

Отдельная анонимная health-проверка (URL скопировать из Dashboard):

```powershell
$apiOrigin = Read-Host 'Actual Render HTTPS origin'
curl.exe --fail-with-body --max-time 120 "$apiOrigin/api/v1/health"
curl.exe --fail-with-body --max-time 120 "$apiOrigin/api/v1/ready"
```

Ready обязан вернуть schemaVersion 5, database ok, photos private-storage-configured.
Один HTTP 200 при `photos:not-configured` не проходит выпуск.
Документировать отдельно cold start после периода простоя; Free засыпает после 15 минут,
пробуждение может занять около минуты. Proxy может получить HTML/502/503 до старта Express.
Не повторять неоднозначный POST автоматически; сохранять исходные key/body/file.

## 7. Передача Тәңірберді и Айдане

- Передать фактический backend origin и **deployed**, а не локальный HEAD SHA, deployment IDs,
  результаты initial/restart/redeploy/reseed, manifest без секретов.
- Cookie `gp_v2_session`: Secure, HttpOnly, SameSite=Strict, Path=/api/v1, без Domain, 8 часов.
  CSRF из login/auth/me, `X-CSRF-Token` на unsafe; Idempotency-Key и body сохраняются вместе.
- Фиксированный same-origin `/api/*` proxy на HTTPS backend; browser Origin сохраняется,
  Host соответствует upstream. Удалять клиентские forwarding headers; доверять только
  непосредственному Render ingress. Не доверять X-Forwarded-Host.
- Передавать Cookie, отдельные Set-Cookie, Content-Type, CSRF, Idempotency-Key, status и binary;
  никаких redirects, cache или JSON-преобразования фото/export. Multipart boundary задаёт FormData.
- Фото: один file + taskId, JPEG/PNG/WebP ≤5 MiB, один кадр, ≤4096×4096, нормализация WebP
  без metadata; два concurrent decode, до 50 stored+pending на задание, JSON ≤32 KiB.
- Браузерный API frontend держать отдельным от публичного
  [mock](https://green-pavlodar-mock.pages.dev/). Публикацию и PR #35 не изменять.
  Реальный Pages runtime + другое устройство проверяет интегратор/Айдана после backend PASS.
- API keys/DB credentials отсутствуют в Cloudflare env; нужен только согласованный фиксированный
  backend origin в имени переменной существующего proxy adapter. Актуальную привязку задаёт владелец #35.
- Ещё **503 CLOUD_ENDPOINT_UNSUPPORTED**: geocode/search, POST /zones, GIS import/commit,
  /zones/:id/care-schedule, assistant и history, rank-preview/plant-selection/interpretation.
  LLM/RAG/weather/generated images не объявлять работающими. Полный [список](cloud-route-coverage.md).

## 8. Приёмочный checklist

- [ ] Владелец подтвердил отдельные demo project/service, квоты, доступ и целевой SHA.
- [ ] Supabase private bucket, TLS и schema isolation прошли preflight.
- [ ] Миграции 1–5 и insert-only seed успешны, секреты не в Git/логах/frontend.
- [ ] Render действительно выдал HTTPS URL; recorded SHA совпадает с принятым.
- [ ] Health/ready с photos; полный HTTPS runner create PASS.
- [ ] Реальный Restart service + verify PASS.
- [ ] Реальный redeploy того же SHA + verify PASS.
- [ ] Повтор seed с сохранением старых паролей и данных + verify PASS.
- [ ] Тәңірберді подключил отдельный same-origin API deployment, mock сохранён.
- [ ] Айдана повторила ролевую/CSRF/photo/Outcomes-приёмку и проверку с другого устройства.

На момент этого документа все provider пункты выше **NOT RUN**; это checklist, не результаты.
