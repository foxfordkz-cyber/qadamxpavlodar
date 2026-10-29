# PR #13 — Docker acceptance

Дата: 29.10.2026. Runtime: **BLOCKED**. Browser acceptance: **BLOCKED / NOT RUN**. PR остаётся Draft.

Проверяемый runtime: `25019f17f859177fba6d2a5715e33ea88448b523`.

## Диагностика

| Команда/проверка | Exit code / результат |
|---|---|
| `docker --version` | 0 — Docker 29.1.5, build 0e6fee6 |
| `docker compose version` | 0 — Compose v5.0.1 |
| `docker compose config --quiet` | 0 — PASS |
| `docker info --format '{{json .ServerVersion}}'` | **1 — Engine недоступен** |
| Bind probe 127.0.0.1:8080 | 0 — порт свободен, приложение на нём не запущено |
| Container images / volumes / runtime health | NOT AVAILABLE: Engine не отвечает |

Точная причина: `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`. Это результат нового запуска, а не прежний timeout. Диагностика сохранена вне Git: `work/pr13-acceptance/docker-diagnostics.json`.

Установка Docker, изменение настроек, запуск/остановка стека команды и удаление volumes не выполнялись. `docker compose up --build -d` не запускался при недоступном Engine.

## Конфигурация: прочитана, но runtime не доказан

- Web: `8080:80`, nginx; `/api/` проксируется на `server:3100`, исходный Host сохраняется. Server port наружу не публикуется.
- Backend: production, `HOST=0.0.0.0`, storage `/data`, штатный `gp-data` volume. Наличие/содержимое существующего volume проверить невозможно; он не использовался.
- Dockerfile healthcheck: wget `/health` с `Host: localhost`, interval 10 s, timeout 3 s, start period 20 s, retries 5. **Фактический healthy status не получен.**
- Frontend build default — mock; для приёмки обязателен `http://localhost:8080/?source=api`.
- Compose поддерживает env_file; в будущем тестовом окружении надо исключить пользовательский `.env`, дать только временный пароль и независимый storage.

## PR #12 network guard — PASS на локальном Node

Fix commit: `1b5298e96fea3e7ddfebbbd7e555c9a26cbe88d4`, merge PR #12: `99c51adfb55f2a195ebd66a06a807a4d1dcb2c50`. Он уже является предком feature HEAD. Blob `apps/server/scripts/local-network-guard.mjs` совпадает с fix commit: `241f4241be546332df36ae528e0169e868cff56c`. Переносить исправление повторно не требовалось.

Реальная проверка с `node --import ./scripts/local-network-guard.mjs` (exit 0): listen на `0.0.0.0` и loopback TCP работают; outgoing TCP к `0.0.0.0` и внешнему IP, внешний DNS и UDP отвергаются `LOCAL_NETWORK_ONLY`. Дополнительно настоящий backend с `HOST=0.0.0.0` прошёл health/auth/CSRF/migration/restart в migration acceptance. Security rules не менялись; `tz/llm.ts` не редактировался.

## Что не проверено

Контейнерные build/start/restart, healthy status, nginx runtime, browser cookies/CSRF, container volume persistence и container log secret scan — **NOT RUN**. Локальные HTTP cookie/CSRF/persistence прошли, но не считаются контейнерной приёмкой.

Браузерные вход coordinator, карта, отображение 114 зон, анализ, assistant и его сообщения об ошибках на 8080 не выполнялись: Docker endpoint отсутствует. Скриншоты не создавались. В локальном HTTP acceptance assistant фактически работал в режиме **rules**; live LLM и recorded demo не заявляются.

## Следующий шаг

Владелец среды запускает доступный Docker Engine. Затем подготовить отдельный Compose project с независимым volume, временными credentials, без пользовательского env_file и с проверенным свободным портом; выполнить config, up/build, health, browser `?source=api`, cookie/CSRF и restart persistence. Не использовать общий `gp-data` и не выполнять `down -v`. Только после фактического PASS можно пересматривать Draft gate.
