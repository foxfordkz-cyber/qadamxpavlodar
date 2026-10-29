# PR #13 — SQLite v4 → v5 acceptance

Дата: 29.10.2026. **PASS**. Проверяемый runtime PR: `25019f17f859177fba6d2a5715e33ea88448b523`.

## Источник и изоляция

Текущая `origin/codex/coordinator`: `3795f1625a52f48f6cb7e45ba9f52096440d9eca`. Исходники получены через `git archive` именно этого commit. Её `Store` действительно заканчивает миграции на schema 4; в ней присутствуют `tz_species/tz_rates`, но отсутствует `municipal_state`. Это TZ-вариант v4, не прежняя municipal-v4.

Старый Store и seedV2/seedTz запущены из этого архива. Созданы независимые тестовые аккаунты, один synthetic task/report и история расценки. Использованы поставляемые OSM fixtures; пользовательские аккаунты, БД, uploads и Docker volume не читались. Случайный тестовый пароль существует только в памяти процесса.

Старый сервер реально запущен; получена coordinator session. Копия создана `node:sqlite backup()` с учётом WAL, не копированием открытого sqlite-файла. Новый сервер запускался на копии с `HOST=0.0.0.0` и штатным network guard. Оригинальная тестовая v4 осталась отдельным файлом.

## Основные данные

| Показатель | До | После миграции | После HTTP действий и повторного запуска |
|---|---:|---:|---:|
| Schema | 4 | 5 | 5 |
| Таблицы | 38 | 44 | 44 |
| Зоны | 114 | 114 | 114 |
| V2 задания | 1 | 1 | 1 |
| V2 отчёты | 1 | 1 | 1 |
| Аккаунты / password hashes | 9 / 9 | 9 / 9 | 9 / 9 |
| Каталог V2 | 58 | 58 | 58 |
| TZ виды / расценки | 50 / 27 | 50 / 27 | 50 / 27 |
| Версия расценок | 7 | 7 | 7 |
| integrity_check | ok | ok | ok |
| foreign_key_check | [] | [] | [] |

**Все исходные строки всех 38 таблиц после миграции побайтово совпали по сериализованным SQL-значениям.** Добавились только шесть пустых municipal таблиц. Роли сохранены: admin 1, coordinator 1, viewer 1, foreman 2, worker 4. Пароли всех 9 старых аккаунтов проверены новым сервером через HTTP login; значения паролей/хешей в отчёт не включены. Старая session cookie также продолжает работать.

После проверок намеренно появились один calculation snapshot, одна запись assistant history, дополнительные login sessions и одна idempotency запись. Это результаты явных HTTP действий, не дубли от миграции. Повторный запрос snapshot с тем же ключом вернул прежний результат; snapshot, session и история пережили повторный запуск. SQL-схема после второго запуска не изменилась, задачи/отчёты/зоны не размножились.

## HTTP проверки

- `/auth/login`, `/auth/me`: все пять ролей, все девять аккаунтов и старая session — PASS.
- `GET /municipal/sites`: 114 зон; `GET /rates`: прежняя версия 7 и сохранённые данные.
- `POST /zones/:id/snapshots` и `GET /analysis-snapshots/:id`: сохранение, replay и restart — PASS.
- `POST /assistant` и `GET /assistant/history`: **rules**, история сохраняется; live LLM не вызывался.
- POST без CSRF возвращает 403; PATCH расценки с устаревшей expectedVersion — 409.

## Автоматизация и воспроизведение

Существующие [merge-migrations.test.ts](tests/merge-migrations.test.ts) уже проверяют обе несовместимые v4 ветки, исходные строки, hashes, session, reports, rates, seed и reopen. Они сохранены; дублирующий unit test не добавлен. Текущий полный набор: **58 passed, 0 failed, 0 skipped** (134.08 с).

Добавлен [accept-migration-v4-v5.mjs](scripts/accept-migration-v4-v5.mjs) для отличающегося сценария: старый исходный сервер → WAL-safe backup → новый сервер → прежние credentials → HTTP mutation/restart. Новый output directory обязателен; скрипт не перезаписывает предыдущий результат и не загружает `.env`.

```text
git archive --format=zip --output=<archive.zip> 3795f1625a52f48f6cb7e45ba9f52096440d9eca
# Extract into a separate directory; provide its matching server dependencies.
# From apps/server of this feature branch:
node --import tsx scripts/accept-migration-v4-v5.mjs <archived-repository> <new-output-directory> 3795f1625a52f48f6cb7e45ba9f52096440d9eca
```

Фактический последний запуск: exit 0, `work/pr13-acceptance/migration-verified-latest/result.json` вне репозитория. Серверные логи не содержат сгенерированный пароль. Тест использует локальные процессы; это не Docker acceptance. Перед финальной публикацией coordinator обновился с dc182fd до указанного SHA; архив и весь миграционный HTTP сценарий повторены на новом источнике.

Две попытки запуска после обновления архива завершились health startup timeout (первая параллельно со сборками, вторая — при дополнительных проверках). Миграционная потеря данных или ошибка SQL не обнаружена; отдельно проверены загрузка модулей и HTTP health нового сервера — 200. Причина задержек не установлена окончательно. В runner добавлен ограниченный 60-секундный startup deadline с 2-секундным timeout отдельного health запроса и диагностикой последнего probe; API assertions не ослаблялись. Финальный полный прогон прошёл отдельно: старый сервер healthy за 5.016 с, новый после миграции за 20.316 с, повторный запуск за 23.513 с. Задержки cold start следует проверить в контейнерной приёмке; они не скрываются за итоговым PASS проверки данных.

## Полный список таблиц и количества

`—` означает, что таблицы ещё не существовало. Legacy таблицы присутствуют, но пусты в этом специально созданном TZ seed.

| Таблица | v4 | v5 до HTTP | v5 после HTTP/restart |
|---|---:|---:|---:|
| `ai_proposals` | 0 | 0 | 0 |
| `candidate_sites` | 0 | 0 | 0 |
| `evidence_refs` | 0 | 0 | 0 |
| `experimental_photos` | 0 | 0 | 0 |
| `experimental_reports` | 0 | 0 | 0 |
| `experimental_task_history` | 0 | 0 | 0 |
| `experimental_tasks` | 0 | 0 | 0 |
| `idempotency_keys` | 0 | 0 | 0 |
| `municipal_analyses` | — | 0 | 1 |
| `municipal_features` | — | 0 | 0 |
| `municipal_history` | — | 0 | 0 |
| `municipal_imports` | — | 0 | 0 |
| `municipal_roles` | — | 0 | 0 |
| `municipal_state` | — | 0 | 0 |
| `observations` | 0 | 0 | 0 |
| `photos` | 0 | 0 | 0 |
| `plants` | 0 | 0 | 0 |
| `reports` | 0 | 0 | 0 |
| `task_history` | 0 | 0 | 0 |
| `tasks` | 0 | 0 | 0 |
| `tz_assistant_history` | 0 | 0 | 1 |
| `tz_rate_history` | 1 | 1 | 1 |
| `tz_rates` | 27 | 27 | 27 |
| `tz_species` | 50 | 50 | 50 |
| `users` | 0 | 0 | 0 |
| `v2_assignments` | 1 | 1 | 1 |
| `v2_care_events` | 0 | 0 | 0 |
| `v2_crews` | 2 | 2 | 2 |
| `v2_design_revisions` | 0 | 0 | 0 |
| `v2_designs` | 0 | 0 | 0 |
| `v2_documents` | 339 | 339 | 339 |
| `v2_history` | 0 | 0 | 0 |
| `v2_idempotency` | 1 | 1 | 2 |
| `v2_issues` | 0 | 0 | 0 |
| `v2_login_attempts` | 2 | 2 | 10 |
| `v2_memberships` | 4 | 4 | 4 |
| `v2_planting_receipts` | 0 | 0 | 0 |
| `v2_profiles` | 6 | 6 | 6 |
| `v2_report_drafts` | 0 | 0 | 0 |
| `v2_reports` | 1 | 1 | 1 |
| `v2_sessions` | 1 | 1 | 11 |
| `v2_tasks` | 1 | 1 | 1 |
| `v2_uploads` | 0 | 0 | 0 |
| `v2_users` | 9 | 9 | 9 |
