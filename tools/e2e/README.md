# Green Pavlodar — браузерная приёмка (Node 22.19+)
1. Из `tools/e2e`: `npm ci` (для веба один раз: `npm ci --prefix ../../apps/web`).
2. Chromium: `npx playwright install chromium`.
3. Mock: `npm run e2e` — Vite на `http://localhost:5174` запускается автоматически.
4. Готовый сервер / Docker: задайте `E2E_BASE_URL=http://localhost:8080` в окружении и запускайте ту же команду.
5. API: запустите `apps/server`, затем `npm run e2e:api`; нужен `E2E_PASSWORD` в окружении.
6. Локально API-скрипт сам читает `DEMO_PASSWORD` из `apps/server/.env`; без пароля тест пропускается.
7. HTML-отчёт mock: `npm run report`; API: `playwright-report/api/results.json` без секретных деталей.
8. Слайды: `screens/<страница>-<ширина>.png` (1280×800 и 375×812, Alt+P); ошибки: `test-results/`.
9. Баги: `BUGS.md`, повтор: `npm run e2e:bugs`; быстрый прогон, диагностика и ZIP для показа — [DEMO-TOOLS.md](DEMO-TOOLS.md).
