import { test, expect } from '@playwright/test';
import { apiLogin, apiCall } from '../support/api-login';

test.beforeEach(() => test.skip(!process.env.E2E_PASSWORD, 'E2E_PASSWORD is not set'));
for (const role of ['coordinator','viewer']) for (const lang of ['ru','kk'] as const) for (const width of [1280,375]) {
  test(`API lab: ${role}, ${lang}/${width}, real plans and frozen stress/rebuild`, async ({ page }) => {
    await page.setViewportSize({width,height:812});
    await apiLogin(page,role);
    const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/decision-lab') && r.request().method()==='POST' && r.status()===200);
    await page.goto(`/?source=api&lang=${lang}#/lab`,{waitUntil:'domcontentloaded'});
    const result=await (await response).json();
    expect(result.data.basis.provenance.source).toBe('api');
    const cards=page.locator('.gp-lab-card'); await expect(cards).toHaveCount(3);
    const identity=()=>cards.locator('[data-scheme]').evaluateAll(nodes=>nodes.map(n=>[n.getAttribute('data-site-id'),n.getAttribute('data-scheme')]));
    const before=await identity(); expect(before.length).toBeGreaterThan(0);
    await page.getByRole('radio',{name:lang==='ru'?'Без полива':'Суармай',exact:true}).check();
    expect(await cards.locator('[data-metric=water]').allTextContents()).toEqual(['0','0','0']);
    expect(await identity()).toEqual(before);
    const reply=await apiCall(page,'/decision-lab','POST',{budgetKzt:50e6,waterLimitM3:500,watering:'none',goal:'schools'});
    expect(reply.status).toBe(200);
    expect(reply.body.data.plans.every((p:any)=>p.baseline.spentKzt<=50e6 && p.baseline.waterM3<=500 && p.scenario.waterM3===0)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
test('API lab: errors remain API errors; retry recovers without mock data',async({page})=>{
  await apiLogin(page,'viewer');
  await page.route('**/api/v1/decision-lab',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'QA_UNAVAILABLE',message:'QA simulated failure'}})}));
  await page.goto('/?source=api&lang=ru#/lab',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.gp-lab-results [role=alert]').first()).toBeVisible();
  await expect(page.locator('.gp-lab-card')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('source')).toBe('api');
  await page.unroute('**/api/v1/decision-lab');
  const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/decision-lab') && r.status()===200);
  await page.locator('.gp-lab-results').getByRole('button',{name:/Повторить/}).click();
  expect((await (await response).json()).data.basis.provenance.source).toBe('api');
  await expect(page.locator('.gp-lab-card')).toHaveCount(3);
});
