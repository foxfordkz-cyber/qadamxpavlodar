import { test, expect, type Page, type Locator } from '../support/test';
import { species } from '../support/catalogue';
import { openPage, dismissHint, SITE } from '../support/helpers';
import { expectNoOverflow } from '../support/session';
import { ru } from '../../../apps/web/src/shared/i18n/ru';
import { kk } from '../../../apps/web/src/shared/i18n/kk';

async function switchLanguage(page: Page, language: 'Рус' | 'Қаз') {
  const button = page.getByRole('group', { name: 'Язык / Тіл', exact: true }).getByRole('button', { name: language, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

async function translatedSpecies(page: Page, container: Locator) {
  // Analysis and catalogue load independently; aria-busy covers only the former.
  await expect.poll(async () => {
    const text = await container.innerText();
    return species.some(s => text.includes(s.nameRu));
  }, { message: 'Wait for actual catalogue names before comparing translations' }).toBe(true);
  const russian = await container.innerText();
  const used = species.filter(s => russian.includes(s.nameRu));
  expect(used.length, 'The selected view must contain actual catalogue species').toBeGreaterThan(0);
  const latin = used.filter(s => russian.includes(s.latin)).map(s => s.latin);
  await switchLanguage(page, 'Қаз');
  for (const s of used) await expect(container).toContainText(s.nameKk || s.nameRu);
  for (const name of latin) await expect(container).toContainText(name);
}

test('PR14: header language persists after reload and preserves the current route', async ({ page }) => {
  await openPage(page, '/priorities');
  const route = new URL(page.url()).hash;
  await switchLanguage(page, 'Қаз');
  await expect(page.locator('nav.gp-nav').getByRole('link', { name: 'Басымдықтар', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(new URL(page.url()).hash).toBe(route);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('nav.gp-nav').getByRole('link', { name: 'Басымдықтар', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(new URL(page.url()).hash).toBe(route);
  await switchLanguage(page, 'Рус');
  await expect(page.locator('nav.gp-nav').getByRole('link', { name: 'Приоритеты', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('PR14: catalogue finds the same pine by Russian, Kazakh and Latin names', async ({ page }) => {
  await openPage(page, '/species', 'mock', 'kk');
  const pine = species.find(s => s.id === 'sp-pinus-sylvestris')!;
  expect(pine.nameKk).toBe('Кәдімгі қарағай');
  const search = page.locator('#main input[type=search]');
  for (const query of [pine.nameRu, pine.nameKk!, pine.latin]) {
    await search.fill(query);
    const cards = page.locator('.gp-spcard');
    await expect(cards).toHaveCount(1);
    await expect(cards.locator('.gp-spcard__name')).toHaveText('Кәдімгі қарағай');
    await expect(cards.locator('i')).toHaveText(pine.latin);
  }
});

test('PR14: unconfirmed Kazakh plant names fall back to the Russian catalogue name', async ({ page }) => {
  await openPage(page, '/species', 'mock', 'kk');
  const fallback = species.filter(s => s.nameKk === null);
  expect(fallback.length).toBeGreaterThan(0);
  // Read the current catalogue instead of freezing the historical 24/26 translation counts.
  for (const s of fallback) {
    await page.locator('#main input[type=search]').fill(s.latin);
    const card = page.locator('.gp-spcard').filter({ has: page.locator('i', { hasText: s.latin }) });
    await expect(card.locator('.gp-spcard__name')).toHaveText(s.nameRu);
    await expect(card.locator('i')).toHaveText(s.latin);
  }
});

for (const tab of ['Растения', 'Приживаемость']) {
  test(`PR14: translated species in zone tab ${tab} preserve Latin names`, async ({ page }) => {
    await openPage(page, `/map?site=${SITE}`);
    await dismissHint(page);
    const card = page.locator('.gp-sites__card');
    await card.getByRole('tab', { name: tab, exact: true }).click();
    await expect(card.locator('.gp-zone')).toHaveAttribute('aria-busy', 'false');
    await translatedSpecies(page, card.locator('.gp-zone'));
    expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('site')).toBe(SITE);
  });
}

test('PR14: estimate translates service headings and preserves every numeric cost cell', async ({ page }) => {
  await openPage(page, `/map?site=${SITE}`);
  await dismissHint(page);
  const card = page.locator('.gp-sites__card');
  await card.getByRole('tab', { name: 'Смета', exact: true }).click();
  const section = card.locator('section[aria-labelledby="z-cost"]');
  await expect(section.locator('tbody tr').first()).toBeVisible();
  const numbers = () => section.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('td')]
    .slice(1).map(cell => cell.textContent?.match(/\d+(?:[.,]\d+)?/g) ?? [])));
  const before = await numbers();
  await switchLanguage(page, 'Қаз');
  await expect(section.getByRole('columnheader', { name: 'Статья', exact: true })).toHaveCount(0);
  await expect(section.getByRole('columnheader', { name: 'Сумма', exact: true })).toHaveCount(0);
  expect(await numbers()).toEqual(before);
  // This view contains cost categories, not species names; those are checked in planting,
  // survival, the zone report and DOCX rather than inventing a species list for the estimate.
});

test('PR14: zone report translates plant names while retaining Latin names and numbers', async ({ page }) => {
  await openPage(page, `/report?site=${SITE}`);
  const report = page.locator('.gp-report-doc');
  const numbers = () => report.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('td')]
    .slice(1).map(cell => cell.textContent?.match(/\d+(?:[.,]\d+)?/g) ?? [])));
  const before = await numbers();
  await translatedSpecies(page, report);
  expect(await numbers()).toEqual(before);
  await expectNoOverflow(page);
});

test('PR14: dashboard counters translate their labels while preserving data values', async ({ page }) => {
  await openPage(page);
  const cards = page.locator('.gp-home .gp-tile--metric');
  await expect(cards.first()).toBeVisible();
  const values = await cards.locator('.gp-tile__value').allTextContents();
  const labels = await cards.locator('.gp-tile__label').allTextContents();
  const translations = new Map(Object.entries(ru).map(([key, value]) => [value, kk[key as keyof typeof kk]]));
  const expected = labels.map(label => translations.get(label));
  expect(expected.every(Boolean), 'Every displayed service label has a Kazakh dictionary entry').toBe(true);
  await switchLanguage(page, 'Қаз');
  await expect(cards.locator('.gp-tile__label')).toHaveText(expected as string[]);
  await expect(cards.locator('.gp-tile__value')).toHaveText(values);
  await expectNoOverflow(page);
});

test('PR14: rule assistant answers Kazakh then Russian with identical priorities and factors', async ({ page }) => {
  await openPage(page, '/map');
  await dismissHint(page);
  await page.getByRole('button', { name: 'Открыть ассистента', exact: true }).click();
  const ask = async (question: string, prefix: RegExp) => {
    const messages = page.locator('.gp-assist__msg--bot');
    const count = await messages.count();
    await page.getByRole('textbox', { name: 'Вопрос ассистенту' }).fill(question);
    await page.getByRole('button', { name: 'Спросить', exact: true }).click();
    await expect(messages).toHaveCount(count + 1);
    const reply = messages.last();
    await expect(reply.locator('p').first()).toHaveText(prefix);
    await expect(reply.locator('.gp-assist__proof')).toContainText(/правил/i);
    const paragraphs = await reply.locator(':scope > p').allTextContents();
    const ids = await reply.locator('.gp-assist__zones a').evaluateAll(links => links.map(link =>
      new URLSearchParams(new URL((link as HTMLAnchorElement).href).hash.split('?')[1]).get('site')));
    expect(ids.length).toBeGreaterThan(0);
    await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('hl')?.split(',')).toEqual(ids);
    return { ids, numbers: paragraphs.join('\n').match(/\d+(?:[.,]\d+)?/g) };
  };
  const kk = await ask('Бірінші кезекте қай аумақтарды көгалдандыру керек?', /^Басымдық индексі бойынша алғашқы бестік/);
  const ru = await ask('Какие зоны озеленять в первую очередь?', /^Первая пятёрка/);
  expect(kk).toEqual(ru);
});
