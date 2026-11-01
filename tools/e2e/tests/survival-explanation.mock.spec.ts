import { test, expect, type Page } from '../support/test';
import type { Locator } from '@playwright/test';
import { openPage, dismissHint, SITE } from '../support/helpers';

const copy = {
  ru: {
    title: 'Как получен прогноз', tab: 'Приживаемость',
    label: 'Прогноз на синтетических данных',
    summary: 'Модель оценивает первый год; следующие годы — экспертная оценка. На посадках Павлодара прогноз пока не проверен.',
    show: 'Метод и ограничения', hide: 'Скрыть пояснение',
    dataset: 'Синтетических сценариев', validation: 'Из них для проверки',
    range: 'не 95%-я гарантия для отдельного вида или посадки Павлодара',
  },
  kk: {
    title: 'Болжам қалай есептелді', tab: 'Жерсіну',
    label: 'Синтетикалық деректерге негізделген болжам',
    summary: 'Модель бірінші жылды бағалайды; кейінгі жылдар — сараптамалық бағалау. Болжам Павлодардағы нақты отырғызуларда әлі тексерілмеген.',
    show: 'Әдіс және шектеулер', hide: 'Түсіндірмені жасыру',
    dataset: 'Синтетикалық сценарийлер', validation: 'Оның ішінде тексеруге арналған',
    range: 'жеке түр немесе Павлодардағы отырғызу үшін 95% кепілдік емес',
  },
} as const;
type Language = keyof typeof copy;

async function widthSafe(page: Page, notice: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    'The explanation must not make the page scroll horizontally').toBe(true);
  expect(await notice.evaluate(node => node.scrollWidth <= node.clientWidth),
    'Explanation text and facts must fit their container').toBe(true);
}

async function compactNotice(page: Page, language: Language) {
  const text = copy[language];
  const notice = page.getByRole('region', { name: text.title, exact: true });
  const toggle = notice.locator('.gp-survival-method__toggle');
  const details = notice.locator('.gp-survival-method__details');
  await expect(notice).toBeVisible();
  await expect(notice.locator('.gp-survival-method__label')).toHaveText(text.label);
  await expect(notice.locator('.gp-survival-method__summary')).toHaveText(text.summary);
  await expect(notice.locator('.gp-survival-method__summary')).toBeVisible();
  await expect(toggle).toHaveAccessibleName(text.show);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(details).toBeHidden();
  const id = await toggle.getAttribute('aria-controls');
  expect(id, 'Disclosure must identify the details it controls').toBeTruthy();
  await expect(details).toHaveAttribute('id', id!);
  expect(await page.locator('[id]').evaluateAll((nodes, target) => nodes.filter(node => node.id === target).length, id),
    'The controlled details ID must identify exactly one element').toBe(1);
  await widthSafe(page, notice);
  return { notice, toggle, details };
}

async function expandedDetails(page: Page, language: Language, notice: Locator) {
  const text = copy[language];
  const details = notice.locator('.gp-survival-method__details');
  await expect(details).toBeVisible();
  await expect(notice.locator('.gp-survival-method__toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(notice.locator('.gp-survival-method__toggle')).toHaveAccessibleName(text.hide);
  await expect(details.locator('dt')).toHaveText([text.dataset, text.validation]);
  // Independent reviewed fixture contract, docs/survival-model.md: 50 templates x
  // 240 scenarios; 80% training / 20% validation. No production function is the oracle.
  const counts = await details.locator('dd').allTextContents();
  expect(counts.map(value => Number(value.replace(/\s/g, '')))).toEqual([50 * 240, 50 * 240 / 5]);
  await expect(details).toContainText('ROC-AUC = 0,732');
  await expect(details).toContainText('Brier = 0,177');
  await expect(details).toContainText('n = 2400');
  await expect(details).toContainText(text.range);
  await widthSafe(page, notice);
}

for (const language of ['ru', 'kk'] as const) {
  test(`PR42: ${language} zone forecast keeps limitations visible and toggles details by pointer and keyboard`, async ({ page }) => {
    await openPage(page, `/map?site=${SITE}`, 'mock', language);
    const card = page.locator('.gp-sites__card');
    await expect(card.getByRole('tablist')).toBeVisible();
    await dismissHint(page);
    const handle = page.locator('.gp-sheet__handle');
    if (await handle.isVisible() && await handle.getAttribute('aria-expanded') === 'false') await handle.click();
    await card.getByRole('tab', { name: copy[language].tab, exact: true }).click();
    await expect(card.locator('.gp-zone')).toHaveAttribute('aria-busy', 'false');
    const { notice, toggle, details } = await compactNotice(page, language);
    await toggle.click();
    await expandedDetails(page, language, notice);
    await toggle.focus();
    await toggle.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(details).toBeHidden();
    await expect(notice.locator('.gp-survival-method__summary')).toBeVisible();
    await toggle.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(details).toBeVisible();
    await toggle.click();
    await expect(details).toBeHidden();
  });

  test(`PR42: ${language} report starts compact and includes full methodology in print media`, async ({ page }) => {
    await openPage(page, `/report?site=${SITE}`, 'mock', language);
    await expect(page.locator('.gp-report-doc')).toBeVisible();
    await dismissHint(page);
    const { notice, toggle, details } = await compactNotice(page, language);
    await toggle.click();
    await expandedDetails(page, language, notice);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(details).toBeHidden();
    // CSS print-media visibility only: this does not certify Word opening or pagination.
    await page.emulateMedia({ media: 'print' });
    await expect(toggle).toBeHidden();
    await expect(details).toBeVisible();
    await expect(details).toContainText(copy[language].range);
    await page.emulateMedia({ media: 'screen' });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(details).toBeHidden();
  });
}
