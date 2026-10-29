import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { apiPassword, baseUrl, e2eDir } from './environment.mjs';

const args = process.argv.slice(2);
if (args.some(arg => !['--api', '--docker'].includes(arg))) throw new Error('Supported options: --api, --docker');
const checks = [];
const add = (name, status, detail) => { checks.push({ name, status, detail }); console.log(`[${status.toUpperCase()}] ${name}: ${detail}`); };
const [major, minor] = process.versions.node.split('.').map(Number);
add('Node.js', major > 22 || (major === 22 && minor >= 19) ? 'pass' : 'fail', `Версия ${process.versions.node}; требуется >=22.19`);
const require = createRequire(import.meta.url);
try {
  const wanted = JSON.parse(readFileSync(join(e2eDir, 'package.json'), 'utf8')).devDependencies['@playwright/test'];
  const actual = require('@playwright/test/package.json').version;
  add('Playwright', wanted === actual ? 'pass' : 'fail', `${actual}; закреплённая версия ${wanted}`);
  const { chromium } = await import('@playwright/test');
  if (!existsSync(chromium.executablePath())) add('Chromium', 'fail', 'Нет браузера: npx playwright install chromium');
  else {
    let browser;
    try {
      browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'], timeout: 15_000 });
      const page = await browser.newPage();
      const webgl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
      add('Chromium', 'pass', 'Браузер запускается');
      add('WebGL', webgl ? 'pass' : 'warn', webgl ? 'Программный WebGL доступен' : 'WebGL недоступен; приложение должно показать схему');
    } catch { add('Chromium', 'fail', 'Не удалось запустить браузер; проверьте установку и права запуска'); }
    finally { await browser?.close(); }
  }
} catch { add('Playwright', 'fail', 'Зависимости недоступны: выполните npm ci в tools/e2e'); }

try {
  const target = baseUrl(process.env.E2E_BASE_URL || undefined);
  if (process.env.E2E_BASE_URL) {
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      add('Веб-сервер', response.ok ? 'pass' : 'fail', `${target.origin}: HTTP ${response.status}`);
      await response.body?.cancel();
    } catch { add('Веб-сервер', 'fail', `${target.origin}: недоступен или перенаправляет запрос`); }
  } else {
    add('Vite', existsSync(join(e2eDir, '../../apps/web/node_modules/vite/bin/vite.js')) ? 'pass' : 'fail',
      'Без E2E_BASE_URL тесты запускают Vite :5174; зависимости веба: npm ci --prefix ../../apps/web');
  }
} catch { add('Адрес', 'fail', 'E2E_BASE_URL должен быть HTTP(S)-адресом без встроенных паролей'); }
let passwordPresent = false;
if (args.includes('--api') || args.includes('--docker')) {
  try {
    const password = apiPassword();
    passwordPresent = !!password.value;
    add('Пароль API', password.value ? 'pass' : 'warn', password.value ? `Настроен через ${password.source}; значение скрыто` : 'Отсутствует: API-тесты будут пропущены');
  } catch { add('Пароль API', 'fail', 'Файл окружения нельзя прочитать; содержимое скрыто'); }
}
if (args.includes('--api')) {
  try {
    const target = baseUrl(process.env.E2E_BASE_URL || process.env.VITE_API_PROXY || 'http://127.0.0.1:3100');
    const response = await fetch(new URL('/api/health', target), { signal: AbortSignal.timeout(5000), redirect: 'error' });
    const body = await response.json();
    const healthy = response.ok && body.status === 'ok' && body.database === 'ok';
    add('API и база данных', healthy ? 'pass' : passwordPresent ? 'fail' : 'warn',
      healthy ? 'Health endpoint подтвердил доступность API и SQLite' : 'Health endpoint не подтвердил готовность сервера');
  } catch { add('API и база данных', passwordPresent ? 'fail' : 'warn', 'Сервер не отвечает; запустите API или задайте E2E_BASE_URL для готового стенда'); }
}
if (args.includes('--docker')) {
  try {
    const version = execFileSync('docker', ['version', '--format', '{{.Server.Version}}'],
      { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
    add('Docker Engine', version ? 'pass' : 'fail', version ? 'Демон доступен' : 'Сервер Docker не ответил');
  } catch { add('Docker Engine', 'fail', 'Демон недоступен; запустите Docker Desktop/Engine'); }
  add('Окружение Docker', existsSync(join(e2eDir, '../../apps/server/.env')) ? 'pass' : 'warn',
    'Для стенда команды нужен настроенный apps/server/.env; doctor не запускает контейнеры');
}
const report = { checkedAt: new Date().toISOString(), checks };
mkdirSync(join(e2eDir, 'playwright-report', 'doctor'), { recursive: true });
writeFileSync(join(e2eDir, 'playwright-report', 'doctor', 'results.json'), JSON.stringify(report, null, 2));
process.exitCode = checks.some(check => check.status === 'fail') ? 1 : 0;
