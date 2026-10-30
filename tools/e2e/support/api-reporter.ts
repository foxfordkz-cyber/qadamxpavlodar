import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
import { mkdirSync, writeFileSync } from 'node:fs';

/** No step tree, attachments, DOM snapshots or raw errors in the API report. */
export default class ApiReporter implements Reporter {
  private results: { title: string; status: string; fixme: boolean; durationMs: number; note: string; errors: string[] }[] = [];
  private redact(text: string) {
    const password = process.env.E2E_PASSWORD;
    if (!password) return text;
    return [password, JSON.stringify(password).slice(1, -1), encodeURIComponent(password)]
      .reduce((value, secret) => value.split(secret).join('[redacted]'), text);
  }
  onTestEnd(test: TestCase, result: TestResult) {
    const status = result.status;
    const fixme = test.annotations.find(a => a.type === 'fixme');
    const note = fixme ? fixme.description ?? 'Known application bug.' : status === 'skipped' ? 'E2E_PASSWORD is absent; no login attempted.' :
      status === 'passed' ? '' : 'Browser assertion failed. Reproduce the named scenario; sensitive action details are omitted.';
    const errors = result.errors.map(e => this.redact(e.message ?? 'Assertion failed'));
    this.results.push({ title: test.title, status, fixme: !!fixme, durationMs: result.duration, note, errors });
    console.log(`[${status}] ${test.title}${note ? ` — ${note}` : ''}`);
  }
  onError() { console.error('API runner error (details omitted to protect credentials).'); }
  onEnd(result: FullResult) {
    mkdirSync('playwright-report/api', { recursive: true });
    const counts = Object.fromEntries(['passed', 'failed', 'timedOut', 'skipped'].map(status => [status, this.results.filter(t => t.status === status).length]));
    writeFileSync('playwright-report/api/results.json', JSON.stringify({ status: result.status, counts, tests: this.results }, null, 2));
    console.log(`API: ${counts.passed} passed, ${counts.failed + counts.timedOut} failed, ${counts.skipped} skipped. Report: playwright-report/api/results.json`);
  }
}
