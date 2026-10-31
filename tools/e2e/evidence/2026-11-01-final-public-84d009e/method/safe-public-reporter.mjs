import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default class SafePublicReporter {
  constructor(options) { this.output = options.output; this.tests = []; this.globalErrors = 0; }
  onError() { this.globalErrors++; }
  onTestEnd(test, result) {
    const row = { title: test.title, project: test.parent.project()?.name ?? null, status: result.status,
      retry: result.retry, durationMs: result.duration, fixme: test.annotations.some(a => a.type === 'fixme'),
      failure: result.status === 'failed' || result.status === 'timedOut' ? 'assertion-or-browser-error; raw payload omitted' : null,
      screenshots: [], hitTests: [] };
    // The unchanged suite intentionally attaches only synthetic mock screenshots.
    // Failed-page automatic screenshots, DOM contexts, traces and raw errors are not retained.
    if (result.status === 'passed') for (const attachment of result.attachments) {
      if (attachment.contentType === 'image/png' && /^public-[a-z-]+$/.test(attachment.name)) {
        const bytes = attachment.body ?? (attachment.path ? readFileSync(attachment.path) : null);
        if (!bytes || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid intentional screenshot');
        const name = `${String(this.tests.length + 1).padStart(2, '0')}-${row.project}-${attachment.name}.png`;
        mkdirSync(join(this.output, 'screens'), { recursive: true }); writeFileSync(join(this.output, 'screens', name), bytes);
        row.screenshots.push({ file: `screens/${name}`, sha256: createHash('sha256').update(bytes).digest('hex'), reviewed: false });
      }
      if (attachment.name === 'public-assistant-hit-test' && attachment.contentType === 'application/json') {
        const raw = attachment.body ?? (attachment.path ? readFileSync(attachment.path) : null);
        if (raw) row.hitTests = JSON.parse(raw.toString('utf8')).map(mode => ({ mode: mode.mode,
          controls: mode.result.length, collisionCount: mode.result.reduce((n, item) => n + item.collisions.length, 0) }));
      }
    }
    this.tests.push(row);
  }
  onEnd() {
    const counts = { passed: this.tests.filter(t => t.status === 'passed').length,
      failed: this.tests.filter(t => !['passed', 'skipped'].includes(t.status)).length,
      skipped: this.tests.filter(t => t.status === 'skipped' && !t.fixme).length,
      fixme: this.tests.filter(t => t.fixme).length, flaky: this.tests.filter(t => t.retry > 0).length };
    writeFileSync(join(this.output, 'browser-results.json'), JSON.stringify({ counts, globalErrors: this.globalErrors,
      tests: this.tests, privacy: 'No raw errors, DOM snapshots, trace, video, cookies or credentials retained.' }, null, 2) + '\n');
    console.log(JSON.stringify({ kind: 'public-mock-safe-summary', counts, globalErrors: this.globalErrors }));
  }
}
