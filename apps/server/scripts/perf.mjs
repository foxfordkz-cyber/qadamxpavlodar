import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { cpus, totalmem, platform, release, arch } from 'node:os';
import { performance } from 'node:perf_hooks';

// Read only DEMO_PASSWORD/PORT from the local .env; never print credentials or response bodies.
const env = parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
if (!env.DEMO_PASSWORD) throw new Error('Set DEMO_PASSWORD in apps/server/.env');
const base = new URL(process.env.PERF_BASE_URL ?? `http://127.0.0.1:${env.PORT ?? 3100}`);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.protocol !== 'http:' || base.username || base.password) throw new Error('Performance script accepts a local HTTP server only');
let cookie = '', csrf = '';
async function request(path, method = 'GET', body) {
  const start = performance.now();
  const response = await fetch(new URL('/api/v1' + path, base), { method, redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  const json = await response.json();
  return { json, ms: performance.now() - start, response };
}
const stats = samples => { const sorted = [...samples].sort((a, b) => a - b); return { median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) }; };
const rows = [];
async function measure(label, call) {
  const samples = [];
  for (let i = 0; i < 5; i++) samples.push((await call(i)).ms);
  rows.push({ label, samples, ...stats(samples) });
}
try {
  const login = await request('/auth/login', 'POST', { login: 'coordinator', password: env.DEMO_PASSWORD });
  cookie = login.response.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
  csrf = login.json.data.csrfToken;
  if (!cookie || !csrf) throw new Error('Login did not return a session and CSRF token');
  let sites;
  await measure('GET /sites', async () => { const r = await request('/sites'); sites = r.json.data; return r; });
  const ids = sites.filter(s => s.geometry?.type === 'Polygon' && s.centroid).slice(0, 5).map(s => s.id);
  if (ids.length !== 5) throw new Error('Seed at least five polygon zones with npm run seed:tz');
  const zonePath = (i, suffix) => `/zones/${encodeURIComponent(ids[i])}/${suffix}`;
  // A process restart is required before this script for true cold application-cache measurements.
  await measure('POST /zones/:id/analysis — first request, 5 zones', i => request(zonePath(i, 'analysis'), 'POST', { options: {} }));
  await measure('POST /zones/:id/analysis — cached, same 5 zones', i => request(zonePath(i, 'analysis'), 'POST', { options: {} }));
  await measure('POST /zones/:id/variants', () => request(zonePath(0, 'variants'), 'POST', { options: {} }));
  await measure('POST /priorities', () => request('/priorities', 'POST', {}));
  await measure('GET /problems', () => request('/problems'));
  await measure('GET /reference/facts', () => request('/reference/facts'));
  const machine = `${platform()} ${release()} ${arch()}; ${cpus()[0]?.model ?? 'CPU unknown'}; ${cpus().length} logical CPUs; ${(totalmem() / 2 ** 30).toFixed(1)} GiB RAM; Node ${process.version}`;
  const report = `# Локальный замер скорости\n\nДата UTC: ${new Date().toISOString()}.\n\nМашина: ${machine}. Сервер: ${base.origin}; SQLite, демонстрационный набор.\n\nПеред этим запуском сервер нужно перезапустить, чтобы первые пять анализов были без прикладного кэша. Вход coordinator выполняется вне замера; пароль читается только из apps/server/.env и не сохраняется в отчёте.\n\nПять последовательных запросов на строку; время включает локальный HTTP, чтение тела и JSON. Для анализа первые и повторные запросы направляются в пять одинаковых зон с одинаковыми options={}. Это холодный прикладной кэш, не холодный запуск ОС/SQLite. Для остальных строк первый запрос и последующие четыре отражены вместе.\n\n| Запрос | Медиана, мс | Максимум, мс | Все 5 измерений, мс |\n|---|---:|---:|---|\n${rows.map(r => `| ${r.label} | ${r.median.toFixed(2)} | ${r.max.toFixed(2)} | ${r.samples.map(v => v.toFixed(2)).join(', ')} |`).join('\n')}\n\nВсе максимумы до 5 секунд: **${rows.every(r => r.max <= 5000) ? 'да' : 'нет'}**. Это замер одного локального клиента на демо-наборе, не нагрузочный тест и не гарантия времени в production. Время браузерного рендера и LLM не измерено.\n\nПовтор: запустить seed:v2 и seed:tz, перезапустить npm --prefix apps/server run dev, затем npm --prefix apps/server run perf. Скрипт заменяет docs/perf.md текущими результатами.\n`;
  writeFileSync(new URL('../../../docs/perf.md', import.meta.url), report);
  console.table(rows.map(({ label, median, max }) => ({ request: label, medianMs: +median.toFixed(2), maxMs: +max.toFixed(2) })));
  console.log('Saved docs/perf.md');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Performance measurement failed');
  process.exitCode = 1;
} finally {
  if (cookie && csrf) await request('/auth/logout', 'POST', {}).catch(() => {});
}
