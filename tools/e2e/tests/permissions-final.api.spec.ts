import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from '../support/test';
import { apiCall, apiLogin } from '../support/api-login';
import { SITE } from '../support/helpers';
import { expectNoOverflow } from '../support/session';
import { workerReady } from '../support/worker';
import { expectNoReportMutations, expectNoTaskMutations, expectViewerNavigation, type AcceptanceLanguage } from '../support/permissions-final';

test.describe.configure({ mode: 'default' });
test.beforeEach(() => test.skip(!process.env.E2E_PASSWORD, 'E2E_PASSWORD is not set'));
let tasks: Record<string, any> = {};
let viewerLogins: string[] = [];
let report: any;
let referenceCrews: any[] = [], referenceWorkers: any[] = [];
const day = '2026-10-28';
const taskBody = (description: string) => ({ objectType: 'candidate_site', objectId: SITE, action: 'inspect',
  description, priority: 'medium', priorityWeight: 50, estimatedMinutes: 15, minWorkers: 1,
  requiredSkills: ['inspect'], evidenceIds: ['demo-v2-evidence'] });

test.beforeAll(async ({ baseURL }) => {
  if (!process.env.E2E_PASSWORD) return;
  expect(process.env.E2E_ISOLATED, 'Mutating acceptance fixtures require scripts/isolated.mjs and an isolated database').toBe('1');
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL!).hostname);
  const root = resolve(process.env.STORAGE_ROOT ?? '');
  const rel = relative(fileURLToPath(new URL('../test-results/', import.meta.url)), root);
  expect(rel.startsWith('isolated-api-') && !rel.startsWith('..') && !isAbsolute(rel)).toBe(true);
  const fixture = JSON.parse(readFileSync(join(root, 'qa-permissions.json'), 'utf8'));
  expect(fixture.isDemo).toBe(true);
  ({ tasks, report, viewerLogins } = fixture);
  referenceCrews = fixture.crews;
  referenceWorkers = fixture.workers;
  expect(referenceCrews.length).toBeGreaterThan(0);
  expect(referenceWorkers.length).toBeGreaterThan(0);
});

async function login(page: Page, username: string, route = '/', lang: AcceptanceLanguage = 'ru') {
  await apiLogin(page, username, route);
  await expect(page.locator('.gp-header__right')).toContainText(username.startsWith('qa-final-viewer-') ? 'Просмотр' : 'Работник');
  if (lang === 'kk') {
    const selected = page.getByRole('group', { name: 'Язык / Тіл', exact: true }).getByRole('button', { name: 'Қаз', exact: true });
    await selected.click();
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.locator('.gp-status-row > .gp-kv').first().locator('dd')).toContainText(
    username.startsWith('qa-final-viewer-') ? lang === 'kk' ? 'Қарау' : 'Просмотр' : 'Работник');
}

let viewerCase = 0;
function viewerTest(title: string, scenario: (page: Page, username: string) => Promise<void>) {
  const index = viewerCase++;
  test(title, async ({ page }) => { await scenario(page, viewerLogins[index]); });
}

for (const endpoint of ['/tasks', '/reports', '/crews', '/workers']) {
  viewerTest(`final viewer API: ${endpoint} returns existing authorized records`, async (page, username) => {
    await login(page, username);
    const read = await apiCall(page, endpoint);
    expect(read.status).toBe(200);
    const expected = endpoint === '/tasks' ? [tasks['viewer-read'].id] : endpoint === '/reports' ? [report.id]
      : endpoint === '/crews' ? referenceCrews.map(c => c.id) : referenceWorkers.map(w => w.id);
    expect(read.body.data.map((row: any) => row.id), `${endpoint}: viewer must receive the existing data, not an empty successful response`).toEqual(expect.arrayContaining(expected));
  });
}

for (const width of [1280, 375]) for (const lang of ['ru', 'kk'] as const) {
  viewerTest(`final viewer API UI: ${lang}/${width}, work and report navigation remains available`, async (page, username) => {
    await page.setViewportSize({ width, height: 812 });
    await login(page, username, '/', lang);
    await expectViewerNavigation(page, lang);
    await expectNoOverflow(page);
  });

  viewerTest(`final viewer API UI: ${lang}/${width}, tasks, crews and people are readable without writes`, async (page, username) => {
    await page.setViewportSize({ width, height: 812 });
    await login(page, username, '/tasks', lang);
    await expectNoTaskMutations(page, lang);
    await expect(page.locator('.gp-tasks')).toContainText(tasks['viewer-read'].id);
    for (const crew of referenceCrews) await expect(page.locator('.gp-tasks__workers')).toContainText(crew.name);
    for (const id of ['demo-worker-1', 'demo-foreman-1']) {
      await expect(page.locator('.gp-tasks__workers')).toContainText(referenceWorkers.find(w => w.id === id).displayName);
    }
    await expect(page.locator('#main [role=alert]')).toHaveCount(0);
    await expectNoOverflow(page);
  });

  viewerTest(`final viewer API UI: ${lang}/${width}, report detail remains readable without review controls`, async (page, username) => {
    await page.setViewportSize({ width, height: 812 });
    await login(page, username, `/reports?report=${report.id}`, lang);
    await expect(page.locator('.gp-report h2')).toHaveText(report.id);
    await expect(page.locator('.gp-report .gp-quote')).toHaveText(report.note);
    await expectNoReportMutations(page, lang);
    await expect(page.locator('#main [role=alert]')).toHaveCount(0);
    await expectNoOverflow(page);
  });
}

viewerTest('final viewer API: valid task, crew and report mutations are rejected with 403', async (page, username) => {
  await login(page, username);
  const actions = [
    { path: '/tasks', body: taskBody('QA DEMO forbidden viewer task') },
    { path: '/crews', body: { name: 'QA DEMO forbidden viewer crew', foremanId: 'demo-foreman-1', resourceIds: [] } },
    { path: `/reports/${report.id}/review`, body: { expectedVersion: tasks['viewer-read'].version,
      expectedReportVersion: report.version, decision: 'accepted', comment: 'QA DEMO viewer must not accept', acceptGeometryDeviation: false } },
  ];
  for (const action of actions) {
    const response = await apiCall(page, action.path, 'POST', action.body, randomUUID());
    expect.soft(response.status, `Viewer POST ${action.path}`).toBe(403);
  }
});

for (const width of [1280, 375]) {
  test(`final worker API: ${width}px, browser submits a real report and reload retains one server record`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await login(page, 'worker1', '/worker');
    await workerReady(page);
    const cabinet = page.locator('green-worker'), task = tasks[`worker-${width}`];
    await cabinet.locator('#shift-date').fill(day);
    await cabinet.locator('#shift-date').press('Tab');
    await expect(cabinet.locator(`[data-action=select][data-id="${task.id}"]`)).toBeVisible();
    await cabinet.locator(`[data-action=select][data-id="${task.id}"]`).click();
    await cabinet.getByRole('button', { name: 'Отчитаться', exact: true }).click();
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
      const context = canvas.getContext('2d')!; context.fillStyle = '#cfe9d8'; context.fillRect(0, 0, 96, 64);
      context.fillStyle = '#184c30'; context.font = '14px sans-serif'; context.fillText('QA DEMO', 10, 36);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await cabinet.locator('input#photo').setInputFiles({ name: 'qa-synthetic-demo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await expect(cabinet.locator('.preview img')).toBeVisible();
    const note = `QA DEMO browser report ${width}px — synthetic isolated acceptance`;
    await cabinet.locator('textarea#note').fill(note);
    await expect(cabinet.locator('[data-save-status]')).toContainText('Сохранено на устройстве');
    const sending = page.waitForResponse(response => response.url().endsWith(`/tasks/${task.id}/reports`) && response.request().method() === 'POST');
    await cabinet.getByRole('button', { name: 'Отправить на проверку', exact: true }).click();
    const response = await sending;
    expect(response.status()).toBe(201);
    const saved = (await response.json()).data;
    expect(saved.task.status).toBe('submitted');
    expect(saved.report.note).toBe(note);
    expect(saved.report.authorId).toBe('demo-worker-1');
    expect(saved.report.photoIds).toHaveLength(1);
    expect(saved.report.reviewStatus).toBe('pending');
    await expect(cabinet.getByText('Отчёт сохранён. Ожидает проверки координатором.', { exact: true })).toBeVisible();
    const server = await apiCall(page, `/reports/${saved.report.id}`);
    expect(server.status).toBe(200);
    expect(server.body.data).toMatchObject({ id: saved.report.id, taskId: task.id, note, photoIds: saved.report.photoIds });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await workerReady(page);
    await cabinet.locator('#shift-date').fill(day);
    await cabinet.locator('#shift-date').press('Tab');
    await cabinet.locator('button[data-action=tab][data-id=submitted]').click();
    await expect(cabinet.locator(`[data-action=select][data-id="${task.id}"]`)).toBeVisible();
    await cabinet.locator(`[data-action=select][data-id="${task.id}"]`).click();
    await expect(cabinet.locator('.detail-history')).toContainText(note);
    expect((await apiCall(page, `/reports?taskId=${task.id}`)).body.data).toHaveLength(1);
    await expectNoOverflow(page);
  });
}
