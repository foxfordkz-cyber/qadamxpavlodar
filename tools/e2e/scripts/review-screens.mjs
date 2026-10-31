import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { e2eDir } from './environment.mjs';
import { collectRuns, expectedScreens, inspectScreens } from './report-model.mjs';
import { captureRunId } from './screen-provenance.mjs';
import { gitState } from './summary.mjs';

export function reviewScreens({ root = e2eDir, runId, approve = false } = {}) {
  if (!captureRunId.test(runId ?? '')) throw new Error('An exact capture run UUID is required');
  const { revision, dirty } = gitState(root);
  const runs = collectRuns(root), screens = inspectScreens(root, runs, revision);
  const selected = runs.find(run => run.meta?.runId === runId && ['mock', 'screens'].includes(run.profile));
  if (!selected || selected.meta.revision !== revision || dirty) throw new Error('Visual review requires the current clean repository SHA and current capture run');
  const captures = screens.filter(screen => screen.fresh && screen.runId === runId);
  if (approve) {
    if (captures.length !== expectedScreens.length) throw new Error(`Visual approval needs all ${expectedScreens.length} current captures; missing or stale images cannot be approved`);
    const folder = join(root, 'playwright-report', 'captures', runId);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'review.json'), JSON.stringify({ schemaVersion: 1, runId, revision,
      reviewedAt: new Date().toISOString(), method: 'Visual inspection of these exact generated PNGs',
      captures: captures.map(({ name, sha256 }) => ({ name, sha256 })) }, null, 2));
  }
  return { runId, revision, approved: approve, captures: captures.map(({ name, relativePath, sha256, readiness }) => ({ name, relativePath, sha256, readiness })),
    missing: expectedScreens.filter(name => !captures.some(capture => capture.name === name)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), flag = args.indexOf('--run-id');
    if (flag < 0 || !args[flag + 1] || args.some((value, index) => !['--run-id', '--approve', '--list'].includes(value) && index !== flag + 1)) {
      throw new Error('Usage: node scripts/review-screens.mjs --run-id UUID --list|--approve; approve only after viewing every listed PNG');
    }
    if (args.includes('--approve') && args.includes('--list')) throw new Error('Choose either --list or --approve');
    console.log(JSON.stringify(reviewScreens({ runId: args[flag + 1], approve: args.includes('--approve') }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
