import { test, expect, type Page } from '../support/test';
import type { Locator } from '@playwright/test';
import { openPage } from '../support/helpers';
import { switchLanguage, expectNoOverflow } from '../support/session';
import { workerReady } from '../support/worker';

// Check stable service labels from the worker dictionary explicitly. Source
// names, task descriptions and synthetic people's names are not translation bugs.
const demoDay = '2026-10-28';
const taskId = 'GP-104';
const photoName = 'qa-demo-worker-locale.png';

async function selectMockRoleInCurrentDocument(page: Page, role = 'Работник') {
  // mockControls.role is deliberately memory-only and resets to coordinator on a
  // fresh document. Re-enter the fixture role through the real UI, without
  // changing the selected language or injecting worker state. This does NOT test
  // authenticated API session persistence or authorization on direct entry.
  const languages = page.getByRole('group', { name: 'Язык / Тіл', exact: true });
  await expect(languages).toBeVisible();
  const kazakh = await languages.getByRole('button', { name: 'Қаз', exact: true }).getAttribute('aria-pressed') === 'true';
  await page.getByRole('button', { name: kazakh ? '⚙ Тексеру режимі' : '⚙ Режим проверки', exact: true }).click();
  const panel = page.locator('.gp-dev');
  await panel.getByRole('radio', { name: kazakh && role === 'Работник' ? 'Жұмысшы' : role, exact: true }).check();
  await panel.getByRole('button', { name: kazakh ? 'Жабу' : 'Закрыть', exact: true }).click();
  await expect(page).toHaveURL(/#\/worker/);
  await workerReady(page);
  await expect(page.locator('green-worker #shift-date')).toHaveValue(demoDay);
  return page.locator('green-worker');
}

async function openCabinet(page: Page) {
  await openPage(page, '/priorities');
  return selectMockRoleInCurrentDocument(page);
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
  test(`E2E-11: ${role}, Kazakh document and reload translate controls after explicit mock role re-entry`, async ({ page }) => {
    await page.goto('/?source=mock&lang=kk#/worker', { waitUntil: 'domcontentloaded' });
    await selectMockRoleInCurrentDocument(page, role);
    await expect(page.getByRole('group', { name: 'Язык / Тіл', exact: true }).getByRole('button', { name: 'Қаз', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expectKazakhShift(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await selectMockRoleInCurrentDocument(page, role);
    await expect(page.locator('green-worker #shift-date')).toHaveValue(demoDay);
    await expectKazakhShift(page);
  });
}

test('E2E-11: switching RU/KK persists without a language URL override after mock role re-entry', async ({ page }) => {
  const cabinet = await openCabinet(page);
  const refresh = cabinet.locator('.date-tools button[data-action=refresh]');
  await expect(refresh).toHaveAccessibleName('Обновить');
  await switchLanguage(page, 'Қаз');
  await expectKazakhShift(page);
  // A fresh document without ?lang exercises the saved choice rather than a URL override.
  await page.goto('/?source=mock#/worker', { waitUntil: 'domcontentloaded' });
  await selectMockRoleInCurrentDocument(page);
  await expect(page.getByRole('group', { name: 'Язык / Тіл', exact: true }).getByRole('button', { name: 'Қаз', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectKazakhShift(page);
  await switchLanguage(page, 'Рус');
  await expect(refresh).toHaveAccessibleName('Обновить');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await selectMockRoleInCurrentDocument(page);
  await expect(page.getByRole('group', { name: 'Язык / Тіл', exact: true }).getByRole('button', { name: 'Рус', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(refresh).toHaveAccessibleName('Обновить');
});

test('E2E-11: note and synthetic photo survive language repaint and reload with mock role re-entry', async ({ page }) => {
  const cabinet = await openCabinet(page);
  await cabinet.locator(`[data-action=select][data-id="${taskId}"]`).click();
  await cabinet.locator('button[data-action=start]').click();
  // Start refresh can render the report button before its busy guard clears.
  // Navigation stays disabled until that operation completes; wait for this
  // observable completion before opening the independent language/photo draft.
  await expect(cabinet.locator('button[data-action=nav][data-id=tasks]').filter({ visible: true })).toBeEnabled();
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
  await selectMockRoleInCurrentDocument(page);
  await cabinet.locator('button[data-action=open-draft]').filter({ hasText: taskId }).click();
  await expectPhotoDraft(cabinet, note, [...bytes]);
  await expectNoOverflow(page);
  await expect(cabinet.locator('input#photo'), 'The preserved form must also switch to Kazakh').toHaveAccessibleName('Фото таңдау');
  await expect(cabinet.locator('button[data-action=send]')).toHaveAccessibleName('Тексеруге жіберу');
});
