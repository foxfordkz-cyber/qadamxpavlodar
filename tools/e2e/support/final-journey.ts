import { expect, type Page } from '@playwright/test';
import { SITE, dismissHint, settledPage } from './helpers';
import { inspectDocx } from './docx';

/** One actual browser journey; DOCX/XML validity is not Microsoft Word opening. */
export async function zoneToDocument(page: Page, mode: 'mock'|'api', lang: 'ru'|'kk') {
  await page.goto(`/?source=${mode}&lang=${lang}#/map?site=${SITE}`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('.gp-sites__card');
  await expect(card.locator('[role=tablist]')).toBeVisible();
  // The first-run panel mounts with the hydrated map, after DOMContentLoaded.
  // Dismissing before the card exists could miss it and block the sheet handle.
  await dismissHint(page);
  await expect(page.locator('.gp-firstrun')).toHaveCount(0);
  const handle = page.locator('.gp-sheet__handle');
  if (await handle.isVisible() && await handle.getAttribute('aria-expanded') === 'false') await handle.click();
  await card.getByRole('tab', { name: lang === 'ru' ? 'Растения' : 'Өсімдіктер', exact: true }).click();
  await expect(card.locator('.gp-zone')).toHaveAttribute('aria-busy', 'false');
  await expect(card.locator('.gp-rank li').first()).toBeVisible();
  await expect(card.locator('.gp-zone table tbody tr').first()).toBeVisible();
  await card.getByRole('tab', { name: lang === 'ru' ? 'Смета' : 'Смета', exact: true }).click();
  const cost = card.locator('#z-cost');
  await expect(cost).toContainText('₸');
  const costText = (await cost.innerText()).split('₸')[0].replace(/[^0-9]/g, '');
  expect(Number(costText)).toBeGreaterThan(0);
  await card.getByRole('tab', { name: lang === 'ru' ? 'Эффект' : 'Әсер', exact: true }).click();
  const years = card.locator('.gp-tm [role=radiogroup]');
  await expect(years).toBeVisible();
  const twenties = years.locator('label').filter({ hasText: /^20 (лет|жыл)$/ });
  await twenties.click();
  await expect(twenties.getByRole('radio')).toBeChecked();
  await expect(page.locator('.gp-tm-bar')).toBeVisible();
  await expect(card.locator('.gp-tm__stats')).toContainText('м²');
  const reportLink = card.locator('a[href^="#/report?"]').first();
  await reportLink.click();
  await expect(page).toHaveURL(new RegExp(`#/report\\?.*site=${SITE}`));
  await settledPage(page);
  await expect(page.locator('.gp-report-doc')).toContainText('₸');
  await page.getByRole('button', { name: /Word/ }).click();
  const exportPanel = page.getByRole('region', { name: /Word/ });
  const language = lang === 'ru' ? 'Рус' : 'Қаз';
  await exportPanel.locator('label').filter({hasText:new RegExp(`^${language}$`)}).click();
  await expect(exportPanel.getByRole('radio', {name:language,exact:true})).toBeChecked();
  const [download] = await Promise.all([page.waitForEvent('download'), exportPanel.getByRole('button', { name: /\.docx/i }).click()]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`-${lang}-.*\\.docx$`));
  const doc = await inspectDocx(page, (await download.path())!);
  expect(doc.text).toContain(lang === 'ru' ? 'СЛУЖЕБНАЯ ЗАПИСКА' : 'ҚЫЗМЕТТІК ЖАЗБА');
  expect(doc.tables.length).toBeGreaterThan(2);
}
