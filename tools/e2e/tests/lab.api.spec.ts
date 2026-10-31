import { test, expect } from '@playwright/test';
import { apiLogin, apiCall } from '../support/api-login';
import { auditForecast } from '../support/outcomes-oracle';

const sessions: Record<string, any[]> = {};
test.beforeAll(async ({browser,baseURL}) => {
  if (!process.env.E2E_PASSWORD) return;
  for (const role of ['coordinator','viewer']) {
    const context=await browser.newContext({baseURL});
    try { await apiLogin(await context.newPage(),role); sessions[role]=await context.cookies(); }
    finally { await context.close(); }
  }
});
async function labSession(page: import('@playwright/test').Page, role: string) {
  await page.context().addCookies(sessions[role]);
  await page.goto('/?source=api&lang=ru#/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.gp-login')).toHaveCount(0);
}

test.beforeEach(() => test.skip(!process.env.E2E_PASSWORD, 'E2E_PASSWORD is not set'));
for (const role of ['coordinator','viewer']) for (const lang of ['ru','kk'] as const) for (const width of [1280,375]) {
  test(`API lab: ${role}, ${lang}/${width}, real plans and frozen stress/rebuild`, async ({ page }) => {
    await page.setViewportSize({width,height:812});
    await labSession(page,role);
    const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/decision-lab') && r.request().method()==='POST' && r.status()===200);
    await page.goto(`/?source=api&lang=${lang}#/lab`,{waitUntil:'domcontentloaded'});
    const result=await (await response).json();
    expect(result.data.basis.provenance.source).toBe('api');
    const cards=page.locator('.gp-lab-card'); await expect(cards).toHaveCount(3);
    const identity=()=>cards.locator('[data-scheme]').evaluateAll(nodes=>nodes.map(n=>[n.getAttribute('data-site-id'),n.getAttribute('data-scheme')]));
    const before=await identity(); expect(before.length).toBeGreaterThan(0);
    await page.getByRole('radio',{name:lang==='ru'?'Без полива':'Суарылмайды',exact:true}).check();
    expect(await cards.locator('[data-metric=water]').allTextContents()).toEqual(['0','0','0']);
    expect(await identity()).toEqual(before);
    const reply=await apiCall(page,'/decision-lab','POST',{budgetKzt:50e6,waterLimitM3:500,watering:'none',goal:'schools'});
    expect(reply.status).toBe(200);
    expect(reply.body.data.plans.every((p:any)=>p.baseline.spentKzt<=50e6 && p.baseline.waterM3<=500 && p.scenario.waterM3===0)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
test('API lab: errors remain API errors; retry recovers without mock data',async({page})=>{
  await labSession(page,'viewer');
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

test('API lab: displayed explanations and totals match independent cost, water and survival arithmetic', async ({page}) => {
  await labSession(page,'coordinator');
  const reply=page.waitForResponse(r=>r.url().endsWith('/api/v1/decision-lab') && r.request().method()==='POST' && r.status()===200);
  await page.goto('/?source=api&lang=ru#/lab',{waitUntil:'domcontentloaded'});
  const data=(await (await reply).json()).data;
  const rates=Object.fromEntries(data.basis.rateEntries.map((r:any)=>[r.key,r.value]));
  const format=(value:number,digits=1)=>value.toLocaleString('ru-RU',{maximumFractionDigits:digits});
  for (const plan of data.plans) {
    const card=page.locator(`.gp-lab-card[data-plan="${plan.id}"]`);
    await card.locator('.gp-lab-reasons summary').click();
    let total=0, water=0, expectedTrees=0, trees=0;
    for (const zone of plan.zones) {
      const audit=auditForecast({analysis:zone.analysis,catalog:data.basis.catalog,rates:data.basis.rateEntries});
      const treeCount=zone.analysis.scheme.filter((r:any)=>r.tier==='tree').reduce((s:number,r:any)=>s+r.quantity,0);
      const shrubCount=zone.analysis.scheme.filter((r:any)=>r.tier==='shrub').reduce((s:number,r:any)=>s+r.quantity,0);
      const visits=zone.analysis.care.filter((r:any)=>r.operation==='Полив').reduce((s:number,r:any)=>s+r.visits,0);
      const expectedWater=visits*(treeCount*rates['care.water.tree']+shrubCount*rates['care.water.shrub'])/1000;
      expect(zone.costKzt).toBeCloseTo(audit.total,5);
      expect(zone.waterM3).toBeCloseTo(expectedWater,8);
      expect(zone.expectedTreesY3).toBeCloseTo(audit.expected,8);
      total+=audit.total; water+=expectedWater; expectedTrees+=audit.expected; trees+=treeCount;
      const reason=card.locator(`[data-site-id="${zone.siteId}"]`);
      await expect(reason).toContainText(`Базовая смета: ${format(audit.total,0)} ₸`);
      await expect(reason).toContainText(format(expectedWater));
      const context=zone.site.context??{};
      const expectedDeficit=Math.round(Math.max(0,1-(context.greenShare200m??0)/0.3)*100);
      // Laboratory social evidence is typed OSM data, not legacy name strings.
      const proofIds=new Set(zone.social.map((proof:any)=>proof.id));
      expect(proofIds.size).toBe(zone.social.length);
      const expectedSocial=Math.min(100,proofIds.size*25);
      expect(zone.explanation.find((e:any)=>e.key==='lab.factor.deficit').value).toBe(expectedDeficit);
      expect(zone.explanation.find((e:any)=>e.key==='lab.factor.social').value).toBe(expectedSocial);
      await expect(reason).toContainText(`Дефицит зелени: ${expectedDeficit}/100`);
      await expect(reason).toContainText(`Социальные объекты рядом: ${expectedSocial}/100`);
    }
    expect(total).toBeLessThanOrEqual(data.input.budgetKzt);
    expect(plan.baseline.spentKzt).toBeCloseTo(total,5);
    expect(plan.baseline.waterM3).toBeCloseTo(water,8);
    expect(plan.baseline.expectedTreesY3).toBeCloseTo(expectedTrees,8);
    expect(plan.baseline.survivalY3).toBeCloseTo(expectedTrees/trees*100,8);
    await expect(card.locator('[data-metric=spent]')).toHaveText(`${format(total,0)} ₸`);
    await expect(card.locator('[data-metric=water]')).toHaveText(format(water));
    await expect(card.locator('[data-metric=expected]')).toHaveText(format(expectedTrees));
  }
});
