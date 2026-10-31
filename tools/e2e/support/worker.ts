import { expect, type Page } from '@playwright/test';

export async function workerReady(page: Page) {
  const cabinet = page.locator('green-worker');
  await expect(cabinet).toBeVisible();
  await expect(cabinet.locator('.date-tools button[data-action=refresh]')).toBeEnabled();
  await expect(cabinet.locator('.loading')).toHaveCount(0);
  // The component injects a stylesheet link; unstyled duplicate menus are not readiness.
  await expect.poll(() => cabinet.evaluate(node => {
    const link = node.shadowRoot?.querySelector('link[rel=stylesheet]') as HTMLLinkElement | null;
    return !!link?.sheet;
  })).toBe(true);
}

export async function workerProfileButton(page: Page) {
  await workerReady(page);
  const cabinet = page.locator('green-worker');
  const button = cabinet.getByRole('button', { name: /Профиль/ }).filter({ visible: true });
  await expect(button, 'E2E-06: embedded crew cabinet must expose one usable Profile navigation control').toHaveCount(1);
  return button;
}

// Reviewed labels from the merged worker dictionary. Choose exactly one language:
// allowing either RU or KK would hide a regression where the shell and cabinet differ.
const crewWords = {
  ru: { shift: 'Смена', journal: 'Журнал', profile: 'Профиль', journalHeading: 'Журнал работ',
    profileHeading: 'Карточка сотрудника', workerHeading: 'Моя смена', foremanHeading: 'Смена бригады',
    workerRole: 'Работник', foremanRole: 'Бригадир' },
  kk: { shift: 'Ауысым', journal: 'Журнал', profile: 'Профиль', journalHeading: 'Жұмыстар журналы',
    profileHeading: 'Қызметкер карточкасы', workerHeading: 'Менің ауысымым', foremanHeading: 'Бригада ауысымы',
    workerRole: 'Жұмысшы', foremanRole: 'Бригадир' },
} as const;

export async function crewKeyboardNavigation(page: Page, foreman = false, language: 'ru' | 'kk' = 'ru') {
  await workerReady(page);
  const cabinet = page.locator('green-worker');
  const words = crewWords[language];
  for (const [name, heading, key] of [
    [words.journal, words.journalHeading, 'Enter'], [words.profile, words.profileHeading, 'Space'],
    [words.shift, foreman ? words.foremanHeading : words.workerHeading, 'Enter'],
  ]) {
    const button = cabinet.getByRole('button', { name: new RegExp(`${name}$`) }).filter({ visible: true });
    await expect(button).toHaveCount(1);
    await button.focus();
    await page.keyboard.press(key);
    await expect(cabinet.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    if (heading === words.profileHeading) {
      await expect(cabinet.locator('.profile-role')).toHaveText(foreman ? words.foremanRole : words.workerRole);
    }
    await workerReady(page);
    await expect(button).toHaveAttribute('aria-current', 'page');
    await cabinet.locator('.page-footer').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    const layout = await cabinet.evaluate(node => {
      const root = node.shadowRoot!;
      const footer = root.querySelector('.page-footer')!.getBoundingClientRect();
      const menus = [...root.querySelectorAll('nav')].filter(nav => nav.getClientRects().length > 0);
      return { top: footer.top, bottom: footer.bottom, height: innerHeight,
        scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
        overlap: menus.some(nav => { const r = nav.getBoundingClientRect();
          return r.left < footer.right && r.right > footer.left && r.top < footer.bottom && r.bottom > footer.top;
        }) };
    });
    expect(layout.overlap, `${name}: navigation must not cover content`).toBe(false);
    expect(layout.top).toBeGreaterThanOrEqual(0);
    expect(layout.bottom).toBeLessThanOrEqual(layout.height + 1);
    expect(layout.scroll).toBeLessThanOrEqual(layout.client);
  }
}
