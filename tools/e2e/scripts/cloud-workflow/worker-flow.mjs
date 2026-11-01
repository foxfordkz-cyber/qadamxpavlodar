// One explicitly approved synthetic inspect task. Browser UI only; no auth or API helper.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

const APPROVED_TASK = '9050ea3c-369b-4864-b30b-caede24c96f2';
const APPROVED_SITE = 'site-osm-1568405606';
const SHIFT_DATE = '2026-11-01';
const ORIGIN = 'https://green-pavlodar-api.pages.dev';
const words = {
  ru: { shift: 'Смена', journal: 'Журнал', profile: 'Профиль', shiftHeading: 'Моя смена',
    journalHeading: 'Журнал работ', profileHeading: 'Карточка сотрудника', role: 'Работник',
    refresh: 'Обновить', current: 'На сегодня', submitted: 'На проверке', confirmed: 'Подтверждены',
    inspect: 'Осмотреть объект', assigned: 'Назначено', inProgress: 'В работе',
    start: 'Начать задание', report: 'Отчитаться', reportHeading: 'Отчёт о работе',
    photo: 'Выбрать фото', send: 'Отправить на проверку',
    saved: 'Сохранено на устройстве, не отправлено',
    sent: 'Отчёт сохранён. Ожидает проверки координатором.', pending: 'Ожидает проверки' },
  kk: { shift: 'Ауысым', journal: 'Журнал', profile: 'Профиль', shiftHeading: 'Менің ауысымым',
    journalHeading: 'Жұмыстар журналы', profileHeading: 'Қызметкер карточкасы', role: 'Жұмысшы',
    refresh: 'Жаңарту', current: 'Бүгінге', submitted: 'Тексеруде', confirmed: 'Расталған',
    inspect: 'Нысанды қарап тексеру', assigned: 'Тағайындалды', inProgress: 'Орындалуда',
    start: 'Тапсырманы бастау', report: 'Есеп беру', reportHeading: 'Жұмыс туралы есеп',
    photo: 'Фото таңдау', send: 'Тексеруге жіберу',
    saved: 'Құрылғыда сақталды, жіберілген жоқ',
    sent: 'Есеп сақталды. Үйлестірушінің тексеруін күтуде.', pending: 'Тексеруді күтуде' },
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function overflow(page, expect, stage) {
  const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth }));
  expect(layout.scrollWidth, stage + ': document must not overflow horizontally').toBeLessThanOrEqual(layout.clientWidth);
  return layout;
}

async function ready(page, expect) {
  const cabinet = page.locator('green-worker');
  await expect(cabinet).toBeVisible();
  await expect(page.locator('.gp-login')).toHaveCount(0);
  await expect(cabinet.locator('.loading')).toHaveCount(0);
  await expect(cabinet.locator('[data-action=nav][data-id=tasks]').filter({ visible: true })).toBeEnabled();
  await expect.poll(() => cabinet.evaluate(node => !!node.shadowRoot?.querySelector('link[rel=stylesheet]')?.sheet)).toBe(true);
  return cabinet;
}

async function language(page, expect, lang) {
  const group = page.getByRole('group', { name: 'Язык / Тіл', exact: true });
  const chosen = group.getByRole('button', { name: lang === 'kk' ? 'Қаз' : 'Рус', exact: true });
  await chosen.click();
  await expect(chosen).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('green-worker')).toHaveAttribute('lang', lang);
}

async function navigation(page, expect, lang) {
  const cabinet = await ready(page, expect), t = words[lang];
  for (const [id, label, heading, key] of [
    ['history', t.journal, t.journalHeading, 'Enter'],
    ['profile', t.profile, t.profileHeading, 'Space'],
    ['tasks', t.shift, t.shiftHeading, 'Enter'],
  ]) {
    const button = cabinet.locator(`[data-action=nav][data-id=${id}]`).filter({ visible: true });
    await expect(button).toHaveCount(1);
    await expect(button).toHaveAccessibleName(label);
    await button.focus();
    await page.keyboard.press(key);
    await expect(cabinet.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(button).toHaveAttribute('aria-current', 'page');
    if (id === 'profile') await expect(cabinet.locator('.profile-role')).toHaveText(t.role);
    await cabinet.locator('.page-footer').scrollIntoViewIfNeeded();
    const layout = await cabinet.evaluate(node => {
      const footer = node.shadowRoot.querySelector('.page-footer').getBoundingClientRect();
      const navs = [...node.shadowRoot.querySelectorAll('nav')].filter(nav => nav.getClientRects().length);
      return { footerTop: footer.top, footerBottom: footer.bottom, height: innerHeight,
        overlaps: navs.some(nav => { const r = nav.getBoundingClientRect();
          return r.left < footer.right && r.right > footer.left && r.top < footer.bottom && r.bottom > footer.top; }) };
    });
    expect(layout.overlaps, 'Worker navigation must not cover page footer').toBe(false);
    expect(layout.footerTop).toBeGreaterThanOrEqual(0);
    expect(layout.footerBottom).toBeLessThanOrEqual(layout.height + 1);
    await overflow(page, expect, `${lang}/${page.viewportSize().width}/${id}`);
  }
  await expect(cabinet.locator('.date-tools button[data-action=refresh]')).toHaveAccessibleName(t.refresh);
  for (const id of ['current', 'submitted', 'confirmed'])
    await expect(cabinet.locator(`[data-action=tab][data-id=${id}]`)).toContainText(t[id]);
}

async function assertDraft(page, expect, lang, note, photoName, photoDigest, photoBytes) {
  const cabinet = await ready(page, expect), t = words[lang];
  await expect(cabinet.locator('.form h3').first()).toHaveText(t.reportHeading);
  await expect(cabinet.locator('textarea#note')).toHaveValue(note);
  await expect(cabinet.locator('input#photo')).toHaveAccessibleName(t.photo);
  await expect(cabinet.locator('[data-action=send]')).toHaveAccessibleName(t.send);
  await expect(cabinet.locator('[data-save-status]')).toHaveText(t.saved);
  await expect(cabinet.locator('.preview figcaption')).toContainText(photoName);
  const photo = cabinet.locator('.preview img');
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate(node => node.complete && node.naturalWidth > 0 && node.naturalHeight > 0)).toBe(true);
  // Only a local blob URL is read, never an HTTP/API request from evaluate.
  const preview = await photo.evaluate(async image => {
    if (!image.src.startsWith('blob:')) return { blob: false };
    const bytes = await (await fetch(image.src)).arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return { blob: true, bytes: bytes.byteLength,
      sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') };
  });
  expect(preview).toEqual({ blob: true, bytes: photoBytes, sha256: photoDigest });
  await overflow(page, expect, `${lang}/${page.viewportSize().width}/draft`);
}

/** record receives safe {step,status,...} objects. No authentication or response bodies. */
export async function workerFlow({ page, expect, taskId, siteId, photoPath, note, record = async () => {} }) {
  if (taskId !== APPROVED_TASK || siteId !== APPROVED_SITE) throw Error('WORKER_FLOW_UNAPPROVED_TARGET');
  if (typeof note !== 'string' || !note.trim() || note.length > 4000 || !/synthetic|синтетичес|QA DEMO/i.test(note))
    throw Error('WORKER_FLOW_REQUIRES_SYNTHETIC_NOTE');
  const photoBytes = readFileSync(photoPath), photoName = basename(photoPath);
  if (!photoName.endsWith('.webp') || photoBytes.length === 0 || photoBytes.length > 5 * 1024 * 1024 ||
      photoBytes.toString('ascii', 0, 4) !== 'RIFF' || photoBytes.toString('ascii', 8, 12) !== 'WEBP')
    throw Error('WORKER_FLOW_REQUIRES_SYNTHETIC_WEBP');
  const url = new URL(page.url());
  if (url.origin !== ORIGIN || url.searchParams.get('source') !== 'api' || !url.hash.startsWith('#/worker'))
    throw Error('WORKER_FLOW_REQUIRES_AUTHENTICATED_PAGES_API_WORKER');
  const photoDigest = sha256(photoBytes), noteDigest = sha256(Buffer.from(note));
  await ready(page, expect);

  // All four read-only layout/language matrices complete before the first business write.
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    for (const lang of ['ru', 'kk']) {
      await language(page, expect, lang);
      await navigation(page, expect, lang);
      await record({ step: 'worker-navigation', status: 'PASS', language: lang, width,
        keyboard: true, activeSection: true, noFooterOverlap: true, noHorizontalOverflow: true });
    }
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  let cabinet = await ready(page, expect);
  await expect(cabinet).toHaveAttribute('lang', 'kk');
  await expect(page.getByRole('group', { name: 'Язык / Тіл', exact: true }).getByRole('button', { name: 'Қаз', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await record({ step: 'worker-session-language-reload', status: 'PASS', language: 'kk', width: 375 });

  await page.setViewportSize({ width: 1280, height: 900 });
  await language(page, expect, 'ru');
  const date = cabinet.locator('#shift-date');
  if (await date.inputValue() !== SHIFT_DATE) { await date.fill(SHIFT_DATE); await date.press('Tab'); }
  await expect(date).toHaveValue(SHIFT_DATE);
  await expect(cabinet.locator('.date-tools button[data-action=refresh]')).toBeEnabled();
  const row = cabinet.locator(`[data-action=select][data-id="${APPROVED_TASK}"]`);
  await expect(row).toBeVisible();
  await expect(row.locator('.badge')).toHaveText(words.ru.assigned);
  await row.click();
  await expect(cabinet.locator('.detail-panel .task-code')).toContainText(APPROVED_TASK);
  await expect(cabinet.locator('.detail-action')).toHaveText(words.ru.inspect);
  await expect(cabinet.locator('[data-action=start]')).toHaveAccessibleName(words.ru.start);
  await expect(cabinet.locator('[data-action=start]')).toBeEnabled();
  await record({ step: 'worker-before-start', status: 'READY', taskId, siteId,
    bindingLimit: 'Task ID and inspect action verified in UI; site/version/assignment must be verified by caller network guard.' });
  await cabinet.locator('[data-action=start]').click(); // exactly one click; no retry/rebase
  await ready(page, expect);
  await expect(cabinet.locator('.detail-hero .badge')).toHaveText(words.ru.inProgress);
  await expect(cabinet.locator('[data-action=open-report]')).toBeEnabled();
  await record({ step: 'worker-task-started-ui', status: 'PASS', taskId });
  await cabinet.locator('[data-action=open-report]').click();
  await expect(cabinet.locator('.form h3').first()).toHaveText(words.ru.reportHeading);
  await cabinet.locator('input#photo').setInputFiles(photoPath);
  await expect(cabinet.locator('.preview img')).toBeVisible();
  await cabinet.locator('textarea#note').fill(note);
  await expect(cabinet.locator('[data-save-status]')).toHaveText(words.ru.saved);

  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    for (const lang of ['ru', 'kk']) {
      await language(page, expect, lang);
      await assertDraft(page, expect, lang, note, photoName, photoDigest, photoBytes.length);
      await record({ step: 'worker-unsent-draft', status: 'PASS', language: lang, width,
        noteSha256: noteDigest, photoSha256: photoDigest, photoBytes: photoBytes.length });
    }
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  cabinet = await ready(page, expect);
  await expect(cabinet).toHaveAttribute('lang', 'kk');
  const draft = cabinet.locator('button[data-action=open-draft]').filter({ hasText: APPROVED_TASK });
  await expect(draft).toHaveCount(1);
  await draft.click();
  await expect(cabinet.locator('.detail-panel .task-code')).toContainText(APPROVED_TASK);
  await assertDraft(page, expect, 'kk', note, photoName, photoDigest, photoBytes.length);
  await record({ step: 'worker-unsent-draft-reload', status: 'PASS', language: 'kk', width: 375,
    noteSha256: noteDigest, photoSha256: photoDigest, photoBytes: photoBytes.length });

  await expect(cabinet.locator('[data-action=send]')).toBeEnabled();
  await record({ step: 'worker-before-report-send', status: 'READY', taskId, synthetic: true });
  await cabinet.locator('[data-action=send]').click(); // upload + single report through normal UI only
  await ready(page, expect);
  await expect(cabinet.locator('.toast[role=status]')).toContainText(words.kk.sent);
  await expect(cabinet.locator('.form')).toHaveCount(0);
  const history = cabinet.locator('.detail-history .history-card').filter({ hasText: note });
  await expect(history).toHaveCount(1);
  await expect(history.locator('.badge')).toHaveText(words.kk.pending);
  const submittedPhoto = history.locator('img');
  await expect(submittedPhoto).toBeVisible();
  await expect.poll(() => submittedPhoto.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
  const contentPath = await submittedPhoto.getAttribute('src');
  expect(contentPath).toMatch(/^\/api\/v1\/uploads\/[a-f0-9-]+$/i);
  await overflow(page, expect, 'worker-submitted-kk-375');
  const photoId = contentPath.split('/').at(-1);
  const evidence = { taskId, siteId, status: 'SUBMITTED_UI_CONFIRMED', photoId,
    noteSha256: noteDigest, inputPhotoSha256: photoDigest, inputPhotoBytes: photoBytes.length,
    role: 'worker', finalLanguage: 'kk', finalWidth: 375,
    reportIdSource: 'Caller captures the new ID from the UI-triggered report response; not exposed in worker DOM.' };
  await record({ step: 'worker-report-submitted-ui', ...evidence, uiStatus: evidence.status, status: 'PASS' });
  return evidence;
}
