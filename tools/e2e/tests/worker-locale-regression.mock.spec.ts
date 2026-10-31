import { test, expect, type Page } from '../support/test';
import type { Locator } from '@playwright/test';
import { openPage } from '../support/helpers';
import { mockRole, switchLanguage, expectNoOverflow } from '../support/session';
import { workerReady } from '../support/worker';

// The embedded cabinet currently supports a partial kk-draft dictionary. Check
// translated service labels explicitly; do not reject its documented RU fallback,
// source names, task descriptions or synthetic people's names as translation bugs.
const demoDay = '2026-10-28';
const taskId = 'GP-104';
const photoName = 'qa-demo-worker-locale.png';

async function openCabinet(page: Page, role = 'Работник') {
  await openPage(page, '/priorities');
  await mockRole(page, role);
  await expect(page).toHaveURL(/#\/worker/);
  await workerReady(page);
  await expect(page.locator('green-worker #shift-date')).toHaveValue(demoDay);
  return page.locator('green-worker');
}

async function expectKazakhShift(page: Page) {
  const cabinet = page.locator('green-worker');
  // Soft assertions retain reload evidence for the same confirmed defect. They
  // still fail the test; no skip/fixme or fallback expectation hides the failure.
  await expect.soft(cabinet.locator('.date-tools button[data-action=refresh]'),
    'KK shell must pass its language to the embedded worker cabinet').toHaveAccessibleName('Жаңарту');
  for (const [id, label] of [['current', 'Бүгінге'], ['submitted', 'Тексеруде'], ['confirmed', 'Расталған']]) {
    const text = await cabinet.locator(`button[data-action=tab][data-id=${id}]`).innerText();
    expect.soft(text, `The ${id} service filter must use the selected Kazakh dictionary`).toContain(label);
  }
  await expectNoOverflow(page);
}

async function expectPhotoDraft(cabinet: Locator, note: string, expectedBytes: number[]) {
  await expect(cabinet.locator('textarea#note'), 'Language changes must keep the open, unsent note').toHaveValue(note);
  const photo = cabinet.locator('.preview img');
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(96);
  await expect(cabinet.locator('.preview figcaption')).toContainText(photoName);
  const bytes = await photo.evaluate(async node => Array.from(new Uint8Array(await (await fetch((node as HTMLImageElement).src)).arrayBuffer())));
  expect(bytes, 'The selected synthetic image must survive unchanged, not merely its filename').toEqual(expectedBytes);
}

for (const role of ['Работник', 'Бригадир']) {
  test(`E2E-11: ${role}, direct Kazakh entry and reload translate available service controls`, async ({ page }) => {
    await openCabinet(page, role);
    await page.goto('/?source=mock&lang=kk#/worker', { waitUntil: 'domcontentloaded' });
    await workerReady(page);
    await expect(page.getByRole('group', { name: 'Язык / Тіл', exact: true }).getByRole('button', { name: 'Қаз', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expectKazakhShift(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await workerReady(page);
    await expect(page.locator('green-worker #shift-date')).toHaveValue(demoDay);
    await expectKazakhShift(page);
  });
}

test('E2E-11: switching RU/KK updates cabinet and persists without a language URL override', async ({ page }) => {
  const cabinet = await openCabinet(page);
  const refresh = cabinet.locator('.date-tools button[data-action=refresh]');
  await expect(refresh).toHaveAccessibleName('Обновить');
  await switchLanguage(page, 'Қаз');
  await expectKazakhShift(page);
  // A fresh document without ?lang exercises the saved choice rather than a URL override.
  await page.goto('/?source=mock#/worker', { waitUntil: 'domcontentloaded' });
  await workerReady(page);
  await expect(page.getByRole('group', { name: 'Язык / Тіл', exact: true }).getByRole('button', { name: 'Қаз', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectKazakhShift(page);
  await switchLanguage(page, 'Рус');
  await expect(refresh).toHaveAccessibleName('Обновить');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await workerReady(page);
  await expect(page.getByRole('group', { name: 'Язык / Тіл', exact: true }).getByRole('button', { name: 'Рус', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(refresh).toHaveAccessibleName('Обновить');
});

test('E2E-11: language repaint preserves the unsent note and synthetic photo, including reload', async ({ page }) => {
  const cabinet = await openCabinet(page);
  await cabinet.locator(`[data-action=select][data-id="${taskId}"]`).click();
  await cabinet.locator('button[data-action=start]').click();
  await expect(cabinet.locator('button[data-action=open-report]')).toBeEnabled();
  await cabinet.locator('button[data-action=open-report]').click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#dae8d6'; context.fillRect(0, 0, 96, 64);
    context.fillStyle = '#16482b'; context.font = '14px sans-serif'; context.fillText('QA DEMO', 10, 36);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const bytes = Buffer.from(png, 'base64');
  await cabinet.locator('input#photo').setInputFiles({ name: photoName, mimeType: 'image/png', buffer: bytes });
  await expect(cabinet.locator('.preview img')).toBeVisible();
  const note = `QA DEMO — synthetic locale preservation at ${page.viewportSize()!.width}px`;
  await cabinet.locator('textarea#note').fill(note);
  await expect(cabinet.locator('[data-save-status]')).toContainText('Сохранено на устройстве');
  await expectPhotoDraft(cabinet, note, [...bytes]);
  // Preservation is checked independently before the final translation assertion,
  // so the known locale bug cannot prevent detecting a draft-reset regression.
  await switchLanguage(page, 'Қаз');
  await expectPhotoDraft(cabinet, note, [...bytes]);
  await switchLanguage(page, 'Рус');
  await expectPhotoDraft(cabinet, note, [...bytes]);
  await switchLanguage(page, 'Қаз');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await workerReady(page);
  await cabinet.locator('button[data-action=open-draft]').filter({ hasText: taskId }).click();
  await expectPhotoDraft(cabinet, note, [...bytes]);
  await expectNoOverflow(page);
  await expect(cabinet.locator('input#photo'), 'The preserved form must also switch to Kazakh').toHaveAccessibleName('Фото таңдау');
  await expect(cabinet.locator('button[data-action=send]')).toHaveAccessibleName('Тексеруге жіберу');
});
