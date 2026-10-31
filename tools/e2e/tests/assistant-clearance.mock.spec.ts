import { test, expect } from '../support/test';
import { openPage, dismissHint, presentation, SITE } from '../support/helpers';
import { centerContent, expectHitTarget, expectUsableAssistant, inspectAssistantClearance } from '../support/assistant-clearance';

// The original four E2E-09 failures in defence-final.mock.spec.ts remain intact.
// These cases extend them to actual pointer/keyboard access and the other affected pages.
for (const lang of ['ru', 'kk'] as const) {
  test(`E2E-09 weights: ${lang}, ordinary/presentation, pointer and keyboard access`, async ({ page }, info) => {
    await openPage(page, '/priorities', 'mock', lang);
    await dismissHint(page);
    await expect(page.locator('.gp-rank-list li').first()).toBeVisible();
    const rows = page.locator('.gp-ranking__weights .gp-weight');
    await expect(rows).toHaveCount(6);
    for (const mode of ['ordinary', 'presentation']) {
      if (mode === 'presentation') await presentation(page);
      await page.evaluate(async () => { await document.fonts.ready; window.scrollTo({ top: 0, behavior: 'instant' }); });
      await inspectAssistantClearance(rows.locator('input, strong'), `${lang}-${mode}-initial-weights`, info, true);
      for (let index = 0; index < 6; index++) {
        const row = rows.nth(index), slider = row.locator('input[type=range]'), value = row.locator('strong');
        await centerContent(row);
        await expectHitTarget(slider, `${mode} slider ${index + 1}`);
        await expectHitTarget(value, `${mode} displayed value ${index + 1}`);
        await inspectAssistantClearance(row.locator('input,strong'), `${lang}-${mode}-weight-${index + 1}`, info);
        // A normal click focuses the real native slider; no force or synthetic change event.
        await slider.click();
        const before = Number(await slider.inputValue());
        const direction = before < 0.5 ? 'ArrowRight' : 'ArrowLeft';
        const expected = Number((before + (direction === 'ArrowRight' ? 0.05 : -0.05)).toFixed(2));
        await slider.press(direction);
        await expect.poll(async () => Number(await slider.inputValue())).toBe(expected);
        await expect(value).toHaveText(expected.toFixed(2));
      }
      await expectUsableAssistant(page);
    }
  });

  for (const sample of [
    { name: 'problem recommendations', route: '/problems', targets: '.gp-table tbody tr:nth-child(-n+3) td:last-child' },
    { name: 'species benefits', route: '/species', targets: '.gp-spcard:nth-child(-n+3) .gp-spcard__line' },
    { name: 'crew cards', route: '/tasks', targets: '.gp-worker:nth-child(-n+3) .gp-worker__head, .gp-worker:nth-child(-n+3) .gp-dl, .gp-worker:nth-child(-n+3) .gp-worker__load' },
    { name: 'laboratory unit price', route: '/lab', targets: '.gp-lab-metrics > div:last-child, .gp-lab-card > p.gp-small, .gp-lab-map' },
    { name: 'rate sources', route: '/rates', targets: '.gp-table tbody tr:nth-child(-n+3) td:last-child' },
  ]) test(`E2E-09 ${sample.name}: ${lang}, ordinary/presentation`, async ({ page }, info) => {
    await openPage(page, sample.route, 'mock', lang);
    await dismissHint(page);
    const targets = page.locator(sample.targets);
    await expect(targets.first()).toBeVisible();
    for (const mode of ['ordinary', 'presentation']) {
      if (mode === 'presentation') await presentation(page);
      await page.evaluate(async () => { await document.fonts.ready; window.scrollTo({ top: 0, behavior: 'instant' }); });
      await inspectAssistantClearance(targets, `${lang}-${mode}-${sample.route.slice(1)}-initial`, info, true);
      // Every previously obscured region is brought into view, including rightmost
      // table cells on a phone; a horizontally scrollable table is valid UI.
      for (let index = 0; index < await targets.count(); index++) {
        const current = targets.nth(index);
        await centerContent(current);
        // Inspect this readable region, not earlier rows now legitimately scrolled
        // behind the sticky header. Every required target gets its own turn.
        await inspectAssistantClearance(current, `${lang}-${mode}-${sample.route.slice(1)}-${index + 1}`, info);
      }
      await expectUsableAssistant(page);
    }
  });

  test(`E2E-09 growth explanation: ${lang}, planting/20 years, ordinary/presentation`, async ({ page }, info) => {
    await openPage(page, `/map?site=${SITE}`, 'mock', lang);
    await dismissHint(page);
    await expectUsableAssistant(page);
    const card = page.locator('.gp-sites__card');
    await card.getByRole('tab', { name: lang === 'ru' ? 'Эффект' : 'Әсер', exact: true }).click();
    const timeMachine = card.locator('.gp-tm');
    await expect(timeMachine).toBeVisible();
    if (page.viewportSize()!.width === 375) {
      await card.getByRole('button', { name: lang === 'ru' ? 'Развернуть карточку' : 'Карточканы жаю', exact: true }).click();
      await expect(card).toHaveClass(/\bis-full\b/);
    }
    for (const mode of ['ordinary', 'presentation']) {
      if (mode === 'presentation') await presentation(page);
      await page.evaluate(async () => { await document.fonts.ready; });
      for (const year of [0, 20]) {
        const label = year === 0 ? (lang === 'ru' ? 'Посадка' : 'Отырғызу') : (lang === 'ru' ? '20 лет' : '20 жыл');
        await timeMachine.getByRole('radiogroup').locator('label').filter({ hasText: new RegExp(`^${label}$`) }).click();
        await expect(timeMachine.getByRole('radio', { name: label, exact: true })).toBeChecked();
        await expect(timeMachine.locator('.gp-tm__stats')).toBeVisible();
        const explanation = timeMachine.locator(':scope > p').last();
        await centerContent(explanation);
        await inspectAssistantClearance(explanation, `${lang}-${mode}-growth-${year}-method`, info);
        await centerContent(timeMachine.locator('.gp-tm__stats'));
        await inspectAssistantClearance(timeMachine.locator('.gp-tm__stats'), `${lang}-${mode}-growth-${year}-values`, info);
      }
    }
  });
}
