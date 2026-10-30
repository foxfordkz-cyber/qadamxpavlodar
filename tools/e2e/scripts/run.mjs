import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { apiPassword, baseUrl, e2eDir } from './environment.mjs';
import { selectRun } from './profiles.mjs';
import { generateSummary, gitState } from './summary.mjs';

const [command = 'mock', ...args] = process.argv.slice(2);
const run = selectRun(command, args);
const target = baseUrl(process.env.E2E_BASE_URL || undefined).origin;
const env = { ...process.env, E2E_MODE: run.mode, E2E_PROFILE: run.profile, E2E_RUN_KNOWN_BUGS: run.knownBugs ? '1' : '0' };
if (run.mode === 'api') {
  env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
  const { value } = apiPassword(env);
  if (value) env.E2E_PASSWORD = value;
}
const metaFolder = join(e2eDir, 'playwright-report', 'runs');
const metadata = { profile: run.profile, selection: run.selection, target, ...gitState(),
  capturesScreens: run.profile === 'screens' || (run.profile === 'mock' && run.selection === 'full'),
  startedAt: new Date().toISOString(), state: 'running', exitCode: null };
function saveMetadata() {
  if (!run.executesTests) return;
  mkdirSync(metaFolder, { recursive: true });
  writeFileSync(join(metaFolder, `${run.profile}.json`), JSON.stringify(metadata, null, 2));
}
saveMetadata();
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...run.args], {
  cwd: e2eDir, env, stdio: 'inherit', windowsHide: true,
});
child.on('error', () => { console.error('Cannot start Playwright'); process.exitCode = 1; });
child.on('close', (code) => {
  process.exitCode = code ?? 1;
  metadata.state = 'finished';
  metadata.exitCode = code ?? 1;
  metadata.endedAt = new Date().toISOString();
  saveMetadata();
  if (run.executesTests) {
    try {
      generateSummary({ secrets: [env.E2E_PASSWORD] });
      console.log('Summary: playwright-report/summary/index.html');
    } catch { console.error('Summary could not be generated; original test exit code preserved.'); }
  }
});
process.on('SIGINT', () => child.kill('SIGINT'));
