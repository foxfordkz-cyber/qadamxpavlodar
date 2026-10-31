import { expect, type Locator, type Page } from '@playwright/test';
import { openPage } from './helpers';
import { mockRole, switchLanguage } from './session';

export type AcceptanceLanguage = 'ru' | 'kk';
export const viewerWords = {
  ru: { more: /Ещё/, create: /Новое задание/, assign: /^Назначить$/, approve: /^(Утвердить план дня|Утвердить заново)$/, accept: /Принять$/, return: /Вернуть на исправление$/ },
  kk: { more: /Тағы/, create: /Жаңа тапсырма/, assign: /^Тағайындау$/, approve: /^(Күндік жоспарды бекіту|Қайта бекіту)$/, accept: /Қабылдау$/, return: /Түзетуге қайтару$/ },
};

export async function mockViewer(page: Page, route: string, lang: AcceptanceLanguage) {
  await openPage(page, '/', 'mock');
  await mockRole(page, 'Просмотр');
  if (lang === 'kk') await switchLanguage(page, 'Қаз');
  // A hash transition preserves the selected mock session. A full navigation
  // would reset the in-memory demo role and could accidentally test coordinator.
  await page.evaluate(route => { location.hash = route; }, route);
  await expect(page).toHaveURL(new RegExp(`#${route.replace(/[?]/g, '\\?')}$`));
  await expect(page.locator('.gp-status-row > .gp-kv').first().locator('dd')).toContainText(lang === 'kk' ? 'Қарау' : 'Просмотр');
}

export async function expectViewerNavigation(page: Page, lang: AcceptanceLanguage) {
  const nav = page.locator('nav.gp-nav');
  const more = nav.getByRole('button', { name: viewerWords[lang].more });
  if (await more.count()) await more.click();
  for (const route of ['/map', '/lab', '/outcomes', '/tasks', '/reports']) {
    await expect.soft(nav.locator(`a[href="#${route}"]`), `Viewer navigation includes ${route}`).toBeVisible();
  }
}

export async function expectUnavailable(controls: Locator, label: string) {
  for (const control of await controls.all()) {
    if (await control.isVisible()) expect.soft(await control.isEnabled(), `${label} must be unavailable to viewer`).toBe(false);
  }
}

export async function expectNoTaskMutations(page: Page, lang: AcceptanceLanguage) {
  await expect(page.locator('#main .gp-planbar')).toBeVisible();
  await expect(page.locator('#main .gp-state .gp-spinner')).toHaveCount(0);
  const words = viewerWords[lang];
  for (const [label, name] of [['create', words.create], ['assign', words.assign], ['approve day plan', words.approve]] as const) {
    await expectUnavailable(page.locator('#main').getByRole('button', { name }), label);
  }
}

export async function expectNoReportMutations(page: Page, lang: AcceptanceLanguage) {
  await expectUnavailable(page.locator('.gp-report').getByRole('button', { name: viewerWords[lang].accept }), 'accept report');
  await expectUnavailable(page.locator('.gp-report').getByRole('button', { name: viewerWords[lang].return }), 'return report');
}
