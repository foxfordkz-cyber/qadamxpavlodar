import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { zoneToDocument } from '../support/final-journey';
import { openPage, dismissHint, presentation, SITE } from '../support/helpers';
import { outcomeWords } from '../support/outcomes-ui';

const language = (info: TestInfo) => info.project.metadata.lang as 'ru'|'kk';
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await info.attach(name, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test('public mock: complete menu and three calculated laboratory plans', async ({page}, info) => {
  const lang=language(info);
  await openPage(page, '/', 'mock', lang);
  const nav=page.locator('nav.gp-nav');
  const more=nav.getByRole('button', {name:lang==='kk'?/Тағы/:/Ещё/});
  if (await more.count()) await more.click();
  const links=nav.locator('a');
  expect(await links.count()).toBeGreaterThanOrEqual(13);
  for (let i=0;i<await links.count();i++) {
    await expect(links.nth(i)).toBeVisible();
    // The phone design intentionally scrolls its tab strip. Verify keyboard
    // reachability and actual hit area there; the all-at-once E2E-07 contract
    // applies to desktop and must not be invented for the phone.
    if (page.viewportSize()!.width === 375) {
      await links.nth(i).focus();
      await expect(links.nth(i)).toBeFocused();
      await links.nth(i).scrollIntoViewIfNeeded();
      expect(await links.nth(i).evaluate(el=>{
        const b=el.getBoundingClientRect(); const hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);
        return hit===el || (!!hit && el.contains(hit));
      })).toBe(true);
    }
    const box=await links.nth(i).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x+box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await openPage(page, '/lab', 'mock', lang);
  await expect(page.locator('.gp-lab-card')).toHaveCount(3);
  for (const metric of ['spent','water','survival']) {
    const values=await page.locator(`.gp-lab-card [data-metric=${metric}]`).allTextContents();
    expect(values).toHaveLength(3);
    expect(values.every(value=>/[0-9]/.test(value))).toBe(true);
  }
  await noOverflow(page);
  await capture(page,info,'public-completed-lab');
});

test('public mock: site → recommendation/estimate → growth → RU/KK DOCX XML', async ({page}, info) => {
  await zoneToDocument(page,'mock',language(info));
  await noOverflow(page);
  await capture(page,info,'public-completed-report');
});

test('public mock: Outcomes variants and inspection retain demonstration labels', async ({page},info) => {
  const lang=language(info), words=outcomeWords[lang];
  await openPage(page,`/outcomes?site=${SITE}`,'mock',lang);
  for (const variant of ['econom','optimal','max']) await expect(page.getByTestId(`outcome-${variant}`)).toBeVisible();
  await expect(page.getByLabel(words.cohort,{exact:true})).toBeVisible();
  await expect(page.getByLabel(words.inspection,{exact:true})).toBeVisible();
  await expect(page.locator('section[aria-labelledby="outcome-observed"]')).toContainText(lang==='ru'?'Демонстрационные данные':'Демонстрациялық деректер');
  await expect(page.getByTestId('outcome-stat-total').locator('dd')).not.toHaveText('0');
  await noOverflow(page);
  await capture(page,info,'public-completed-outcomes');
});

test('public mock E2E-09: weight controls and values remain accessible in normal/presentation modes',async({page},info)=>{
  await openPage(page,'/priorities','mock',language(info)); await dismissHint(page);
  const evidence:unknown[]=[];
  for (const mode of ['normal','presentation']) {
    if(mode==='presentation') await presentation(page);
    await page.evaluate(async()=>{await document.fonts.ready; window.scrollTo({top:0,behavior:'instant'});});
    const result=await page.locator('.gp-ranking__weights input, .gp-weight strong').evaluateAll(elements=>{
      const launcher=document.querySelector('.gp-assist-fab');
      const f=launcher?.getBoundingClientRect();
      return elements.map(el=>{
        const rectangles:DOMRect[]=[];
        if(el.matches('input')) rectangles.push(el.getBoundingClientRect());
        else {const range=document.createRange();range.selectNodeContents(el);rectangles.push(...range.getClientRects());}
        return {label:el.textContent?.trim()||el.getAttribute('aria-label')||el.getAttribute('type'),collisions:rectangles.flatMap(b=>{
          if(!f||!b.width||!b.height||b.top>=innerHeight||b.bottom<=0)return[];
          const l=Math.max(0,b.left,f.left),r=Math.min(innerWidth,b.right,f.right),t=Math.max(0,b.top,f.top),bottom=Math.min(innerHeight,b.bottom,f.bottom);
          if(r<=l||bottom<=t)return[];
          const covered=[0.2,0.5,0.8].some(x=>[0.2,0.5,0.8].some(y=>document.elementFromPoint(l+(r-l)*x,t+(bottom-t)*y)?.closest('.gp-assist-fab')));
          return covered?[{left:l,right:r,top:t,bottom,intersectionPx:(r-l)*(bottom-t)}]:[];
        })};
      });
    });
    expect(result.length).toBeGreaterThan(0);
    evidence.push({mode,result});
    await capture(page,info,`public-priorities-${mode}`);
    expect.soft(result.flatMap(x=>x.collisions),`${mode}: assistant covers a weight control or value`).toEqual([]);
  }
  await info.attach('public-assistant-hit-test',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});
});
