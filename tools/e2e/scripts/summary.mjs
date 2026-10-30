import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { apiPassword, e2eDir } from './environment.mjs';
import { acceptance, collectRuns, expectedScreens, inspectScreens } from './report-model.mjs';
import { renderHtml } from './report-html.mjs';

export function gitState(root = e2eDir) {
  try {
    const options = { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, windowsHide: true };
    return { revision: execFileSync('git', ['rev-parse', 'HEAD'], options).trim(),
      dirty: !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], options).trim() };
  } catch { return { revision: null, dirty: true }; }
}

const oneLine = value => String(value ?? '').replace(/[\r\n|]/g, ' ').trim();
export function markdown(model) {
  const rows = model.runs.map(run => run.available
    ? `| ${run.profile} | ${run.counts.passed} | ${run.counts.failed} | ${run.counts.fixme} | ${run.counts.skipped} | ${run.counts.flaky} | ${run.current ? 'да' : 'не подтверждена'} |`
    : `| ${run.profile} | — | — | — | — | — | ${run.invalid ? 'повреждён отчёт' : 'нет отчёта'} |`);
  const issues = [...new Set(model.runs.flatMap(run => (run.tests ?? []).filter(test => ['failed', 'fixme', 'flaky', 'notRun'].includes(test.status))
    .map(test => test.status === 'fixme' && test.note ? `- ${oneLine(test.note)}` : `- ${run.profile}/${oneLine(test.project)} → ${oneLine(test.title)} → ожидалось: проверка пройдена → получилось: ${test.status}.`)))];
  return `# Green Pavlodar — сводка для Дамира\n\n${model.acceptance.message}.\n\nСобрано: ${model.generatedAt}. Ревизия: ${model.revision ?? 'неизвестна'}.\n\n| Прогон | Passed | Failed | Fixme | Skip | Flaky | Свежесть |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\nFixme — нерешённый дефект; skip — не выполненная проверка. Быстрый прогон не заменяет полный. Docker и ручной показ проверяются отдельно.\n\n${issues.length ? issues.join('\n') : 'В доступных результатах падений и fixme нет; отсутствие отчёта не означает успешную проверку.'}\n\nСкриншоты: ${model.screens.filter(screen => screen.valid).length}/26; свежесть подтверждена для ${model.screens.filter(screen => screen.fresh).length}.\n`;
}

export function generateSummary({ root = e2eDir, secrets = [], pack = false } = {}) {
  const runs = collectRuns(root, secrets);
  const { revision, dirty } = gitState(root);
  const model = { generatedAt: new Date().toISOString(), revision, dirty, runs,
    screens: inspectScreens(root, runs), acceptance: acceptance(runs, revision) };
  if (dirty) model.acceptance = { ready: false, message: 'Есть локальные изменения после зафиксированной версии: полная приёмка не подтверждена' };
  const folder = join(root, 'playwright-report', 'summary');
  mkdirSync(join(folder, 'screens'), { recursive: true });
  const html = renderHtml(model);
  const note = markdown(model);
  const result = JSON.stringify(model, null, 2);
  writeFileSync(join(folder, 'index.html'), html);
  writeFileSync(join(folder, 'DAMIR.md'), note);
  writeFileSync(join(folder, 'results.json'), result);
  for (const screen of model.screens.filter(screen => screen.valid)) copyFileSync(join(root, 'screens', screen.name), join(folder, 'screens', screen.name));
  if (pack) {
    if (model.screens.some(screen => !screen.valid || !screen.fresh)) throw new Error('Pack needs all 26 fresh PNGs: run npm run e2e:screens first');
    // Explicit allowlist: never archive test-results, API errors, traces, .env or arbitrary files.
    const entries = { 'index.html': strToU8(html), 'DAMIR.md': strToU8(note), 'results.json': strToU8(result) };
    for (const name of expectedScreens) entries[`screens/${name}`] = readFileSync(join(root, 'screens', name));
    writeFileSync(join(folder, 'green-pavlodar-demo.zip'), zipSync(entries, { level: 6 }));
  }
  return model;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => !['--pack', '--strict'].includes(arg))) throw new Error('Supported options: --pack, --strict');
    const { value } = apiPassword();
    const model = generateSummary({ secrets: [value], pack: args.includes('--pack') });
    console.log('Summary: playwright-report/summary/index.html; team notes: playwright-report/summary/DAMIR.md');
    if (args.includes('--pack')) console.log('Demo package: playwright-report/summary/green-pavlodar-demo.zip (29 files, no API captures)');
    console.log(model.acceptance.message);
    if (args.includes('--strict') && !model.acceptance.ready) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
