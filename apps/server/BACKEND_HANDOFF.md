> Исторический документ PREPARATION 2. Актуальный Backend V2: [BACKEND_V2_HANDOFF.md](BACKEND_V2_HANDOFF.md), [compliance matrix](BACKEND_V2_COMPLIANCE.md).

# Backend handoff — продолжение 28 октября 2026

Продолжать текущий проект. Локальная ветка `feature/backend-preparation`, без
remote и коммитов. Основные 16 legacy-заданий сохранены. Общий контракт отсутствует.

Сначала прочитать [HACKATHON_BACKEND_READY.md](HACKATHON_BACKEND_READY.md),
[VERIFICATION.md](VERIFICATION.md) и [OFFICIAL_TASK_ADAPTATION_CHECKLIST.md](OFFICIAL_TASK_ADAPTATION_CHECKLIST.md).

Работают Express/TypeScript/SQLite, Swagger, legacy API, изолированный
экспериментальный workflow с review/rework, приватные фото, версии, история,
идемпотентность, AI mock со snapshot, CSV preview, GeoJSON, UTC+5 и локальный CORS.
Настоящая auth и AI, импорт с записью и обновление Plant после review не реализованы.

```powershell
npm run build
npm run seed
npm start
```

Swagger: `http://127.0.0.1:3100/api-docs`.
Проверки: `npm run typecheck`, `npm test`, `npm run smoke`.
Полное демо (PowerShell 7):

```powershell
npm run demo:integration -- -RunName tomorrow-demo
```

Demo использует отдельные data/demo-flow/ и uploads/demo-flow/, сам проверяет
перезапуск. Seed и повтор demo не должны стирать или дублировать данные.
Не удалять рабочую БД/фото для адаптации — сделать копию и добавочную миграцию.

Для UI — FRONTEND_API_HANDOFF.md; для участника 1 — AI_INTEGRATION_CONTRACT.md.
Все `/experimental` и новые правила интеграции — PROPOSED.
После официального задания согласовать workflow, DTO, auth, связь растений
с участком, фото и применение подтверждённого отчёта к карте.

Следующий запрос:

> Прилагаю официальное задание и общий контракт. Прочитай HACKATHON_BACKEND_READY.md,
> VERIFICATION.md и OFFICIAL_TASK_ADAPTATION_CHECKLIST.md. Сопоставь требования с
> текущими модулями, затем адаптируй проект локально с сохранением данных и тестами.
> Не делай push, PR, merge, rebase, deploy и не подключай production/общие БД
> или платные AI API без моего нового прямого разрешения.

**NO PUSH · NO PR · NO MERGE · NO REBASE · NO DEPLOY · NO PRODUCTION DATA.**
