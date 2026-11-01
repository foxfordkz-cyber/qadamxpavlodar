// UI-only helpers for one agreed synthetic report. Authentication and network guards belong to the runner.
const ORIGIN = 'https://green-pavlodar-api.pages.dev';
const FIXED_TASK = '9050ea3c-369b-4864-b30b-caede24c96f2';
const FIXED_SITE = 'site-osm-1568405606';
const FIXED_COHORT = 'release-738f96b2-cohort';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const baselineReports = new Set(['368df690-6894-4b67-9aab-2651a9c4fad9', '32bf4fed-c476-4cf6-81f2-aec7813939bb']);
const WORDS = {
  ru: { language: 'Рус', role: 'Просмотр', reports: 'Отчёты на проверке', note: 'Заметка работника', accepted: 'Принят', comment: 'Комментарий',
    accept: 'Принять', return: 'Вернуть на исправление', zone: 'Зона', cohort: 'Партия растений', inspection: 'Контрольный осмотр',
    snapshots: 'Сохранённые прогнозы', save: 'Сохранить прогноз', noData: 'Нет данных', demo: 'Демонстрационные данные',
    observed: '3. Что показал осмотр', notComparable: 'Сравнение пока недоступно', coverage: 'Охват осмотром',
    assessmentCoverage: 'Охват установленным состоянием', assessedSurvival: 'Живых среди оценённых растений',
    unknown: 'Неосмотренные растения и записи «состояние неизвестно» не считаются живыми или погибшими.' },
  kk: { language: 'Қаз', role: 'Қарау', reports: 'Тексерудегі есептер', note: 'Жұмысшы жазбасы', accepted: 'Қабылданды', comment: 'Түсініктеме',
    accept: 'Қабылдау', return: 'Түзетуге қайтару', zone: 'Аймақ', cohort: 'Өсімдіктер партиясы', inspection: 'Бақылау мақсатындағы қарап тексеру',
    snapshots: 'Сақталған болжамдар', save: 'Болжамды сақтау', noData: 'Дерек жоқ', demo: 'Демонстрациялық деректер',
    observed: '3. Қарап тексеру нені көрсетті', notComparable: 'Салыстыру әзірге қолжетімсіз', coverage: 'Қарап тексерілген өсімдіктер үлесі',
    assessmentCoverage: 'Жай-күйі анықталған өсімдіктер үлесі', assessedSurvival: 'Жай-күйі анықталған өсімдіктер арасындағы тірілер үлесі',
    unknown: 'Қарап тексерілмеген және жай-күйі белгісіз өсімдіктер тірі не қураған деп саналмайды.' },
};
const defaultExpected = Object.freeze({ total: 4, inspected: 2, assessed: 1, alive: 1, dead: 0, unknown: 3, notInspected: 2,
  inspectionCoveragePct: 50, assessmentCoveragePct: 25, survivalAmongAssessedPct: 100, wholeCohortSurvivalPct: null });

function assertIds({ reportId, taskId, siteId }) {
  if (taskId !== undefined && taskId !== FIXED_TASK) throw Error('UNAPPROVED_TASK');
  if (siteId !== undefined && siteId !== FIXED_SITE) throw Error('UNAPPROVED_SITE');
  if (reportId !== undefined && (!uuid.test(reportId) || baselineReports.has(reportId))) throw Error('NOT_A_NEW_APPROVED_REPORT');
}
async function emit(record, data) { if (record) await record(data); }
async function open(page, route, lang = 'ru') {
  if (new URL(page.url()).origin !== ORIGIN) throw Error('UNAPPROVED_BROWSER_ORIGIN');
  await page.goto(`${ORIGIN}/?source=api&lang=${lang}#${route}`, { waitUntil: 'domcontentloaded' });
}
async function ready(page, expect, lang) {
  await expect(page.locator('.gp-login')).toHaveCount(0);
  const language = page.getByRole('group', { name: 'Язык / Тіл', exact: true }).getByRole('button', { name: WORDS[lang].language, exact: true });
  await expect(language).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\?source=api&lang=(ru|kk)#/);
}
async function noOverflow(page, expect) {
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.client);
}
async function reportPhotos(page, expect) {
  const photos = page.locator('.gp-report .gp-photos .gp-photo');
  await expect(photos).toHaveCount(1);
  const img = photos.first().locator('img');
  await expect(img).toBeVisible();
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate(element => element.complete && element.naturalWidth > 0 && element.naturalHeight > 0)).toBe(true);
  const id = (await photos.first().locator('figcaption').innerText()).trim().split(/\s/)[0];
  expect(uuid.test(id)).toBe(true);
  const href = new URL(await img.getAttribute('src'), ORIGIN);
  expect(href.origin).toBe(ORIGIN);
  expect(href.pathname).toBe(`/api/v1/uploads/${id}`);
  return [id];
}

/** One exact new report, one UI accept click. Never retries a review mutation. */
export async function coordinatorAccept({ page, expect, reportId, taskId, note, record }) {
  assertIds({ reportId, taskId });
  if (!note || !/synthetic|DEMO|QA/i.test(note)) throw Error('SYNTHETIC_NOTE_REQUIRED');
  await page.setViewportSize({ width: 1280, height: 812 });
  await open(page, `/reports?report=${encodeURIComponent(reportId)}`, 'ru');
  await ready(page, expect, 'ru');
  const report = page.locator('.gp-report');
  await expect(page.getByRole('heading', { name: WORDS.ru.reports, exact: true })).toBeVisible();
  await expect(report.locator('h2')).toHaveText(reportId);
  await expect(report.locator('.gp-dl')).toContainText(taskId);
  await expect(report.locator('.gp-quote')).toHaveText(note);
  const photoIds = await reportPhotos(page, expect);
  await expect(report.locator('.gp-review')).toBeVisible();
  await report.getByLabel(WORDS.ru.comment, { exact: true }).fill('QA synthetic DEMO inspection acceptance; no real-world verification claimed.');
  const accept = report.getByRole('button', { name: /^✓\s*Принять$/ });
  await expect(accept).toBeEnabled();
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/reports/${reportId}/review` && response.request().method() === 'POST');
  await accept.click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const data = (await response.json()).data;
  expect(data.report.id).toBe(reportId);
  expect(data.report.taskId).toBe(taskId);
  expect(data.report.reviewStatus).toBe('accepted');
  expect(data.task.id).toBe(taskId);
  expect(data.task.status).toBe('verified');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page, expect, 'ru');
  await expect(report.locator('h2')).toHaveText(reportId);
  await expect(report.locator('.gp-alert--ok')).toContainText(WORDS.ru.accepted);
  await expect(report.locator('.gp-review')).toHaveCount(0);
  await expect(report.locator('.gp-quote')).toHaveText(note);
  expect(await reportPhotos(page, expect)).toEqual(photoIds);
  await noOverflow(page, expect);
  const evidence = { event: 'coordinator-ui-accepted', reportId, taskId, photoIds, reportVersion: data.report.version,
    taskVersion: data.task.version, reviewedAt: data.report.reviewedAt, reloaded: true, language: 'ru', width: 1280 };
  await emit(record, evidence);
  return evidence;
}

/** Existing accepted report: RU/KK × desktop/phone. No HTTP mutation or API bypass. */
export async function viewerRead({ page, expect, reportId, taskId, siteId, note, record }) {
  assertIds({ reportId, taskId, siteId });
  const rows = [];
  for (const lang of ['ru', 'kk']) for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await open(page, `/reports?report=${encodeURIComponent(reportId)}`, lang);
    await ready(page, expect, lang);
    const report = page.locator('.gp-report');
    await expect(page.locator('.gp-status-row > .gp-kv').first().locator('dd')).toContainText(WORDS[lang].role);
    await expect(page.getByRole('heading', { name: WORDS[lang].reports, exact: true })).toBeVisible();
    await expect(report.locator('h2')).toHaveText(reportId);
    await expect(report.locator('.gp-dl')).toContainText(taskId);
    if (siteId) await expect(report.locator(`a[href="#/map?site=${siteId}"]`)).toBeVisible();
    await expect(report.getByRole('heading', { name: WORDS[lang].note, exact: true })).toBeVisible();
    if (note) await expect(report.locator('.gp-quote')).toHaveText(note);
    await expect(report.locator('.gp-alert--ok')).toContainText(WORDS[lang].accepted);
    await expect(report.locator('.gp-review')).toHaveCount(0);
    await expect(report.locator('textarea')).toHaveCount(0);
    await expect(report.getByRole('button', { name: new RegExp(`${WORDS[lang].accept}$`) })).toHaveCount(0);
    await expect(report.getByRole('button', { name: new RegExp(`${WORDS[lang].return}$`) })).toHaveCount(0);
    const photoIds = await reportPhotos(page, expect);
    await noOverflow(page, expect);
    // Reload verifies this viewer session and language remain usable.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready(page, expect, lang);
    await expect(report.locator('h2')).toHaveText(reportId);
    await expect(report.locator('.gp-alert--ok')).toContainText(WORDS[lang].accepted);
    expect(await reportPhotos(page, expect)).toEqual(photoIds);
    const row = { event: 'viewer-ui-readonly-report', reportId, taskId, photoIds, lang, width, reloaded: true, mutationControls: false };
    await emit(record, row); rows.push(row);
  }
  return rows;
}

/** Read-only UI baseline or a later separately approved inspection. Expectations are independent literals. */
export async function outcomesRead({ page, expect, siteId, cohortId, inspectionId = 'release-738f96b2-inspection',
  expected = defaultExpected, expectedReportId, record }) {
  assertIds({ siteId });
  if (cohortId !== FIXED_COHORT) throw Error('UNAPPROVED_COHORT');
  if (expectedReportId) assertIds({ reportId: expectedReportId });
  const rows = [];
  for (const lang of ['ru', 'kk']) for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await open(page, `/outcomes?site=${encodeURIComponent(siteId)}`, lang);
    await ready(page, expect, lang);
    await expect(page.locator('.gp-status-row > .gp-kv').first().locator('dd')).toContainText(WORDS[lang].role);
    await expect(page.getByTestId('outcome-econom')).toBeVisible();
    await expect(page.getByTestId('outcome-optimal')).toBeVisible();
    await expect(page.getByTestId('outcome-max')).toBeVisible();
    await expect(page.getByLabel(WORDS[lang].zone, { exact: true })).toHaveValue(siteId);
    await page.getByLabel(WORDS[lang].cohort, { exact: true }).selectOption(cohortId);
    await page.getByLabel(WORDS[lang].inspection, { exact: true }).selectOption(inspectionId);
    const observed = page.locator('section[aria-labelledby="outcome-observed"]');
    await expect(observed.getByRole('heading', { name: WORDS[lang].observed, exact: true })).toBeVisible();
    await expect(observed).toContainText(WORDS[lang].demo);
    for (const key of ['total', 'inspected', 'assessed', 'alive', 'dead', 'unknown', 'notInspected']) {
      await expect(page.getByTestId(`outcome-stat-${key}`).locator('dd')).toHaveText(String(expected[key]));
    }
    for (const [label, key] of [['coverage','inspectionCoveragePct'],['assessmentCoverage','assessmentCoveragePct'],['assessedSurvival','survivalAmongAssessedPct']]) {
      const stat = observed.locator('.gp-outcome-stats > div').filter({ has: page.locator('dt').filter({ hasText: new RegExp('^'+WORDS[lang][label]+'$') }) });
      await expect(stat.locator('dd')).toHaveText(expected[key] === null ? WORDS[lang].noData : `${expected[key]}%`);
    }
    await expect(page.getByTestId('outcome-whole').locator('dd')).toHaveText(expected.wholeCohortSurvivalPct === null ? WORDS[lang].noData : `${expected.wholeCohortSurvivalPct}%`);
    await expect(observed).toContainText(WORDS[lang].unknown);
    await expect(page.getByTestId('outcome-comparison')).toHaveCount(0);
    await expect(page.locator('section[aria-labelledby="outcome-compare"]')).toContainText(WORDS[lang].notComparable);
    if (expectedReportId) await expect(observed.locator(`a[href="#/reports?report=${expectedReportId}"]`)).toBeVisible();
    const snapshots = page.getByLabel(WORDS[lang].snapshots, { exact: true });
    await snapshots.selectOption('release-738f96b2-forecast');
    await expect(snapshots).toHaveValue('release-738f96b2-forecast');
    await expect(page.locator('.gp-outcome-snapshot').last()).toBeVisible();
    await expect(page.getByRole('button', { name: WORDS[lang].save, exact: true })).toHaveCount(0);
    await expect(page.locator('.gp-outcomes-page [role=alert]')).toHaveCount(0);
    await noOverflow(page, expect);
    const row = { event: 'viewer-ui-outcomes-readonly', siteId, cohortId, inspectionId, lang, width, observed: { ...expected },
      savedForecastId: 'release-738f96b2-forecast', comparisonShown: false, demoLabel: true,
      linkedNewReportVerified: Boolean(expectedReportId), limitation: expectedReportId ? null : 'Baseline inspection only; this does not prove a new linked inspection exists.' };
    await emit(record, row); rows.push(row);
  }
  return rows;
}
