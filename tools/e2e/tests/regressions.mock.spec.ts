import { test, expect, type Page } from '../support/test';
import { SITE, openPage, dismissHint, openEffect, chooseYear } from '../support/helpers';

function mapParams(url: string) {
  return new URLSearchParams(new URL(url).hash.split('?')[1] ?? '');
}

async function ask(page: Page, question: string) {
  await page.getByRole('button', { name: 'Открыть ассистента', exact: true }).click();
  await page.getByRole('textbox', { name: 'Вопрос ассистенту' }).fill(question);
  await page.getByRole('button', { name: 'Спросить', exact: true }).click();
  return page.locator('.gp-assist__msg--bot').last();
}

for (const command of ['нарисуй зону', 'аймақ сыз']) {
  test(`assistant drawing: specialist sends «${command}» from priorities and cancels`, async ({ page }) => {
    await openPage(page, '/priorities');
    await ask(page, command);
    await expect(page).toHaveURL(/#\/map(?:\?|$)/);
    const draw = page.locator('.gp-drawbar');
    await expect(draw).toBeVisible();
    await dismissHint(page);
    // Close via its button: Escape would also cancel drawing, masking the Cancel test.
    await page.getByRole('button', { name: 'Закрыть ассистента', exact: true }).click();
    await draw.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(draw).toHaveCount(0);
    await expect(page).toHaveURL(/#\/map(?:\?|$)/);
  });

  test(`assistant drawing: viewer is denied «${command}»`, async ({ page }) => {
    await openPage(page, '/priorities');
    await page.getByRole('button', { name: '⚙ Режим проверки', exact: true }).click();
    await page.getByRole('radio', { name: 'Просмотр', exact: true }).check();
    await page.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
    // Role switching may return to home; navigate through the UI, preserving the role.
    await page.locator('nav.gp-nav').getByRole('link', { name: 'Приоритеты', exact: true }).click();
    const reply = await ask(page, command);
    await expect(reply).toContainText('Рисовать зоны может только специалист');
    await expect(page.locator('.gp-drawbar')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/priorities$/);
  });
}

test('time machine: canopy grows at 5, 10, 20 years; planting describes seedlings', async ({ page }) => {
  const card = await openEffect(page, SITE);
  expect(mapParams(page.url()).get('site')).toBe(SITE);
  const canopy: number[] = [];
  for (const year of ['5 лет', '10 лет', '20 лет']) {
    await chooseYear(page, year);
    const value = card.locator('.gp-tm__stats strong').first();
    await expect(value).toContainText('м²');
    const number = (await value.innerText()).match(/[\d\s\u00a0\u202f]+(?:[.,]\d+)?/)?.[0];
    canopy.push(Number(number?.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')));
  }
  expect(canopy.every(Number.isFinite), `Canopy: ${canopy}`).toBe(true);
  expect(canopy[0]).toBeGreaterThan(0);
  expect(canopy[1], `5 → 10 years: ${canopy}`).toBeGreaterThan(canopy[0]);
  expect(canopy[2], `10 → 20 years: ${canopy}`).toBeGreaterThan(canopy[1]);
  await chooseYear(page, 'Посадка');
  await expect(card.locator('.gp-tm__stats')).toContainText(/Саженцы.*приживания/);
});

test('mobile report: document fits the viewport and wide tables scroll internally', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'The report overflow regression targets 375×812');
  await openPage(page, `/report?site=${SITE}`);
  await expect(page.getByRole('heading', { name: '3. Смета', exact: true })).toBeVisible();
  const tables = page.locator('.gp-report-doc table');
  expect(await tables.count()).toBeGreaterThan(0);
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
  }));
  expect(sizes.client).toBe(375);
  expect(sizes.scroll, `Report width ${sizes.scroll}, viewport ${sizes.client}`).toBeLessThanOrEqual(sizes.client);
  const measurements = await tables.evaluateAll(elements => elements.map(table => {
    const wide = table.scrollWidth > table.clientWidth;
    table.scrollLeft = wide ? 50 : 0;
    const result = { wide, scrolled: table.scrollLeft, overflow: getComputedStyle(table).overflowX,
      right: table.getBoundingClientRect().right };
    table.scrollLeft = 0;
    return result;
  }));
  for (const table of measurements) {
    expect(table.right).toBeLessThanOrEqual(sizes.client);
    if (table.wide) {
      expect(table.overflow).toMatch(/^(auto|scroll)$/);
      expect(table.scrolled).toBeGreaterThan(0);
    }
  }
});

test('empty map list: reset restores every zone', async ({ page }) => {
  await openPage(page, '/map');
  await dismissHint(page);
  const rows = page.locator('.gp-sites__items button');
  await expect(rows.first()).toBeVisible();
  const original = await rows.allTextContents();
  const search = page.getByRole('searchbox', { name: 'Поиск по названию, улице или ID', exact: true });
  await search.fill('zzzz');
  await expect(rows).toHaveCount(0);
  const empty = page.locator('.gp-sites__list .gp-state--empty');
  await expect(empty).toContainText('Ни один участок не подходит под фильтры');
  await empty.getByRole('button', { name: /Сбросить фильтры/ }).click();
  await expect(search).toHaveValue('');
  await expect(rows).toHaveText(original);
  await expect(empty).toHaveCount(0);
});

test('empty species list: reset restores every species', async ({ page }) => {
  await openPage(page, '/species');
  const names = page.locator('.gp-spcard__name');
  await expect(names.first()).toBeVisible();
  const original = await names.allTextContents();
  const search = page.getByRole('searchbox', { name: 'Поиск', exact: true });
  await search.fill('zzzz');
  await expect(names).toHaveCount(0);
  const empty = page.locator('#main .gp-state--empty');
  await expect(empty).toContainText('Ничего не найдено');
  await empty.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(names).toHaveText(original);
  await expect(empty).toHaveCount(0);
});

test('empty problems list: show all clears both filters and restores rows', async ({ page }) => {
  await openPage(page, '/problems');
  const rows = page.locator('#main table tbody tr');
  await expect(rows.first()).toBeVisible();
  const original = await rows.allTextContents();
  const type = page.getByRole('combobox', { name: 'Тип', exact: true });
  const severity = page.getByRole('combobox', { name: 'Острота', exact: true });
  // The mock snapshot has no detected degradation; exercise a real empty filter result.
  await type.selectOption({ label: 'Деградация насаждений' });
  await severity.selectOption({ label: 'Низкая' });
  const empty = page.locator('#main .gp-state--empty');
  await expect(empty).toContainText('Проблем по выбранным фильтрам нет');
  await expect(rows).toHaveCount(0);
  await empty.getByRole('button', { name: 'Показать все', exact: true }).click();
  await expect(type).toHaveValue('all');
  await expect(severity).toHaveValue('all');
  await expect(rows).toHaveText(original);
  await expect(empty).toHaveCount(0);
});

test('presentation: present=1 enables the mode and the exit pill disables it', async ({ page }) => {
  await page.goto('/?source=mock&lang=ru&present=1#/', { waitUntil: 'domcontentloaded' });
  const html = page.locator('html');
  await expect(html).toHaveClass(/\bgp-present\b/);
  const exit = page.getByRole('button', { name: 'Режим презентации · выйти', exact: true });
  await exit.click();
  await expect(html).not.toHaveClass(/\bgp-present\b/);
  await expect(exit).toHaveCount(0);
});

test('priorities: top ten IDs and numbered rows persist when selecting a zone', async ({ page }) => {
  await openPage(page, '/priorities');
  const ranked = page.locator('.gp-rank-item__head a');
  await expect(ranked.nth(9)).toBeVisible();
  const expectedIds = (await ranked.evaluateAll(links => links.slice(0, 10).map(link => (link as HTMLAnchorElement).href)))
    .map(url => mapParams(url).get('site'));
  expect(new Set(expectedIds).size).toBe(10);
  await page.getByRole('button', { name: /Топ-10 на карте/ }).click();
  await expect(page).toHaveURL(/#\/map\?.*\bhl=/);
  expect(mapParams(page.url()).get('hl')?.split(',')).toEqual(expectedIds);
  await dismissHint(page);
  const rows = page.locator('.gp-hl__item');
  await expect(rows).toHaveCount(10);
  await expect(rows.locator('.gp-hl__n')).toHaveText(Array.from({ length: 10 }, (_, i) => String(i + 1)));
  const chosen = rows.nth(3);
  const zoneName = (await chosen.innerText()).replace(/^4\s*/, '').trim();
  await chosen.click();
  await expect.poll(() => mapParams(page.url()).get('site')).toBe(expectedIds[3]);
  await expect(page.locator('.gp-sites__card')).toBeVisible();
  await expect(page.locator('.gp-sites__card')).toContainText(zoneName);
  await expect(page.locator('.gp-sites__card').getByRole('tab')).toHaveCount(6);
  expect(mapParams(page.url()).get('hl')?.split(',')).toEqual(expectedIds);
  await expect(rows).toHaveCount(10);
  await expect(chosen).toHaveAttribute('aria-current', 'true');
});
