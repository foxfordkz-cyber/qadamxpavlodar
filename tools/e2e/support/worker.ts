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
