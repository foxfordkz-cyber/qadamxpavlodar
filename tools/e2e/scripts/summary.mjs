import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { apiPassword, e2eDir } from './environment.mjs';
import { acceptance, collectHistory, collectRuns, expectedScreens, inspectScreens } from './report-model.mjs';
import { renderHtml } from './report-html.mjs';
import { hashBytes } from './screen-provenance.mjs';

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
    ? `| ${run.profile} | ${run.counts.passed} | ${run.counts.failed} | ${run.counts.skipped} | ${run.counts.fixme} | ${run.counts.flaky} | ${run.counts.notRun} | ${run.meta?.revision ?? 'неизвестен'} | ${run.current ? run.meta?.state : 'устаревший отчёт'} |`
    : `| ${run.profile} | — | — | — | — | — | — | ${run.meta?.revision ?? 'неизвестен'} | ${run.invalid ? 'повреждён отчёт' : 'нет отчёта'} |`);
  const issues = [...new Set(model.runs.flatMap(run => (run.tests ?? []).filter(test => ['failed', 'fixme', 'flaky', 'notRun'].includes(test.status))
    .map(test => test.status === 'fixme' && test.note ? `- ${oneLine(test.note)}` : `- ${run.profile}/${oneLine(test.project)} → ${oneLine(test.title)} → ожидалось: проверка пройдена → получилось: ${test.status}.`)))];
  const conditions = model.runs.filter(run => run.meta).map(run => `- ${run.profile}: runId=${run.meta.runId ?? 'не записан'}; ${oneLine(run.meta.command)}; ${oneLine(run.meta.target)}; Node ${run.meta.environment?.node ?? '—'}, Playwright ${run.meta.environment?.playwright ?? '—'}, ${run.meta.environment?.platform ?? '—'}/${run.meta.environment?.arch ?? '—'}, workers=${run.meta.environment?.workers ?? '—'}, retries=${run.meta.environment?.retries ?? '—'}; ${run.meta.startedAt} → ${run.meta.endedAt ?? 'не завершён'}; exit=${run.meta.exitCode}; dirty=${!!run.meta.dirty}.`);
  const skips = model.runs.flatMap(run => (run.tests ?? []).filter(test => test.status === 'skipped')
    .map(test => `- ${run.profile}/${oneLine(test.project)}: ${oneLine(test.title)} — ${oneLine(test.note) || (test.outOfScope ? 'Мобильный сценарий не применяется к desktop; отдельно проверяется на телефоне.' : 'Причина не записана; пропуск блокирует приёмку.')}`));
  const history = (model.history ?? []).map(run => `| ${run.profile} | ${run.runId} | ${run.revision} | ${run.counts ? `${run.counts.passed}/${run.counts.failed}/${run.counts.skipped}/${run.counts.fixme}/${run.counts.flaky}` : 'нет результата этого запуска'} | ${run.selection} | ${run.startedAt} | ${run.endedAt ?? 'не завершён'} | ${run.exitCode} |`);
  return ['# Green Pavlodar — независимая браузерная приёмка', '', `${model.acceptance.message}.`, '',
    `Собрано: ${model.generatedAt}. SHA: ${model.revision ?? 'неизвестен'}. Тип пакета: ${model.packageKind}.`, '',
    '| Набор | Passed | Failed | Skipped | Fixme | Flaky | Not run | SHA | Состояние |',
    '|---|---:|---:|---:|---:|---:|---:|---|---|', ...rows, '',
    'Условия запусков (время UTC):', '', ...conditions, '',
    'Причины пропусков:', '', ...(skips.length ? skips : ['Пропуски в доступных отчётах отсутствуют.']), '',
    ...(issues.length ? issues : ['В доступных результатах падений и fixme нет; отсутствие отчёта не означает успешную проверку.']), '',
    `Снимки: ${model.screens.filter(screen => screen.fresh).length}/${expectedScreens.length} с совпадающими SHA/runId/хэшами; просмотрено ${model.screens.filter(screen => screen.fresh && screen.reviewed).length}. Старые и неподтверждённые PNG не включаются в архив.`, '',
    'История запусков этого SHA (P/F/S/X/Flaky):', '',
    '| Набор | Run ID | SHA | P/F/S/X/Flaky | Выборка | Начат UTC | Закончен UTC | Exit |',
    '|---|---|---|---|---|---|---|---|---|', ...(history.length ? history : ['| — | — | — | — | — | — | — | — |']), '',
    'Локальный API не доказывает работу Docker или публичного HTTPS. Проверка DOCX/XML не является открытием файла в Microsoft Word. Эти проверки и ручной сценарий защиты отмечаются отдельно.', ''].join('\n');
}

export function generateSummary({ root = e2eDir, secrets = [], pack = false } = {}) {
  const runs = collectRuns(root, secrets);
  const { revision, dirty } = gitState(root);
  const model = { generatedAt: new Date().toISOString(), revision, dirty, runs, history: collectHistory(root, revision),
    screens: inspectScreens(root, runs, revision), acceptance: acceptance(runs, revision) };
  if (dirty) model.acceptance = { ready: false, message: 'Есть локальные изменения после зафиксированной версии: полная приёмка не подтверждена' };
  else if (model.acceptance.ready && model.screens.some(screen => !screen.fresh || !screen.reviewed)) {
    model.acceptance = { ready: false, message: 'Тесты пройдены, но полный набор свежих просмотренных снимков ещё не подтверждён' };
  }
  model.packageKind = model.acceptance.ready ? 'accepted-local-build' : 'diagnostic-not-accepted';
  const folder = join(root, 'playwright-report', 'summary');
  mkdirSync(join(folder, 'screens'), { recursive: true });
  const html = renderHtml(model);
  const note = markdown(model);
  const result = JSON.stringify(model, null, 2);
  writeFileSync(join(folder, 'index.html'), html);
  writeFileSync(join(folder, 'DAMIR.md'), note);
  writeFileSync(join(folder, 'results.json'), result);
  // Never leave a previous run's screenshots next to a newly generated report.
  for (const name of expectedScreens) {
    const file = join(folder, 'screens', name);
    if (existsSync(file)) rmSync(file, { force: true });
  }
  for (const screen of model.screens.filter(screen => screen.fresh)) copyFileSync(join(root, screen.relativePath), join(folder, 'screens', screen.name));
  const archive = join(folder, 'green-pavlodar-demo.zip');
  if (existsSync(archive)) rmSync(archive, { force: true });
  if (pack) {
    // A blocked run may still produce an explicitly diagnostic archive. Missing,
    // stale, or replaced captures are listed in results.json and never substituted.
    // Explicit allowlist: never archive raw test-results, API errors/traces or .env.
    const entries = { 'index.html': strToU8(html), 'DAMIR.md': strToU8(note), 'results.json': strToU8(result) };
    for (const screen of model.screens.filter(screen => screen.fresh)) {
      const bytes = readFileSync(join(root, screen.relativePath));
      if (hashBytes(bytes) !== screen.sha256) throw new Error('Screenshot changed during packaging; no archive was published');
      entries[`screens/${screen.name}`] = bytes;
    }
    writeFileSync(archive, zipSync(entries, { level: 6 }));
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
    if (args.includes('--pack')) console.log(`Package: playwright-report/summary/green-pavlodar-demo.zip (${model.packageKind}, ${model.screens.filter(screen => screen.fresh).length} current mock captures, no API captures)`);
    console.log(model.acceptance.message);
    if (args.includes('--strict') && !model.acceptance.ready) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
