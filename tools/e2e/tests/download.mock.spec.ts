import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { openPage, SITE } from '../support/helpers';
import { bugs, runKnownBugs } from '../support/known-bugs';

test('zone report downloads a real Word memo with estimate', async ({ page }) => {
  test.fixme(!runKnownBugs, bugs.memo);
  await openPage(page, `/report?site=${SITE}`);
  await expect(page.getByRole('heading', { name: /Смета/ })).toBeVisible();
  const button = page.getByRole('button', { name: /Служебная записка|Записка.*Word|Word.*записка/i });
  await expect(button).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(file.suggestedFilename()).toMatch(/\.docx$/i);
  const bytes = await readFile((await file.path())!);
  expect(bytes.length).toBeGreaterThan(5 * 1024);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  const document = unzipSync(bytes)['word/document.xml'];
  expect(document).toBeDefined();
  const text = strFromU8(document).replace(/<[^>]+>/g, '');
  expect(text).toContain('СЛУЖЕБНАЯ ЗАПИСКА');
  expect(text).toContain('Смета');
});
