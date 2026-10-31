import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { savePrivacyVerdict } from './privacy-verdict.mjs';
import { generateSummary } from './summary.mjs';

const [mode = 'api', ...args] = process.argv.slice(2);
if (!['api', 'mock'].includes(mode)) throw new Error('Expected api or mock');
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24 for the isolated accepted server build');
const outcomes = args.includes('--outcomes');
const e2e = fileURLToPath(new URL('..', import.meta.url));
const serverDir = fileURLToPath(new URL('../../../apps/server', import.meta.url));
const webDir = fileURLToPath(new URL('../../../apps/web', import.meta.url));
const storage = join(e2e, 'test-results', `isolated-${mode}-${Date.now()}`);
mkdirSync(storage, { recursive: true });
const password = randomBytes(24).toString('hex');
const webPort = mode === 'api' ? '5177' : '5176';
const env = { ...process.env, E2E_BASE_URL: `http://localhost:${webPort}`, E2E_SCREEN_REVIEW: '1', E2E_ISOLATED: '1',
  VITE_API_PROXY: 'http://127.0.0.1:3102', HOST: '127.0.0.1', PORT: '3102', STORAGE_ROOT: storage,
  FRONTEND_ORIGINS: `http://localhost:${webPort}`, NODE_ENV: 'development', PLAYWRIGHT_NO_COPY_PROMPT: '1',
  ...(mode === 'api' ? { E2E_PASSWORD: password, DEMO_PASSWORD: password } : {}) };
delete env.DB_PATH; delete env.UPLOADS_PATH;
const sanitize = value => value.split(password).join('[redacted]');
function start(args, cwd, show = false) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  child.stdout.on('data', b => { output += b; if (show) process.stdout.write(sanitize(String(b))); });
  child.stderr.on('data', b => { output += b; });
  child.done = new Promise(resolve => { child.on('exit', code => resolve({ code, output: sanitize(output) })); child.on('error', () => resolve({code:1,output:'Child process could not start'})); });
  return child;
}
async function ready(url, child) {
  for (let n = 0; n < 120; n++) {
    if (child.exitCode !== null) throw new Error((await child.done).output);
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Isolated server did not become ready');
}
let api, web;
try {
  if (mode === 'api') {
    for (const file of ['src/tz/seed-cli.ts', '../../tools/e2e/scripts/seed-qa-permissions.ts', ...(outcomes ? ['src/outcomes/seed-cli.ts', '../../tools/e2e/scripts/seed-qa-outcomes.ts'] : [])]) {
      const result = await start(['--import', './scripts/local-network-guard.mjs', '--import', 'tsx', file], serverDir).done;
      if (result.code !== 0) throw new Error(result.output);
    }
    console.log('Disposable API database seeded; credentials remain only in process environments.');
    api = start(['--import', './scripts/local-network-guard.mjs', '--import', 'tsx', 'src/server.ts'], serverDir);
    await ready('http://127.0.0.1:3102/health', api);
  }
  web = start(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', webPort, '--strictPort'], webDir);
  await ready(env.E2E_BASE_URL, web);
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: e2e, encoding:'utf8', windowsHide:true }).stdout.trim();
  writeFileSync(join(storage, 'environment.json'), JSON.stringify({sha, mode, outcomesSeed:outcomes, node:process.versions.node, baseURL:env.E2E_BASE_URL, startedAt:new Date().toISOString()}, null, 2));
  const testsStartedAt = Date.now();
  const result = await start(['scripts/run.mjs', mode, ...args.filter(a => a !== '--outcomes')], e2e, true).done;
  let leaked = false;
  function scan(dir) { if (!existsSync(dir)) return; for (const entry of readdirSync(dir, {withFileTypes:true})) {
    const path = join(dir, entry.name); if (entry.isDirectory()) scan(path); else if (readFileSync(path).includes(Buffer.from(password))) leaked = true;
  } }
  if (mode === 'api') {
    scan(join(e2e, 'test-results/api')); scan(join(e2e, 'playwright-report/api')); scan(join(e2e, 'playwright-report/summary'));
    console.log(leaked ? 'Secret scan failed; value omitted.' : 'Secret scan passed.');
    const meta = JSON.parse(readFileSync(join(e2e, 'playwright-report/runs/api.json'), 'utf8'));
    if (meta.revision !== sha || Date.parse(meta.startedAt) < testsStartedAt) throw new Error('Cannot associate privacy scan with this isolated API run');
    savePrivacyVerdict(e2e, meta.runId, !leaked);
    generateSummary({ secrets: [password] });
  }
  process.exitCode = leaked ? 1 : result.code ?? 1;
} finally {
  for (const child of [api, web].filter(Boolean)) if (child.exitCode === null) child.kill();
  await Promise.all([api, web].filter(Boolean).map(child => child.done));
}
