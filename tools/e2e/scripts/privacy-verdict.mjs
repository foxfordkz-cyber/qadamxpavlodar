import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectRuns } from './report-model.mjs';

/** Keep browser counts intact; a privacy failure is a runner failure. */
export function savePrivacyVerdict(root, runId, passed) {
  const file = join(root, 'playwright-report', 'runs', 'api.json');
  const meta = JSON.parse(readFileSync(file, 'utf8'));
  if (meta.runId !== runId || meta.state !== 'finished') throw new Error('API privacy verdict does not match the finished run');
  meta.browserExitCode = meta.browserExitCode ?? meta.exitCode;
  meta.privacyScan = passed ? 'passed' : 'failed';
  if (!passed) meta.exitCode = 1;
  writeFileSync(file, JSON.stringify(meta, null, 2));
  const history = join(root, 'playwright-report', 'history');
  mkdirSync(history, { recursive: true });
  const record = collectRuns(root).find(run => run.profile === 'api');
  writeFileSync(join(history, `${runId}.json`), JSON.stringify(record, null, 2));
  return meta;
}
