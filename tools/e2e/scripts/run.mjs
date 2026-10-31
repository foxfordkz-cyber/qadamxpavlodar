import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { apiPassword, baseUrl, e2eDir } from './environment.mjs';
import { selectRun } from './profiles.mjs';
import { generateSummary, gitState } from './summary.mjs';
import { collectRuns } from './report-model.mjs';

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
const require = createRequire(import.meta.url);
const metadata = { runId: randomUUID(), profile: run.profile, selection: run.selection, target, ...gitState(),
  command: `node scripts/run.mjs ${command}`, environment: { node: process.versions.node, platform: process.platform, arch: process.arch,
    playwright: require('@playwright/test/package.json').version },
  capturesScreens: run.profile === 'screens' || (run.profile === 'mock' && run.selection === 'full'),
  privacyScan: run.mode === 'api' && env.E2E_ISOLATED === '1' ? 'pending' : undefined,
  startedAt: new Date().toISOString(), state: 'running', exitCode: null };
env.E2E_RUN_ID = metadata.runId;
env.E2E_RUN_REVISION = metadata.revision ?? '';
function saveMetadata() {
  if (!run.executesTests) return;
  mkdirSync(metaFolder, { recursive: true });
  writeFileSync(join(metaFolder, `${run.profile}.json`), JSON.stringify(metadata, null, 2));
}
saveMetadata();
const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...run.args], {
  cwd: e2eDir, env, stdio: 'inherit', windowsHide: true,
});
child.on('error', () => { console.error('Cannot start Playwright'); process.exitCode = 1; });
child.on('close', (code) => {
  process.exitCode = code ?? 1;
  metadata.state = 'finished';
  metadata.exitCode = code ?? 1;
  metadata.endedAt = new Date().toISOString();
  try {
    const report = JSON.parse(readFileSync(join(e2eDir, run.mode === 'api' ? 'playwright-report' : 'test-results', run.profile, 'results.json'), 'utf8'));
    const workers = report.config?.workers ?? report.environment?.workers;
    const retries = report.environment?.retries ?? report.config?.projects?.[0]?.retries;
    if (Number.isInteger(workers)) metadata.environment.workers = workers;
    if (Number.isInteger(retries)) metadata.environment.retries = retries;
  } catch { /* Failed startup must still leave a finished non-green run record. */ }
  saveMetadata();
  if (run.executesTests) {
    try {
      const history = join(e2eDir, 'playwright-report', 'history');
      mkdirSync(history, { recursive: true });
      const record = collectRuns(e2eDir, [env.E2E_PASSWORD]).find(item => item.profile === run.profile);
      writeFileSync(join(history, `${metadata.runId}.json`), JSON.stringify(record, null, 2));
      generateSummary({ secrets: [env.E2E_PASSWORD] });
      console.log('Summary: playwright-report/summary/index.html');
    } catch { console.error('Summary could not be generated; original test exit code preserved.'); }
  }
});
process.on('SIGINT', () => child.kill('SIGINT'));
