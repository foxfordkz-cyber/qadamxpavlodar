import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { apiPassword, e2eDir } from './environment.mjs';
import { acceptance, captureRunIsComplete, collectHistory, collectRuns, expectedScreens, inspectScreens, latestCaptureRun } from './report-model.mjs';
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

export function buildSummaryModel({ root = e2eDir, secrets = [] } = {}) {
  const runs = collectRuns(root, secrets);
  const { revision, dirty } = gitState(root);
  const captureRun = latestCaptureRun(runs);
  const model = { generatedAt: new Date().toISOString(), revision, dirty, runs, history: collectHistory(root, revision),
    captureRun: captureRun ? { profile: captureRun.profile, runId: captureRun.meta.runId, state: captureRun.meta.state,
      exitCode: captureRun.meta.exitCode, successful: !!captureRunIsComplete(captureRun) } : null,
    screens: inspectScreens(root, runs, revision), acceptance: acceptance(runs, revision) };
  if (dirty) model.acceptance = { ready: false, message: 'Есть локальные изменения после зафиксированной версии: полная приёмка не подтверждена' };
  else if (model.acceptance.ready && (!model.captureRun?.successful || model.screens.some(screen => !screen.fresh || !screen.reviewed))) {
    model.acceptance = { ready: false, message: 'Тесты пройдены, но успешный прогон полного набора свежих просмотренных снимков ещё не подтверждён' };
  }
  model.packageKind = model.acceptance.ready ? 'accepted-local-build' : 'diagnostic-not-accepted';
  return model;
}

export function generateSummary({ root = e2eDir, secrets = [], pack = false } = {}) {
  const model = buildSummaryModel({ root, secrets });
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

const stableJson = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const modelIdentity = model => { const { generatedAt, ...identity } = model; return stableJson(identity); };

/** Read-only gate: validate current evidence and the already published package. */
export function verifyPublishedSummary({ root = e2eDir, secrets = [] } = {}) {
  const model = buildSummaryModel({ root, secrets }), folder = join(root, 'playwright-report', 'summary');
  let published;
  try { published = JSON.parse(readFileSync(join(folder, 'results.json'), 'utf8')); }
  catch { throw new Error('Published summary is missing or invalid; run e2e:summary first'); }
  if (modelIdentity(published) !== modelIdentity(model)) throw new Error('Published summary is stale: SHA, run IDs, results or screenshot evidence changed');
  const html = readFileSync(join(folder, 'index.html'), 'utf8'), note = readFileSync(join(folder, 'DAMIR.md'), 'utf8');
  if (html !== renderHtml(published) || note !== markdown(published)) throw new Error('Published report content does not match its recorded evidence');
  const fresh = model.screens.filter(screen => screen.fresh);
  for (const screen of fresh) if (hashBytes(readFileSync(join(folder, 'screens', screen.name))) !== screen.sha256) {
    throw new Error('Published screenshot changed after report generation');
  }
  const archive = join(folder, 'green-pavlodar-demo.zip');
  if (existsSync(archive)) {
    const entries = unzipSync(readFileSync(archive));
    const allowed = ['index.html', 'DAMIR.md', 'results.json', ...fresh.map(screen => `screens/${screen.name}`)].sort();
    if (stableJson(Object.keys(entries).sort()) !== stableJson(allowed)) throw new Error('Archive contains missing or unexpected files');
    const decode = name => new TextDecoder().decode(entries[name]);
    if (stableJson(JSON.parse(decode('results.json'))) !== stableJson(published) || decode('index.html') !== html || decode('DAMIR.md') !== note) {
      throw new Error('Archive belongs to another report generation');
    }
    for (const screen of fresh) if (hashBytes(entries[`screens/${screen.name}`]) !== screen.sha256) throw new Error('Archive screenshot hash does not match current evidence');
  }
  return model;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => !['--pack', '--strict'].includes(arg))) throw new Error('Supported options: --pack, --strict');
    const { value } = apiPassword();
    if (args.includes('--strict') && args.includes('--pack')) throw new Error('Run e2e:pack and the read-only e2e:gate separately');
    const model = args.includes('--strict') ? verifyPublishedSummary({ secrets: [value] }) : generateSummary({ secrets: [value], pack: args.includes('--pack') });
    console.log('Summary: playwright-report/summary/index.html; team notes: playwright-report/summary/DAMIR.md');
    if (args.includes('--pack')) console.log(`Package: playwright-report/summary/green-pavlodar-demo.zip (${model.packageKind}, ${model.screens.filter(screen => screen.fresh).length} current mock captures, no API captures)`);
    console.log(model.acceptance.message);
    if (args.includes('--strict') && !model.acceptance.ready) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
