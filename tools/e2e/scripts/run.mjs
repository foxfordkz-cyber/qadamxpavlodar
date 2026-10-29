import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const [mode = 'mock', ...args] = process.argv.slice(2);
if (!['mock', 'api'].includes(mode)) throw new Error('Expected mock or api');
const env = { ...process.env, E2E_MODE: mode };
if (mode === 'api') env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
if (mode === 'api' && !env.E2E_PASSWORD) {
  // The value is passed only to the child environment, never to argv or stdout.
  try {
    const values = parseEnv(readFileSync(new URL('../../../apps/server/.env', import.meta.url), 'utf8'));
    if (values.DEMO_PASSWORD) env.E2E_PASSWORD = values.DEMO_PASSWORD;
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot read local server .env (contents omitted)');
  }
}
if (args.includes('--known-bugs')) env.E2E_RUN_KNOWN_BUGS = '1';
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...args.filter(a => a !== '--known-bugs')], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), env, stdio: 'inherit',
});
child.on('error', () => { console.error('Cannot start Playwright'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
