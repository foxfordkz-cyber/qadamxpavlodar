import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { profiles } from './profiles.mjs';
import { redact } from './environment.mjs';
import { captureRunId, inspectCapture } from './screen-provenance.mjs';
import { safeDiagnostic } from './api-diagnostics.mjs';

export const screenNames = ['home', 'map', 'problems', 'priorities', 'species', 'projects', 'rates', 'import', 'guide', 'tasks', 'reports', 'time-planting', 'time-20-years', 'lab', 'outcomes'];
export const expectedScreens = screenNames.flatMap(name => [1280, 375].map(width => `${name}-${width}.png`));
export const statuses = ['passed', 'failed', 'fixme', 'skipped', 'flaky', 'notRun'];

export function normalizeReport(data, profile, secrets = []) {
  const tests = [];
  const safe = value => redact(value, secrets);
  if (profile === 'api') {
    if (!Array.isArray(data.tests) || typeof data.status !== 'string') throw new Error('Invalid API report');
    for (const test of data.tests) {
      const fixme = test.fixme ?? /^E2E-\d+:/.test(test.note ?? '');
      const status = test.status === 'flaky' ? 'flaky' : test.status === 'passed' ? 'passed' : test.status === 'skipped' ? fixme ? 'fixme' : 'skipped' : 'failed';
      tests.push({ title: safe(test.title), project: 'api', status, note: safe(test.note), durationMs: test.durationMs ?? 0,
        diagnostics: Array.isArray(test.diagnostics) ? test.diagnostics.slice(0, 8).map(safeDiagnostic).filter(value => Object.keys(value).length) : [] });
    }
  } else {
    if (!Array.isArray(data.suites) || !data.stats) throw new Error('Invalid Playwright report');
    const visit = suites => {
      for (const suite of suites) {
        for (const spec of suite.specs ?? []) {
          for (const test of spec.tests ?? []) {
            const last = test.results?.at(-1);
            const annotation = test.annotations?.find(item => item.type === 'fixme') ?? test.annotations?.find(item => item.type === 'skip');
            let status = 'notRun';
            if (test.status === 'flaky') status = 'flaky';
            else if (test.status === 'unexpected') status = 'failed';
            else if (last?.status === 'skipped') status = annotation?.type === 'fixme' ? 'fixme' : 'skipped';
            else if (last?.status === 'passed') status = 'passed';
            else if (last) status = 'failed';
            const outOfScope = status === 'skipped' && test.projectName === 'desktop' && [
              'mobile: bottom sheet expands from under 60% to about 90%',
              'mobile report: document fits the viewport and wide tables scroll internally',
            ].includes(spec.title);
            tests.push({ title: safe(spec.title), project: safe(test.projectName), status, outOfScope,
              note: safe(annotation?.description), durationMs: last?.duration ?? 0 });
          }
        }
        visit(suite.suites ?? []);
      }
    };
    visit(data.suites);
  }
  return { tests, counts: Object.fromEntries(statuses.map(status => [status, tests.filter(test => test.status === status).length])),
    runnerFailed: profile === 'api' ? data.status !== 'passed' : !!data.errors?.length,
    durationMs: profile === 'api' ? tests.reduce((sum, test) => sum + test.durationMs, 0) : data.stats.duration };
}

export function runIsComplete(run) {
  return run.available && run.current && run.meta?.state === 'finished' && run.meta.exitCode === 0 &&
    (!run.meta.privacyScan || run.meta.privacyScan === 'passed') &&
    run.meta.selection === 'full' && !run.runnerFailed && run.counts.passed > 0 &&
    statuses.filter(status => !['passed', 'skipped'].includes(status)).every(status => run.counts[status] === 0) &&
    run.tests.filter(test => test.status === 'skipped').every(test => run.profile === 'mock' && test.outOfScope);
}

export function acceptance(runs, revision) {
  const required = ['mock', 'api'].map(profile => runs.find(run => run.profile === profile));
  const ready = /^[a-f0-9]{40}$/.test(revision ?? '') && required.every(run => run && runIsComplete(run) && run.meta.revision === revision && !run.meta.dirty);
  return { ready, message: ready ? 'Полные mock и API пройдены на текущем коммите' : 'Полная приёмка mock + API ещё не подтверждена' };
}

function json(file) { return JSON.parse(readFileSync(file, 'utf8')); }

export function collectRuns(root, secrets = []) {
  return profiles.map(profile => {
    const file = join(root, profile === 'api' ? 'playwright-report' : 'test-results', profile, 'results.json');
    const metaFile = join(root, 'playwright-report', 'runs', `${profile}.json`);
    let meta;
    try {
      if (existsSync(metaFile)) {
        const raw = json(metaFile);
        // Only publish the fields needed to identify a run, never arbitrary environment/argv.
        meta = { runId: captureRunId.test(raw.runId ?? '') ? raw.runId : null,
          state: raw.state, startedAt: raw.startedAt, endedAt: raw.endedAt, exitCode: raw.exitCode,
          browserExitCode: Number.isInteger(raw.browserExitCode) ? raw.browserExitCode : undefined,
          privacyScan: ['pending', 'passed', 'failed'].includes(raw.privacyScan) ? raw.privacyScan : undefined,
          revision: /^[a-f0-9]{40}$/.test(raw.revision) ? raw.revision : null, dirty: !!raw.dirty,
          selection: raw.selection, capturesScreens: raw.capturesScreens === true,
          command: typeof raw.command === 'string' && /^node scripts\/run\.mjs (mock|api|smoke|screens)$/.test(raw.command) ? raw.command : undefined,
          environment: publicEnvironment(raw.environment),
          target: raw.target ? new URL(raw.target).origin : undefined };
      }
      if (!existsSync(file)) return { profile, available: false, meta };
      const normalized = normalizeReport(json(file), profile, secrets);
      // A failed new invocation must not silently reuse a previous green JSON report.
      const current = !!meta?.startedAt && statSync(file).mtimeMs >= Date.parse(meta.startedAt);
      if (!current) return { profile, available: false, current: false, stale: true, meta };
      return { profile, available: true, current, meta, ...normalized };
    } catch {
      return { profile, available: false, invalid: true, meta };
    }
  });
}

const safeVersion = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value : undefined;
const publicEnvironment = value => value ? { node: safeVersion(value.node), playwright: safeVersion(value.playwright),
  platform: ['win32', 'linux', 'darwin'].includes(value.platform) ? value.platform : undefined,
  arch: ['x64', 'arm64', 'ia32'].includes(value.arch) ? value.arch : undefined,
  workers: Number.isInteger(value.workers) && value.workers > 0 && value.workers <= 128 ? value.workers : undefined,
  retries: Number.isInteger(value.retries) && value.retries >= 0 && value.retries <= 10 ? value.retries : undefined } : undefined;

export function latestCaptureRun(runs = []) {
  return runs.filter(run => ['mock', 'screens'].includes(run.profile) && run.meta?.capturesScreens && run.meta.startedAt)
    .sort((a, b) => Date.parse(b.meta.startedAt) - Date.parse(a.meta.startedAt))[0];
}

export function captureRunIsComplete(run) {
  return !!run && run.available && run.current && run.meta?.state === 'finished' && run.meta.exitCode === 0 &&
    run.meta.capturesScreens && !run.runnerFailed && run.counts.passed > 0 &&
    (run.profile === 'screens' || (run.profile === 'mock' && run.meta.selection === 'full')) &&
    statuses.filter(status => !['passed', 'skipped'].includes(status)).every(status => run.counts[status] === 0) &&
    run.tests.filter(test => test.status === 'skipped').every(test => run.profile === 'mock' && test.outOfScope);
}

export function inspectScreens(root, runs = [], revision) {
  const screenshotRun = latestCaptureRun(runs);
  return expectedScreens.map(name => inspectCapture(root, name, screenshotRun, revision));
}

export function collectHistory(root, revision) {
  const directory = join(root, 'playwright-report', 'history');
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => captureRunId.test(name.replace(/\.json$/, ''))).flatMap(name => {
    try {
      const record = json(join(directory, name));
      if (record.meta?.revision !== revision) return [];
      // History is for run provenance, not another source of raw test/HTTP errors.
      return [{ profile: profiles.includes(record.profile) ? record.profile : 'unknown', runId: record.meta.runId, available: !!record.available,
        revision, startedAt: record.meta.startedAt, endedAt: record.meta.endedAt, exitCode: record.meta.exitCode,
        browserExitCode: record.meta.browserExitCode, privacyScan: record.meta.privacyScan,
        selection: record.meta.selection, dirty: !!record.meta.dirty, target: record.meta.target,
        command: /^node scripts\/run\.mjs (mock|api|smoke|screens)$/.test(record.meta.command ?? '') ? record.meta.command : undefined,
        environment: publicEnvironment(record.meta.environment),
        counts: record.available ? Object.fromEntries(statuses.map(status => [status, Number.isInteger(record.counts?.[status]) ? record.counts[status] : 0])) : null }];
    } catch { return []; }
  }).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}
