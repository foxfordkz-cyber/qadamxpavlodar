# PR #13 — Damir compatibility acceptance

Дата: 29.10.2026. **FAIL как полный gate: чистый временный merge не проходит server typecheck. Runtime совместимость проверена: 60/60 PASS.**

- Feature runtime HEAD: `25019f17f859177fba6d2a5715e33ea88448b523`.
- Coordinator: `3795f1625a52f48f6cb7e45ba9f52096440d9eca`.
- `origin/ui/differentiators`: `3795f1625a52f48f6cb7e45ba9f52096440d9eca`.
- `origin/server/srv-03-06`: `1fa8e2f61af61a9e53247d2ebf65e9c45e5b8dfe`.

## Изоляция и merge

Основная feature-копия была чистой. `git fetch origin` выполнился, но локальная remote-конфигурация fetch-ит только personal branch; поэтому нужные remote-tracking refs дополнительно обновлены явными обычными fetch refspec, без force.

Создан отдельный detached worktree `work/pr13-compat` на feature HEAD. Команда `git merge --no-commit --no-ff origin/ui/differentiators` завершилась с exit 0, **конфликтов нет**. Merge commit не создавался. Основная feature-ветка не получала изменения этой ветки.

`tz/llm.ts` в тестовой копии пришёл из incoming без ручного редактирования: его blob и blob incoming совпадают (`0d4a8b8c0c42b79db7226f45c6a01ed2461e56a5`). Основной feature-файл остался с blob `53a055de9f5e4244760d9d1987df28c7ea122e66`.

## Результаты

| Проверка | Итог |
|---|---|
| Исходная feature: server typecheck/build | PASS, exit 0 |
| Исходная feature: `npm test` | **58 passed / 0 failed / 0 skipped**, 134.08 с |
| Исходная feature: web typecheck/build | PASS; предупреждение о чанках >500 kB |
| Merge: server typecheck без правок | **FAIL**, exit 1, два TS18049 |
| Merge: server build | PASS, exit 0 |
| Merge: `npm test` без исходных правок | **60 passed / 0 failed / 0 skipped**, 101.57 с |
| Merge: web typecheck/build | PASS, exit 0; предупреждение о чанках >500 kB |
| Только в worktree: предложенная правка + typecheck | PASS, exit 0 |
| Предварительный merge 46611e2: правка + `tests/llm.test.ts` | **8 passed / 0 failed / 0 skipped**, 58.38 с |
| Дополнительный настоящий HTTP acceptance | PASS: DTO, scopes, persistence, CSRF, idempotency, 114 зон |

Первый build с Windows junction на зависимости основной копии получил TS2883 (declaration types ссылались на внешний node_modules). В тестовой копии junction заменён независимой копией тех же зависимостей; build прошёл без изменения исходников. Это отдельно от реальной ошибки TS18049, которая повторилась и с независимыми dependencies.

## Точная нерешённая ошибка

В incoming `apps/server/tests/llm.test.ts:130` два обращения к `site.centroid` не учитывают nullable тип, возвращаемый `candidates` после интеграции municipal-модуля:

```text
tests/llm.test.ts(130,55): error TS18049: 'site.centroid' is possibly 'null' or 'undefined'.
tests/llm.test.ts(130,87): error TS18049: 'site.centroid' is possibly 'null' or 'undefined'.
```

`.find(c => c.centroid)!` сужает найденный объект, но не его nullable поле. Проверенная минимальная правка в тесте:

```ts
const site = candidates(f.store).find((c) => c.centroid)!;
assert.ok(site.centroid);
const zone = { name: String(site.name), lat: Number(site.centroid.lat), lng: Number(site.centroid.lng) };
```

После добавления assertion typecheck и 8 assistant tests проходят. Правка сохранена отдельно в `work/pr13-acceptance/proposed-centroid-test-fix-latest.patch` и **не включена в PR #13**, поскольку задача запрещает заранее публиковать изменения из ui/differentiators. Следующий шаг владельца incoming ветки: добавить это сужение типа в тест, затем повторить совместный typecheck. Ослаблять тип `candidates` или проверки API для обхода ошибки не требуется.

## Assistant и безопасность

- Новый DTO `history`/`view` принят реальным HTTP сервером; неверный latitude, более 6 turns и роль `system` получают 400.
- Incoming тест вызывает настоящий `find_place` tool через контролируемый локальный fake provider: адрес находится, ближайшие зоны имеют конечное distanceM, history передаётся модели. Это проверка adapter/tool boundary, **не live LLM**.
- Дополнительный HTTP прогон без provider работает в режиме **rules**: адресный follow-up использует history, запрос «здесь» использует центр карты и возвращает соответствующую зону.
- История сохраняется после закрытия сервера/SQLite и открытия заново; viewer не видит историю coordinator.
- Worker `/assistant` → 403; без session → 401; POST без CSRF → 403.
- Создание snapshot без Idempotency-Key → 400; повтор с ключом возвращает прежний snapshot. Проверки optimistic version и object access также остаются в полном V2 suite.
- Старые V2 tasks/reports/plants читаются; полный workflow, acceptance, scoped crews/workers и отсутствие дублей покрыты полным набором.
- Сравнение расчётов с общими analytics сохранено и проходит. Число тестов получено из runner, не рассчитано вручную.

## Безопасный откат

Логи, список файлов, patch и HTTP result сохранены вне tracked исходников. После снятия временного assertion первый `git merge --abort` сообщил `Entry ... not uptodate`: содержимое файла уже совпадало с индексом, что подтверждено одинаковыми blob hashes. Выполнен `git update-index --refresh`, затем **`git merge --abort` завершился с exit 0**. Reset не выполнялся.

Подтверждено после abort:

- HEAD: `25019f17f859177fba6d2a5715e33ea88448b523`, не изменился.
- MERGE_HEAD отсутствует.
- `git status --porcelain` пустой.
- `tz/llm.ts` вернулся к исходному feature blob.
- Изменения ui/differentiators и временное исправление отсутствуют в рабочем дереве; merge commit и push этой ветки не выполнялись.

Чистый detached worktree оставлен локально для воспроизводимости; ignored dependencies/build artifacts не публикуются. Evidence: `work/pr13-acceptance/compat-latest-before-abort.json`, `compat-latest-after-abort.json`, `backend-compat-latest-tests.txt`, `compat-assistant-targeted.txt`, `compat-http-latest/result.json`.

## Файлы временного merge

- `apps/server/src/tz/llm.ts`
- `apps/server/src/tz/routes.ts`
- `apps/server/src/tz/shared.ts`
- `apps/server/tests/llm.test.ts`
- `apps/web/src/features/coordinator/CoordinatorApp.tsx`
- `apps/web/src/features/coordinator/approval/ApprovalPage.tsx`
- `apps/web/src/features/coordinator/home/HomePage.tsx`
- `apps/web/src/features/coordinator/map/SiteMap.tsx`
- `apps/web/src/features/coordinator/map/mapView.ts`
- `apps/web/src/features/coordinator/projects/ProjectsPage.tsx`
- `apps/web/src/features/coordinator/projects/scene3d.ts`
- `apps/web/src/features/coordinator/reports/ReportsPage.tsx`
- `apps/web/src/features/coordinator/sites/SitesPage.tsx`
- `apps/web/src/features/coordinator/species/SpeciesPage.tsx`
- `apps/web/src/features/coordinator/tasks/TasksPage.tsx`
- `apps/web/src/features/coordinator/tz.css`
- `apps/web/src/features/coordinator/tz/AssistantPanel.tsx`
- `apps/web/src/features/coordinator/tz/PrioritiesPage.tsx`
- `apps/web/src/features/coordinator/tz/ProblemsPage.tsx`
- `apps/web/src/features/coordinator/tz/RatesPage.tsx`
- `apps/web/src/features/coordinator/zone/TimeMachinePanel.tsx`
- `apps/web/src/features/coordinator/zone/ZoneAnalysisView.tsx`
- `apps/web/src/features/coordinator/zone/timeMachine.ts`
- `apps/web/src/shared/analytics/assistant.ts`
- `apps/web/src/shared/analytics/plan.ts`
- `apps/web/src/shared/api/api.ts`
- `apps/web/src/shared/api/mock/server.ts`
- `apps/web/src/shared/geo.ts`
- `apps/web/src/shared/ui/components.tsx`
- `docs/tz-gap-analysis.md`

Перед публикацией обе remote-ветки продвинулись до 3795f16. Полный merge/build/60 tests, frontend build, HTTP acceptance и исправленный typecheck повторены на новом SHA; временный merge снова отменён. Проверено 30 затронутых файлов. Предварительные логи 46611e2 сохранены отдельно.
