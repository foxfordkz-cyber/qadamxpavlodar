# Green Pavlodar — локальный Backend V2

Текущий контракт: предложение команды V2 от 27 октября 2026. Реализация продолжает
существующий backend. Только DEMO, без production-данных.

28 октября 2026 пользователь разрешил публикацию в отдельную ветку
`feature/backend-preparation` репозитория `foxfordkz-cyber/qadamxpavlodar`.
Backend расположен в `apps/server`; существующие файлы команды сохранены.
Отметки NO PUSH / NO COMMIT в прежних отчётах описывают состояние до этого разрешения.

- [Запуск, вход и интеграция V2](BACKEND_V2_HANDOFF.md)
- [Compliance matrix C01–C25 и владельцы остатков](BACKEND_V2_COMPLIANCE.md)
- [Фактические проверки: 32/32](BACKEND_V2_VERIFICATION.md)

## Запуск

Node.js 24.x. Из корня репозитория перейти в `apps/server` и установить зависимости:

```powershell
cd apps/server
npm ci
```

```powershell
npm run build
npm run seed:v2
npm start
```

- [Административный экран](http://127.0.0.1:3100/api/v1/admin)
- [Swagger V2](http://127.0.0.1:3100/api/v1/docs) — 66 операций, включая явно недоступные без адаптера AI endpoints.
- [OpenAPI V2](http://127.0.0.1:3100/api/v1/openapi.json)
- [Health](http://127.0.0.1:3100/health)

Вход: admin / coordinator / foreman1–2 / worker1–4, DEMO-пароль `DEMO-only-2026!`.
Подробности cookie, CSRF, прав, актуальных версий и повторов — в V2 handoff.
Не запускать второй сервер на занятом порту. Production mode запрещён конфигурацией.

## Проверки и демо

```powershell
npm run typecheck
npm run build
npm test
npm run smoke
npm run demo:v2
```

V2-демо использует отдельные SQLite/uploads, четыре роли, согласование проекта,
бригаду, исполнителей, фото, приёмку посадки и перезапуск. Повтор не создаёт дублей.
Результат сохраняется в `data/v2-demo/verification-v2/result.json`.

## Совместимость

Основная база: `data/green-pavlodar-demo.sqlite`, добавочная миграция 2→3.
Все старые строки и 16 legacy-задач сохранены. Новые таблицы `v2_*` работают с V2 DTO.
Legacy API и V2 не синхронизируются в обе стороны: новый frontend использует `/api/v1`.
Старые 30 операций и `/api-docs` сохранены для подготовки и регрессии; X-Demo-User
не авторизует V2. Предыдущий experimental AI — mock, в V2 default AI отсутствует (503).

История подготовки: [HACKATHON_BACKEND_READY.md](HACKATHON_BACKEND_READY.md),
[старые проверки](VERIFICATION.md), [старый frontend API](FRONTEND_API_HANDOFF.md).
`npm run demo:integration -- -RunName my-local-demo` сохраняет прежний experimental flow.

`data`, `uploads`, `dist`, `node_modules`, `.env` исключены из Git. База и сессии
создаются локально. Пароль DEMO выше — публичная синтетическая fixture для локального
сценария; реальные пароли, ключи и токены в исходники не включены.
Исходная локальная рабочая копия и её DEMO-данные сохранены отдельно.

Проверки перед публикацией: typecheck PASS, build PASS, тесты 32/32 PASS.
PR, merge, force push и deploy не выполняются.
