import type { Reporter, TestCase, TestResult, FullResult, FullConfig } from '@playwright/test/reporter';
import { mkdirSync, writeFileSync } from 'node:fs';
import { diagnosticLabel, errorDiagnostics } from '../scripts/api-diagnostics.mjs';

/** No step tree, attachments, DOM snapshots, response bodies or raw API errors. */
export default class ApiReporter implements Reporter {
  private cases = new Map<string, { test: TestCase; result: TestResult }>();
  private environment: { workers?: number; retries?: number } = {};
  private redact(text: string) {
    const password = process.env.E2E_PASSWORD;
    if (!password) return text;
    return [password, JSON.stringify(password).slice(1, -1), encodeURIComponent(password)]
      .reduce((value, secret) => value.split(secret).join('[redacted]'), text);
  }
  onBegin(config: FullConfig) {
    this.environment = { workers: config.workers, retries: config.projects[0]?.retries };
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.cases.set(test.id, { test, result });
    const diagnostics = errorDiagnostics(result.errors, [process.env.E2E_PASSWORD]);
    console.log(`[${result.status}] ${this.redact(test.title)}${diagnostics.length ? ' — ' + diagnostics.map(diagnosticLabel).join('; ') : ''}`);
  }
  onError() { console.error('API runner error (details omitted to protect credentials).'); }
  onEnd(result: FullResult) {
    const tests = [...this.cases.values()].map(({ test, result: last }) => {
      const fixme = test.annotations.find(a => a.type === 'fixme');
      const status = test.outcome() === 'flaky' ? 'flaky' : last.status;
      const note = fixme ? this.redact(fixme.description ?? 'Known application bug.') : status === 'skipped'
        ? this.redact(test.annotations.find(a => a.type === 'skip')?.description ?? 'API scenario skipped; check its explicit precondition.')
        : status === 'passed' ? '' : status === 'flaky' ? 'Scenario required a retry; acceptance is blocked.'
          : 'Browser assertion failed. Reproduce the named scenario; sensitive action details are omitted.';
      const diagnostics = errorDiagnostics(last.errors, [process.env.E2E_PASSWORD]);
      return { title: this.redact(test.title), status, fixme: !!fixme, durationMs: test.results.reduce((sum, attempt) => sum + attempt.duration, 0),
        attempts: test.results.length, note, failureKind: last.status === 'timedOut' ? 'timeout' : last.status === 'interrupted' ? 'interrupted'
          : last.status === 'failed' ? 'assertion-or-runtime' : undefined, errorLocation: diagnostics[0]?.errorLocation, diagnostics };
    });
    mkdirSync('playwright-report/api', { recursive: true });
    const counts = Object.fromEntries(['passed', 'failed', 'timedOut', 'interrupted', 'skipped', 'flaky'].map(status => [status, tests.filter(t => t.status === status).length]));
    const fixme = tests.filter(t => t.fixme).length;
    writeFileSync('playwright-report/api/results.json', JSON.stringify({ status: result.status, environment: this.environment, counts: { ...counts, fixme }, tests }, null, 2));
    console.log(`API: ${counts.passed} passed, ${counts.failed + counts.timedOut + counts.interrupted} failed, ${counts.skipped - fixme} skipped, ${fixme} fixme, ${counts.flaky} flaky. Report: playwright-report/api/results.json`);
  }
}
